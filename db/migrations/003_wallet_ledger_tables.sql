-- ============================================================================
-- Migration 003: Wallet, Ledger, and Merchant Tables + Triggers
-- PayLedger Fintech Database
-- ============================================================================

SET search_path = payledger, public;

-- ============================================================================
-- Accounts — wallets for customers, merchants, and system internal accounts
-- ============================================================================
CREATE TABLE IF NOT EXISTS payledger.accounts (
    id              UUID                    DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id         UUID                    REFERENCES payledger.users (id),  -- NULL for system accounts
    account_type    payledger.account_type  NOT NULL,
    currency        CHAR(3)                 NOT NULL DEFAULT 'INR'
                        CHECK (currency ~ '^[A-Z]{3}$'),
    status          payledger.account_status NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ             NOT NULL DEFAULT now()
);

-- Each user may have at most one account of each type
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_user_type
    ON payledger.accounts (user_id, account_type)
    WHERE user_id IS NOT NULL;

COMMENT ON TABLE payledger.accounts IS 'All ledger accounts: customer/merchant wallets and system accounts.';

-- ============================================================================
-- Ledger Transactions — the grouping header for double-entry sets
-- NOT partitioned; serves as FK target for ledger_entries via triggers.
-- ============================================================================
CREATE TABLE IF NOT EXISTS payledger.ledger_transactions (
    id              UUID                DEFAULT gen_random_uuid() PRIMARY KEY,
    kind            payledger.txn_kind  NOT NULL,
    idempotency_key VARCHAR(255)        NOT NULL,
    description     TEXT,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),
    created_by      UUID                REFERENCES payledger.users (id),
    related_transaction_id UUID         REFERENCES payledger.ledger_transactions (id),

    CONSTRAINT uq_ledger_txn_idempotency UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ledger_transactions_related_id
    ON payledger.ledger_transactions (related_transaction_id)
    WHERE related_transaction_id IS NOT NULL;

COMMENT ON TABLE payledger.ledger_transactions IS 'Header row for each balanced set of ledger entries.';

-- ============================================================================
-- Ledger Entries — partitioned by RANGE on created_at
-- This is the append-only, immutable double-entry core.
-- NOTE: Foreign keys FROM a partitioned table are supported in PG 12+.
--       We declare them here for data integrity.
-- ============================================================================
CREATE TABLE IF NOT EXISTS payledger.ledger_entries (
    id              UUID                    DEFAULT gen_random_uuid(),
    transaction_id  UUID                    NOT NULL,
    account_id      UUID                    NOT NULL,
    direction       payledger.entry_direction NOT NULL,
    amount          NUMERIC(18,2)           NOT NULL CHECK (amount > 0),
    created_at      TIMESTAMPTZ             NOT NULL DEFAULT now(),

    -- PK must include the partition key
    PRIMARY KEY (id, created_at),

    -- FK to accounts is fine (accounts is not partitioned)
    CONSTRAINT fk_le_account FOREIGN KEY (account_id)
        REFERENCES payledger.accounts (id),

    -- FK to ledger_transactions
    CONSTRAINT fk_le_transaction FOREIGN KEY (transaction_id)
        REFERENCES payledger.ledger_transactions (id)
) PARTITION BY RANGE (created_at);

COMMENT ON TABLE payledger.ledger_entries IS
    'Immutable double-entry rows. Partitioned monthly by created_at.';

-- Create a default partition to catch any data that doesn't fall into explicit partitions.
-- Migration 010 will create month-specific partitions and the management function.
CREATE TABLE IF NOT EXISTS payledger.ledger_entries_default
    PARTITION OF payledger.ledger_entries DEFAULT;

-- ============================================================================
-- Account Balances — materialised running balance, updated by trigger
-- ============================================================================
CREATE TABLE IF NOT EXISTS payledger.account_balances (
    account_id  UUID            PRIMARY KEY
                    REFERENCES payledger.accounts (id),
    balance     NUMERIC(18,2)   NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT now()
);

COMMENT ON TABLE payledger.account_balances IS
    'Current balance per account. Updated atomically by trigger on ledger_entries.';

-- ============================================================================
-- Merchant Profiles
-- ============================================================================
CREATE TABLE IF NOT EXISTS payledger.merchant_profiles (
    user_id                 UUID            PRIMARY KEY
                                REFERENCES payledger.users (id),
    business_name           VARCHAR(300),
    settlement_frequency    VARCHAR(20)     NOT NULL DEFAULT 'daily'
                                CHECK (settlement_frequency IN ('daily', 'weekly', 'monthly')),
    fee_rate                NUMERIC(5,4)    NOT NULL DEFAULT 0.0200
                                CHECK (fee_rate >= 0 AND fee_rate <= 1)
);

COMMENT ON COLUMN payledger.merchant_profiles.fee_rate IS 'Platform fee as a decimal, e.g. 0.02 = 2%.';

-- ============================================================================
-- Settlements
-- ============================================================================
CREATE TABLE IF NOT EXISTS payledger.settlements (
    id                      UUID            DEFAULT gen_random_uuid() PRIMARY KEY,
    merchant_user_id        UUID            NOT NULL
                                REFERENCES payledger.users (id),
    amount                  NUMERIC(18,2)   NOT NULL CHECK (amount > 0),
    ledger_transaction_id   UUID            REFERENCES payledger.ledger_transactions (id),
    status                  VARCHAR(20)     NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    settled_at              TIMESTAMPTZ,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- (1) Append-only: ledger_entries
CREATE OR REPLACE FUNCTION payledger.trg_ledger_entries_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Ledger entries are append-only';
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_immutable ON payledger.ledger_entries;
CREATE TRIGGER ledger_entries_immutable
    BEFORE UPDATE OR DELETE ON payledger.ledger_entries
    FOR EACH ROW
    EXECUTE FUNCTION payledger.trg_ledger_entries_immutable();

-- (2) Append-only: ledger_transactions
CREATE OR REPLACE FUNCTION payledger.trg_ledger_transactions_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Ledger transactions are append-only';
END;
$$;

DROP TRIGGER IF EXISTS ledger_transactions_immutable ON payledger.ledger_transactions;
CREATE TRIGGER ledger_transactions_immutable
    BEFORE UPDATE OR DELETE ON payledger.ledger_transactions
    FOR EACH ROW
    EXECUTE FUNCTION payledger.trg_ledger_transactions_immutable();

-- (3) Balance update trigger + (5) Non-negative wallet check
CREATE OR REPLACE FUNCTION payledger.trg_update_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
DECLARE
    v_delta        NUMERIC(18,2);
    v_new_balance  NUMERIC(18,2);
    v_acct_type    payledger.account_type;
BEGIN
    -- Determine signed delta: credits increase, debits decrease
    IF NEW.direction = 'credit' THEN
        v_delta := NEW.amount;
    ELSE
        v_delta := -NEW.amount;
    END IF;

    -- Upsert the balance row
    INSERT INTO payledger.account_balances (account_id, balance, updated_at)
    VALUES (NEW.account_id, v_delta, now())
    ON CONFLICT (account_id) DO UPDATE
        SET balance    = payledger.account_balances.balance + v_delta,
            updated_at = now()
    RETURNING balance INTO v_new_balance;

    -- Enforce non-negative balance for wallet accounts
    SELECT account_type INTO v_acct_type
    FROM payledger.accounts
    WHERE id = NEW.account_id;

    IF v_acct_type IN ('customer_wallet', 'merchant_wallet') AND v_new_balance < 0 THEN
        RAISE EXCEPTION 'Insufficient funds: account % balance would become %',
            NEW.account_id, v_new_balance;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_update_balance ON payledger.ledger_entries;
CREATE TRIGGER ledger_entries_update_balance
    AFTER INSERT ON payledger.ledger_entries
    FOR EACH ROW
    EXECUTE FUNCTION payledger.trg_update_balance();

-- (4) Double-entry balance constraint (deferred to commit time)
--     Attached to the non-partitioned ledger_transactions table for PostgreSQL 16
--     compatibility (PostgreSQL does not support constraint triggers on partitioned tables).
--     For every transaction header created, validates at commit time:
--       a) At least 2 ledger entries exist (rejects 0-entry or 1-entry transactions)
--       b) SUM(credits) = SUM(debits)
CREATE OR REPLACE FUNCTION payledger.trg_check_double_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
DECLARE
    v_debit_sum   NUMERIC(18,2);
    v_credit_sum  NUMERIC(18,2);
    v_entry_count INT;
BEGIN
    SELECT
        COALESCE(SUM(amount) FILTER (WHERE direction = 'debit'), 0),
        COALESCE(SUM(amount) FILTER (WHERE direction = 'credit'), 0),
        COUNT(*)
    INTO v_debit_sum, v_credit_sum, v_entry_count
    FROM payledger.ledger_entries
    WHERE transaction_id = NEW.id;

    IF v_entry_count < 2 THEN
        RAISE EXCEPTION 'Double-entry violation: transaction % has only % entry(ies) (minimum 2 required)',
            NEW.id, v_entry_count;
    END IF;

    IF v_debit_sum <> v_credit_sum THEN
        RAISE EXCEPTION 'Double-entry violation: transaction % is unbalanced (debits=% credits=%)',
            NEW.id, v_debit_sum, v_credit_sum;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_double_entry ON payledger.ledger_entries;
DROP TRIGGER IF EXISTS ledger_txn_double_entry ON payledger.ledger_transactions;
CREATE CONSTRAINT TRIGGER ledger_txn_double_entry
    AFTER INSERT ON payledger.ledger_transactions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION payledger.trg_check_double_entry();

-- (5) Prevent appending entries to already-committed transactions
--     Guarantees that ledger_entries can only be created in the exact same database
--     transaction as their parent ledger_transactions header.
--     Completely eliminates the vulnerability where extra entries are added to a
--     previously committed transaction without triggering the deferred balance check.
--
--     Implementation:
--     When ledger_transactions is inserted, a transaction-level advisory lock is acquired
--     for that header's UUID. This lock is automatically held across all savepoints and
--     subtransactions in the current database transaction and released at commit/rollback.
--     When ledger_entries is inserted, it verifies the current session holds this lock.
--     This avoids unsafe xid/xid8 casting and unsupported subtransaction snapshot visibility.

CREATE OR REPLACE FUNCTION payledger.trg_ledger_transactions_track()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtext('payledger_active_header:' || NEW.id::text),
        hashtext('header:' || NEW.id::text)
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ledger_transactions_track ON payledger.ledger_transactions;
CREATE TRIGGER ledger_transactions_track
    AFTER INSERT ON payledger.ledger_transactions
    FOR EACH ROW
    EXECUTE FUNCTION payledger.trg_ledger_transactions_track();

CREATE OR REPLACE FUNCTION payledger.trg_ledger_entries_prevent_post_commit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
DECLARE
    v_held BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory'
          AND classid = hashtext('payledger_active_header:' || NEW.transaction_id::text)
          AND objid = hashtext('header:' || NEW.transaction_id::text)
          AND objsubid = 2
          AND granted = TRUE
          AND pid = pg_backend_pid()
    ) INTO v_held;

    IF NOT v_held THEN
        RAISE EXCEPTION 'Cannot add ledger entries to previously committed transaction %',
            NEW.transaction_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ledger_entries_prevent_post_commit ON payledger.ledger_entries;
CREATE TRIGGER ledger_entries_prevent_post_commit
    BEFORE INSERT ON payledger.ledger_entries
    FOR EACH ROW
    EXECUTE FUNCTION payledger.trg_ledger_entries_prevent_post_commit();

-- ============================================================================
-- Core Ledger Access Control & Privilege Hardening
-- ============================================================================
-- Explicitly revoke direct mutation permissions on ledger tables from PUBLIC.
-- Application roles and unprivileged connections cannot directly INSERT,
-- UPDATE, or DELETE ledger entries, transaction headers, or account balances.
-- All ledger writes must flow through approved SECURITY DEFINER stored procedures.
REVOKE INSERT, UPDATE, DELETE ON payledger.ledger_transactions FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON payledger.ledger_entries FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON payledger.account_balances FROM PUBLIC;
