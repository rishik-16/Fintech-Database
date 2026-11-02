"""
Wallet & Ledger router — accounts, transfers, payments, refunds, and statements.
"""
import csv
import io
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
import psycopg.errors

from app.db import get_conn, fetch_one, fetch_all, clean_db_error
from app.deps import CurrentUser, require_role, IdempotencyKey
from app.models.wallet import (
    AccountResponse,
    TransferRequest,
    PayMerchantRequest,
    RefundRequest,
    TransactionResponse,
    LedgerEntryResponse,
)

router = APIRouter()


# ── helpers ──────────────────────────────────────────────────────────────────

def _verify_account_owner(account_id: str, user_id: str, user_role: str = "customer") -> dict:
    """Verify the account belongs to the current user (or caller has admin role) and return it."""
    account = fetch_one(
        "SELECT a.id, a.user_id, a.account_type, a.currency, a.status, "
        "       ab.balance, a.created_at "
        "FROM accounts a "
        "JOIN account_balances ab ON ab.account_id = a.id "
        "WHERE a.id = %s",
        (account_id,),
        user_id=user_id,
        user_role=user_role,
    )
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    if str(account["user_id"]) != str(user_id) and user_role not in ("admin", "risk_analyst"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your account")
    return account


def _get_user_wallet(user_id: str, user_role: str = "customer") -> str:
    """Return the customer_wallet account id for a user."""
    row = fetch_one(
        "SELECT id FROM accounts WHERE user_id = %s AND account_type = 'customer_wallet' LIMIT 1",
        (user_id,),
        user_id=user_id,
        user_role=user_role,
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wallet account not found")
    return str(row["id"])


def _build_statement_query(
    account_id: str,
    page: int,
    per_page: int,
    date_from: Optional[str],
    date_to: Optional[str],
) -> tuple[str, list]:
    """Build the paginated statement query with optional date filters."""
    conditions = ["account_id = %s"]
    params: list = [account_id]

    if date_from:
        conditions.append("created_at >= %s::timestamptz")
        params.append(date_from)
    if date_to:
        conditions.append("created_at < (%s::date + 1)::timestamptz")
        params.append(date_to)

    where = " AND ".join(conditions)
    offset = (page - 1) * per_page
    params.extend([per_page, offset])

    query = (
        "SELECT entry_id AS id, transaction_id, kind, direction, amount, "
        "       description, running_balance, created_at "
        "FROM payledger.v_account_statement "
        f"WHERE {where} "
        "ORDER BY created_at DESC "
        "LIMIT %s OFFSET %s"
    )
    return query, params


# ── accounts ─────────────────────────────────────────────────────────────────

@router.get("/accounts", response_model=list[AccountResponse])
async def list_accounts(user: CurrentUser):
    """List all accounts belonging to the current user with their balances."""
    rows = fetch_all(
        "SELECT a.id, a.user_id, a.account_type, a.currency, a.status, "
        "       ab.balance, a.created_at "
        "FROM accounts a "
        "JOIN account_balances ab ON ab.account_id = a.id "
        "WHERE a.user_id = %s "
        "ORDER BY a.created_at",
        (str(user["id"]),),
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    return [AccountResponse(**r) for r in rows]


@router.get("/accounts/{account_id}/balance", response_model=AccountResponse)
async def get_account_balance(account_id: str, user: CurrentUser):
    """Get a single account with its current balance."""
    account = _verify_account_owner(account_id, str(user["id"]), user["role"])
    return AccountResponse(**account)


# ── statements ───────────────────────────────────────────────────────────────

@router.get("/accounts/{account_id}/statement", response_model=list[LedgerEntryResponse])
async def get_statement(
    account_id: str,
    user: CurrentUser,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    date_from: Optional[str] = Query(None, description="ISO date yyyy-mm-dd"),
    date_to: Optional[str] = Query(None, description="ISO date yyyy-mm-dd"),
):
    """Paginated account statement with optional date filters and running balance."""
    _verify_account_owner(account_id, str(user["id"]), user["role"])

    query, params = _build_statement_query(account_id, page, per_page, date_from, date_to)
    rows = fetch_all(query, tuple(params), user_id=str(user["id"]), user_role=user["role"])
    return [LedgerEntryResponse(**r) for r in rows]


@router.get("/accounts/{account_id}/statement/csv")
async def get_statement_csv(
    account_id: str,
    user: CurrentUser,
    page: int = Query(1, ge=1),
    per_page: int = Query(1000, ge=1, le=10000),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
):
    """Download account statement as a CSV file."""
    _verify_account_owner(account_id, str(user["id"]), user["role"])

    query, params = _build_statement_query(account_id, page, per_page, date_from, date_to)
    rows = fetch_all(query, tuple(params), user_id=str(user["id"]), user_role=user["role"])

    def generate():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["id", "transaction_id", "kind", "direction", "amount",
                         "description", "running_balance", "created_at"])
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate()
        for row in rows:
            writer.writerow([
                row["id"], row["transaction_id"], row["kind"],
                row["direction"], row["amount"], row.get("description", ""),
                row.get("running_balance", ""), row["created_at"],
            ])
            yield buf.getvalue()
            buf.seek(0)
            buf.truncate()

    return StreamingResponse(
        generate(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=statement_{account_id}.csv"},
    )


# ── money endpoints ─────────────────────────────────────────────────────────

@router.post("/transfer", response_model=TransactionResponse)
async def transfer(
    body: TransferRequest,
    user: CurrentUser,
    idem_key: IdempotencyKey,
):
    """Transfer money between accounts. Requires Idempotency-Key header."""
    from_account = _get_user_wallet(str(user["id"]), user["role"])
    try:
        with get_conn(user_id=str(user["id"]), user_role=user["role"]) as conn:
            row = conn.execute(
                "SELECT payledger.sp_transfer(%s::uuid, %s::uuid, %s::numeric, %s::varchar, %s::text, %s::uuid)",
                (from_account, str(body.to_account_id), Decimal(str(body.amount)),
                 idem_key, body.description, str(user["id"])),
            ).fetchone()
            conn.commit()
            result = list(row.values())[0] if row else None
    except (psycopg.errors.RaiseException, psycopg.Error) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=clean_db_error(exc))

    return TransactionResponse(
        transaction_id=str(result),
        message="Transfer completed successfully",
    )


@router.get("/contacts")
async def list_contacts(user: CurrentUser):
    """List sample peer customer contacts for peer-to-peer transfers."""
    try:
        rows = fetch_all(
            """SELECT a.id AS account_id, u.id AS user_id, u.full_name, u.email
               FROM accounts a
               JOIN users u ON u.id = a.user_id
               WHERE a.account_type = 'customer_wallet'
                 AND a.status = 'active'
                 AND u.id != %s::uuid
                 AND NOT starts_with(u.email, 'test_')
               ORDER BY u.full_name
               LIMIT 12""",
            (str(user["id"]),)
        )
        return rows
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=clean_db_error(exc))


@router.get("/merchants")
async def list_merchants(user: CurrentUser):
    """List registered merchants with their wallet accounts and fee rates for customer checkout."""
    try:
        with get_conn(user_id=str(user["id"]), user_role=user["role"]) as conn:
            rows = conn.execute("SELECT account_id, user_id, full_name, business_name, fee_rate FROM payledger.sp_get_active_merchants()").fetchall()
            return [
                {
                    "account_id": str(r[0]),
                    "user_id": str(r[1]),
                    "full_name": r[2],
                    "business_name": r[3],
                    "fee_rate": float(r[4]),
                }
                for r in rows
            ]
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=clean_db_error(exc))


@router.post("/pay-merchant", response_model=TransactionResponse)
async def pay_merchant(
    body: PayMerchantRequest,
    user: CurrentUser,
    idem_key: IdempotencyKey,
):
    """Pay a merchant. Requires Idempotency-Key header."""
    from_account = _get_user_wallet(str(user["id"]), user["role"])
    try:
        with get_conn(user_id=str(user["id"]), user_role=user["role"]) as conn:
            row = conn.execute(
                "SELECT payledger.sp_pay_merchant(%s::uuid, %s::uuid, %s::numeric, %s::varchar, %s::uuid)",
                (from_account, str(body.merchant_account_id), Decimal(str(body.amount)),
                 idem_key, str(user["id"])),
            ).fetchone()
            conn.commit()
            result = list(row.values())[0] if row else None
    except (psycopg.errors.RaiseException, psycopg.Error) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=clean_db_error(exc))

    return TransactionResponse(
        transaction_id=str(result),
        message="Merchant payment completed successfully",
    )


@router.post(
    "/refund",
    response_model=TransactionResponse,
    dependencies=[Depends(require_role("merchant", "admin"))],
)
async def refund(
    body: RefundRequest,
    user: CurrentUser,
    idem_key: IdempotencyKey,
):
    """Refund a previous transaction. Requires merchant or admin role and Idempotency-Key."""
    try:
        with get_conn(user_id=str(user["id"]), user_role=user["role"]) as conn:
            row = conn.execute(
                "SELECT payledger.sp_refund(%s::uuid, %s::numeric, %s::varchar, %s::uuid)",
                (str(body.original_transaction_id), Decimal(str(body.amount)),
                 idem_key, str(user["id"])),
            ).fetchone()
            conn.commit()
            result = list(row.values())[0] if row else None
    except (psycopg.errors.RaiseException, psycopg.Error) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=clean_db_error(exc))

    return TransactionResponse(
        transaction_id=str(result),
        message="Refund processed successfully",
    )
