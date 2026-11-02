"""Pydantic models for risk, fraud, and reconciliation endpoints."""
from datetime import datetime
from decimal import Decimal
from typing import Optional, Any, Union
from uuid import UUID

from pydantic import BaseModel, Field

UUIDType = Union[UUID, str]


class FraudRuleResponse(BaseModel):
    id: UUIDType
    code: str
    description: Optional[str] = None
    threshold_json: dict
    severity: str
    active: bool
    created_at: datetime


class FraudRuleCreateRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=50)
    description: Optional[str] = None
    threshold_json: dict
    severity: str = Field(default="medium", pattern="^(low|medium|high|critical)$")
    active: bool = True


class FraudRuleUpdateRequest(BaseModel):
    description: Optional[str] = None
    threshold_json: Optional[dict] = None
    severity: Optional[str] = None
    active: Optional[bool] = None


class FraudAlertResponse(BaseModel):
    id: UUIDType
    rule_id: UUIDType
    rule_code: Optional[str] = None
    ledger_transaction_id: Optional[UUIDType] = None
    account_id: Optional[UUIDType] = None
    severity: str
    status: str
    assigned_to: Optional[UUIDType] = None
    assigned_name: Optional[str] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None
    notes: Optional[str] = None


class AlertAssignRequest(BaseModel):
    assigned_to: UUIDType


class AlertResolveRequest(BaseModel):
    status: str = Field(..., pattern="^(resolved|false_positive)$")
    notes: Optional[str] = None


class ReconciliationResultResponse(BaseModel):
    id: UUIDType
    import_id: UUIDType
    run_at: datetime
    matched_count: int
    unmatched_count: int
    mismatch_count: int


class BankStatementLineResponse(BaseModel):
    id: UUIDType
    bank_reference: Optional[str] = None
    value_date: Optional[str] = None
    amount: Decimal
    narration: Optional[str] = None
    matched_transaction_id: Optional[UUIDType] = None
    match_status: str
