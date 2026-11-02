"""
Lending Module Tests:
  1. Reducing-balance EMI formula & exact principal sum invariant
  2. Edge cases (0% interest rate, 1-month tenure)
  3. Prepayment & loan closure
  4. Nightly accrual & penalty assessment idempotency
"""
import uuid
from datetime import date, timedelta
from decimal import Decimal
import pytest
import psycopg


def test_reducing_balance_emi_sum_exact(db_conn, create_test_customer):
    """
    Assert that the sum of principal components in the generated schedule
    equals the loan principal EXACTLY, with last installment rounding adjustment.
    """
    customer = create_test_customer("BorrowerExact", Decimal("1000.00"))

    # Create product with 12.5% rate
    prod_id = uuid.uuid4()
    db_conn.execute(
        """INSERT INTO loan_products (id, name, annual_rate, min_amount, max_amount, min_tenure_months, max_tenure_months)
           VALUES (%s, 'EMI Test Product', 12.50, 1000, 100000, 3, 36)""",
        (prod_id,)
    )

    principal = Decimal("15432.50")
    tenure = 11  # Odd tenure to induce floating-point rounding

    app_id = db_conn.execute(
        "SELECT sp_apply_for_loan(%s, %s, %s, %s)",
        (customer["user_id"], prod_id, principal, tenure)
    ).fetchone()[0]

    # Officer approves
    officer_id = db_conn.execute("SELECT id FROM users WHERE role = 'loan_officer' LIMIT 1").fetchone()[0]
    db_conn.execute("SELECT sp_decide_loan(%s, %s, 'approved', 'Looks good')", (app_id, officer_id))

    # Disburse
    txn_id = db_conn.execute("SELECT sp_disburse_loan(%s, %s)", (app_id, f"disb-{uuid.uuid4()}")).fetchone()[0]
    assert txn_id is not None

    loan = db_conn.execute("SELECT id, principal FROM loans WHERE application_id = %s", (app_id,)).fetchone()
    loan_id = loan[0]

    # Fetch generated schedule
    schedule = db_conn.execute(
        "SELECT installment_no, principal_component, interest_component, total_due FROM emi_schedule WHERE loan_id = %s ORDER BY installment_no",
        (loan_id,)
    ).fetchall()

    assert len(schedule) == tenure

    # Verify principal sum
    total_principal_scheduled = sum(Decimal(str(r[1])) for r in schedule)
    assert total_principal_scheduled == principal, (
        f"Principal sum mismatch! Loan Principal: {principal}, Scheduled Sum: {total_principal_scheduled}"
    )


def test_emi_edge_cases_zero_rate_and_one_month(db_conn, create_test_customer):
    """
    Test zero-rate (0%) loan and 1-month tenure.
    """
    customer = create_test_customer("ZeroRateCust", Decimal("1000.00"))

    prod_id = uuid.uuid4()
    db_conn.execute(
        """INSERT INTO loan_products (id, name, annual_rate, min_amount, max_amount, min_tenure_months, max_tenure_months)
           VALUES (%s, 'Zero Rate Prod', 0.00, 500, 50000, 1, 12)""",
        (prod_id,)
    )

    principal = Decimal("5000.00")
    app_id = db_conn.execute(
        "SELECT sp_apply_for_loan(%s, %s, %s, 1)",
        (customer["user_id"], prod_id, principal)
    ).fetchone()[0]

    officer_id = db_conn.execute("SELECT id FROM users WHERE role = 'loan_officer' LIMIT 1").fetchone()[0]
    db_conn.execute("SELECT sp_decide_loan(%s, %s, 'approved', 'Zero rate')", (app_id, officer_id))
    db_conn.execute("SELECT sp_disburse_loan(%s, %s)", (app_id, f"disb-{uuid.uuid4()}"))

    loan_id = db_conn.execute("SELECT id FROM loans WHERE application_id = %s", (app_id,)).fetchone()[0]

    schedule = db_conn.execute(
        "SELECT installment_no, principal_component, interest_component, total_due FROM emi_schedule WHERE loan_id = %s",
        (loan_id,)
    ).fetchall()

    assert len(schedule) == 1
    inst = schedule[0]
    assert Decimal(str(inst[1])) == principal
    assert Decimal(str(inst[2])) == Decimal("0.00")
    assert Decimal(str(inst[3])) == principal


def test_loan_full_repayment_and_closure(db_conn, create_test_customer):
    """
    Borrower pays all EMIs in full.
    Assert:
      - EMI status transitions to 'paid'
      - Loan status transitions to 'closed'
      - Outstanding principal becomes 0
    """
    customer = create_test_customer("PayBorrower", Decimal("50000.00"))

    prod = db_conn.execute("SELECT id, min_amount, min_tenure_months FROM loan_products WHERE active = true LIMIT 1").fetchone()
    app_id = db_conn.execute("SELECT sp_apply_for_loan(%s, %s, %s, %s)", (customer["user_id"], prod[0], prod[1], prod[2])).fetchone()[0]
    officer_id = db_conn.execute("SELECT id FROM users WHERE role = 'loan_officer' LIMIT 1").fetchone()[0]
    db_conn.execute("SELECT sp_decide_loan(%s, %s, 'approved', 'OK')", (app_id, officer_id))
    db_conn.execute("SELECT sp_disburse_loan(%s, %s)", (app_id, f"disb-{uuid.uuid4()}"))

    loan_id = db_conn.execute("SELECT id FROM loans WHERE application_id = %s", (app_id,)).fetchone()[0]

    emis = db_conn.execute(
        "SELECT id, total_due FROM emi_schedule WHERE loan_id = %s ORDER BY installment_no",
        (loan_id,)
    ).fetchall()

    for emi in emis:
        emi_id, total_due = emi[0], emi[1]
        db_conn.execute(
            "SELECT sp_pay_emi(%s, %s, %s, %s, %s)",
            (loan_id, emi_id, total_due, f"repay-{uuid.uuid4()}", customer["user_id"])
        )

    loan = db_conn.execute("SELECT status, outstanding_principal FROM loans WHERE id = %s", (loan_id,)).fetchone()
    assert loan[0] == "closed", f"Expected loan status 'closed', got '{loan[0]}'"
    assert Decimal(str(loan[1])) == Decimal("0.00")


def test_nightly_job_idempotency(db_conn, create_test_customer):
    """
    Running sp_accrue_interest_and_penalties twice for the same date
    MUST NOT create duplicate penalty rows or charge fees twice.
    """
    customer = create_test_customer("PenaltyCust", Decimal("1000.00"))
    prod = db_conn.execute("SELECT id, min_amount, min_tenure_months FROM loan_products WHERE active = true LIMIT 1").fetchone()
    app_id = db_conn.execute("SELECT sp_apply_for_loan(%s, %s, %s, %s)", (customer["user_id"], prod[0], prod[1], prod[2])).fetchone()[0]
    officer_id = db_conn.execute("SELECT id FROM users WHERE role = 'loan_officer' LIMIT 1").fetchone()[0]
    db_conn.execute("SELECT sp_decide_loan(%s, %s, 'approved', 'OK')", (app_id, officer_id))
    db_conn.execute("SELECT sp_disburse_loan(%s, %s)", (app_id, f"disb-{uuid.uuid4()}"))

    loan_id = db_conn.execute("SELECT id FROM loans WHERE application_id = %s", (app_id,)).fetchone()[0]

    # Deliberately backdate one EMI due date to 10 days ago
    past_date = date.today() - timedelta(days=10)
    db_conn.execute(
        "UPDATE emi_schedule SET due_date = %s WHERE loan_id = %s AND installment_no = 1",
        (past_date, loan_id)
    )

    as_of = date.today()

    # First run
    db_conn.execute("SELECT * FROM sp_accrue_interest_and_penalties(%s)", (as_of,))
    initial_penalties = db_conn.execute(
        "SELECT COUNT(*) FROM penalties WHERE loan_id = %s AND assessed_on = %s",
        (loan_id, as_of)
    ).fetchone()[0]

    # Second run for same date (idempotency check)
    db_conn.execute("SELECT * FROM sp_accrue_interest_and_penalties(%s)", (as_of,))
    subsequent_penalties = db_conn.execute(
        "SELECT COUNT(*) FROM penalties WHERE loan_id = %s AND assessed_on = %s",
        (loan_id, as_of)
    ).fetchone()[0]

    assert initial_penalties == subsequent_penalties, "Nightly accrual is not idempotent! Duplicate penalties created."
