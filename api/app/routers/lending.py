"""
Lending router — loan products, applications, EMI calculations, and loan management.
"""
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, status
import psycopg.errors

from app.db import get_conn, fetch_one, fetch_all, call_procedure_scalar, clean_db_error
from app.deps import CurrentUser, require_role, IdempotencyKey
from app.models.wallet import TransactionResponse
from app.models.lending import (
    LoanProductResponse,
    EMICalculatorRequest,
    EMICalculatorResponse,
    LoanApplyRequest,
    LoanApplicationResponse,
    LoanDecisionRequest,
    LoanResponse,
    EMIScheduleResponse,
    PayEMIRequest,
    PrepayLoanRequest,
)

router = APIRouter()


# ── helpers ──────────────────────────────────────────────────────────────────

def _calc_emi(principal: Decimal, annual_rate: Decimal, tenure_months: int) -> dict:
    """Compute EMI using the standard formula: EMI = P*r*(1+r)^n / ((1+r)^n - 1)."""
    if annual_rate == 0:
        emi = (principal / tenure_months).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return {
            "emi_amount": emi,
            "total_interest": Decimal("0.00"),
            "total_payment": principal.quantize(Decimal("0.01")),
        }

    r = (annual_rate / Decimal(100)) / Decimal(12)  # monthly rate
    n = tenure_months
    power = (1 + r) ** n
    emi = (principal * r * power / (power - 1)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    total_payment = (emi * n).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    total_interest = (total_payment - principal).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return {
        "emi_amount": emi,
        "total_interest": total_interest,
        "total_payment": total_payment,
    }


# ── loan products ────────────────────────────────────────────────────────────

@router.get("/products", response_model=list[LoanProductResponse])
async def list_products(user: CurrentUser):
    """List all active loan products."""
    rows = fetch_all(
        "SELECT id, name, annual_rate, min_amount, max_amount, "
        "       min_tenure_months, max_tenure_months, penalty_rate, prepayment_allowed "
        "FROM loan_products WHERE active = true "
        "ORDER BY name",
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    return [LoanProductResponse(**r) for r in rows]


# ── EMI calculator ───────────────────────────────────────────────────────────

@router.post("/emi-calculator", response_model=EMICalculatorResponse)
async def emi_calculator(body: EMICalculatorRequest, user: CurrentUser):
    """Preview EMI calculation. No database call — computed in Python."""
    result = _calc_emi(body.principal, body.annual_rate, body.tenure_months)
    return EMICalculatorResponse(**result)


# ── loan applications ───────────────────────────────────────────────────────

@router.post("/apply", response_model=LoanApplicationResponse, status_code=status.HTTP_201_CREATED)
async def apply_for_loan(body: LoanApplyRequest, user: CurrentUser):
    """Customer applies for a loan. Calls sp_apply_for_loan."""
    try:
        with get_conn(user_id=str(user["id"]), user_role=user["role"]) as conn:
            row = conn.execute(
                "SELECT payledger.sp_apply_for_loan(%s::uuid, %s::uuid, %s::numeric, %s::integer)",
                (str(user["id"]), str(body.product_id), Decimal(str(body.amount)), int(body.tenure_months)),
            ).fetchone()
            conn.commit()
            app_id = list(row.values())[0] if row else None
    except (psycopg.errors.RaiseException, psycopg.Error) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=clean_db_error(exc))

    app_row = fetch_one(
        "SELECT * FROM loan_applications WHERE id = %s",
        (app_id,),
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    if not app_row:
        raise HTTPException(status_code=500, detail="Failed to retrieve loan application")
    return LoanApplicationResponse(**app_row)


@router.get("/my-applications", response_model=list[LoanApplicationResponse])
async def my_applications(user: CurrentUser):
    """List the current customer's loan applications."""
    rows = fetch_all(
        "SELECT id, user_id, product_id, amount, tenure_months, "
        "       status, decided_by, decided_at, reason, created_at "
        "FROM loan_applications WHERE user_id = %s "
        "ORDER BY created_at DESC",
        (str(user["id"]),),
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    return [LoanApplicationResponse(**r) for r in rows]


# ── customer loans ───────────────────────────────────────────────────────────

@router.get("/my-loans", response_model=list[LoanResponse])
async def my_loans(user: CurrentUser):
    """List the current customer's loans."""
    rows = fetch_all(
        "SELECT id, application_id, user_id, principal, annual_rate, "
        "       tenure_months, status, outstanding_principal, disbursed_at, created_at "
        "FROM loans WHERE user_id = %s "
        "ORDER BY created_at DESC",
        (str(user["id"]),),
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    return [LoanResponse(**r) for r in rows]


@router.get("/loans/{loan_id}")
async def loan_detail(loan_id: str, user: CurrentUser):
    """Get loan detail with its EMI schedule."""
    loan = fetch_one(
        "SELECT id, application_id, user_id, principal, annual_rate, "
        "       tenure_months, status, outstanding_principal, disbursed_at, created_at "
        "FROM loans WHERE id = %s",
        (loan_id,),
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    if not loan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")

    # Allow access if the user owns the loan, or is an officer/admin
    if str(loan["user_id"]) != str(user["id"]) and user["role"] not in ("loan_officer", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    schedule = fetch_all(
        "SELECT id, loan_id, installment_no, due_date, principal_component, "
        "       interest_component, total_due, status, paid_amount, paid_at "
        "FROM emi_schedule WHERE loan_id = %s "
        "ORDER BY installment_no",
        (loan_id,),
        user_id=str(user["id"]),
        user_role=user["role"],
    )

    return {
        "loan": LoanResponse(**loan),
        "emi_schedule": [EMIScheduleResponse(**s) for s in schedule],
    }


@router.post("/loans/{loan_id}/pay-emi", response_model=TransactionResponse)
async def pay_emi(
    loan_id: str,
    body: PayEMIRequest,
    user: CurrentUser,
    idem_key: IdempotencyKey,
):
    """Pay an EMI installment. Requires Idempotency-Key header."""
    # Verify loan ownership
    loan = fetch_one(
        "SELECT user_id FROM loans WHERE id = %s",
        (loan_id,),
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    if not loan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")
    if str(loan["user_id"]) != str(user["id"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your loan")

    try:
        with get_conn(user_id=str(user["id"]), user_role=user["role"]) as conn:
            row = conn.execute(
                "SELECT payledger.sp_pay_emi(%s::uuid, %s::uuid, %s::numeric, %s::varchar, %s::uuid)",
                (str(loan_id), str(body.emi_id), Decimal(str(body.amount)), idem_key, str(user["id"])),
            ).fetchone()
            conn.commit()
            result = list(row.values())[0] if row else None
    except (psycopg.errors.RaiseException, psycopg.Error) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=clean_db_error(exc))

    return TransactionResponse(
        transaction_id=str(result),
        message="EMI payment processed successfully",
    )


@router.post("/loans/{loan_id}/prepay", response_model=TransactionResponse)
async def prepay_loan(
    loan_id: str,
    body: PrepayLoanRequest,
    user: CurrentUser,
    idem_key: IdempotencyKey,
):
    """Prepay principal towards a loan. Requires Idempotency-Key header."""
    loan = fetch_one(
        "SELECT user_id FROM loans WHERE id = %s",
        (loan_id,),
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    if not loan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")
    if str(loan["user_id"]) != str(user["id"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your loan")

    try:
        with get_conn(user_id=str(user["id"]), user_role=user["role"]) as conn:
            row = conn.execute(
                "SELECT payledger.sp_prepay_loan(%s::uuid, %s::numeric, %s::varchar, %s::uuid)",
                (str(loan_id), Decimal(str(body.amount)), idem_key, str(user["id"])),
            ).fetchone()
            conn.commit()
            result = list(row.values())[0] if row else None
    except (psycopg.errors.RaiseException, psycopg.Error) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=clean_db_error(exc))

    return TransactionResponse(
        transaction_id=str(result),
        message="Loan prepayment processed successfully",
    )


# ── loan officer endpoints ──────────────────────────────────────────────────

@router.get(
    "/officer/queue",
    response_model=list[LoanApplicationResponse],
    dependencies=[Depends(require_role("loan_officer", "admin"))],
)
async def officer_queue(user: CurrentUser):
    """Loan officer views pending applications."""
    rows = fetch_all(
        "SELECT id, user_id, product_id, amount, tenure_months, "
        "       status, decided_by, decided_at, reason, created_at "
        "FROM loan_applications WHERE status IN ('submitted', 'under_review') "
        "ORDER BY created_at",
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    return [LoanApplicationResponse(**r) for r in rows]


@router.post(
    "/officer/decide/{application_id}",
    dependencies=[Depends(require_role("loan_officer", "admin"))],
)
async def decide_loan(application_id: str, body: LoanDecisionRequest, user: CurrentUser):
    """Approve or reject a loan application. Calls sp_decide_loan and auto-disburses on approval."""
    try:
        with get_conn(user_id=str(user["id"]), user_role=user["role"]) as conn:
            conn.execute(
                "SELECT payledger.sp_decide_loan(%s::uuid, %s::uuid, %s::varchar, %s::text)",
                (str(application_id), str(user["id"]), str(body.decision), str(body.reason)),
            )
            if body.decision == "approved":
                idem_key = f"disburse-{application_id}"
                conn.execute(
                    "SELECT payledger.sp_disburse_loan(%s::uuid, %s::varchar)",
                    (str(application_id), idem_key),
                )
            conn.commit()
    except (psycopg.errors.RaiseException, psycopg.Error) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=clean_db_error(exc))

    return {"message": f"Application {body.decision}"}


@router.get(
    "/portfolio",
    dependencies=[Depends(require_role("loan_officer", "admin"))],
)
async def loan_portfolio(user: CurrentUser):
    """Loan portfolio statistics from the v_loan_portfolio view."""
    rows = fetch_all(
        "SELECT * FROM v_loan_portfolio",
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    return rows


# ── admin ────────────────────────────────────────────────────────────────────

@router.post(
    "/admin/accrue",
    dependencies=[Depends(require_role("admin"))],
)
async def accrue_interest(user: CurrentUser):
    """Trigger nightly accrual of interest and penalties. Admin only."""
    try:
        call_procedure_scalar("sp_accrue_interest_and_penalties", user_id=str(user["id"]), user_role=user["role"])
    except psycopg.Error as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=clean_db_error(exc))

    return {"message": "Interest and penalty accrual completed"}
