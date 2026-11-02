"""
Invariant & Trigger Tests for PayLedger:
  1. Append-only enforcement on ledger_entries (UPDATE/DELETE blocked)
  2. Append-only enforcement on ledger_transactions (UPDATE/DELETE blocked)
  3. Double-entry accounting invariant (debits == credits enforced at commit)
"""
import uuid
from decimal import Decimal
import pytest
import psycopg

from tests.conftest import DATABASE_URL


def test_append_only_ledger_entries(db_conn, create_test_customer):
    """
    Attempting to UPDATE or DELETE rows in ledger_entries MUST fail via trigger.
    """
    c1 = create_test_customer("AppendOnly1", Decimal("500.00"))
    c2 = create_test_customer("AppendOnly2", Decimal("500.00"))

    # Execute a transfer to create ledger entries
    txn_id = db_conn.execute(
        "SELECT sp_transfer(%s, %s, %s, %s, %s, NULL)",
        (c1["account_id"], c2["account_id"], Decimal("50.00"), f"append-test-{uuid.uuid4()}", "Test")
    ).fetchone()[0]

    entry = db_conn.execute(
        "SELECT id, amount, created_at FROM ledger_entries WHERE transaction_id = %s LIMIT 1",
        (txn_id,)
    ).fetchone()
    entry_id = entry[0]

    # 1. Attempt UPDATE
    with pytest.raises(psycopg.errors.RaiseException) as exc_update:
        db_conn.execute(
            "UPDATE ledger_entries SET amount = 9999.00 WHERE id = %s",
            (entry_id,)
        )
    assert "append-only" in str(exc_update.value).lower()

    # 2. Attempt DELETE
    with pytest.raises(psycopg.errors.RaiseException) as exc_delete:
        db_conn.execute(
            "DELETE FROM ledger_entries WHERE id = %s",
            (entry_id,)
        )
    assert "append-only" in str(exc_delete.value).lower()


def test_append_only_ledger_transactions(db_conn, create_test_customer):
    """
    Attempting to UPDATE or DELETE rows in ledger_transactions MUST fail via trigger.
    """
    c1 = create_test_customer("TxnAppend1", Decimal("500.00"))
    c2 = create_test_customer("TxnAppend2", Decimal("500.00"))

    txn_id = db_conn.execute(
        "SELECT sp_transfer(%s, %s, %s, %s, %s, NULL)",
        (c1["account_id"], c2["account_id"], Decimal("30.00"), f"txn-append-{uuid.uuid4()}", "Test")
    ).fetchone()[0]

    # 1. Attempt UPDATE
    with pytest.raises(psycopg.errors.RaiseException) as exc_update:
        db_conn.execute(
            "UPDATE ledger_transactions SET description = 'Tampered' WHERE id = %s",
            (txn_id,)
        )
    assert "append-only" in str(exc_update.value).lower()

    # 2. Attempt DELETE
    with pytest.raises(psycopg.errors.RaiseException) as exc_delete:
        db_conn.execute(
            "DELETE FROM ledger_transactions WHERE id = %s",
            (txn_id,)
        )
    assert "append-only" in str(exc_delete.value).lower()


def test_double_entry_invariant_rejection(db_conn, create_test_customer):
    """
    Hand-crafting an unbalanced transaction (e.g. debits != credits or single entry)
    MUST be rejected by the deferred constraint trigger upon commit.
    """
    c1 = create_test_customer("Unbalanced1", Decimal("500.00"))
    c2 = create_test_customer("Unbalanced2", Decimal("500.00"))

    txn_id = uuid.uuid4()
    idem_key = f"unbalanced-{uuid.uuid4()}"

    # Connect with manual transaction
    conn = psycopg.connect(DATABASE_URL, autocommit=False)
    conn.execute("SET search_path = payledger, public")

    try:
        # Create transaction header
        conn.execute(
            "INSERT INTO ledger_transactions (id, kind, idempotency_key, description) "
            "VALUES (%s, 'transfer', %s, 'Unbalanced attack')",
            (txn_id, idem_key)
        )

        # Insert unbalanced entries: Debit 100, Credit 50!
        conn.execute(
            "INSERT INTO ledger_entries (transaction_id, account_id, direction, amount) "
            "VALUES (%s, %s, 'debit', 100.00)",
            (txn_id, c1["account_id"])
        )
        conn.execute(
            "INSERT INTO ledger_entries (transaction_id, account_id, direction, amount) "
            "VALUES (%s, %s, 'credit', 50.00)",
            (txn_id, c2["account_id"])
        )

        # Commit must fail due to deferred constraint trigger
        with pytest.raises(psycopg.errors.RaiseException) as exc:
            conn.commit()

        assert "double-entry violation" in str(exc.value).lower()
    finally:
        conn.close()
