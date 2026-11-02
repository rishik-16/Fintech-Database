# PayLedger Security, RBAC & Row-Level Security (RLS) Architecture

## 1. Defense-in-Depth Security Philosophy

PayLedger rejects the common, fragile anti-pattern where the database runs as an all-powerful superuser and security is enforced solely by application code. Instead, PayLedger enforces **dual-tier defense-in-depth**:
1. **Application Tier**: FastAPI dependency injection guards validating JWT claims and RBAC roles before routing requests.
2. **Database Core Tier**: Native PostgreSQL roles, explicit least-privilege `GRANT` statements, and engine-level **Row-Level Security (RLS)** policies that enforce tenancy boundaries even against raw SQL queries.

---

## 2. Role-Based Access Control (RBAC) Matrix

| Platform Role | PostgreSQL Role | Allowed API Actions | Database Permissions (`GRANT`) |
|---|---|---|---|
| **Customer** | `app_customer` | View own wallet, transfer money, pay merchants, view statements, apply for & repay loans. | `SELECT` on own accounts/ledger; `EXECUTE` on `sp_transfer`, `sp_pay_merchant`, `sp_apply_for_loan`, `sp_pay_emi`. |
| **Merchant** | `app_merchant` | View customer payments, inspect settlements, issue customer refunds. | `SELECT` on merchant accounts; `EXECUTE` on `sp_refund`. |
| **Loan Officer** | `app_officer` | Review queue, approve/reject loan applications, disburse approved loans, view loan portfolio. | `SELECT` on `loan_applications`, `loan_products`, `loans`; `EXECUTE` on `sp_decide_loan`, `sp_disburse_loan`. |
| **Risk Analyst** | `app_risk` | Inspect fraud alerts, update alert status, review fraud rules, upload bank statements, execute reconciliation. | `SELECT`/`UPDATE` on `fraud_alerts`, `fraud_rules`; `EXECUTE` on `sp_reconcile`. |
| **Admin** | `app_admin` | Full user administration, view audit logs, trigger nightly batch jobs, view system analytics. | Full `ALL PRIVILEGES` on schema `payledger`, trigger inspection, partition creation. |
| **API Runtime** | `app_api` | Least-privileged connection pool role used by FastAPI backend. | Connects to DB, sets session variables (`payledger.current_user_id`), switches context. |

---

## 3. PostgreSQL Row-Level Security (RLS) Implementation

Row-Level Security ensures that rows returned by a query are filtered by PostgreSQL's query rewriter according to active security policies. Even if an attacker executes an unfiltered `SELECT * FROM payledger.accounts;`, the database engine strictly hides records belonging to other tenants.

### 3.1 Session Identity Context
The API connection pool sets the current tenant identity at the start of each request transaction:
```sql
SET LOCAL payledger.current_user_id = '018f...';
SET LOCAL payledger.current_user_role = 'customer';
```
Using `SET LOCAL` guarantees that the session context automatically resets when the connection returns to the connection pool, preventing cross-request tenant leakage.

### 3.2 Customer Isolation Policy on `accounts`
```sql
ALTER TABLE payledger.accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounts_customer_isolation_policy ON payledger.accounts
    FOR ALL
    TO app_customer
    USING (
        user_id = NULLIF(current_setting('payledger.current_user_id', true), '')::UUID
    );

CREATE POLICY accounts_admin_policy ON payledger.accounts
    FOR ALL
    TO app_admin
    USING (true);
```

### 3.3 Customer Isolation Policy on `ledger_entries`
Customers can only see ledger entries associated with accounts they own:
```sql
ALTER TABLE payledger.ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY ledger_entries_customer_policy ON payledger.ledger_entries
    FOR SELECT
    TO app_customer
    USING (
        account_id IN (
            SELECT id FROM payledger.accounts
            WHERE user_id = NULLIF(current_setting('payledger.current_user_id', true), '')::UUID
        )
    );
```

### 3.4 Verification with Raw SQL
When authenticated as customer Alice (`user_id = '11111111-...'`):
```sql
-- Query executed by customer Alice:
SELECT account_id, amount, direction FROM payledger.ledger_entries;
```
**PostgreSQL Internal Rewrite**:
```sql
SELECT account_id, amount, direction FROM payledger.ledger_entries
WHERE account_id IN (SELECT id FROM payledger.accounts WHERE user_id = '11111111-...');
```
Result: Bob's transfers, merchant fees, and administrative movements are completely invisible.

---

## 4. Cryptographic Standards & Authentication

1. **Password Hashing**:
   - Implemented via `bcrypt` with automated salt generation.
   - Plaintext passwords never touch database disk storage.
2. **Stateless JWT Tokens**:
   - Encrypted with HMAC-SHA256 (`HS256`).
   - Standard claims: `sub` (User UUID), `role` (Platform role), `exp` (1-day expiration).
   - Validated on every protected endpoint by `get_current_user` FastAPI dependency.
3. **Database Credentials**:
   - Handled via isolated environment variables (`.env`).
   - The API uses `app_api` rather than the `postgres` superuser.
