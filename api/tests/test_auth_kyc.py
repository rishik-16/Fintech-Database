"""
Tests for case-insensitive email authentication, redundant index verification,
and KYC HMAC-SHA256 hashing utilities.
"""
import hashlib
import hmac
import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException
import psycopg.errors

from app.auth import hash_password
from app.crypto import normalize_kyc_identifier, hash_kyc_identifier
from app.models.auth import RegisterRequest, LoginRequest
from app.routers.auth import register, login


# ============================================================================
# 1. KYC HMAC-SHA256 & Normalization Tests
# ============================================================================

def test_kyc_identifier_normalization():
    """Verify identifier normalization strips spaces, hyphens, and standardizes casing."""
    assert normalize_kyc_identifier("  1234 5678 9012  ") == "123456789012"
    assert normalize_kyc_identifier("1234-5678-9012") == "123456789012"
    assert normalize_kyc_identifier("abcde-1234-f") == "ABCDE1234F"
    assert normalize_kyc_identifier("  p1234567  ") == "P1234567"


def test_kyc_normalization_invalid_inputs():
    """Verify empty or blank identifiers raise ValueError."""
    with pytest.raises(ValueError, match="non-empty string"):
        normalize_kyc_identifier("")
    with pytest.raises(ValueError, match="non-empty string"):
        normalize_kyc_identifier(None)
    with pytest.raises(ValueError, match="cannot be empty after normalization"):
        normalize_kyc_identifier("   - - -   ")


def test_kyc_hmac_consistent_output_for_same_normalized_identifier():
    """Verify that different raw formatting of the same ID produces identical HMAC output."""
    secret = "test-hmac-secret-key-123"
    expected_normalized = "123456789012"
    expected_hmac = hmac.new(
        secret.encode("utf-8"),
        expected_normalized.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()

    variants = [
        "123456789012",
        " 1234 5678 9012 ",
        "1234-5678-9012",
        "  1234-5678-9012  ",
    ]

    for variant in variants:
        digest = hash_kyc_identifier(variant, secret_key=secret)
        assert digest == expected_hmac
        assert len(digest) == 64


def test_kyc_hmac_different_output_when_secret_changes():
    """Verify that changing the HMAC secret generates completely different digests."""
    raw_id = "ABCDE1234F"
    digest_1 = hash_kyc_identifier(raw_id, secret_key="secret-key-alpha")
    digest_2 = hash_kyc_identifier(raw_id, secret_key="secret-key-beta")

    assert digest_1 != digest_2
    assert len(digest_1) == 64
    assert len(digest_2) == 64


def test_raw_kyc_identifier_not_persisted_in_hash():
    """Verify the raw identifier is not present in or leaked by the HMAC digest."""
    raw_id = "AADHAAR9876543210"
    digest = hash_kyc_identifier(raw_id, secret_key="test-secret")

    assert raw_id not in digest
    assert "9876543210" not in digest
    assert len(digest) == 64
    # Digest should only contain valid hex characters
    int(digest, 16)


def test_kyc_hmac_missing_secret_raises_error(monkeypatch):
    """Verify that missing secret key raises a ValueError."""
    monkeypatch.delenv("KYC_HMAC_SECRET", raising=False)
    with patch("app.crypto.settings.kyc_hmac_secret", ""):
        with pytest.raises(ValueError, match="KYC HMAC secret key is not configured"):
            hash_kyc_identifier("ABCDE1234F", secret_key=None)


# ============================================================================
# 2. Case-Insensitive Email Authentication Tests
# ============================================================================

def test_pydantic_email_casing_and_trimming():
    """Pydantic request models should trim and lowercase emails on input."""
    reg = RegisterRequest(
        full_name="Alice Tester",
        email="  Alice@Example.COM  ",
        password="securepassword123",
        role="customer"
    )
    assert reg.email == "alice@example.com"

    log = LoginRequest(
        email="  ALICE@EXAMPLE.COM  ",
        password="securepassword123"
    )
    assert log.email == "alice@example.com"


@pytest.mark.asyncio
async def test_login_uses_lower_email_query():
    """Login should query using WHERE LOWER(email) = LOWER(%s) with trimmed email."""
    mock_user = {
        "id": "11111111-2222-3333-4444-555555555555",
        "password_hash": hash_password("mypassword"),
        "role": "customer",
        "status": "active"
    }

    captured_query = {}

    def mock_fetch_one(query, params=()):
        captured_query["query"] = query
        captured_query["params"] = params
        return mock_user

    with patch("app.routers.auth.fetch_one", side_effect=mock_fetch_one):
        login_req = LoginRequest(email="  John.Doe@Example.COM  ", password="mypassword")
        token_resp = await login(login_req)

        assert token_resp.access_token is not None
        assert "WHERE LOWER(email) = LOWER(%s)" in captured_query["query"]
        # The query parameter should be trimmed and lowercased
        assert captured_query["params"] == ("john.doe@example.com",)


@pytest.mark.asyncio
async def test_login_case_insensitivity_success():
    """User should be able to log in regardless of email casing."""
    # Stored in DB with mixed or lower case
    mock_user = {
        "id": "11111111-2222-3333-4444-555555555555",
        "password_hash": hash_password("mypassword"),
        "role": "customer",
        "status": "active"
    }

    with patch("app.routers.auth.fetch_one", return_value=mock_user):
        for variant in ["user@example.com", "USER@EXAMPLE.COM", "User@Example.Com"]:
            login_req = LoginRequest(email=variant, password="mypassword")
            resp = await login(login_req)
            assert resp.access_token is not None


@pytest.mark.asyncio
async def test_login_invalid_password_raises_401():
    """Invalid password raises 401 Unauthorized."""
    mock_user = {
        "id": "11111111-2222-3333-4444-555555555555",
        "password_hash": hash_password("correct_password"),
        "role": "customer",
        "status": "active"
    }

    with patch("app.routers.auth.fetch_one", return_value=mock_user):
        login_req = LoginRequest(email="user@example.com", password="wrong_password")
        with pytest.raises(HTTPException) as exc_info:
            await login(login_req)
        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Invalid email or password"


@pytest.mark.asyncio
async def test_login_inactive_user_raises_403():
    """Suspended or deactivated user raises 403 Forbidden."""
    mock_user = {
        "id": "11111111-2222-3333-4444-555555555555",
        "password_hash": hash_password("correct_password"),
        "role": "customer",
        "status": "suspended"
    }

    with patch("app.routers.auth.fetch_one", return_value=mock_user):
        login_req = LoginRequest(email="user@example.com", password="correct_password")
        with pytest.raises(HTTPException) as exc_info:
            await login(login_req)
        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == "Account is not active"


@pytest.mark.asyncio
async def test_registration_stores_normalized_email():
    """Registration should insert trimmed and lowercased email."""
    mock_conn = MagicMock()
    executed_statements = []

    def mock_execute(sql, params=()):
        executed_statements.append((sql, params))

    mock_conn.execute.side_effect = mock_execute

    class DummyContext:
        def __enter__(self):
            return mock_conn
        def __exit__(self, *args):
            pass

    with patch("app.routers.auth.get_conn", return_value=DummyContext()):
        reg_req = RegisterRequest(
            full_name="Jane Doe",
            email="  Jane.Doe@Example.COM  ",
            password="mypassword",
            role="customer"
        )
        resp = await register(reg_req)
        assert resp.access_token is not None

        # Verify the email parameter sent to the DB was lowercase and trimmed
        user_insert = [stmt for stmt in executed_statements if "INSERT INTO users" in stmt[0]][0]
        params = user_insert[1]
        inserted_email = params[2]
        assert inserted_email == "jane.doe@example.com"


@pytest.mark.asyncio
async def test_duplicate_registration_different_casing_raises_409():
    """Attempting duplicate registration with different casing triggers UniqueViolation -> 409."""
    mock_conn = MagicMock()
    # Simulate Postgres UniqueViolation (e.g. from unique functional index on LOWER(email))
    mock_conn.execute.side_effect = psycopg.errors.UniqueViolation("duplicate key value violates unique index idx_users_email_lower")

    class DummyContext:
        def __enter__(self):
            return mock_conn
        def __exit__(self, *args):
            pass

    with patch("app.routers.auth.get_conn", return_value=DummyContext()):
        reg_req = RegisterRequest(
            full_name="Duplicate User",
            email="ALICE@EXAMPLE.COM",
            password="mypassword",
            role="customer"
        )
        with pytest.raises(HTTPException) as exc_info:
            await register(reg_req)
        assert exc_info.value.status_code == 409
        assert exc_info.value.detail == "A user with this email already exists"

