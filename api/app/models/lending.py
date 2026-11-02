"""Pydantic models for lending endpoints."""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field

UUIDType = Union[UUID, str]


class LoanProductResponse(BaseModel):
    id: UUIDType
    name: str
    annual_rate: Decimal
    min_amount: Decimal
    max_amount: Decimal
    min_tenure_months: int
    max_tenure_months: int
    penalty_rate: Decimal
    prepayment_allowed: bool


class EMICalculatorRequest(BaseModel):
    principal: Decimal = Field(..., gt=0)
    annual_rate: Decimal = Field(..., ge=0)
    tenure_months: int = Field(..., gt=0)


class EMICalculatorResponse(BaseModel):
    emi_amount: Decimal
    total_interest: Decimal
    total_payment: Decimal


class LoanApplyRequest(BaseModel):
    product_id: UUIDType
    amount: Decimal = Field(..., gt=0)
    tenure_months: int = Field(..., gt=0)


class LoanApplicationResponse(BaseModel):
    id: UUIDType
    user_id: UUIDType
    product_id: UUIDType
    amount: Decimal
    tenure_months: int
    status: str
    decided_by: Optional[UUIDType] = None
    decided_at: Optional[datetime] = None
    reason: Optional[str] = None
    created_at: datetime


class LoanDecisionRequest(BaseModel):
    decision: str = Field(..., pattern="^(approved|rejected)$")
    reason: Optional[str] = None


class LoanResponse(BaseModel):
    id: UUIDType
    application_id: UUIDType
    user_id: UUIDType
    principal: Decimal
    annual_rate: Decimal
    tenure_months: int
    status: str
    outstanding_principal: Decimal
    disbursed_at: Optional[datetime] = None
    created_at: datetime


class EMIScheduleResponse(BaseModel):
    id: UUIDType
    loan_id: UUIDType
    installment_no: int
    due_date: date
    principal_component: Decimal
    interest_component: Decimal
    total_due: Decimal
    status: str
    paid_amount: Decimal
    paid_at: Optional[datetime] = None


class PayEMIRequest(BaseModel):
    emi_id: UUIDType
    amount: Decimal = Field(..., gt=0)


class PrepayLoanRequest(BaseModel):
    amount: Decimal = Field(..., gt=0)
