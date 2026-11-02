"""
Row-Level Security (RLS) Tests for PayLedger:
  Demonstrates that customer connections CANNOT read another customer's accounts
  or ledger rows, even with arbitrary raw SQL queries.
"""
import uuid
from decimal import Decimal
import pytest
import psycopg

from tests.conftest import DATABASE_URL


def test_customer_rls_isolation(db_conn, create_test_customer):
    """
    Assert that Row-Level Security blocks cross-customer data leakage.
    """
    c1 = create_test_customer("RLS_Alice", Decimal("1000.00"))
    c2 = create_test_customer("RLS_Bob", Decimal("2000.00"))

    # Connect to database as app_api role or using session GUC variables
    conn = psycopg.connect(DATABASE_URL, autocommit=True)
    conn.execute("SET search_path = payledger, public")
    conn.execute("SET ROLE app_api")

    try:
        # 1. Simulate Alice's session
        conn.execute("SELECT set_config('payledger.current_user_id', %s, false)", (c1["user_id"],))
        conn.execute("SELECT set_config('payledger.current_user_role', 'customer', false)")

        # Alice runs raw query: SELECT * FROM accounts WHERE user_id IS NOT NULL
        alice_visible_accounts = conn.execute(
            "SELECT id, user_id FROM accounts WHERE user_id IS NOT NULL"
        ).fetchall()

        # Must only see Alice's account, NOT Bob's!
        visible_user_ids = {str(r[1]) for r in alice_visible_accounts}
        assert c1["user_id"] in visible_user_ids
        assert c2["user_id"] not in visible_user_ids, "RLS FAILURE: Alice was able to read Bob's account!"

        # 2. Check ledger entries isolation
        alice_visible_entries = conn.execute("SELECT account_id FROM ledger_entries").fetchall()
        visible_acc_ids = {str(r[0]) for r in alice_visible_entries}

        assert c2["account_id"] not in visible_acc_ids, "RLS FAILURE: Alice was able to read Bob's ledger rows!"

        # 3. Simulate Admin session: Admin can see both
        conn.execute("SELECT set_config('payledger.current_user_id', '00000000-0000-0000-0000-000000000000', false)")
        conn.execute("SELECT set_config('payledger.current_user_role', 'admin', false)")

        admin_visible_accounts = conn.execute(
            "SELECT id, user_id FROM accounts WHERE user_id IS NOT NULL"
        ).fetchall()
        admin_user_ids = {str(r[1]) for r in admin_visible_accounts}

        assert c1["user_id"] in admin_user_ids
        assert c2["user_id"] in admin_user_ids
    finally:
        conn.close()
