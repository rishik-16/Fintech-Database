"""
FastAPI End-to-End Endpoint Smoke Tests:
  Validates API routes for all five roles (Customer, Merchant, Officer, Analyst, Admin).
"""
import uuid
import pytest
from fastapi.testclient import TestClient


def test_auth_and_profile_flow(client: TestClient):
    """Register customer, login, and verify /api/auth/me."""
    email = f"api_user_{uuid.uuid4().hex[:6]}@example.com"
    reg_resp = client.post(
        "/api/auth/register",
        json={
            "full_name": "API Tester",
            "email": email,
            "phone": "+91-9876543210",
            "password": "securepassword123",
            "role": "customer",
        },
    )
    assert reg_resp.status_code == 201
    token = reg_resp.json()["access_token"]

    # Verify /api/auth/me
    me_resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200
    user_data = me_resp.json()
    assert user_data["email"] == email
    assert user_data["role"] == "customer"


def test_wallet_transfer_and_statement(client: TestClient, create_test_customer):
    """Customer transfers funds to another account with Idempotency-Key and reads statement."""
    c1 = create_test_customer("APISender", 1000.0)
    c2 = create_test_customer("APIRecipient", 100.0)

    # 1. Transfer
    idem_key = str(uuid.uuid4())
    transfer_resp = client.post(
        "/api/wallet/transfer",
        headers={
            "Authorization": f"Bearer {c1['token']}",
            "Idempotency-Key": idem_key,
        },
        json={
            "to_account_id": c2["account_id"],
            "amount": 75.50,
            "description": "API Transfer Test",
        },
    )
    assert transfer_resp.status_code == 200
    assert "transaction_id" in transfer_resp.json()

    # 2. View statement
    stmt_resp = client.get(
        f"/api/wallet/accounts/{c1['account_id']}/statement",
        headers={"Authorization": f"Bearer {c1['token']}"},
    )
    assert stmt_resp.status_code == 200
    entries = stmt_resp.json()
    assert len(entries) > 0

    # 3. Download statement CSV
    csv_resp = client.get(
        f"/api/wallet/accounts/{c1['account_id']}/statement/csv",
        headers={"Authorization": f"Bearer {c1['token']}"},
    )
    assert csv_resp.status_code == 200
    assert "text/csv" in csv_resp.headers["content-type"]


def test_lending_calculator_and_products(client: TestClient, create_test_customer):
    """Test public EMI calculator and products listing."""
    c = create_test_customer("LendingAPICust", 500.0)

    # Products list
    prods_resp = client.get(
        "/api/lending/products",
        headers={"Authorization": f"Bearer {c['token']}"},
    )
    assert prods_resp.status_code == 200
    prods = prods_resp.json()
    assert len(prods) > 0

    # EMI calculator preview
    calc_resp = client.post(
        "/api/lending/emi-calculator",
        headers={"Authorization": f"Bearer {c['token']}"},
        json={"principal": 50000.0, "annual_rate": 10.5, "tenure_months": 12},
    )
    assert calc_resp.status_code == 200
    res = calc_resp.json()
    assert float(res["emi_amount"]) > 0
    assert float(res["total_interest"]) > 0


def test_admin_system_and_db_lab(client: TestClient, admin_token):
    """Test admin health, audit log, and DB Lab invariant check."""
    # System health
    health_resp = client.get(
        "/api/admin/system/health",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert health_resp.status_code == 200
    data = health_resp.json()
    assert "db_size" in data
    assert "table_counts" in data

    # DB Lab invariant check
    inv_resp = client.get(
        "/api/admin/db-lab/invariant-check",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert inv_resp.status_code == 200
    assert "all_balanced" in inv_resp.json()
