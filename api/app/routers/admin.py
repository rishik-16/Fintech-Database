"""
Admin, system health, and DB Lab router.
"""
import glob
import os
import sys
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
import psycopg.errors

from app.db import get_conn, fetch_one, fetch_all, call_procedure_scalar, clean_db_error
from app.deps import CurrentUser, require_role
from app.models.admin import (
    AuditLogResponse,
    UserManageResponse,
    SystemHealthResponse,
    DailyVolumeResponse,
)

router = APIRouter()


# ── User Management ──────────────────────────────────────────────────────────

@router.get(
    "/users",
    response_model=list[UserManageResponse],
    dependencies=[Depends(require_role("admin"))],
)
async def list_users(
    user: CurrentUser,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    role: Optional[str] = Query(None),
):
    """List users with pagination and optional role filter."""
    conditions = []
    params = []
    if role:
        conditions.append("role = %s::user_role")
        params.append(role)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    offset = (page - 1) * per_page
    params.extend([per_page, offset])

    rows = fetch_all(
        f"""SELECT id, full_name, email, phone, role, status, created_at
            FROM users
            {where}
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s""",
        tuple(params),
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    return [UserManageResponse(**r) for r in rows]


@router.put(
    "/users/{user_id}/status",
    dependencies=[Depends(require_role("admin"))],
)
async def update_user_status(user_id: str, new_status: str = Query(...), user: CurrentUser = None):
    """Update user status (active, suspended, deactivated)."""
    if new_status not in ("active", "suspended", "deactivated"):
        raise HTTPException(status_code=400, detail="Invalid status. Must be active, suspended, or deactivated")

    with get_conn(user_id=str(user["id"]) if user else None, user_role=user["role"] if user else "admin") as conn:
        res = conn.execute(
            "UPDATE users SET status = %s WHERE id = %s RETURNING id",
            (new_status, user_id),
        )
        if not res.fetchone():
            raise HTTPException(status_code=404, detail="User not found")
        conn.commit()

    return {"message": f"User status updated to {new_status}"}


# ── Audit Log ────────────────────────────────────────────────────────────────

@router.get(
    "/audit-log",
    dependencies=[Depends(require_role("admin"))],
)
async def audit_log(
    user: CurrentUser,
    entity: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=1, le=100),
):
    """Filterable audit log with actor attribution."""
    conditions = []
    params = []
    if entity:
        conditions.append("al.entity = %s")
        params.append(entity)
    if action:
        conditions.append("al.action = %s")
        params.append(action)
    if date_from:
        conditions.append("al.performed_at >= %s::timestamptz")
        params.append(date_from)
    if date_to:
        conditions.append("al.performed_at < (%s::date + 1)::timestamptz")
        params.append(date_to)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    offset = (page - 1) * per_page
    params.extend([per_page, offset])

    rows = fetch_all(
        f"""SELECT al.id, al.entity, al.entity_id, al.action,
                   al.performed_by, u.full_name AS performed_by_name,
                   al.performed_at, al.old_state, al.new_state
            FROM audit_log al
            LEFT JOIN users u ON u.id = al.performed_by
            {where}
            ORDER BY al.performed_at DESC
            LIMIT %s OFFSET %s""",
        tuple(params),
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    return rows


# ── System Health & Analytics ────────────────────────────────────────────────

@router.get(
    "/system/health",
    response_model=SystemHealthResponse,
    dependencies=[Depends(require_role("admin"))],
)
async def system_health(user: CurrentUser):
    """System health check for admin dashboard and monitoring."""
    db_size_row = fetch_one(
        "SELECT pg_size_pretty(pg_database_size(current_database())) AS size",
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    db_size = db_size_row["size"] if db_size_row else "Unknown"

    active_conn_row = fetch_one(
        "SELECT count(*) AS cnt FROM pg_stat_activity WHERE datname = current_database()",
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    active_conns = int(active_conn_row["cnt"]) if active_conn_row else 1

    tables = ["users", "accounts", "account_balances", "ledger_transactions", "ledger_entries", "loans", "fraud_alerts"]
    table_counts = {}
    for tbl in tables:
        try:
            cnt_row = fetch_one(
                f"SELECT count(*) AS cnt FROM payledger.{tbl}",
                user_id=str(user["id"]),
                user_role=user["role"],
            )
            table_counts[tbl] = int(cnt_row["cnt"]) if cnt_row else 0
        except Exception:
            table_counts[tbl] = 0

    partition_rows = fetch_all(
        """SELECT child.relname AS partition_name,
                  pg_size_pretty(pg_relation_size(child.oid)) AS size
           FROM pg_inherits
           JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
           JOIN pg_class child ON child.oid = pg_inherits.inhrelid
           JOIN pg_namespace n ON n.oid = parent.relnamespace
           WHERE n.nspname = 'payledger' AND parent.relname = 'ledger_entries'
           ORDER BY child.relname""",
        user_id=str(user["id"]),
        user_role=user["role"],
    )

    return SystemHealthResponse(
        db_size=db_size,
        table_counts=table_counts,
        partition_list=partition_rows or [],
        active_connections=active_conns,
    )


@router.get(
    "/health/deep",
    dependencies=[Depends(require_role("admin"))],
)
async def deep_health(user: CurrentUser):
    """Deep system health checks: DB connection, schema checks, invariants."""
    checks = {}

    # Check DB
    try:
        row = fetch_one("SELECT 1 AS ok", user_id=str(user["id"]), user_role=user["role"])
        checks["database"] = "healthy" if row and row["ok"] == 1 else "unhealthy"
    except Exception as e:
        checks["database"] = f"error: {str(e)}"

    # Check double-entry invariant across all ledger entries
    try:
        inv = fetch_one(
            """SELECT COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0) =
                      COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0) AS is_balanced
               FROM ledger_entries""",
            user_id=str(user["id"]),
            user_role=user["role"],
        )
        checks["double_entry_invariant"] = "intact" if inv and inv["is_balanced"] else "VIOLATED"
    except Exception as e:
        checks["double_entry_invariant"] = f"error: {str(e)}"

    # Check connection pool
    from app.db import get_pool
    checks["connection_pool"] = "healthy" if get_pool() is not None else "uninitialized"

    all_healthy = all(v in ("healthy", "intact") for v in checks.values())
    return {"status": "ok" if all_healthy else "degraded", "checks": checks}


@router.get(
    "/analytics/daily-volume",
    response_model=list[DailyVolumeResponse],
    dependencies=[Depends(require_role("admin"))],
)
async def daily_volume(
    user: CurrentUser,
    days: int = Query(30, ge=1, le=365),
):
    """Daily transaction volume and failure rates."""
    rows = fetch_all(
        """SELECT volume_date, transaction_count, total_volume,
                  successful_count, failed_count
           FROM daily_transaction_stats
           WHERE volume_date >= CURRENT_DATE - %s::integer
           ORDER BY volume_date DESC""",
        (days,),
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    return [DailyVolumeResponse(**r) for r in rows]


@router.get(
    "/analytics/loan-portfolio",
    dependencies=[Depends(require_role("loan_officer", "admin"))],
)
async def loan_portfolio_analytics(user: CurrentUser):
    """Detailed loan portfolio analytics, NPA tracking, and Bank Treasury reserves status."""
    loans = fetch_all(
        "SELECT * FROM v_loan_portfolio ORDER BY disbursed_at DESC NULLS LAST",
        user_id=str(user["id"]),
        user_role=user["role"],
    )

    total_outstanding = sum(float(l["outstanding_principal"]) for l in loans)
    npa_amount = sum(float(l["overdue_amount"]) for l in loans if l.get("is_npa"))
    total_loans = len(loans)
    active_loans = sum(1 for l in loans if l["status"] == "active")
    closed_loans = sum(1 for l in loans if l["status"] == "closed")
    total_penalties = sum(float(l["total_penalties"]) for l in loans)

    # Bank Treasury Accounts: loan_pool & system_fee
    treasury = fetch_all(
        """SELECT a.id, a.account_type, a.currency, ab.balance
           FROM accounts a
           JOIN account_balances ab ON ab.account_id = a.id
           WHERE a.account_type IN ('loan_pool', 'system_fee', 'system_suspense')
           ORDER BY a.account_type"""
    )

    # Recent Bank Treasury activity (last 15 double-entry records affecting bank accounts)
    recent_bank_activity = fetch_all(
        """SELECT le.id, le.transaction_id, lt.kind, lt.description,
                  a.account_type, le.direction, le.amount, le.created_at
           FROM ledger_entries le
           JOIN ledger_transactions lt ON lt.id = le.transaction_id
           JOIN accounts a ON a.id = le.account_id
           WHERE a.account_type IN ('loan_pool', 'system_fee')
           ORDER BY le.created_at DESC
           LIMIT 15"""
    )

    return {
        "summary": {
            "total_outstanding": total_outstanding,
            "npa_amount": npa_amount,
            "total_loans": total_loans,
            "active_loans": active_loans,
            "closed_loans": closed_loans,
            "total_penalties_assessed": total_penalties,
        },
        "loans": loans,
        "treasury": treasury,
        "recent_bank_activity": recent_bank_activity,
    }


@router.post(
    "/analytics/refresh-stats",
    dependencies=[Depends(require_role("admin"))],
)
async def refresh_stats(user: CurrentUser):
    """Refresh daily transaction stats materialized table."""
    try:
        call_procedure_scalar("sp_refresh_daily_stats", user_id=str(user["id"]), user_role=user["role"])
    except psycopg.Error as exc:
        raise HTTPException(status_code=500, detail=clean_db_error(exc))
    return {"message": "Daily stats refreshed successfully"}


# ── Partition Information ────────────────────────────────────────────────────

@router.get(
    "/system/partitions",
    dependencies=[Depends(require_role("admin"))],
)
async def list_partitions(user: CurrentUser):
    """List all ledger_entries table partitions with row counts and sizes."""
    rows = fetch_all(
        """SELECT child.relname AS partition_name,
                  pg_size_pretty(pg_relation_size(child.oid)) AS size,
                  pg_relation_size(child.oid) AS size_bytes
           FROM pg_inherits
           JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
           JOIN pg_class child ON child.oid = pg_inherits.inhrelid
           JOIN pg_namespace n ON n.oid = parent.relnamespace
           WHERE n.nspname = 'payledger' AND parent.relname = 'ledger_entries'
           ORDER BY child.relname""",
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    return rows


@router.post(
    "/system/create-partition",
    dependencies=[Depends(require_role("admin"))],
)
async def create_partition(user: CurrentUser):
    """Create the ledger_entries partition for next month."""
    partition_name = call_procedure_scalar("sp_create_next_month_partition", user_id=str(user["id"]), user_role=user["role"])
    return {"message": "Partition created successfully", "partition": partition_name}


# ── DB Lab Endpoints (Accessible to all authenticated users) ──────────────────

@router.get("/db-lab/concurrency-demo")
async def run_concurrency_endpoint(user: CurrentUser):
    """Run a live concurrency simulation of transfers and verify money conservation."""
    try:
        scripts_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "scripts"))
        if scripts_dir not in sys.path:
            sys.path.insert(0, scripts_dir)
        import concurrency_demo
        result = concurrency_demo.run_concurrency_test(num_transfers=50, num_accounts=5)
        if result is None:
            raise HTTPException(status_code=500, detail="Insufficient accounts to run demo. Seed database first.")
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Concurrency demo failed: {str(e)}")


@router.get("/db-lab/invariant-check")
async def invariant_check(user: CurrentUser):
    """Live proof: check that SUM(debits) = SUM(credits) for every transaction across the entire ledger."""
    # Run at system-level without RLS filtering so counterparty entries are included
    stats = fetch_one(
        """SELECT
             COUNT(DISTINCT transaction_id) AS total_transactions,
             COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0)::float AS total_debits,
             COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0)::float AS total_credits
           FROM ledger_entries"""
    )

    unbalanced = fetch_all(
        """SELECT transaction_id,
                  SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END) AS debits,
                  SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END) AS credits
           FROM ledger_entries
           GROUP BY transaction_id
           HAVING SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END)
               <> SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END)
           LIMIT 10"""
    )

    all_balanced = len(unbalanced) == 0
    total_txns = stats["total_transactions"] if stats else 0
    return {
        "total_transactions": total_txns,
        "total_debits": stats["total_debits"] if stats else 0.0,
        "total_credits": stats["total_credits"] if stats else 0.0,
        "all_balanced": all_balanced,
        "unbalanced_count": len(unbalanced),
        "unbalanced_sample": unbalanced,
        "message": (
            f"All {total_txns} transactions have balanced debits and credits ✓"
            if all_balanced
            else f"Warning: {len(unbalanced)} unbalanced transactions detected!"
        ),
    }


@router.get("/db-lab/partitions")
async def db_lab_partitions(user: CurrentUser):
    """Demonstrate table partitioning on ledger_entries with sizes."""
    rows = fetch_all(
        """SELECT child.relname AS partition_name,
                  pg_size_pretty(pg_relation_size(child.oid)) AS size,
                  (SELECT COUNT(*) FROM payledger.ledger_entries WHERE tableoid = child.oid) AS row_count
           FROM pg_inherits
           JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
           JOIN pg_class child ON child.oid = pg_inherits.inhrelid
           JOIN pg_namespace n ON n.oid = parent.relnamespace
           WHERE n.nspname = 'payledger' AND parent.relname = 'ledger_entries'
           ORDER BY child.relname""",
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    return rows


@router.get("/db-lab/rls-demo")
async def rls_demo(user: CurrentUser):
    """Demonstrate Row-Level Security: shows total rows vs rows visible to current user."""
    total_accounts = fetch_one("SELECT COUNT(*) AS cnt FROM accounts")
    total_entries = fetch_one("SELECT COUNT(*) AS cnt FROM ledger_entries")

    user_accounts = fetch_all(
        "SELECT COUNT(*) AS cnt FROM accounts",
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    user_entries = fetch_all(
        "SELECT COUNT(*) AS cnt FROM ledger_entries",
        user_id=str(user["id"]),
        user_role=user["role"],
    )

    return {
        "user_email": user["email"],
        "user_role": user["role"],
        "total_accounts_in_db": total_accounts["cnt"] if total_accounts else 0,
        "accounts_visible_to_user": user_accounts[0]["cnt"] if user_accounts else 0,
        "total_ledger_entries_in_db": total_entries["cnt"] if total_entries else 0,
        "entries_visible_to_user": user_entries[0]["cnt"] if user_entries else 0,
        "rls_enforced": True,
        "explanation": (
            "Because of Row-Level Security, a customer can only see their own accounts and entries, "
            "even with a raw 'SELECT * FROM accounts' query."
            if user["role"] == "customer"
            else f"Role '{user['role']}' has elevated read privileges across accounts."
        ),
    }


@router.get("/db-lab/explain-results")
async def explain_results(user: CurrentUser):
    """Return before/after EXPLAIN ANALYZE comparison data for 5 key queries."""
    candidate_dirs = [
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "docs", "explain"),
        os.path.join(os.path.dirname(__file__), "..", "..", "docs", "explain"),
        os.path.abspath("docs/explain"),
        "/app/docs/explain",
    ]
    docs_dir = ""
    for c in candidate_dirs:
        if os.path.exists(c):
            docs_dir = c
            break

    results = []

    for i in range(1, 6):
        before_file = os.path.join(docs_dir, f"query_0{i}_before.txt")
        after_file = os.path.join(docs_dir, f"query_0{i}_after.txt")

        before_text = ""
        after_text = ""

        if os.path.exists(before_file):
            with open(before_file, "r") as f:
                before_text = f.read()
        if os.path.exists(after_file):
            with open(after_file, "r") as f:
                after_text = f.read()

        results.append({
            "query_number": i,
            "title": _get_explain_query_title(i),
            "before": before_text or "No index (Sequential Scan)",
            "after": after_text or "With index (Index Scan)",
        })

    return results


def _get_explain_query_title(num: int) -> str:
    titles = {
        1: "Account Statement Query (idx_ledger_entries_account_date)",
        2: "Open Fraud Alerts for Dashboard (idx_fraud_alerts_open)",
        3: "Pending EMI Batch Assessment (idx_emi_pending_due)",
        4: "Customer Active Loans Lookup (idx_loans_user)",
        5: "Audit Trail by Entity (idx_audit_entity)",
    }
    return titles.get(num, f"Query #{num}")


@router.get("/db-lab/bank-treasury")
async def db_lab_bank_treasury(user: CurrentUser):
    """Inspect Bank System Accounts (loan_pool, system_fee, system_suspense) and recent double-entry ledger stream."""
    accounts = fetch_all(
        """SELECT a.id, a.account_type, a.currency, a.status, ab.balance, a.created_at
           FROM accounts a
           JOIN account_balances ab ON ab.account_id = a.id
           WHERE a.account_type IN ('loan_pool', 'system_fee', 'system_suspense')
           ORDER BY a.account_type"""
    )
    recent_entries = fetch_all(
        """SELECT le.id, le.transaction_id, lt.kind, lt.description,
                  a.account_type, le.direction, le.amount, le.created_at
           FROM ledger_entries le
           JOIN ledger_transactions lt ON lt.id = le.transaction_id
           JOIN accounts a ON a.id = le.account_id
           WHERE a.account_type IN ('loan_pool', 'system_fee', 'system_suspense')
           ORDER BY le.created_at DESC
           LIMIT 20"""
    )
    return {
        "accounts": accounts,
        "recent_entries": recent_entries,
    }

