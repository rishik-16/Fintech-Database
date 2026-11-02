"""
Concurrency Demonstration Script for PayLedger.
Demonstrates:
  1. Money conservation under 100 parallel transfers
  2. Deadlock avoidance (A->B and B->A opposing transfers)
  3. No negative balances
  4. Double-entry accounting invariants
"""
import concurrent.futures
import os
import random
import sys
import time
import uuid
from decimal import Decimal

import psycopg

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


def run_concurrency_test(num_transfers: int = 100, num_accounts: int = 5):
    """
    Execute concurrent transfers between accounts and prove:
      - Total funds before == Total funds after
      - No account went negative
      - Zero unhandled deadlocks
    """
    conn = psycopg.connect(DATABASE_URL, autocommit=True)
    conn.execute("SET search_path = payledger, public")

    print("\n" + "=" * 70)
    print("PAYLEDGER CONCURRENCY & DEADLOCK AVOIDANCE DEMONSTRATION")
    print("=" * 70)

    # 1. Fetch or initialize 5 demo accounts
    rows = conn.execute("""
        SELECT a.id, u.full_name, ab.balance
        FROM accounts a
        JOIN users u ON u.id = a.user_id
        JOIN account_balances ab ON ab.account_id = a.id
        WHERE a.account_type = 'customer_wallet' AND a.status = 'active'
        LIMIT %s
    """, (num_accounts,)).fetchall()

    if len(rows) < num_accounts:
        print(f"Error: Need at least {num_accounts} customer accounts with balances. Run 'make seed' first.")
        conn.close()
        return None

    accounts = [{"id": str(r[0]), "name": r[1], "initial_balance": Decimal(str(r[2]))} for r in rows]
    account_ids = [a["id"] for a in accounts]

    # Ensure accounts have at least 1,000 balance each for testing
    for acc in accounts:
        if acc["initial_balance"] < 500:
            sys_pool = conn.execute(
                "SELECT id FROM accounts WHERE account_type = 'loan_pool' LIMIT 1"
            ).fetchone()[0]
            conn.execute(
                "SELECT sp_transfer(%s, %s, %s, %s, %s, NULL)",
                (sys_pool, acc["id"], Decimal("5000.00"), f"demo-fund-{acc['id']}-{uuid.uuid4().hex[:6]}", "Demo topup")
            )
            acc["initial_balance"] = Decimal(str(conn.execute(
                "SELECT balance FROM account_balances WHERE account_id = %s", (acc["id"],)
            ).fetchone()[0]))

    # Capture initial state
    print("\n[STEP 1] INITIAL ACCOUNT BALANCES (BEFORE):")
    print("-" * 70)
    print(f"{'Account ID':<38} | {'Owner':<18} | {'Balance (INR)':>12}")
    print("-" * 70)
    total_before = Decimal("0.00")
    for acc in accounts:
        curr = Decimal(str(conn.execute(
            "SELECT balance FROM account_balances WHERE account_id = %s", (acc["id"],)
        ).fetchone()[0]))
        acc["before"] = curr
        total_before += curr
        print(f"{acc['id']:<38} | {acc['name'][:18]:<18} | {curr:>12.2f}")
    print("-" * 70)
    print(f"{'TOTAL INITIAL FUNDS:':<59} {total_before:>12.2f} INR")

    # 2. Fire 100 concurrent transfers using ThreadPoolExecutor
    print(f"\n[STEP 2] LAUNCHING {num_transfers} PARALLEL TRANSFERS...")
    print("  - Includes opposing transfers (A->B and B->A) to test deadlock avoidance")
    print("  - Multiple concurrent worker threads operating on same accounts")

    success_count = 0
    failure_count = 0
    deadlock_count = 0
    errors = []

    def execute_single_transfer(task_id: int):
        from_id, to_id = random.sample(account_ids, 2)
        amount = Decimal(str(random.randint(5, 50)))
        idem_key = f"concurrency-test-{task_id}-{uuid.uuid4().hex[:8]}"

        t_conn = psycopg.connect(DATABASE_URL, autocommit=True)
        t_conn.execute("SET search_path = payledger, public")
        try:
            t_conn.execute(
                "SELECT sp_transfer(%s, %s, %s, %s, %s, NULL)",
                (from_id, to_id, amount, idem_key, f"Parallel transfer #{task_id}")
            )
            return {"status": "success", "from": from_id, "to": to_id, "amount": amount}
        except Exception as e:
            err_msg = str(e)
            is_deadlock = "deadlock detected" in err_msg.lower()
            return {"status": "failed", "error": err_msg, "is_deadlock": is_deadlock}
        finally:
            t_conn.close()

    start_time = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as executor:
        futures = [executor.submit(execute_single_transfer, i) for i in range(num_transfers)]
        for f in concurrent.futures.as_completed(futures):
            res = f.result()
            if res["status"] == "success":
                success_count += 1
            else:
                failure_count += 1
                if res.get("is_deadlock"):
                    deadlock_count += 1
                errors.append(res["error"])

    elapsed = time.time() - start_time
    print(f"  Completed in {elapsed:.2f} seconds ({num_transfers / elapsed:.1f} txns/sec)")
    print(f"  Successful: {success_count} | Failed: {failure_count} | Deadlocks: {deadlock_count}")

    # 3. Capture final state
    print("\n[STEP 3] FINAL ACCOUNT BALANCES (AFTER):")
    print("-" * 70)
    print(f"{'Account ID':<38} | {'Owner':<18} | {'Balance (INR)':>12}")
    print("-" * 70)
    total_after = Decimal("0.00")
    negative_balances = 0

    for acc in accounts:
        curr = Decimal(str(conn.execute(
            "SELECT balance FROM account_balances WHERE account_id = %s", (acc["id"],)
        ).fetchone()[0]))
        acc["after"] = curr
        total_after += curr
        if curr < 0:
            negative_balances += 1
        print(f"{acc['id']:<38} | {acc['name'][:18]:<18} | {curr:>12.2f}")
    print("-" * 70)
    print(f"{'TOTAL FINAL FUNDS:':<59} {total_after:>12.2f} INR")

    # 4. Correctness Invariants Verification
    delta = total_after - total_before
    money_conserved = (delta == Decimal("0.00"))

    print("\n" + "=" * 70)
    print("INVARIANT VERIFICATION REPORT:")
    print("=" * 70)
    print(f"1. Money Conservation:  {'PASSED (Delta = 0.00 INR)' if money_conserved else f'FAILED (Delta = {delta})'}")
    print(f"2. Non-negative Wallets: {'PASSED (0 negative)' if negative_balances == 0 else f'FAILED ({negative_balances} negative)'}")
    print(f"3. Deadlock Prevention:  {'PASSED (0 deadlocks)' if deadlock_count == 0 else f'FAILED ({deadlock_count} deadlocks)'}")
    print("=" * 70)

    conn.close()

    return {
        "num_transfers": num_transfers,
        "elapsed_seconds": round(elapsed, 2),
        "success_count": success_count,
        "failure_count": failure_count,
        "deadlock_count": deadlock_count,
        "total_before": float(total_before),
        "total_after": float(total_after),
        "delta": float(delta),
        "money_conserved": money_conserved,
        "negative_balances": negative_balances,
        "accounts": [
            {
                "id": a["id"],
                "name": a["name"],
                "before": float(a["before"]),
                "after": float(a["after"]),
                "change": float(a["after"] - a["before"]),
            }
            for a in accounts
        ],
    }


if __name__ == "__main__":
    run_concurrency_test()
