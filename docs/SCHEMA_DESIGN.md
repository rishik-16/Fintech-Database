# PayLedger Schema Design & Normalization Analysis

## 1. Relational Database Normalization

The PayLedger relational schema is designed in strict accordance with relational database normalization principles, satisfying Boyce-Codd Normal Form (BCNF) / Third Normal Form (3NF) across transactional entities, with carefully justified engineering denormalizations for high-frequency financial hot paths.

---

### 1.1 First Normal Form (1NF)
A relation is in 1NF if and only if all attributes contain only atomic (indivisible) values, and there are no repeating groups or arrays.

* **Atomic Attributes**: Attributes such as `users.full_name`, `users.email`, `users.phone`, `loans.principal`, `ledger_entries.amount` contain discrete scalar values.
* **Elimination of Repeating Groups**:
  * Installments are not stored as an array inside `loans`; they are normalized into child rows in `emi_schedule`.
  * Audit entries are not appended to a JSON array column on the target table; each mutation creates an individual row in `audit_log`.
* **Primary Key Enforcement**: Every table declares an explicit primary key (UUID v4 or composite `(id, created_at)` for partitioned entities).

---

### 1.2 Second Normal Form (2NF)
A relation is in 2NF if it is in 1NF and every non-prime attribute is fully functionally dependent on the entire primary key (no partial dependencies on a subset of a composite candidate key).

* **Composite Primary Keys**:
  * In `ledger_entries`, the primary key is `(id, created_at)` due to PostgreSQL declarative range partitioning.
  * Functional dependency:
    $$\{id, created\_at\} \to \{transaction\_id, account\_id, direction, amount\}$$
    Because each ledger entry represents a single point-in-time debit or credit created at timestamp $t$ with an immutable UUID $id$, no non-key attribute depends solely on $id$ or `created_at`.
  * In all other tables (`users`, `accounts`, `loans`, `emi_schedule`, `fraud_alerts`), the primary key is a single surrogate attribute (`id UUID`), making partial key dependencies structurally impossible.

---

### 1.3 Third Normal Form (3NF)
A relation is in 3NF if it is in 2NF and no non-prime attribute is transitively dependent on the primary key ($X \to Y$ and $Y \to Z$ where $Z$ is not a candidate key).

* **Decoupling Customer & Account State**:
  * In `accounts`:
    $$\text{id} \to \{\text{user\_id}, \text{type}, \text{currency}, \text{status}, \text{created\_at}\}$$
    User details (name, email, role) are omitted; they reside in `users`.
* **Decoupling Loan Products & Loan Contracts**:
  * Loan terms such as default interest rate and max tenure belong to `loan_products`:
    $$\text{product\_id} \to \{\text{annual\_rate}, \text{min\_amount}, \text{max\_amount}, \text{penalty\_rate}\}$$
  * A `loans` row captures contract-specific terms at the time of underwriting:
    $$\text{loan\_id} \to \{\text{application\_id}, \text{principal}, \text{annual\_rate}, \text{tenure\_months}, \text{status}\}$$
    This prevents transitive update anomalies if the commercial product parameters change in the future.

---

## 2. Intentional & Controlled Denormalization

In high-throughput financial core banking engines, pure normalization can introduce critical latency bottlenecks on high-frequency transactions. PayLedger selectively introduces two controlled denormalizations, both protected by transactional triggers and row-level locking:

### 2.1 Materialized Running Balances (`account_balances`)
* **The Problem**: In pure 3NF, an account's balance is calculated on demand:
  $$\text{Balance} = \sum_{\text{direction}=\text{'credit'}} \text{amount} - \sum_{\text{direction}=\text{'debit'}} \text{amount}$$
  Over 6 months of operation with 20,000+ entries, executing a full ledger scan on every transfer check turns an $O(1)$ operation into an $O(N)$ table scan, saturating buffer pools and causing lock contention.
* **The Solution**: An `account_balances` table stores `(account_id, balance, version, updated_at)`.
* **Integrity Guard**:
  * Maintained within the exact same database transaction as `ledger_entries` via `trg_update_account_balance`.
  * Checked by a domain CHECK constraint:
    ```sql
    CHECK (type IN ('system_fee', 'system_suspense', 'loan_pool') OR balance >= 0.00)
    ```
  * Enforced using row locks (`SELECT ... FOR UPDATE` ordered by `LEAST(id, ...), GREATEST(id, ...)`) to prevent race conditions.

### 2.2 Materialized Outstanding Principal (`loans.outstanding_principal`)
* **The Problem**: Querying portfolio health or evaluating eligibility requires knowing a borrower's total unpaid principal. Re-aggregating all remaining rows of `emi_schedule` on every loan query is computationally expensive.
* **The Solution**: `loans.outstanding_principal` is stored and updated atomically by `sp_pay_emi` whenever principal amortization occurs.
* **Integrity Guard**:
  * Recalculated inside stored procedures within the payment transaction.
  * Verified by consistency tests against the sum of unpaid installments.

---

## 3. Append-Only Immutable Ledger Architecture

Double-entry bookkeeping is the cornerstone of regulatory compliance (GAAP / IFRS) and financial security.

### 3.1 Prohibiting UPDATE and DELETE
In `003_wallet_ledger_tables.sql`, triggers `trg_ledger_transactions_immutable` and `trg_ledger_entries_immutable` intercept any mutation attempt:
```sql
CREATE OR REPLACE FUNCTION payledger.fn_block_update_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Immutable ledger: UPDATE and DELETE operations are forbidden on % (SQLSTATE: PL003)', TG_TABLE_NAME
        USING ERRCODE = 'PL003';
END;
$$ LANGUAGE plpgsql;
```

### 3.2 Error Correction via Reversing Entries
If a transaction was executed mistakenly or requires a refund:
1. The original transaction is never deleted or altered.
2. A new transaction of kind `refund` is inserted.
3. The debit and credit entries are inverted:
   - Debit: Merchant / Destination account.
   - Credit: Customer / Source account.
4. An immutable audit trail persists forever, enabling forensic reconstruction.

---

## 4. Double-Entry Balanced Transaction Invariant

Every financial movement requires at least two counterbalancing entries that net out to zero:
$$\sum \text{Credits} - \sum \text{Debits} = 0.00$$

PayLedger enforces this at the relational engine level via a deferred constraint trigger:
```sql
CREATE CONSTRAINT TRIGGER trg_ledger_double_entry_check
AFTER INSERT ON payledger.ledger_transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION payledger.fn_check_double_entry_balance();
```

* **Why Deferred?** When an application or stored procedure inserts a transaction header, entries are added in subsequent statements within the same transaction. A standard trigger would fail on step 1 because entries do not exist yet. A `DEFERRABLE INITIALLY DEFERRED` trigger waits until the `COMMIT` boundary to verify that:
  1. Entry count $\ge 2$.
  2. $\text{Total Debits} = \text{Total Credits}$.
  3. No orphan transactions exist.

---

## 5. Constraint Catalog

| Table | Constraint Name | Type | Specification / Rule |
|---|---|---|---|
| `users` | `users_email_key` | UNIQUE | Case-insensitive unique customer email address. |
| `users` | `users_phone_check` | CHECK | Phone number length $\ge 8$ digits. |
| `accounts` | `accounts_user_id_fkey` | FOREIGN KEY | References `users(id)` ON DELETE RESTRICT. |
| `account_balances` | `account_balances_balance_check` | CHECK | Prevents non-system accounts from going negative. |
| `ledger_transactions` | `ledger_transactions_idempotency_key_key` | UNIQUE | Deduplicates concurrent or retried API requests. |
| `ledger_entries` | `ledger_entries_amount_check` | CHECK | `amount > 0.00` (zero or negative transfers impossible). |
| `loan_products` | `loan_products_annual_rate_check` | CHECK | `annual_rate > 0 AND annual_rate <= 100`. |
| `loan_products` | `loan_products_amount_check` | CHECK | `min_amount > 0 AND max_amount >= min_amount`. |
| `loan_applications` | `loan_applications_amount_check` | CHECK | `amount > 0.00`. |
| `loans` | `loans_application_id_key` | UNIQUE | One loan per application. |
| `emi_schedule` | `emi_schedule_installment_no_check` | CHECK | `installment_no >= 1`. |
| `emi_schedule` | `emi_schedule_total_due_check` | CHECK | `total_due = principal_component + interest_component`. |
| `fraud_rules` | `fraud_rules_code_key` | UNIQUE | Unique identifier code per fraud evaluation rule. |
| `bank_statement_lines` | `bank_statement_lines_amount_check` | CHECK | `amount > 0.00`. |
