"""
Fraud Detection Rules Tests:
  1. LARGE_AMOUNT rule triggers alerts on exceeding threshold
  2. VELOCITY rule triggers on burst transfers
"""
import uuid
from decimal import Decimal
import pytest


def test_large_amount_fraud_rule(db_conn, create_test_customer):
    """
    Transactions exceeding the LARGE_AMOUNT threshold must trigger a fraud_alert.
    """
    sender = create_test_customer("FraudBigSender", Decimal("1000000.00"))
    receiver = create_test_customer("FraudBigReceiver", Decimal("1000.00"))

    # Update threshold to 50,000 for deterministic test
    db_conn.execute(
        """UPDATE fraud_rules
           SET threshold_json = '{"absolute_threshold": 50000}'::jsonb
           WHERE code = 'LARGE_AMOUNT'"""
    )

    # Transfer 80,000 > 50,000 threshold
    txn_id = db_conn.execute(
        "SELECT sp_transfer(%s, %s, %s, %s, %s, NULL)",
        (sender["account_id"], receiver["account_id"], Decimal("80000.00"),
         f"large-fraud-{uuid.uuid4()}", "Suspicious large purchase")
    ).fetchone()[0]

    # Verify fraud alert was created
    rule_id = db_conn.execute("SELECT id FROM fraud_rules WHERE code = 'LARGE_AMOUNT'").fetchone()[0]
    alert = db_conn.execute(
        "SELECT id, severity, status FROM fraud_alerts WHERE ledger_transaction_id = %s AND rule_id = %s",
        (txn_id, rule_id)
    ).fetchone()

    assert alert is not None, "Expected LARGE_AMOUNT fraud alert, but none was raised!"
    assert alert[2] == "open"


def test_velocity_fraud_rule(db_conn, create_test_customer):
    """
    Burst transfers in a short window must trigger a VELOCITY alert.
    """
    sender = create_test_customer("VelocitySender", Decimal("50000.00"))
    receiver = create_test_customer("VelocityReceiver", Decimal("1000.00"))

    # Set threshold: max 3 transfers in 10 minutes
    db_conn.execute(
        """UPDATE fraud_rules
           SET threshold_json = '{"window_minutes": 10, "max_count": 3}'::jsonb
           WHERE code = 'VELOCITY'"""
    )

    # Fire 5 transfers in rapid succession
    last_txn = None
    for i in range(5):
        last_txn = db_conn.execute(
            "SELECT sp_transfer(%s, %s, %s, %s, %s, NULL)",
            (sender["account_id"], receiver["account_id"], Decimal("100.00"),
             f"vel-txn-{i}-{uuid.uuid4()}", f"Velocity burst {i}")
        ).fetchone()[0]

    rule_id = db_conn.execute("SELECT id FROM fraud_rules WHERE code = 'VELOCITY'").fetchone()[0]
    alert_count = db_conn.execute(
        "SELECT COUNT(*) FROM fraud_alerts WHERE account_id = %s AND rule_id = %s",
        (sender["account_id"], rule_id)
    ).fetchone()[0]

    assert alert_count > 0, "Expected VELOCITY alert to be generated on rapid transfers!"
