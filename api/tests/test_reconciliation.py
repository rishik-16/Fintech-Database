"""
Bank Reconciliation Algorithm Tests:
  Matches imported bank statement lines against internal ledger transactions.
"""
import uuid
from decimal import Decimal
import pytest


def test_reconciliation_matching(db_conn, create_test_customer):
    """
    Test sp_reconcile:
      - line 1 matches transaction exactly -> matched
      - line 2 matches transaction ID but wrong amount -> amount_mismatch
      - line 3 has unknown reference -> unmatched
    """
    c1 = create_test_customer("ReconA", Decimal("2000.00"))
    c2 = create_test_customer("ReconB", Decimal("100.00"))

    # Create 2 real ledger transactions
    idem1 = f"recon-txn-1-{uuid.uuid4()}"
    txn1_id = db_conn.execute(
        "SELECT sp_transfer(%s, %s, %s, %s, %s, NULL)",
        (c1["account_id"], c2["account_id"], Decimal("250.00"), idem1, "Recon Test 1")
    ).fetchone()[0]

    idem2 = f"recon-txn-2-{uuid.uuid4()}"
    txn2_id = db_conn.execute(
        "SELECT sp_transfer(%s, %s, %s, %s, %s, NULL)",
        (c1["account_id"], c2["account_id"], Decimal("400.00"), idem2, "Recon Test 2")
    ).fetchone()[0]

    import_id = uuid.uuid4()
    admin_id = db_conn.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1").fetchone()[0]
    db_conn.execute(
        "INSERT INTO bank_statement_imports (id, filename, imported_by) VALUES (%s, 'test_statement.csv', %s)",
        (import_id, admin_id)
    )

    # Line 1: Exact match on txn1_id and 250.00
    db_conn.execute(
        """INSERT INTO bank_statement_lines (id, import_id, bank_reference, value_date, amount, match_status)
           VALUES (gen_random_uuid(), %s, %s, CURRENT_DATE, 250.00, 'unmatched')""",
        (import_id, str(txn1_id))
    )

    # Line 2: Reference matches txn2_id but amount is 350.00 instead of 400.00
    db_conn.execute(
        """INSERT INTO bank_statement_lines (id, import_id, bank_reference, value_date, amount, match_status)
           VALUES (gen_random_uuid(), %s, %s, CURRENT_DATE, 350.00, 'unmatched')""",
        (import_id, str(txn2_id))
    )

    # Line 3: Unknown reference
    db_conn.execute(
        """INSERT INTO bank_statement_lines (id, import_id, bank_reference, value_date, amount, match_status)
           VALUES (gen_random_uuid(), %s, 'NONEXISTENT-REF-999', CURRENT_DATE, 100.00, 'unmatched')""",
        (import_id,)
    )

    # Run reconciliation procedure
    run_id = db_conn.execute(
        "SELECT sp_reconcile(%s, %s)",
        (import_id, admin_id)
    ).fetchone()[0]

    run = db_conn.execute(
        "SELECT matched_count, unmatched_count, mismatch_count FROM reconciliation_runs WHERE id = %s",
        (run_id,)
    ).fetchone()

    assert run[0] == 1, f"Expected 1 matched line, got {run[0]}"
    assert run[1] == 1, f"Expected 1 unmatched line, got {run[1]}"
    assert run[2] == 1, f"Expected 1 mismatch line, got {run[2]}"
