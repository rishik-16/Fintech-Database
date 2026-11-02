# PayLedger — Architecture & Implementation Plan

## 1. Overview

**PayLedger** is a simulated fintech platform demonstrating advanced DBMS concepts:
- Double-entry bookkeeping digital wallet
- Peer-to-peer transfers & merchant payments
- Lending with EMI scheduling (reducing-balance)
- Fraud detection & bank reconciliation
- Role-based access with PostgreSQL Row-Level Security

> **Simulation only** — no real money, no real banking integration.

## 2. Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   React/TS   │────▶│   FastAPI     │────▶│ PostgreSQL 16│
│   Vite+TW    │ JWT │   Python 3.12 │ SQL │  payledger   │
│   Port 5173  │◀────│   Port 8000   │◀────│  Port 5432   │
└──────────────┘     └──────────────┘     └──────────────┘
       ▲                    │
       │              psycopg v3
       │              connection pool
       │              plain SQL only
```

All three services run via `docker compose up --build`.

## 3. Folder Structure

```
payledger/
├── docker-compose.yml
├── Makefile
├── README.md
├── .env.example
├── db/
│   ├── migrations/
│   │   ├── 001_schema_and_types.sql
│   │   ├── 002_identity_tables.sql
│   │   ├── 003_wallet_and_ledger.sql
│   │   ├── 004_wallet_procedures.sql
│   │   ├── 005_lending_tables.sql
│   │   ├── 006_lending_procedures.sql
│   │   ├── 007_fraud_and_reconciliation.sql
│   │   ├── 008_fraud_procedures.sql
│   │   ├── 009_roles_grants_rls.sql
│   │   ├── 010_partitioning.sql
│   │   ├── 011_indexes.sql
│   │   ├── 012_views.sql
│   │   ├── 013_audit_triggers.sql
│   │   └── 014_seed_system_accounts.sql
│   ├── seed/
│   │   ├── seed.py
│   │   └── mock_bank_statement.csv
│   └── explain/
│       ├── query_01_before.txt ... query_05_after.txt
│       └── summary.md
├── api/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── db.py
│   │   ├── auth.py
│   │   ├── deps.py
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py
│   │   │   ├── wallet.py
│   │   │   ├── lending.py
│   │   │   ├── risk.py
│   │   │   └── admin.py
│   │   └── routers/
│   │       ├── __init__.py
│   │       ├── auth.py
│   │       ├── wallet.py
│   │       ├── lending.py
│   │       ├── risk.py
│   │       └── admin.py
│   └── tests/
│       ├── conftest.py
│       ├── test_concurrency.py
│       ├── test_invariants.py
│       ├── test_lending.py
│       ├── test_fraud.py
│       ├── test_reconciliation.py
│       ├── test_rls.py
│       └── test_api.py
├── web/
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/
│       │   └── client.ts
│       ├── hooks/
│       │   ├── useAuth.ts
│       │   └── useTheme.ts
│       ├── theme/
│       │   └── index.ts
│       ├── components/
│       │   ├── Layout.tsx
│       │   ├── Sidebar.tsx
│       │   ├── ThemeToggle.tsx
│       │   ├── ProtectedRoute.tsx
│       │   └── ... shared components
│       └── pages/
│           ├── Landing.tsx
│           ├── Login.tsx
│           ├── Register.tsx
│           ├── customer/
│           │   ├── Dashboard.tsx
│           │   ├── SendMoney.tsx
│           │   ├── PayMerchant.tsx
│           │   ├── Statement.tsx
│           │   ├── Loans.tsx
│           │   └── Profile.tsx
│           ├── merchant/
│           │   ├── Payments.tsx
│           │   ├── Refunds.tsx
│           │   └── Settlements.tsx
│           ├── officer/
│           │   ├── Queue.tsx
│           │   └── Portfolio.tsx
│           ├── analyst/
│           │   ├── Alerts.tsx
│           │   ├── Rules.tsx
│           │   └── Reconciliation.tsx
│           ├── admin/
│           │   ├── Users.tsx
│           │   ├── AuditLog.tsx
│           │   ├── Analytics.tsx
│           │   └── SystemHealth.tsx
│           └── DBLab.tsx
├── scripts/
│   ├── concurrency_demo.py
│   ├── migrate.py
│   └── run_tests.sh
└── docs/
    ├── PLAN.md               ← this file
    ├── ER_DIAGRAM.md
    ├── SCHEMA_DESIGN.md
    ├── TRANSACTIONS_AND_ISOLATION.md
    ├── INDEXING_AND_PARTITIONING.md
    ├── SECURITY.md
    ├── REPORT.md
    ├── VIVA_QA.md
    ├── TEAM_SPLIT.md
    ├── DEMO_SCRIPT.md
    └── explain/
```

## 4. Database Tables

### Identity & Access
| Table | Purpose |
|-------|---------|
| `users` | User accounts with role enum |
| `kyc_profiles` | KYC verification records |

### Wallet & Ledger (Member 1)
| Table | Purpose |
|-------|---------|
| `accounts` | All account types (wallets, system, pool) |
| `ledger_transactions` | Transaction headers with idempotency |
| `ledger_entries` | Append-only debit/credit entries |
| `account_balances` | Materialized running balance per account |
| `merchant_profiles` | Merchant settlement configuration |
| `settlements` | Merchant payout records |

### Lending (Member 2)
| Table | Purpose |
|-------|---------|
| `loan_products` | Configurable loan products |
| `loan_applications` | Application workflow |
| `loans` | Active loan tracking |
| `emi_schedule` | EMI installment schedule |
| `loan_repayments` | Payment records |
| `penalties` | Overdue penalty assessments |

### Risk & Reconciliation (Member 3)
| Table | Purpose |
|-------|---------|
| `fraud_rules` | Configurable fraud detection rules |
| `fraud_alerts` | Generated fraud alerts |
| `bank_statement_imports` | CSV import metadata |
| `bank_statement_lines` | Individual bank statement rows |
| `reconciliation_runs` | Reconciliation summary records |
| `audit_log` | System-wide audit trail |

## 5. Stored Procedures

1. `sp_transfer` — Atomic double-entry transfer with deadlock prevention
2. `sp_pay_merchant` — Merchant payment with fee calculation
3. `sp_refund` — Full/partial refund with original validation
4. `sp_apply_for_loan` — Loan application creation
5. `sp_decide_loan` — Officer approval/rejection
6. `sp_generate_emi_schedule` — Reducing-balance EMI calculation
7. `sp_disburse_loan` — Fund disbursement via ledger
8. `sp_pay_emi` — EMI payment with partial/prepayment support
9. `sp_accrue_interest_and_penalties` — Nightly batch job
10. `sp_evaluate_fraud_rules` — Real-time fraud evaluation
11. `sp_reconcile` — Bank statement matching
12. `sp_create_next_month_partition` — Auto partition management

## 6. Milestone Checklist

- [ ] **M1**: Project skeleton, docker-compose, migration runner, DB up
- [ ] **M2**: Core schema (identity, accounts, ledger, constraints, triggers)
- [ ] **M3**: Wallet procedures + concurrency tests
- [ ] **M4**: Lending schema, procedures, EMI tests, nightly job
- [ ] **M5**: Fraud rules, triggers, reconciliation + tests
- [ ] **M6**: Roles, grants, RLS, audit triggers + RLS test
- [ ] **M7**: Partitioning, indexes, EXPLAIN evidence, materialized view
- [ ] **M8**: Seed data script
- [ ] **M9**: FastAPI endpoints with auth and role guards + API tests
- [ ] **M10**: React website (all pages, all roles, DB Lab)
- [ ] **M11**: End-to-end pass, fix rough edges
- [ ] **M12**: Documentation set, final self-review

## 7. Key Design Decisions

### Double-Entry Ledger
- No mutable balance column on `accounts`
- `account_balances` updated by trigger in same transaction
- Deferred constraint ensures debits = credits per transaction
- Append-only: UPDATE/DELETE blocked by trigger

### Concurrency
- Lock accounts in id order to prevent deadlocks
- SERIALIZABLE isolation for critical money operations
- Idempotency keys prevent double-charges on retry

### Denormalization
- `account_balances` — denormalized for O(1) balance lookup; maintained by trigger
- `outstanding_principal` on `loans` — avoids recomputing from schedule each time

### Partitioning
- `ledger_entries` partitioned by month (range on `created_at`)
- Auto-create next month's partition via `sp_create_next_month_partition()`
