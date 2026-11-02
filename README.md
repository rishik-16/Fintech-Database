# PayLedger — Enterprise Double-Entry Ledger & Simulated Fintech Platform

A complete, runnable, tested university DBMS capstone project demonstrating PostgreSQL 16 features: double-entry bookkeeping, stored procedures, deferred constraint triggers, declarative range partitioning, row-level security (RLS), canonical lock ordering for deadlock prevention, and an interactive "DB Lab" dashboard.

> ⚠️ **Simulated Environment**: PayLedger is a simulation for university evaluation. No real money or real banks are involved. A **"Demo / simulated funds"** badge is permanently displayed in the UI footer.

---

## 🚀 Quick Start (Single Command)

Everything runs out of the box with Docker Compose:

```bash
# 1. Start database, API, and web frontend
docker compose up --build

# 2. In another terminal, apply migrations and seed 20,000+ realistic records across 6 months
make seed

# 3. Access the platform
# Web Dashboard: http://localhost:5173
# API Docs:      http://localhost:8000/docs
# Interactive DB Lab: http://localhost:5173/lab
```

### Essential Makefile Targets
```bash
make up         # Start all services (db, api, web)
make down       # Stop all containers
make migrate    # Run 14 plain SQL migrations in db/migrations/
make seed       # Seed users, 20k transactions, 60+ loans, planted fraud & bank CSV
make test       # Run complete pytest test suite (concurrency, invariants, RLS, API)
make demo       # Run 100-thread cross-transfer concurrency & money conservation demo
make db-shell   # Open interactive psql shell directly into payledger database
make clean      # Wipe volumes and containers
```

---

## 👥 Demo Credentials

| Platform Role | Email | Password | Primary Capabilities |
|---|---|---|---|
| **Admin** | `admin@payledger.local` | `AdminPass123!` | Audit logs, partition creation, analytics, system health |
| **Customer 1** | `customer1@payledger.local` | `CustomerPass123!` | Send money, pay merchants, view statements, apply/repay loans |
| **Customer 2** | `customer2@payledger.local` | `CustomerPass123!` | Destination customer for peer-to-peer transfers |
| **Merchant 1** | `merchant1@payledger.local` | `MerchantPass123!` | Receive customer payments, view settlements, issue refunds |
| **Loan Officer** | `officer1@payledger.local` | `OfficerPass123!` | Review underwriting queue, approve/reject loans, disburse loans |
| **Risk Analyst** | `analyst1@payledger.local` | `AnalystPass123!` | Investigate fraud alerts, manage rules, run bank reconciliation |

---

## 🏛️ Architecture & Tech Stack

```
                              ┌─────────────────────────────────────┐
                              │  React + Vite + TypeScript Frontend │
                              │    (Tailwind CSS, TanStack Query,   │
                              │     Recharts, Dark/Light Toggle)    │
                              └──────────────────┬──────────────────┘
                                                 │ HTTP / JSON
                                                 ▼
                              ┌─────────────────────────────────────┐
                              │    Python 3.12 + FastAPI Backend    │
                              │     (psycopg v3, JWT Auth, RBAC,    │
                              │       Zero ORM - Plain SQL)         │
                              └──────────────────┬──────────────────┘
                                                 │ psycopg pool (app_api)
                                                 ▼
    ┌─────────────────────────────────────────────────────────────────────────────────┐
    │                        PostgreSQL 16 Enterprise Database                        │
    │  - Schema: payledger                                                            │
    │  - Double-Entry Append-Only Ledger (Triggers block UPDATE / DELETE)             │
    │  - Deferred Constraint Trigger: Debits = Credits at commit                      │
    │  - Stored Procedures: sp_transfer (Deadlock-Free), sp_pay_emi, sp_reconcile     │
    │  - Range Partitioning: ledger_entries partitioned by month (created_at)        │
    │  - Row-Level Security (RLS): Strict multi-tenant isolation via app_customer     │
    │  - Targeted B-Tree & Partial Indexes: >120x execution speedup                  │
    │  - JSONB Audit Logging Trigger on all sensitive table mutations                 │
    └─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📚 Complete Project Documentation

Detailed markdown reports and technical analyses are available in the [`docs/`](./docs) directory:

1. [**`docs/PLAN.md`**](./docs/PLAN.md) — Architectural milestone checklist, table list, and project design plan.
2. [**`docs/ER_DIAGRAM.md`**](./docs/ER_DIAGRAM.md) — Mermaid ER diagram covering all 14 migration tables, cardinality, and normalization.
3. [**`docs/SCHEMA_DESIGN.md`**](./docs/SCHEMA_DESIGN.md) — 1NF–3NF walkthrough, justification of denormalizations, constraint catalog, append-only rules.
4. [**`docs/TRANSACTIONS_AND_ISOLATION.md`**](./docs/TRANSACTIONS_AND_ISOLATION.md) — Read Committed vs Serializable, canonical lock ordering deadlock proof, idempotency.
5. [**`docs/INDEXING_AND_PARTITIONING.md`**](./docs/INDEXING_AND_PARTITIONING.md) — Declarative monthly partitioning, pruning, and partial index strategies.
6. [**`docs/SECURITY.md`**](./docs/SECURITY.md) — Dual-tier RBAC, PostgreSQL roles, Row-Level Security (RLS) policies, bcrypt hashing.
7. [**`docs/REPORT.md`**](./docs/REPORT.md) — Comprehensive academic final course project report (20 marks).
8. [**`docs/VIVA_QA.md`**](./docs/VIVA_QA.md) — 30 high-yield viva examination questions and technical answers for university evaluators.
9. [**`docs/TEAM_SPLIT.md`**](./docs/TEAM_SPLIT.md) — 3-member responsibilities breakdown (Member 1: Ledger, Member 2: Lending, Member 3: Risk).
10. [**`docs/DEMO_SCRIPT.md`**](./docs/DEMO_SCRIPT.md) — 10-minute presentation guide with exact clicks, test credentials, and talking points.
11. [**`docs/explain/summary.md`**](./docs/explain/summary.md) — Summary of 5 before/after `EXPLAIN (ANALYZE, BUFFERS)` execution plans.

---

## 🧪 Interactive DB Lab

PayLedger includes an interactive **DB Lab** (`/lab`) designed specifically for examiner demonstration:
- **Live Concurrency Tester**: Dispatch 10–100 simultaneous cross-transfers and view real-time deadlock avoidance and money conservation.
- **EXPLAIN (ANALYZE, BUFFERS) Viewer**: Compare raw execution plans before and after indexes.
- **Partition Maintenance**: Inspect active monthly partitions and trigger `sp_create_next_month_partition()`.
- **Row-Level Security Probe**: Verify engine-level tenant filtering in real time.
