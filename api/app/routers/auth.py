"""
Authentication router — registration, login, and user profile.
"""
import uuid
from fastapi import APIRouter, HTTPException, status
import psycopg.errors

from app.auth import hash_password, verify_password, create_access_token
from app.db import get_conn, fetch_one, clean_db_error
from app.deps import CurrentUser
from app.models.auth import (
    RegisterRequest,
    LoginRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest):
    """Register a new user, auto-create their wallet account, and return a JWT."""
    email = str(body.email).strip().lower()
    hashed = hash_password(body.password)
    user_id = str(uuid.uuid4())
    account_id = str(uuid.uuid4())
    account_type = "customer_wallet" if body.role == "customer" else "merchant_wallet"

    try:
        with get_conn() as conn:
            # Insert user
            conn.execute(
                "INSERT INTO users (id, full_name, email, phone, password_hash, role, status) "
                "VALUES (%s, %s, %s, %s, %s, %s, 'active')",
                (user_id, body.full_name, email, body.phone, hashed, body.role),
            )
            # Create wallet account
            conn.execute(
                "INSERT INTO accounts (id, user_id, account_type, currency, status) "
                "VALUES (%s, %s, %s, 'INR', 'active')",
                (account_id, user_id, account_type),
            )
            # Initialize zero balance
            conn.execute(
                "INSERT INTO account_balances (account_id, balance) VALUES (%s, 0)",
                (account_id,),
            )
            if body.role == "merchant":
                conn.execute(
                    "INSERT INTO merchant_profiles (user_id, business_name, fee_rate, settlement_frequency) "
                    "VALUES (%s, %s, 0.0200, 'daily') ON CONFLICT (user_id) DO NOTHING",
                    (user_id, f"{body.full_name} Store"),
                )
            conn.commit()
    except psycopg.errors.UniqueViolation:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )
    except psycopg.Error as exc:
        msg = clean_db_error(exc)
        if "unique" in msg.lower() or "already exists" in msg.lower():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Registration failed: {msg}",
        )

    token = create_access_token({"sub": user_id, "role": body.role})
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    """Authenticate with email/password and return a JWT."""
    email = str(body.email).strip()
    user = fetch_one(
        "SELECT id, password_hash, role, status FROM users WHERE LOWER(email) = LOWER(%s)",
        (email,),
    )
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    if user["status"] != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active",
        )

    token = create_access_token({"sub": str(user["id"]), "role": user["role"]})
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserResponse)
async def me(user: CurrentUser):
    """Return the current authenticated user's profile."""
    return UserResponse(
        id=str(user["id"]),
        full_name=user["full_name"],
        email=user["email"],
        phone=user.get("phone"),
        role=user["role"],
        status=user["status"],
        created_at=user["created_at"],
    )
