import httpx

# Alice login
res = httpx.post("http://127.0.0.1:8000/api/auth/login", json={"email": "alice@example.com", "password": "password123"})
print("Login status:", res.status_code)
token = res.json().get("access_token")

# Get contacts
res2 = httpx.get("http://127.0.0.1:8000/api/wallet/contacts", headers={"Authorization": f"Bearer {token}"})
print("Contacts status:", res2.status_code)
print("Contacts count:", len(res2.json()))
print("Sample:", res2.json()[:3])
