"""Pydantic models for wallet and ledger endpoints."""
from datetime import datetime
from decimal import Decimal
from typing import Optional, Union
from uuid import UUID

from pydantic import BaseModel, Field

UUIDType = Union[UUID, str]


class AccountResponse(BaseModel):
    id: UUIDType
    user_id: Optional[UUIDType] = None
    account_type: str
    currency: str
    status: str
    balance: Decimal
    created_at: datetime


class TransferRequest(BaseModel):
    to_account_id: UUIDType
    amount: Decimal = Field(..., gt=0, decimal_places=2)
    description: Optional[str] = None


class PayMerchantRequest(BaseModel):
    merchant_account_id: UUIDType
    amount: Decimal = Field(..., gt=0, decimal_places=2)


class RefundRequest(BaseModel):
    original_transaction_id: UUIDType
    amount: Decimal = Field(..., gt=0, decimal_places=2)


class TransactionResponse(BaseModel):
    transaction_id: UUIDType
    message: str


class LedgerEntryResponse(BaseModel):
    id: UUIDType
    transaction_id: UUIDType
    kind: str
    direction: str
    amount: Decimal
    description: Optional[str] = None
    running_balance: Optional[Decimal] = None
    created_at: datetime


class StatementParams(BaseModel):
    page: int = Field(default=1, ge=1)
    per_page: int = Field(default=20, ge=1, le=100)
    date_from: Optional[str] = None
    date_to: Optional[str] = None
