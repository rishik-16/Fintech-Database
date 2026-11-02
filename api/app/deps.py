"""
FastAPI dependencies for authentication and role-based access control.
"""
from typing import Annotated, Optional

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.auth import decode_access_token
from app.db import fetch_one

security = HTTPBearer()


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)]
) -> dict:
    """Extract and validate the current user from the JWT token."""
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )
    user = fetch_one(
        "SELECT id, full_name, email, phone, role, status, created_at "
        "FROM users WHERE id = %s",
        (user_id,),
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    if user["status"] != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active",
        )
    return user


# Type alias for dependency injection
CurrentUser = Annotated[dict, Depends(get_current_user)]


def require_role(*roles: str):
    """Dependency factory: require the current user to have one of the given roles."""
    async def role_checker(user: CurrentUser) -> dict:
        if user["role"] not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires role: {', '.join(roles)}",
            )
        return user
    return role_checker


# Convenience role dependencies
RequireAdmin = Depends(require_role("admin"))
RequireCustomer = Depends(require_role("customer", "admin"))
RequireMerchant = Depends(require_role("merchant", "admin"))
RequireOfficer = Depends(require_role("loan_officer", "admin"))
RequireRisk = Depends(require_role("risk_analyst", "admin"))


async def get_idempotency_key(
    idempotency_key: Annotated[Optional[str], Header(alias="Idempotency-Key")] = None
) -> str:
    """Extract the Idempotency-Key header, required on money endpoints."""
    if not idempotency_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Idempotency-Key header is required",
        )
    return idempotency_key


IdempotencyKey = Annotated[str, Depends(get_idempotency_key)]
