# PayLedger Entity-Relationship (ER) Diagram & Schema Relations

This document details the complete relational architecture of the **PayLedger** database (`payledger` schema in PostgreSQL 16).

---

## 1. High-Level Architecture Overview

PayLedger is architected into three specialized functional modules backed by a shared double-entry core:
1. **Wallet & Core Ledger (Member 1)**: Immutable double-entry bookkeeping, range-partitioned ledger entries, materialized running balance, deadlock-free transfer logic.
2. **Lending & Debt Servicing (Member 2)**: Loan product definitions, underwriting application lifecycle, reducing-balance amortized EMI schedules, penalty accrual.
3. **Risk, Fraud & Reconciliation (Member 3)**: Automated real-time rule engine (velocity, high-amount, round-trip, structuring), external statement reconciliation, and JSONB audit logging.

---

## 2. Mermaid Entity-Relationship Diagram

```mermaid
erDiagram
    users ||--o| kyc_profiles : "verifies identity"
    users ||--o{ accounts : "owns"
    users ||--o{ loan_applications : "applies"
    users ||--o{ audit_log : "performs action"

    accounts ||--o| account_balances : "materialized balance"
    accounts ||--o{ ledger_entries : "entry target"
    accounts ||--o{ fraud_alerts : "flagged account"

    ledger_transactions ||--|{ ledger_entries : "contains (>=2)"
    ledger_transactions ||--o{ fraud_alerts : "evaluated for fraud"
    ledger_transactions ||--o{ bank_statement_lines : "matched via ref"

    loan_products ||--o{ loan_applications : "configured by"
    loan_applications ||--o| loans : "underwritten to"
    loans ||--|{ emi_schedule : "amortized schedule"
    loans ||--o{ loan_repayments : "receives payment"
    loans ||--o{ penalties : "incurs"

    emi_schedule ||--o{ loan_repayments : "credited to"
    emi_schedule ||--o{ penalties : "overdue installment"

    ledger_transactions ||--o| loan_repayments : "settled via ledger"

    fraud_rules ||--o{ fraud_alerts : "triggers"

    bank_statement_imports ||--|{ bank_statement_lines : "contains lines"
    reconciliation_runs ||--o{ bank_statement_lines : "audits & reconciles"

    users {
        uuid id PK
        varchar full_name
        varchar email UK
        varchar phone
        varchar password_hash
        user_role role
        user_status status
        timestamptz created_at
    }

    kyc_profiles {
        uuid id PK
        uuid user_id FK,UK
        kyc_id_type id_type
        varchar id_number_hash
        kyc_status status
        timestamptz verified_at
    }

    accounts {
        uuid id PK
        uuid user_id FK
        account_type type
        currency_code currency
        account_status status
        timestamptz created_at
    }

    account_balances {
        uuid account_id PK,FK
        numeric balance
        bigint version
        timestamptz last_entry_at
        timestamptz updated_at
    }

    ledger_transactions {
        uuid id PK
        transaction_kind kind
        varchar idempotency_key UK
        varchar description
        uuid created_by FK
        timestamptz created_at
    }

    ledger_entries {
        uuid id PK
        uuid transaction_id FK
        uuid account_id FK
        entry_direction direction
        numeric amount
        timestamptz created_at PK
    }

    loan_products {
        uuid id PK
        varchar name
        numeric annual_rate
        numeric min_amount
        numeric max_amount
        integer min_tenure_months
        integer max_tenure_months
        numeric penalty_rate
        boolean prepayment_allowed
        boolean active
    }

    loan_applications {
        uuid id PK
        uuid user_id FK
        uuid product_id FK
        numeric amount
        integer tenure_months
        loan_app_status status
        uuid decided_by FK
        timestamptz decided_at
        text reason
    }

    loans {
        uuid id PK
        uuid application_id FK,UK
        numeric principal
        numeric annual_rate
        integer tenure_months
        loan_status status
        timestamptz disbursed_at
        numeric outstanding_principal
    }

    emi_schedule {
        uuid id PK
        uuid loan_id FK
        integer installment_no
        date due_date
        numeric principal_component
        numeric interest_component
        numeric total_due
        emi_status status
        timestamptz paid_at
    }

    loan_repayments {
        uuid id PK
        uuid loan_id FK
        uuid emi_id FK
        uuid ledger_transaction_id FK
        numeric amount
        timestamptz paid_at
    }

    penalties {
        uuid id PK
        uuid loan_id FK
        uuid emi_id FK
        numeric amount
        date assessed_on
    }

    fraud_rules {
        uuid id PK
        varchar code UK
        text description
        jsonb threshold_json
        alert_severity severity
        boolean active
    }

    fraud_alerts {
        uuid id PK
        uuid rule_id FK
        uuid ledger_transaction_id FK
        uuid account_id FK
        alert_severity severity
        alert_status status
        uuid assigned_to FK
        timestamptz created_at
        timestamptz resolved_at
        text notes
    }

    bank_statement_imports {
        uuid id PK
        varchar filename
        uuid imported_by FK
        timestamptz imported_at
    }

    bank_statement_lines {
        uuid id PK
        uuid import_id FK
        varchar bank_reference
        date value_date
        numeric amount
        text narration
        uuid matched_transaction_id FK
        recon_status match_status
    }

    reconciliation_runs {
        uuid id PK
        timestamptz run_at
        integer matched_count
        integer unmatched_count
        integer mismatch_count
    }

    audit_log {
        uuid id PK
        uuid actor_user_id FK
        varchar action
        varchar entity
        uuid entity_id
        jsonb old_data
        jsonb new_data
        timestamptz at
    }
```

---

## 3. Entity Relationships & Cardinality Details

| Parent Entity | Child Entity | Cardinality | Enforced By | Description |
|---|---|---|---|---|
| `users` | `kyc_profiles` | 1 : (0..1) | `UNIQUE(user_id)` FK | Each user has at most one KYC verification profile. |
| `users` | `accounts` | 1 : N | Foreign Key | A user can own multiple accounts (wallet, merchant pool, etc.). System accounts have `user_id = NULL`. |
| `users` | `loan_applications` | 1 : N | Foreign Key | A customer submits multiple loan applications across time. |
| `accounts` | `account_balances` | 1 : 1 | Primary Key is FK | Running balance record automatically initialized on account creation. |
| `accounts` | `ledger_entries` | 1 : N | Foreign Key | Every debit or credit links to exactly one financial account. |
| `ledger_transactions` | `ledger_entries` | 1 : (2..N) | Deferred Constraint Trigger | A transaction must have $\ge 2$ entries whose net sum equals zero. |
| `loan_products` | `loan_applications` | 1 : N | Foreign Key | Multiple customer applications reference standardized loan product terms. |
| `loan_applications` | `loans` | 1 : (0..1) | `UNIQUE(application_id)` FK | An approved and disbursed application translates into exactly one active loan contract. |
| `loans` | `emi_schedule` | 1 : N | Foreign Key | A loan has $N$ monthly installments generated by the reducing-balance formula. |
| `loans` | `loan_repayments` | 1 : N | Foreign Key | A borrower can make multiple repayments against a loan. |
| `loans` | `penalties` | 1 : N | Foreign Key | Penalties assessed on overdue installments. |
| `fraud_rules` | `fraud_alerts` | 1 : N | Foreign Key | Triggered alerts reference the violated fraud rule definition. |
| `ledger_transactions` | `fraud_alerts` | 1 : (0..N) | Foreign Key | Transactions flagged during automated rule evaluation. |
| `bank_statement_imports` | `bank_statement_lines` | 1 : N | Foreign Key | Each uploaded statement batch contains multiple external bank transaction lines. |
| `bank_statement_lines` | `ledger_transactions` | (0..1) : 1 | Foreign Key | Matched external bank reference points to internal ledger transaction. |
| `users` | `audit_log` | 1 : N | Foreign Key (`actor_user_id`) | Every state mutation on sensitive tables logs the triggering user. |

---

## 4. Range Partitioning Structure

`ledger_entries` is range-partitioned on `created_at` by month:

```
ledger_entries (Partitioned Table)
  ├── ledger_entries_2026_05 [2026-05-01, 2026-06-01)
  ├── ledger_entries_2026_06 [2026-06-01, 2026-07-01)
  ├── ledger_entries_2026_07 [2026-07-01, 2026-08-01)
  ├── ledger_entries_2026_08 [2026-08-01, 2026-09-01)
  ├── ledger_entries_2026_09 [2026-09-01, 2026-10-01)
  ├── ledger_entries_2026_10 [2026-10-01, 2026-11-01)
  └── ledger_entries_2026_11 [2026-11-01, 2026-12-01)
```

Because `ledger_entries` is partitioned, the composite primary key is `(id, created_at)`.
Foreign key references from `account_balances` and `loan_repayments` target transactions or accounts directly, keeping the partition boundaries isolated.
