"""Pydantic models for admin endpoints."""
from datetime import datetime
from typing import Optional, Any, Union
from uuid import UUID

from pydantic import BaseModel

UUIDType = Union[UUID, str]


class AuditLogResponse(BaseModel):
    id: UUIDType
    actor_user_id: Optional[UUIDType] = None
    actor_name: Optional[str] = None
    action: str
    entity: str
    entity_id: Optional[UUIDType] = None
    old_data: Optional[dict] = None
    new_data: Optional[dict] = None
    at: datetime


class UserManageResponse(BaseModel):
    id: UUIDType
    full_name: str
    email: str
    phone: Optional[str] = None
    role: str
    status: str
    created_at: datetime


class SystemHealthResponse(BaseModel):
    db_size: str
    table_counts: dict
    partition_list: list
    active_connections: int


class DailyVolumeResponse(BaseModel):
    date: str
    transaction_count: int
    total_amount: float
