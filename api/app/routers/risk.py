"""
Risk, fraud detection, and bank reconciliation router.
"""
import csv
import io
import json
import uuid
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status
import psycopg.errors

from app.db import get_conn, fetch_one, fetch_all, call_procedure_scalar, clean_db_error
from app.deps import CurrentUser, require_role
from app.models.risk import (
    FraudRuleResponse,
    FraudRuleCreateRequest,
    FraudRuleUpdateRequest,
    FraudAlertResponse,
    AlertAssignRequest,
    AlertResolveRequest,
    ReconciliationResultResponse,
    BankStatementLineResponse,
)

router = APIRouter()


# ── Fraud Alerts ─────────────────────────────────────────────────────────────

@router.get(
    "/alerts",
    response_model=list[FraudAlertResponse],
    dependencies=[Depends(require_role("risk_analyst", "admin"))],
)
async def list_alerts(
    user: CurrentUser,
    alert_status: Optional[str] = Query(None, alias="status"),
    severity: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    """List fraud alerts with optional status/severity filters."""
    conditions = []
    params = []
    if alert_status:
        conditions.append("fa.status = %s::alert_status")
        params.append(alert_status)
    if severity:
        conditions.append("fa.severity = %s::alert_severity")
        params.append(severity)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    offset = (page - 1) * per_page
    params.extend([per_page, offset])

    rows = fetch_all(
        f"""SELECT fa.id, fa.rule_id, fr.code AS rule_code,
                   fa.ledger_transaction_id, fa.account_id, fa.severity, fa.status,
                   fa.assigned_to, u.full_name AS assigned_name,
                   fa.created_at, fa.resolved_at, fa.notes
            FROM fraud_alerts fa
            LEFT JOIN fraud_rules fr ON fr.id = fa.rule_id
            LEFT JOIN users u ON u.id = fa.assigned_to
            {where}
            ORDER BY fa.created_at DESC
            LIMIT %s OFFSET %s""",
        tuple(params),
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    return [FraudAlertResponse(**r) for r in rows]


@router.post(
    "/alerts/{alert_id}/assign",
    dependencies=[Depends(require_role("risk_analyst", "admin"))],
)
async def assign_alert(alert_id: str, body: AlertAssignRequest, user: CurrentUser):
    """Assign a fraud alert to an analyst."""
    with get_conn(user_id=str(user["id"]), user_role=user["role"]) as conn:
        result = conn.execute(
            "UPDATE fraud_alerts SET assigned_to = %s WHERE id = %s RETURNING id",
            (body.assigned_to, alert_id),
        )
        if not result.fetchone():
            raise HTTPException(status_code=404, detail="Alert not found")
        conn.commit()
    return {"message": "Alert assigned successfully"}


@router.post(
    "/alerts/{alert_id}/resolve",
    dependencies=[Depends(require_role("risk_analyst", "admin"))],
)
async def resolve_alert(alert_id: str, body: AlertResolveRequest, user: CurrentUser):
    """Resolve an alert or mark it as a false positive."""
    with get_conn(user_id=str(user["id"]), user_role=user["role"]) as conn:
        result = conn.execute(
            """UPDATE fraud_alerts
               SET status = %s::alert_status, notes = %s, resolved_at = now()
               WHERE id = %s
               RETURNING id""",
            (body.status, body.notes, alert_id),
        )
        if not result.fetchone():
            raise HTTPException(status_code=404, detail="Alert not found")
        conn.commit()
    return {"message": f"Alert marked as {body.status}"}


# ── Fraud Rules CRUD ─────────────────────────────────────────────────────────

@router.get(
    "/rules",
    response_model=list[FraudRuleResponse],
    dependencies=[Depends(require_role("risk_analyst", "admin"))],
)
async def list_rules(user: CurrentUser):
    """List all configured fraud detection rules."""
    rows = fetch_all(
        "SELECT * FROM fraud_rules ORDER BY code",
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    return [FraudRuleResponse(**r) for r in rows]


@router.post(
    "/rules",
    response_model=FraudRuleResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_role("risk_analyst", "admin"))],
)
async def create_rule(body: FraudRuleCreateRequest, user: CurrentUser):
    """Create a new fraud rule."""
    with get_conn(user_id=str(user["id"]), user_role=user["role"]) as conn:
        try:
            row = conn.execute(
                """INSERT INTO fraud_rules (id, code, description, threshold_json, severity, active)
                   VALUES (gen_random_uuid(), %s, %s, %s::jsonb, %s::alert_severity, %s)
                   RETURNING *""",
                (
                    body.code,
                    body.description,
                    json.dumps(body.threshold_json),
                    body.severity,
                    body.active,
                ),
            ).fetchone()
            conn.commit()
        except psycopg.errors.UniqueViolation:
            raise HTTPException(status_code=409, detail="A rule with this code already exists")
    return FraudRuleResponse(**dict(row))


@router.put(
    "/rules/{rule_id}",
    dependencies=[Depends(require_role("risk_analyst", "admin"))],
)
async def update_rule(rule_id: str, body: FraudRuleUpdateRequest, user: CurrentUser):
    """Update an existing fraud rule."""
    updates = []
    params = []
    if body.description is not None:
        updates.append("description = %s")
        params.append(body.description)
    if body.threshold_json is not None:
        updates.append("threshold_json = %s::jsonb")
        params.append(json.dumps(body.threshold_json))
    if body.severity is not None:
        updates.append("severity = %s::alert_severity")
        params.append(body.severity)
    if body.active is not None:
        updates.append("active = %s")
        params.append(body.active)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields provided to update")

    params.append(rule_id)
    with get_conn(user_id=str(user["id"]), user_role=user["role"]) as conn:
        result = conn.execute(
            f"UPDATE fraud_rules SET {', '.join(updates)} WHERE id = %s RETURNING *",
            tuple(params),
        ).fetchone()
        if not result:
            raise HTTPException(status_code=404, detail="Rule not found")
        conn.commit()
    return dict(result)


# ── Bank Statement Import & Reconciliation ───────────────────────────────────

@router.post(
    "/import-statement",
    dependencies=[Depends(require_role("risk_analyst", "admin"))],
)
async def import_statement(user: CurrentUser, file: UploadFile = File(...)):
    """Upload a bank statement CSV for automated reconciliation."""
    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    if not text.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded CSV file is empty")

    stream = io.StringIO(text)
    reader = csv.DictReader(stream)
    
    if not reader.fieldnames:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file has no header row")

    import_id = str(uuid.uuid4())
    rows_to_insert = []

    for line_num, row in enumerate(reader, start=2):
        bank_ref = (row.get("bank_reference") or row.get("reference") or row.get("ref") or "").strip()
        value_date = (row.get("value_date") or row.get("date") or "").strip()
        amt_str = (row.get("amount") or "").strip()
        narration = (row.get("narration") or row.get("description") or "").strip()

        if not bank_ref:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Line {line_num}: missing required bank reference"
            )
        if not value_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Line {line_num}: missing required value_date"
            )
        if not amt_str:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Line {line_num}: missing required amount"
            )

        try:
            parsed_amt = Decimal(amt_str)
            if parsed_amt <= 0:
                raise ValueError("Amount must be positive")
        except (InvalidOperation, ValueError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Line {line_num}: invalid monetary amount '{amt_str}'"
            )

        rows_to_insert.append((import_id, bank_ref, value_date, parsed_amt, narration))

    if not rows_to_insert:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No data rows found in CSV")

    with get_conn(user_id=str(user["id"]), user_role=user["role"]) as conn:
        conn.execute(
            """INSERT INTO bank_statement_imports (id, filename, imported_by)
               VALUES (%s, %s, %s)""",
            (import_id, file.filename, str(user["id"])),
        )

        for imp_id, b_ref, v_date, p_amt, narr in rows_to_insert:
            conn.execute(
                """INSERT INTO bank_statement_lines
                   (id, import_id, bank_reference, value_date, amount, narration)
                   VALUES (gen_random_uuid(), %s, %s, %s, %s, %s)""",
                (imp_id, b_ref, v_date, p_amt, narr),
            )

        conn.commit()

    return {
        "import_id": import_id,
        "imported_lines": len(rows_to_insert),
        "message": "Statement imported successfully",
    }


@router.post(
    "/reconcile/{import_id}",
    dependencies=[Depends(require_role("risk_analyst", "admin"))],
)
async def reconcile(import_id: str, user: CurrentUser):
    """Run automated reconciliation algorithm via sp_reconcile."""
    try:
        with get_conn(user_id=str(user["id"]), user_role=user["role"]) as conn:
            row = conn.execute(
                "SELECT payledger.sp_reconcile(%s::uuid, %s::uuid)",
                (str(import_id), str(user["id"])),
            ).fetchone()
            conn.commit()
            run_id = list(row.values())[0] if row else None
    except (psycopg.errors.RaiseException, psycopg.Error) as exc:
        raise HTTPException(status_code=400, detail=clean_db_error(exc))

    result = fetch_one(
        "SELECT * FROM reconciliation_runs WHERE id = %s",
        (run_id,),
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    return result


@router.get(
    "/reconciliation/{run_id}",
    dependencies=[Depends(require_role("risk_analyst", "admin"))],
)
async def get_reconciliation_details(run_id: str, user: CurrentUser):
    """Get reconciliation run summary and individual lines with match statuses."""
    run = fetch_one(
        "SELECT * FROM reconciliation_runs WHERE id = %s",
        (run_id,),
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    if not run:
        raise HTTPException(status_code=404, detail="Reconciliation run not found")

    lines = fetch_all(
        """SELECT id, bank_reference, value_date::text, amount, narration,
                  matched_transaction_id, match_status
           FROM bank_statement_lines
           WHERE import_id = %s
           ORDER BY value_date, id""",
        (run["import_id"],),
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    return {"run": run, "lines": lines}


@router.get(
    "/imports",
    dependencies=[Depends(require_role("risk_analyst", "admin"))],
)
async def list_imports(user: CurrentUser):
    """List all bank statement imports with summary stats."""
    rows = fetch_all(
        "SELECT * FROM v_reconciliation_summary ORDER BY imported_at DESC",
        user_id=str(user["id"]),
        user_role=user["role"],
    )
    return rows
