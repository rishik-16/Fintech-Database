"""
Concurrency and Correctness Tests for PayLedger:
  1. Parallel transfers (Conservation of money under 100 concurrent threads)
  2. Deadlock avoidance (Simultaneous opposing transfers)
  3. Idempotency (Concurrent requests with identical idempotency key)
  4. Double-spend prevention (Simultaneous depletion attempts)
"""
import concurrent.futures
import os
import random
import uuid
from decimal import Decimal
import pytest
import psycopg

from tests.conftest import DATABASE_URL


def get_fresh_conn():
    conn = psycopg.connect(DATABASE_URL, autocommit=True)
    conn.execute("SET search_path = payledger, public")
    return conn


def test_parallel_transfers_conservation(create_test_customer):
    """
    100 parallel transfers across accounts.
    Assert:
      - Total sum across accounts is exactly conserved.
      - No account balance drops below zero.
    """
    accounts = [create_test_customer(f"Cust_{i}", Decimal("2000.00")) for i in range(5)]
    acc_ids = [a["account_id"] for a in accounts]

    conn = get_fresh_conn()
    total_initial = sum(
        Decimal(str(conn.execute("SELECT balance FROM account_balances WHERE account_id = %s", (aid,)).fetchone()[0]))
        for aid in acc_ids
    )

    def do_transfer(i):
        src, dst = random.sample(acc_ids, 2)
        amt = Decimal(str(random.randint(10, 50)))
        idem = f"parallel-test-{i}-{uuid.uuid4().hex[:6]}"
        t_conn = get_fresh_conn()
        try:
            t_conn.execute(
                "SELECT sp_transfer(%s, %s, %s, %s, %s, NULL)",
                (src, dst, amt, idem, f"Parallel {i}")
            )
            return True
        except Exception:
            return False
        finally:
            t_conn.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(do_transfer, range(100)))

    assert any(results), "At least some transfers must succeed"

    total_final = Decimal("0.00")
    for aid in acc_ids:
        bal = Decimal(str(conn.execute("SELECT balance FROM account_balances WHERE account_id = %s", (aid,)).fetchone()[0]))
        assert bal >= 0, f"Account {aid} balance became negative: {bal}"
        total_final += bal

    conn.close()
    assert total_final == total_initial, f"Money not conserved! Initial: {total_initial}, Final: {total_final}"


def test_deadlock_avoidance(create_test_customer):
    """
    Run 100 simultaneous opposing transfers (A->B and B->A).
    Assert that deadlock avoidance (locking in ID order) prevents deadlocks.
    """
    c1 = create_test_customer("DeadlockA", Decimal("5000.00"))
    c2 = create_test_customer("DeadlockB", Decimal("5000.00"))
    a1, a2 = c1["account_id"], c2["account_id"]

    deadlocks = 0

    def opposing_transfer(direction_ab: bool, idx: int):
        nonlocal deadlocks
        src, dst = (a1, a2) if direction_ab else (a2, a1)
        idem = f"deadlock-{idx}-{uuid.uuid4().hex[:6]}"
        t_conn = get_fresh_conn()
        try:
            t_conn.execute(
                "SELECT sp_transfer(%s, %s, %s, %s, %s, NULL)",
                (src, dst, Decimal("10.00"), idem, f"Deadlock test {idx}")
            )
            return True
        except Exception as e:
            if "deadlock detected" in str(e).lower():
                deadlocks += 1
            return False
        finally:
            t_conn.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = [
            executor.submit(opposing_transfer, i % 2 == 0, i)
            for i in range(100)
        ]
        concurrent.futures.wait(futures)

    assert deadlocks == 0, f"Encountered {deadlocks} deadlock errors! Accounts must be locked in consistent order."


def test_idempotency_concurrent(create_test_customer):
    """
    Send the same transfer with the same idempotency key 20 times concurrently.
    Assert: exactly one ledger transaction results, and all calls return the same transaction ID.
    """
    c1 = create_test_customer("IdemSource", Decimal("1000.00"))
    c2 = create_test_customer("IdemTarget", Decimal("100.00"))
    shared_key = f"idem-key-{uuid.uuid4()}"

    def send_idempotent(idx):
        t_conn = get_fresh_conn()
        try:
            res = t_conn.execute(
                "SELECT sp_transfer(%s, %s, %s, %s, %s, NULL)",
                (c1["account_id"], c2["account_id"], Decimal("50.00"), shared_key, "Idempotent transfer")
            ).fetchone()[0]
            return str(res)
        finally:
            t_conn.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        txn_ids = list(executor.map(send_idempotent, range(20)))

    # All returned transaction IDs must be identical
    unique_txns = set(txn_ids)
    assert len(unique_txns) == 1, f"Expected 1 unique transaction, got: {unique_txns}"

    # Verify ledger row count for this key in DB
    conn = get_fresh_conn()
    count = conn.execute(
        "SELECT COUNT(*) FROM ledger_transactions WHERE idempotency_key = %s",
        (shared_key,)
    ).fetchone()[0]
    conn.close()
    assert count == 1, f"Expected 1 ledger transaction header, found {count}"


def test_double_spend_prevention(create_test_customer):
    """
    Account with 100.00 attempts to send 100.00 twice at the exact same instant.
    Assert: exactly one succeeds, and the other fails with Insufficient funds.
    """
    c1 = create_test_customer("DoubleSpendSrc", Decimal("100.00"))
    c2 = create_test_customer("DoubleSpendDst", Decimal("0.00"))

    def send_entire_balance(idx):
        t_conn = get_fresh_conn()
        idem = f"double-spend-{idx}-{uuid.uuid4().hex[:6]}"
        try:
            t_conn.execute(
                "SELECT sp_transfer(%s, %s, %s, %s, %s, NULL)",
                (c1["account_id"], c2["account_id"], Decimal("100.00"), idem, "Double spend try")
            )
            return "success"
        except Exception as e:
            if "insufficient funds" in str(e).lower():
                return "insufficient_funds"
            return str(e)
        finally:
            t_conn.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(send_entire_balance, [1, 2]))

    assert results.count("success") == 1, f"Expected exactly 1 success, got: {results}"
    assert results.count("insufficient_funds") == 1, f"Expected 1 insufficient funds error, got: {results}"
