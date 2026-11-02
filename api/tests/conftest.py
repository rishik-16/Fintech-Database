"""
Pytest configuration and fixtures for PayLedger tests.
"""
import os
import uuid
from decimal import Decimal
import pytest
import psycopg
from fastapi.testclient import TestClient

from app.main import app
from app.auth import create_access_token, hash_password

def _get_db_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    for candidate in [
        os.path.join(os.getcwd(), ".env"),
        os.path.join(os.path.dirname(__file__), "..", "..", ".env"),
        os.path.join(os.path.dirname(__file__), "..", ".env"),
    ]:
        if os.path.isfile(candidate):
            with open(candidate, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    if k.strip() == "DATABASE_URL":
                        return v.strip().strip("'\"")
    return "postgresql://payledger_admin:payledger_secret_2024@localhost:5432/payledger"


DATABASE_URL = _get_db_url()


@pytest.fixture(scope="session")
def db_conn():
    """Session-scoped database connection."""
    conn = psycopg.connect(DATABASE_URL, autocommit=True)
    conn.execute("SET search_path = payledger, public")

    # Ensure baseline officer and product exist for self-contained testing
    row = conn.execute("SELECT id FROM users WHERE role = 'loan_officer' LIMIT 1").fetchone()
    if not row:
        conn.execute(
            "INSERT INTO users (id, full_name, email, password_hash, role) "
            "VALUES (%s, 'Test Officer', 'officer_fixture@payledger.com', %s, 'loan_officer')",
            (uuid.uuid4(), hash_password("password123"))
        )

    p_row = conn.execute("SELECT id FROM loan_products WHERE active = true LIMIT 1").fetchone()
    if not p_row:
        conn.execute(
            """INSERT INTO loan_products (id, name, annual_rate, min_amount, max_amount, min_tenure_months, max_tenure_months, penalty_rate, prepayment_allowed)
               VALUES (gen_random_uuid(), 'Standard Personal Loan', 12.00, 1000.00, 100000.00, 3, 36, 0.0500, true)"""
        )

    yield conn
    conn.close()


@pytest.fixture(scope="session")
def client():
    """FastAPI TestClient fixture."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def unique_id():
    return uuid.uuid4().hex[:8]


@pytest.fixture
def create_test_customer(db_conn):
    """Factory fixture to create a customer user and wallet."""
    created_users = []

    def _create(name="Test User", balance=Decimal("10000.00")):
        u_id = str(uuid.uuid4())
        email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        pw = hash_password("password123")

        db_conn.execute(
            "INSERT INTO users (id, full_name, email, password_hash, role, status) "
            "VALUES (%s, %s, %s, %s, 'customer', 'active')",
            (u_id, name, email, pw)
        )

        acc_id = str(uuid.uuid4())
        db_conn.execute(
            "INSERT INTO accounts (id, user_id, account_type, currency, status) "
            "VALUES (%s, %s, 'customer_wallet', 'INR', 'active')",
            (acc_id, u_id)
        )

        # Create verified KYC profile for test customer so lending operations are permitted
        db_conn.execute(
            "INSERT INTO kyc_profiles (user_id, id_type, id_number_hash, status, verified_at) "
            "VALUES (%s, 'aadhaar', %s, 'verified', now()) "
            "ON CONFLICT (user_id) DO NOTHING",
            (u_id, f"hash-{u_id[:16]}")
        )

        # Fund account from loan pool if initial balance is positive
        if balance > 0:
            pool_id = db_conn.execute("SELECT id FROM accounts WHERE account_type = 'loan_pool' LIMIT 1").fetchone()[0]
            db_conn.execute(
                "SELECT sp_transfer(%s::uuid, %s::uuid, %s::numeric, %s::varchar, %s::text, NULL)",
                (pool_id, acc_id, Decimal(str(balance)), f"fixture-fund-{uuid.uuid4()}", "Test funding")
            )

        token = create_access_token({"sub": u_id, "role": "customer"})
        res = {"user_id": u_id, "email": email, "account_id": acc_id, "token": token}
        created_users.append(res)
        return res

    yield _create


@pytest.fixture
def admin_token(db_conn):
    """Return JWT token for admin user."""
    row = db_conn.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1").fetchone()
    if row:
        admin_id = str(row[0])
    else:
        admin_id = str(uuid.uuid4())
        db_conn.execute(
            "INSERT INTO users (id, full_name, email, password_hash, role) "
            "VALUES (%s, 'Admin Fixture', 'admin_fixture@payledger.com', %s, 'admin')",
            (admin_id, hash_password("admin123"))
        )
    return create_access_token({"sub": admin_id, "role": "admin"})
