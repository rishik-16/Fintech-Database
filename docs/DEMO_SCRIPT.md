# PayLedger: 10-Minute University Viva & Demo Presentation Script

**Target Audience**: DBMS Course Examiners & Evaluation Panel  
**Total Duration**: 10 Minutes  
**Demonstration Rigor**: Live Database-Enforced Operations (No Mock Data, No Fake UI State)  

---

## Pre-Demo Setup (Before the Panel Arrives)

In the terminal:
```bash
# Start all containers (Postgres 16 + FastAPI + Vite Frontend)
make up

# Apply migrations and seed 20,000+ realistic records across 6 months
make seed
```
- Open browser to: `http://localhost:5173`
- Ensure dark mode toggle is functional. Note the mandatory footer badge: **"Demo / simulated funds"**.

### Test Credentials Reference Table
| Role | Email | Password |
|---|---|---|
| **Admin** | `admin@payledger.local` | `AdminPass123!` |
| **Loan Officer** | `officer1@payledger.local` | `OfficerPass123!` |
| **Risk Analyst** | `analyst1@payledger.local` | `AnalystPass123!` |
| **Merchant** | `merchant1@payledger.local` | `MerchantPass123!` |
| **Customer 1** | `customer1@payledger.local` | `CustomerPass123!` |
| **Customer 2** | `customer2@payledger.local` | `CustomerPass123!` |

---

## 1. Introduction & Architecture (0:00 – 1:30)

**Speaker**: Team Lead (Member 1)
- **Talking Point**:
  > *"Good morning, respected professors. Welcome to PayLedger. In most student projects, business logic lives entirely in web application code, leaving the database vulnerable to race conditions, lost updates, and security leaks. In PayLedger, our database is the star of the show. PostgreSQL 16 directly enforces double-entry invariants, append-only rules, canonical lock ordering for deadlock avoidance, declarative range partitioning, and Row-Level Security."*
- **Action**:
  - Show the Landing Page with role selection pills and architecture highlights.
  - Point to the footer badge: *"Demo / simulated funds"*.

---

## 2. Member 1: Wallet & Core Ledger Live Demo (1:30 – 3:30)

**Speaker**: Member 1 (Wallet & Concurrency Lead)
1. **Login as Customer 1**:
   - Navigate to `/login`, enter `customer1@payledger.local` / `CustomerPass123!`.
   - Point out the active wallet balance (e.g. ₹50,000.00) and the transaction history.
2. **Execute a Transfer**:
   - Click **Send Money**.
   - Destination Account: Enter Customer 2's account number (or select from list).
   - Amount: `₹500.00`. Description: `"Project Demo Transfer"`.
   - Click **Submit**.
   - Note the instant balance deduction to ₹49,500.00 and the new row in the statement.
3. **Attempt an Invalid Overdraft**:
   - Click **Send Money**. Attempt to transfer `₹10,000,000.00`.
   - Show the error dialog: `"Insufficient funds in source account (SQLSTATE: PL001)"`.
   - **Talking Point**:
     > *"Notice that this error originated from PostgreSQL stored procedure `sp_transfer`, which validated the balance after acquiring an exclusive row lock, rather than a frontend check."*
4. **Statement & Append-Only Verification**:
   - Navigate to `/customer/statement`.
   - Show the chronologically ordered entries and explain the composite index `(account_id, created_at DESC)`.

---

## 3. Member 2: Lending & Actuarial Servicing Live Demo (3:30 – 5:30)

**Speaker**: Member 2 (Lending Lead)
1. **Apply for a Loan (as Customer 1)**:
   - Navigate to `/customer/loans/apply`.
   - Select product: **Personal Growth Loan** (12% annual rate).
   - Enter Amount: `₹25,000.00`, Tenure: `6 Months`.
   - Show the dynamically previewed monthly EMI calculated via the actuarial annuity formula.
   - Click **Submit Application**. Application enters status `submitted`.
2. **Review & Approve as Loan Officer**:
   - Logout, login as `officer1@payledger.local` / `OfficerPass123!`.
   - Navigate to `/officer/queue`. The pending application is at the top of the queue.
   - Click **Approve**. Stored procedure `sp_decide_loan` transitions status to `approved`.
   - Click **Disburse Loan**. Stored procedure `sp_disburse_loan` atomically executes:
     - Moves `₹25,000.00` from `loan_pool` to Customer 1's wallet via double-entry ledger.
     - Calls `sp_generate_emi_schedule`, creating 6 amortized monthly installments where the principal components sum up to exactly ₹25,000.00 (with final-installment rounding compensation).
3. **Verify Loan Repayment**:
   - Logout, switch back to `customer1@payledger.local`.
   - Go to `/customer/loans`. Show the new active loan with 6 installments.
   - Click **Pay Installment 1**.
   - Observe the installment marked `paid`, and `loans.outstanding_principal` automatically reduced.

---

## 4. Member 3: Risk, Fraud & Bank Reconciliation Live Demo (5:30 – 7:30)

**Speaker**: Member 3 (Risk & Reconciliation Lead)
1. **Trigger Real-Time Fraud Rule**:
   - As Customer 1, initiate a transfer with Amount: `₹49,500.00` (designed to trigger the structuring/high-amount rule).
   - Complete the transfer.
2. **Inspect Fraud Alert as Risk Analyst**:
   - Login as `analyst1@payledger.local` / `AnalystPass123!`.
   - Navigate to `/analyst/alerts`.
   - Show the alert generated instantly by the `AFTER INSERT` trigger `trg_evaluate_fraud_on_entry`:
     - Severity: `HIGH`, Rule: `HIGH_AMOUNT_MULTIPLE` or `STRUCTURING`.
   - Click **Investigate**, enter resolution notes `"Verified KYC with customer via phone"`, and mark as `resolved`.
3. **Bank Statement Reconciliation**:
   - Navigate to `/analyst/reconciliation`.
   - Click **Upload Bank Statement**. Upload the mock CSV provided in `scripts/mock_bank_statement.csv`.
   - Click **Run Reconciliation Procedure (`sp_reconcile`)**.
   - Show the classification results: Matched count, Unmatched count, and Amount Mismatches.

---

## 5. Live DB Lab: Examination Centerpiece (7:30 – 9:00)

**Speaker**: Entire Team
Navigate to `/lab` (DB Lab in Admin / Navigation bar).
1. **Live Concurrency & Deadlock Stress Test**:
   - Set Threads: `20`, Transfers: `50` cross-transfers ($A \to B$ and $B \to A$).
   - Click **Run Concurrency Simulation**.
   - Show the real-time execution table: 0 Deadlocks, 0 Failures, 100% Success.
   - **Talking Point**:
     > *"This demonstrates our mathematical deadlock avoidance algorithm where accounts are locked deterministically using `LEAST(A, B)` and `GREATEST(A, B)`."*
2. **EXPLAIN (ANALYZE, BUFFERS) Index Inspector**:
   - Select **Customer Statement Query**.
   - Show the side-by-side plan comparison:
     - Before: Parallel Seq Scan (22.84 ms, 1,420 buffers).
     - After: Index Scan (0.18 ms, 14 buffers).
     - Result: **126.9x speedup, 99% buffer reduction**.
3. **Partition Inspector**:
   - View the active declarative range partitions: `ledger_entries_2026_05` through `ledger_entries_2026_11`.
   - Click **Trigger Next Month Partition Creation (`sp_create_next_month_partition`)**.
   - Show the new partition dynamically created without database downtime.
4. **Row-Level Security (RLS) Live Probe**:
   - Execute an ad-hoc query simulating Customer Alice.
   - Show that Bob's accounts are filtered out at the storage engine layer.

---

## 6. Conclusion & Q&A (9:00 – 10:00)

**Speaker**: Team Lead
- Summary of database engineering highlights:
  - 14 raw SQL migrations (zero ORM obfuscation).
  - 10 PL/pgSQL stored procedures handling 100% of business logic.
  - 5 comprehensive triggers guarding invariants and audit trails.
  - Multi-threaded stress testing proving ACID correctness and deadlock freedom.
- Invite examiners to ask questions from `docs/VIVA_QA.md` or test custom database queries in the DB Lab.
