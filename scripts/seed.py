"""
Seed data script for PayLedger.
Creates demo users, transactions, loans, fraud patterns, and mock bank statements.
Uses a fixed random seed for reproducibility.
"""
import os
import sys
import random
import csv
import uuid
import hashlib
import hmac
from datetime import datetime, timedelta, date
from decimal import Decimal
from io import StringIO

import psycopg

try:
    import bcrypt

    def hash_pw(password: str) -> str:
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
except Exception:
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

    def hash_pw(password: str) -> str:
        return pwd_context.hash(password)


def hash_kyc_identifier(raw_identifier: str) -> str:
    """Generate keyed HMAC-SHA256 digest for demo KYC identifier."""
    secret = os.environ.get("KYC_HMAC_SECRET", "dev-kyc-hmac-secret-change-in-production-789xyz")
    normalized = "".join(raw_identifier.strip().split()).replace("-", "").upper()
    return hmac.new(secret.encode("utf-8"), normalized.encode("utf-8"), hashlib.sha256).hexdigest()

def load_env():
    """Load key-value pairs from .env if present."""
    candidates = [
        os.path.join(os.getcwd(), ".env"),
        os.path.join(os.path.dirname(__file__), "..", ".env"),
        os.path.join(os.path.dirname(__file__), ".env"),
    ]
    for candidate in candidates:
        candidate = os.path.abspath(candidate)
        if os.path.isfile(candidate):
            with open(candidate, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k not in os.environ:
                        os.environ[k] = v
            break


def get_database_url() -> str:
    """Resolve database URL from environment or configuration."""
    load_env()
    db_url = os.environ.get("DATABASE_URL")
    if db_url:
        if "@db:" in db_url and not os.path.exists("/.dockerenv") and not os.path.exists("/app"):
            db_url = db_url.replace("@db:", "@localhost:")
        return db_url

    user = os.environ.get("POSTGRES_USER", "payledger_admin")
    password = os.environ.get("POSTGRES_PASSWORD", "payledger_secret_2024")
    host = os.environ.get("POSTGRES_HOST", "localhost")
    if host == "db" and not os.path.exists("/.dockerenv") and not os.path.exists("/app"):
        host = "localhost"
    port = os.environ.get("POSTGRES_PORT", "5432")
    dbname = os.environ.get("POSTGRES_DB", "payledger")
    return f"postgresql://{user}:{password}@{host}:{port}/{dbname}"


DATABASE_URL = get_database_url()

SEED = 42
random.seed(SEED)

# Fixed UUIDs for system accounts (predictable for testing)
SYSTEM_FEE_ACCOUNT = None
SYSTEM_SUSPENSE_ACCOUNT = None
LOAN_POOL_ACCOUNT = None


def run_seed():
    conn = psycopg.connect(DATABASE_URL, autocommit=False)
    conn.execute("SET search_path = payledger, public")

    try:
        print("=" * 60)
        print("PayLedger Seed Script")
        print("=" * 60)

        # ------------------------------------------------------------------
        # 1. Create admin user
        # ------------------------------------------------------------------
        print("\n[1/8] Creating admin user...")
        admin_id = create_user(conn, "Admin User", "admin@payledger.com", "+91-9000000001", "admin")
        print(f"  Admin: admin@payledger.com / password123")

        # ------------------------------------------------------------------
        # 2. Create loan officers
        # ------------------------------------------------------------------
        print("\n[2/8] Creating loan officers...")
        officer_ids = []
        for i in range(1, 3):
            uid = create_user(conn, f"Loan Officer {i}", f"officer{i}@payledger.com",
                            f"+91-900000010{i}", "loan_officer")
            officer_ids.append(uid)
            print(f"  Officer {i}: officer{i}@payledger.com / password123")

        # ------------------------------------------------------------------
        # 3. Create risk analysts
        # ------------------------------------------------------------------
        print("\n[3/8] Creating risk analysts...")
        analyst_ids = []
        for i in range(1, 3):
            uid = create_user(conn, f"Risk Analyst {i}", f"analyst{i}@payledger.com",
                            f"+91-900000020{i}", "risk_analyst")
            analyst_ids.append(uid)
            print(f"  Analyst {i}: analyst{i}@payledger.com / password123")

        # ------------------------------------------------------------------
        # 4. Create merchants
        # ------------------------------------------------------------------
        print("\n[4/8] Creating merchants...")
        merchant_names = ["ShopMart", "FoodExpress", "TechStore", "BookWorld", "StyleHub"]
        merchant_ids = []
        for i, name in enumerate(merchant_names):
            email = f"{name.lower()}@example.com"
            uid = create_user(conn, f"{name} Inc.", email,
                            f"+91-900000030{i}", "merchant")
            # Create merchant profile
            conn.execute("""
                INSERT INTO merchant_profiles (user_id, business_name, settlement_frequency, fee_rate)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (user_id) DO NOTHING
            """, (uid, name, random.choice(['daily', 'weekly', 'monthly']),
                  Decimal(str(round(random.uniform(0.01, 0.03), 4)))))
            merchant_ids.append(uid)
            print(f"  Merchant: {email} / password123")

        # ------------------------------------------------------------------
        # 5. Create customers
        # ------------------------------------------------------------------
        print("\n[5/8] Creating 200 customers...")
        first_names = ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace",
                       "Henry", "Iris", "Jack", "Kate", "Liam", "Mia", "Noah",
                       "Olivia", "Peter", "Quinn", "Rachel", "Sam", "Tara"]
        last_names = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia",
                      "Miller", "Davis", "Rodriguez", "Martinez"]

        customer_ids = []
        customer_accounts = {}  # user_id -> account_id

        for i in range(200):
            first = first_names[i % len(first_names)]
            last = last_names[i % len(last_names)]
            suffix = i // len(first_names)
            name = f"{first} {last}" + (f" {suffix}" if suffix > 0 else "")
            email = f"{first.lower()}{suffix if suffix else ''}@example.com"

            uid = create_user(conn, name, email, f"+91-9{i:09d}", "customer")
            customer_ids.append(uid)

            # Get customer's wallet account
            row = conn.execute(
                "SELECT id FROM accounts WHERE user_id = %s AND account_type = 'customer_wallet'",
                (uid,)
            ).fetchone()
            if row:
                customer_accounts[uid] = row[0]

            # Create KYC profile for most customers
            if random.random() < 0.8:
                kyc_status = random.choices(['verified', 'pending', 'rejected'],
                                           weights=[0.7, 0.2, 0.1])[0]
                conn.execute("""
                    INSERT INTO kyc_profiles (user_id, id_type, id_number_hash, status, verified_at)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (user_id) DO NOTHING
                """, (uid, random.choice(['aadhaar', 'pan', 'passport']),
                      hash_kyc_identifier(f"ID{i:06d}"), kyc_status,
                      datetime.now() - timedelta(days=random.randint(1, 180))
                      if kyc_status == 'verified' else None))

        # Named demo customers
        alice_id = customer_ids[0]  # alice@example.com
        bob_id = customer_ids[1]    # bob@example.com
        print(f"  Created 200 customers")
        print(f"  Demo: alice@example.com / password123")
        print(f"  Demo: bob@example.com / password123")

        # Get merchant accounts
        merchant_accounts = {}
        for mid in merchant_ids:
            row = conn.execute(
                "SELECT id FROM accounts WHERE user_id = %s AND account_type = 'merchant_wallet'",
                (mid,)
            ).fetchone()
            if row:
                merchant_accounts[mid] = row[0]

        # Get system accounts
        sys_fee = conn.execute(
            "SELECT id FROM accounts WHERE account_type = 'system_fee' LIMIT 1"
        ).fetchone()
        loan_pool = conn.execute(
            "SELECT id FROM accounts WHERE account_type = 'loan_pool' LIMIT 1"
        ).fetchone()

        fee_account_id = sys_fee[0] if sys_fee else None
        pool_account_id = loan_pool[0] if loan_pool else None

        conn.commit()

        # ------------------------------------------------------------------
        # 6. Generate ledger transactions (fund accounts first, then transfers)
        # ------------------------------------------------------------------
        print("\n[6/8] Generating ~20,000 ledger transactions over 6 months...")

        # Fund all customer wallets from loan_pool (simulating initial deposits)
        # This gives each customer between 1000-50000 INR
        funded_count = 0
        for uid, acc_id in list(customer_accounts.items())[:200]:
            amount = Decimal(str(random.randint(5000, 50000)))
            idem_key = f"seed-fund-{uid}"
            try:
                conn.execute("""
                    SELECT sp_transfer(%s, %s, %s, %s, %s, %s)
                """, (pool_account_id, acc_id, amount, idem_key,
                      "Initial funding (seed)", admin_id))
                conn.commit()
                funded_count += 1
            except Exception as e:
                conn.rollback()
                if funded_count < 5:
                    print(f"  Warning funding account: {e}")

        print(f"  Funded {funded_count} customer wallets")

        # Fund merchant accounts
        for mid, macc in merchant_accounts.items():
            amount = Decimal(str(random.randint(10000, 100000)))
            idem_key = f"seed-fund-merchant-{mid}"
            try:
                conn.execute("""
                    SELECT sp_transfer(%s, %s, %s, %s, %s, %s)
                """, (pool_account_id, macc, amount, idem_key,
                      "Merchant initial funding (seed)", admin_id))
                conn.commit()
            except Exception:
                conn.rollback()

        # Generate transfers between customers over 6 months
        now = datetime.now()
        txn_count = 0
        target_txns = 19000  # We already have ~200 funding txns

        active_customer_ids = list(customer_accounts.keys())
        active_merchant_ids = list(merchant_accounts.keys())

        for day_offset in range(180, 0, -1):
            txn_date = now - timedelta(days=day_offset)
            # ~100-120 transactions per day
            daily_count = random.randint(90, 130)

            for _ in range(daily_count):
                if txn_count >= target_txns:
                    break

                # 60% customer-to-customer transfers, 40% merchant payments
                if random.random() < 0.6:
                    # Customer-to-customer transfer
                    sender = random.choice(active_customer_ids)
                    receiver = random.choice(active_customer_ids)
                    if sender == receiver:
                        continue
                    amount = Decimal(str(random.randint(10, 5000)))
                    idem_key = f"seed-txn-{txn_count}-{uuid.uuid4().hex[:8]}"
                    descriptions = [
                        "Lunch money", "Rent share", "Gift", "Repayment",
                        "Groceries split", "Movie tickets", "Taxi fare",
                        "Coffee", "Dinner bill", "Utilities share"
                    ]
                    try:
                        conn.execute("""
                            SELECT sp_transfer(%s, %s, %s, %s, %s, %s, %s)
                        """, (customer_accounts[sender], customer_accounts[receiver],
                              amount, idem_key, random.choice(descriptions), sender, txn_date))
                        conn.commit()
                        txn_count += 1
                    except Exception:
                        conn.rollback()
                else:
                    # Merchant payment
                    customer = random.choice(active_customer_ids)
                    merchant = random.choice(active_merchant_ids)
                    amount = Decimal(str(random.randint(50, 10000)))
                    idem_key = f"seed-pay-{txn_count}-{uuid.uuid4().hex[:8]}"
                    try:
                        conn.execute("""
                            SELECT sp_pay_merchant(%s, %s, %s, %s, %s, %s)
                        """, (customer_accounts[customer], merchant_accounts[merchant],
                              amount, idem_key, customer, txn_date))
                        conn.commit()
                        txn_count += 1
                    except Exception:
                        conn.rollback()

            if txn_count >= target_txns:
                break

        print(f"  Generated {txn_count} transactions")

        # ------------------------------------------------------------------
        # 7. Create loans
        # ------------------------------------------------------------------
        print("\n[7/8] Creating loan products and ~60 loans...")

        # Loan products (should already exist from migration 014, but ensure)
        products = conn.execute("SELECT id, name FROM loan_products").fetchall()
        if not products:
            # Create loan products
            product_data = [
                ("Personal Loan", 12.0, 10000, 500000, 6, 60, 0.02, True),
                ("Education Loan", 8.5, 50000, 2000000, 12, 120, 0.015, True),
                ("Quick Cash", 18.0, 1000, 50000, 3, 24, 0.03, True),
                ("Home Improvement", 10.5, 100000, 1000000, 12, 84, 0.02, True),
            ]
            for name, rate, min_a, max_a, min_t, max_t, pen, pre in product_data:
                conn.execute("""
                    INSERT INTO loan_products (id, name, annual_rate, min_amount, max_amount,
                        min_tenure_months, max_tenure_months, penalty_rate, prepayment_allowed)
                    VALUES (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s)
                """, (name, rate, min_a, max_a, min_t, max_t, pen, pre))
            conn.commit()
            products = conn.execute("SELECT id, name FROM loan_products").fetchall()

        product_ids = [p[0] for p in products]

        # Create ~60 loan applications and loans in various states
        loan_count = 0
        for i in range(60):
            borrower = random.choice(customer_ids[:100])  # First 100 customers
            product_id = random.choice(product_ids)

            # Get product details
            prod = conn.execute(
                "SELECT min_amount, max_amount, min_tenure_months, max_tenure_months FROM loan_products WHERE id = %s",
                (product_id,)
            ).fetchone()

            amount = Decimal(str(random.randint(int(prod[0]), min(int(prod[1]), 200000))))
            tenure = random.randint(prod[2], min(prod[3], 36))

            try:
                # Apply
                app_result = conn.execute(
                    "SELECT sp_apply_for_loan(%s, %s, %s, %s)",
                    (borrower, product_id, amount, tenure)
                ).fetchone()
                app_id = app_result[0]
                conn.commit()

                # Decide outcome
                status_choice = random.choices(
                    ['approved', 'rejected', 'submitted'],
                    weights=[0.6, 0.2, 0.2]
                )[0]

                if status_choice == 'submitted':
                    loan_count += 1
                    continue

                officer = random.choice(officer_ids)
                reason = "Approved based on credit assessment" if status_choice == 'approved' else "Insufficient credit history"

                conn.execute(
                    "SELECT sp_decide_loan(%s, %s, %s, %s)",
                    (app_id, officer, status_choice, reason)
                )
                conn.commit()

                if status_choice == 'approved':
                    # Disburse
                    idem_key = f"seed-disburse-{app_id}"
                    conn.execute(
                        "SELECT sp_disburse_loan(%s, %s)",
                        (app_id, idem_key)
                    )
                    conn.commit()

                    # Get the loan
                    loan_row = conn.execute(
                        "SELECT id FROM loans WHERE application_id = %s", (app_id,)
                    ).fetchone()

                    if loan_row:
                        loan_id = loan_row[0]
                        # Pay some EMIs for some loans
                        emis = conn.execute(
                            "SELECT id, installment_no FROM emi_schedule WHERE loan_id = %s ORDER BY installment_no",
                            (loan_id,)
                        ).fetchall()

                        # Pay between 0 and all EMIs
                        emis_to_pay = random.randint(0, min(len(emis), 6))
                        for j in range(emis_to_pay):
                            emi = emis[j]
                            emi_detail = conn.execute(
                                "SELECT total_due FROM emi_schedule WHERE id = %s",
                                (emi[0],)
                            ).fetchone()
                            idem_key = f"seed-emi-{loan_id}-{emi[0]}"
                            try:
                                conn.execute(
                                    "SELECT sp_pay_emi(%s, %s, %s, %s, %s)",
                                    (loan_id, emi[0], emi_detail[0], idem_key, borrower)
                                )
                                conn.commit()
                            except Exception:
                                conn.rollback()

                loan_count += 1
            except Exception as e:
                conn.rollback()
                if loan_count < 5:
                    print(f"  Warning creating loan: {e}")

        print(f"  Created {loan_count} loan applications")

        # ------------------------------------------------------------------
        # 8. Plant fraud patterns and create mock bank statement
        # ------------------------------------------------------------------
        print("\n[8/8] Planting fraud patterns and mock bank statement...")

        # The fraud rules should trigger on some of the seeded transactions
        # Let's also create some deliberate fraud patterns

        # High velocity: one customer makes many transfers quickly
        velocity_customer = customer_ids[10]
        velocity_account = customer_accounts.get(velocity_customer)
        if velocity_account:
            for i in range(8):
                target = random.choice(customer_ids[:50])
                target_acc = customer_accounts.get(target)
                if target_acc and target_acc != velocity_account:
                    idem_key = f"seed-velocity-{i}-{uuid.uuid4().hex[:8]}"
                    try:
                        conn.execute(
                            "SELECT sp_transfer(%s, %s, %s, %s, %s, %s)",
                            (velocity_account, target_acc, Decimal("100"),
                             idem_key, "Velocity pattern test", velocity_customer)
                        )
                        conn.commit()
                    except Exception:
                        conn.rollback()

        # Large amount transfer
        large_customer = customer_ids[20]
        large_account = customer_accounts.get(large_customer)
        if large_account:
            # Fund heavily first
            try:
                conn.execute(
                    "SELECT sp_transfer(%s, %s, %s, %s, %s, %s)",
                    (pool_account_id, large_account, Decimal("500000"),
                     f"seed-fund-large-{uuid.uuid4().hex[:8]}", "Large funding", admin_id)
                )
                conn.commit()
                # Then large transfer
                target = customer_accounts.get(customer_ids[21])
                if target:
                    conn.execute(
                        "SELECT sp_transfer(%s, %s, %s, %s, %s, %s)",
                        (large_account, target, Decimal("200000"),
                         f"seed-large-{uuid.uuid4().hex[:8]}", "Large transfer", large_customer)
                    )
                    conn.commit()
            except Exception:
                conn.rollback()

        # Generate mock bank statement CSV
        generate_mock_bank_csv(conn)

        print(f"\n{'=' * 60}")
        print("SEED COMPLETE")
        print(f"{'=' * 60}")
        print("\nDemo Login Credentials:")
        print("-" * 40)
        print(f"  Admin:         admin@payledger.com / password123")
        print(f"  Customer 1:    alice@example.com / password123")
        print(f"  Customer 2:    bob@example.com / password123")
        print(f"  Merchant:      shopmart@example.com / password123")
        print(f"  Loan Officer:  officer1@payledger.com / password123")
        print(f"  Risk Analyst:  analyst1@payledger.com / password123")
        print(f"{'=' * 60}")

    except Exception as e:
        conn.rollback()
        print(f"\nSeed failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        conn.close()


def create_user(conn, full_name, email, phone, role):
    """Create a user and their wallet account. Returns user_id."""
    password_hash = hash_pw("password123")

    # Check if user already exists (case-insensitive)
    existing = conn.execute(
        "SELECT id FROM users WHERE LOWER(email) = LOWER(%s)", (email.strip(),)
    ).fetchone()
    if existing:
        conn.commit()
        return existing[0]

    row = conn.execute("""
        INSERT INTO users (id, full_name, email, phone, password_hash, role)
        VALUES (gen_random_uuid(), %s, %s, %s, %s, %s)
        RETURNING id
    """, (full_name, email, phone, password_hash, role)).fetchone()
    user_id = row[0]

    # Create wallet account
    account_type = 'merchant_wallet' if role == 'merchant' else 'customer_wallet'
    if role in ('customer', 'merchant'):
        acc_row = conn.execute("""
            INSERT INTO accounts (id, user_id, account_type, currency, status)
            VALUES (gen_random_uuid(), %s, %s, 'INR', 'active')
            RETURNING id
        """, (user_id, account_type)).fetchone()
        account_id = acc_row[0]

        # Initialize balance
        conn.execute("""
            INSERT INTO account_balances (account_id, balance, updated_at)
            VALUES (%s, 0, now())
            ON CONFLICT (account_id) DO NOTHING
        """, (account_id,))

    conn.commit()
    return user_id


def generate_mock_bank_csv(conn):
    """Generate a mock bank statement CSV that's ~95% matching with deliberate mismatches."""
    # Get recent ledger transactions
    rows = conn.execute("""
        SELECT lt.id, lt.idempotency_key, lt.kind, lt.created_at,
               SUM(CASE WHEN le.direction = 'debit' THEN le.amount ELSE 0 END) as amount
        FROM ledger_transactions lt
        JOIN ledger_entries le ON le.transaction_id = lt.id
        WHERE lt.kind IN ('transfer', 'payment')
        GROUP BY lt.id, lt.idempotency_key, lt.kind, lt.created_at
        ORDER BY lt.created_at DESC
        LIMIT 500
    """).fetchall()

    csv_path = os.path.join(os.path.dirname(__file__), "..", "db", "seed", "mock_bank_statement.csv")
    os.makedirs(os.path.dirname(csv_path), exist_ok=True)

    with open(csv_path, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['bank_reference', 'value_date', 'amount', 'narration'])

        for i, row in enumerate(rows):
            txn_id = str(row[0])
            txn_date = row[3].strftime('%Y-%m-%d') if row[3] else '2024-01-01'
            amount = float(row[4]) if row[4] else 0

            # 95% match correctly
            if random.random() < 0.95:
                writer.writerow([txn_id, txn_date, f"{amount:.2f}",
                                f"Payment {row[2]} ref:{row[1][:20] if row[1] else 'N/A'}"])
            elif random.random() < 0.5:
                # Amount mismatch (2.5%)
                wrong_amount = amount + random.uniform(-100, 100)
                writer.writerow([txn_id, txn_date, f"{wrong_amount:.2f}",
                                f"Payment with mismatch"])
            else:
                # Unmatched (2.5%)
                writer.writerow([f"UNKNOWN-{uuid.uuid4().hex[:8]}", txn_date,
                                f"{random.uniform(100, 5000):.2f}",
                                "Unknown bank transaction"])

    print(f"  Generated mock bank statement CSV at {csv_path}")


if __name__ == "__main__":
    run_seed()
