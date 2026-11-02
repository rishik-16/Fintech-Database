-- ============================================================================
-- Migration 004: Wallet Stored Procedures
-- PayLedger Fintech Database
-- ============================================================================

SET search_path = payledger, public;

-- ============================================================================
-- sp_transfer: P2P wallet transfer with double-entry bookkeeping
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.sp_transfer(
    p_from_account  UUID,
    p_to_account    UUID,
    p_amount        NUMERIC,
    p_idempotency_key VARCHAR,
    p_description   TEXT DEFAULT NULL,
    p_created_by    UUID DEFAULT NULL,
    p_created_at    TIMESTAMPTZ DEFAULT now()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
#variable_conflict use_column
DECLARE
    v_txn_id        UUID;
    v_existing_id   UUID;
    v_existing_kind payledger.txn_kind;
    v_from_status   payledger.account_status;
    v_to_status     payledger.account_status;
    v_from_type     payledger.account_type;
    v_to_type       payledger.account_type;
    v_from_curr     CHAR(3);
    v_to_curr       CHAR(3);
    v_from_balance  NUMERIC(18,2);
    v_entry_count   INT;
    v_debit_sum     NUMERIC(18,2);
    v_credit_sum    NUMERIC(18,2);
    v_from_match    BOOLEAN;
    v_to_match      BOOLEAN;
    v_time          TIMESTAMPTZ := COALESCE(p_created_at, now());
BEGIN
    -- 1. Validate idempotency key
    IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
        RAISE EXCEPTION 'Idempotency key cannot be blank';
    END IF;

    -- 2. Validate amount and precision (must have at most 2 decimal places)
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Transfer amount must be positive, got %', p_amount;
    END IF;

    IF p_amount <> ROUND(p_amount, 2) THEN
        RAISE EXCEPTION 'Transfer amount % exceeds permitted precision of 2 decimal places', p_amount;
    END IF;

    IF p_from_account = p_to_account THEN
        RAISE EXCEPTION 'Cannot transfer to the same account';
    END IF;

    -- 3. Acquire transaction-level advisory lock on the idempotency key.
    --    This serializes concurrent requests using the same key even when
    --    different accounts are targeted, preventing unhandled unique constraint errors.
    PERFORM pg_advisory_xact_lock(hashtext(p_idempotency_key), hashtext('payledger:' || p_idempotency_key));

    -- 4. Idempotency validation: check if key already used
    SELECT lt.id, lt.kind INTO v_existing_id, v_existing_kind
    FROM payledger.ledger_transactions lt
    WHERE lt.idempotency_key = p_idempotency_key;

    IF FOUND THEN
        SELECT
            COUNT(*),
            COALESCE(SUM(amount) FILTER (WHERE direction = 'debit'), 0),
            COALESCE(SUM(amount) FILTER (WHERE direction = 'credit'), 0),
            BOOL_OR(account_id = p_from_account AND direction = 'debit' AND amount = p_amount),
            BOOL_OR(account_id = p_to_account AND direction = 'credit' AND amount = p_amount)
        INTO
            v_entry_count,
            v_debit_sum,
            v_credit_sum,
            v_from_match,
            v_to_match
        FROM payledger.ledger_entries
        WHERE transaction_id = v_existing_id;

        IF v_existing_kind = 'transfer'
           AND v_entry_count = 2
           AND v_debit_sum = p_amount
           AND v_credit_sum = p_amount
           AND v_from_match = TRUE
           AND v_to_match = TRUE
        THEN
            RETURN v_existing_id;
        ELSE
            RAISE EXCEPTION 'Idempotency key % already used with different parameters', p_idempotency_key;
        END IF;
    END IF;

    -- 5. Lock both accounts in deterministic UUID order to prevent deadlocks
    PERFORM id
    FROM payledger.accounts
    WHERE id IN (p_from_account, p_to_account)
    ORDER BY id
    FOR UPDATE;

    -- 6. Fetch account details and validate
    SELECT status, account_type, currency
    INTO v_from_status, v_from_type, v_from_curr
    FROM payledger.accounts
    WHERE id = p_from_account;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Source account % not found', p_from_account;
    END IF;

    SELECT status, account_type, currency
    INTO v_to_status, v_to_type, v_to_curr
    FROM payledger.accounts
    WHERE id = p_to_account;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Destination account % not found', p_to_account;
    END IF;

    -- Validate permitted account types
    IF v_from_type NOT IN ('customer_wallet', 'merchant_wallet', 'loan_pool') THEN
        RAISE EXCEPTION 'Account type % is not permitted as transfer source', v_from_type;
    END IF;

    IF v_to_type NOT IN ('customer_wallet', 'merchant_wallet', 'loan_pool') THEN
        RAISE EXCEPTION 'Account type % is not permitted as transfer destination', v_to_type;
    END IF;

    -- Validate account status
    IF v_from_status <> 'active' THEN
        RAISE EXCEPTION 'Source account % is not active (status: %)', p_from_account, v_from_status;
    END IF;

    IF v_to_status <> 'active' THEN
        RAISE EXCEPTION 'Destination account % is not active (status: %)', p_to_account, v_to_status;
    END IF;

    -- Validate currency match
    IF v_from_curr <> v_to_curr THEN
        RAISE EXCEPTION 'Currency mismatch: source account % has %, destination account % has %',
            p_from_account, v_from_curr, p_to_account, v_to_curr;
    END IF;

    -- 7. Check sufficient balance
    SELECT balance INTO v_from_balance
    FROM payledger.account_balances
    WHERE account_id = p_from_account;

    IF NOT FOUND THEN
        v_from_balance := 0;
    END IF;

    IF v_from_type IN ('customer_wallet', 'merchant_wallet') AND v_from_balance < p_amount THEN
        RAISE EXCEPTION 'Insufficient funds: account % has % but needs %',
            p_from_account, v_from_balance, p_amount;
    END IF;

    -- 8. Create the ledger transaction header
    v_txn_id := gen_random_uuid();

    INSERT INTO payledger.ledger_transactions (id, kind, idempotency_key, description, created_by, created_at)
    VALUES (v_txn_id, 'transfer', p_idempotency_key, p_description, p_created_by, v_time);

    -- 9. Create the two ledger entries (debit source, credit destination)
    INSERT INTO payledger.ledger_entries (transaction_id, account_id, direction, amount, created_at)
    VALUES
        (v_txn_id, p_from_account, 'debit',  p_amount, v_time),
        (v_txn_id, p_to_account,   'credit', p_amount, v_time);

    RETURN v_txn_id;
END;
$$;

COMMENT ON FUNCTION payledger.sp_transfer IS
    'Executes a P2P wallet transfer with idempotency serialization, deadlock prevention, precision check, currency match, and double-entry.';

-- ============================================================================
-- sp_pay_merchant: Customer payment to merchant with platform fee
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.sp_pay_merchant(
    p_customer_account  UUID,
    p_merchant_account  UUID,
    p_amount            NUMERIC,
    p_idempotency_key   VARCHAR,
    p_created_by        UUID DEFAULT NULL,
    p_created_at        TIMESTAMPTZ DEFAULT now()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
#variable_conflict use_column
DECLARE
    v_txn_id            UUID;
    v_existing_id       UUID;
    v_existing_kind     payledger.txn_kind;
    v_fee_rate          NUMERIC(5,4);
    v_fee_amount        NUMERIC(18,2);
    v_merchant_amount   NUMERIC(18,2);
    v_customer_total    NUMERIC(18,2);
    v_fee_account_id    UUID;
    v_merchant_user_id  UUID;
    v_cust_status       payledger.account_status;
    v_merch_status      payledger.account_status;
    v_fee_status        payledger.account_status;
    v_cust_type         payledger.account_type;
    v_merch_type        payledger.account_type;
    v_fee_type          payledger.account_type;
    v_cust_curr         CHAR(3);
    v_merch_curr        CHAR(3);
    v_fee_curr          CHAR(3);
    v_cust_balance      NUMERIC(18,2);
    v_entry_count       INT;
    v_debit_count       INT;
    v_credit_count      INT;
    v_debit_sum         NUMERIC(18,2);
    v_credit_sum        NUMERIC(18,2);
    v_cust_match        INT;
    v_merch_match       INT;
    v_fee_match         INT;
    v_unexpected_count  INT;
    v_time              TIMESTAMPTZ := COALESCE(p_created_at, now());
BEGIN
    -- 1. Validate idempotency key
    IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
        RAISE EXCEPTION 'Idempotency key cannot be blank';
    END IF;

    -- 2. Validate amount and precision (must have at most 2 decimal places)
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be positive, got %', p_amount;
    END IF;

    IF p_amount <> ROUND(p_amount, 2) THEN
        RAISE EXCEPTION 'Payment amount % exceeds permitted precision of 2 decimal places', p_amount;
    END IF;

    -- 3. Reject customer and merchant being the same account
    IF p_customer_account = p_merchant_account THEN
        RAISE EXCEPTION 'Customer and merchant accounts cannot be the same';
    END IF;

    -- 4. Acquire transaction-level advisory lock on the idempotency key
    PERFORM pg_advisory_xact_lock(hashtext(p_idempotency_key), hashtext('payledger:' || p_idempotency_key));

    -- 5. Idempotency validation: check if key already used
    SELECT lt.id, lt.kind INTO v_existing_id, v_existing_kind
    FROM payledger.ledger_transactions lt
    WHERE lt.idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing_kind <> 'payment' THEN
            RAISE EXCEPTION 'Idempotency key % already used with different parameters', p_idempotency_key;
        END IF;

        -- Verify that supplied customer account is actually a customer_wallet
        SELECT account_type INTO v_cust_type
        FROM payledger.accounts
        WHERE id = p_customer_account;

        IF NOT FOUND OR v_cust_type <> 'customer_wallet' THEN
            RAISE EXCEPTION 'Idempotency key % already used with different parameters', p_idempotency_key;
        END IF;

        -- Verify that supplied merchant account is actually a merchant_wallet
        SELECT account_type INTO v_merch_type
        FROM payledger.accounts
        WHERE id = p_merchant_account;

        IF NOT FOUND OR v_merch_type <> 'merchant_wallet' THEN
            RAISE EXCEPTION 'Idempotency key % already used with different parameters', p_idempotency_key;
        END IF;

        SELECT
            COUNT(*),
            COUNT(*) FILTER (WHERE le.direction = 'debit'),
            COUNT(*) FILTER (WHERE le.direction = 'credit'),
            COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'debit'), 0),
            COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'credit'), 0),
            -- Exactly one customer debit of positive amount >= p_amount
            COUNT(*) FILTER (WHERE le.account_id = p_customer_account AND le.direction = 'debit' AND le.amount >= p_amount AND a.account_type = 'customer_wallet'),
            -- Exactly one merchant credit of exact amount p_amount
            COUNT(*) FILTER (WHERE le.account_id = p_merchant_account AND le.direction = 'credit' AND le.amount = p_amount AND a.account_type = 'merchant_wallet'),
            -- Exactly one distinct system fee credit of positive amount
            COUNT(*) FILTER (WHERE le.direction = 'credit' AND a.account_type = 'system_fee' AND le.amount > 0 AND le.account_id <> p_merchant_account AND le.account_id <> p_customer_account),
            -- Unexpected or malformed entries
            COUNT(*) FILTER (
                WHERE (le.direction = 'debit' AND (le.account_id <> p_customer_account OR a.account_type <> 'customer_wallet'))
                   OR (le.direction = 'credit' AND le.account_id <> p_merchant_account AND a.account_type <> 'system_fee')
                   OR (le.direction = 'credit' AND a.account_type = 'system_fee' AND (le.account_id = p_merchant_account OR le.account_id = p_customer_account))
                   OR le.direction NOT IN ('debit', 'credit')
                   OR le.amount <= 0
            )
        INTO
            v_entry_count,
            v_debit_count,
            v_credit_count,
            v_debit_sum,
            v_credit_sum,
            v_cust_match,
            v_merch_match,
            v_fee_match,
            v_unexpected_count
        FROM payledger.ledger_entries le
        JOIN payledger.accounts a ON a.id = le.account_id
        WHERE le.transaction_id = v_existing_id;

        IF v_entry_count IN (2, 3)
           AND v_unexpected_count = 0
           AND v_debit_count = 1
           AND v_cust_match = 1
           AND v_merch_match = 1
           AND v_debit_sum = v_credit_sum
           AND (
               (v_entry_count = 2 AND v_credit_count = 1 AND v_fee_match = 0 AND v_debit_sum = p_amount)
            OR (v_entry_count = 3 AND v_credit_count = 2 AND v_fee_match = 1 AND v_debit_sum > p_amount)
           )
        THEN
            RETURN v_existing_id;
        ELSE
            RAISE EXCEPTION 'Idempotency key % already used with different parameters', p_idempotency_key;
        END IF;
    END IF;

    -- 6. Identify customer, merchant, and fee account WITHOUT taking separate locks first
    SELECT currency INTO v_cust_curr
    FROM payledger.accounts
    WHERE id = p_customer_account;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer account % not found', p_customer_account;
    END IF;

    SELECT currency, user_id INTO v_merch_curr, v_merchant_user_id
    FROM payledger.accounts
    WHERE id = p_merchant_account;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Merchant account % not found', p_merchant_account;
    END IF;

    SELECT id, currency INTO v_fee_account_id, v_fee_curr
    FROM payledger.accounts
    WHERE account_type = 'system_fee' AND currency = v_cust_curr
    ORDER BY id
    LIMIT 1;

    IF NOT FOUND THEN
        SELECT id, currency INTO v_fee_account_id, v_fee_curr
        FROM payledger.accounts
        WHERE account_type = 'system_fee'
        ORDER BY id
        LIMIT 1;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'System fee account not found. Run seed migration first.';
        ELSE
            RAISE EXCEPTION 'No system fee account found for currency % (fee account currency is %)',
                v_cust_curr, v_fee_curr;
        END IF;
    END IF;

    -- 7. Lock ALL three accounts together in one single query, ordered by UUID.
    --    This guarantees strict global lock ordering and eliminates deadlocks with sp_refund.
    PERFORM id
    FROM payledger.accounts
    WHERE id IN (p_customer_account, p_merchant_account, v_fee_account_id)
    ORDER BY id
    FOR UPDATE;

    -- 8. Re-read and validate all account details while holding the combined locks
    SELECT status, account_type, currency INTO v_cust_status, v_cust_type, v_cust_curr
    FROM payledger.accounts
    WHERE id = p_customer_account;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer account % not found', p_customer_account;
    END IF;

    IF v_cust_type <> 'customer_wallet' THEN
        RAISE EXCEPTION 'Customer account % is not a customer wallet (type: %)', p_customer_account, v_cust_type;
    END IF;

    IF v_cust_status <> 'active' THEN
        RAISE EXCEPTION 'Customer account % is not active (status: %)', p_customer_account, v_cust_status;
    END IF;

    SELECT user_id, status, account_type, currency
    INTO v_merchant_user_id, v_merch_status, v_merch_type, v_merch_curr
    FROM payledger.accounts
    WHERE id = p_merchant_account;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Merchant account % not found', p_merchant_account;
    END IF;

    IF v_merch_type <> 'merchant_wallet' THEN
        RAISE EXCEPTION 'Merchant account % is not a merchant wallet (type: %)', p_merchant_account, v_merch_type;
    END IF;

    IF v_merch_status <> 'active' THEN
        RAISE EXCEPTION 'Merchant account % is not active (status: %)', p_merchant_account, v_merch_status;
    END IF;

    SELECT status, account_type, currency INTO v_fee_status, v_fee_type, v_fee_curr
    FROM payledger.accounts
    WHERE id = v_fee_account_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'System fee account % not found', v_fee_account_id;
    END IF;

    IF v_fee_type <> 'system_fee' THEN
        RAISE EXCEPTION 'Fee account % is not a system fee account (type: %)', v_fee_account_id, v_fee_type;
    END IF;

    IF v_fee_status <> 'active' THEN
        RAISE EXCEPTION 'System fee account is not active (status: %)', v_fee_status;
    END IF;

    -- Validate currency compatibility across all 3 accounts
    IF v_cust_curr <> v_merch_curr THEN
        RAISE EXCEPTION 'Currency mismatch: customer account % has %, merchant account % has %',
            p_customer_account, v_cust_curr, p_merchant_account, v_merch_curr;
    END IF;

    IF v_cust_curr <> v_fee_curr THEN
        RAISE EXCEPTION 'Currency mismatch: customer account % has %, fee account % has %',
            p_customer_account, v_cust_curr, v_fee_account_id, v_fee_curr;
    END IF;

    -- 9. Calculate fee and customer total (surcharge platform fee model)
    SELECT fee_rate INTO v_fee_rate
    FROM payledger.merchant_profiles
    WHERE user_id = v_merchant_user_id;

    IF NOT FOUND THEN
        v_fee_rate := 0.0200;
    END IF;

    v_fee_amount      := ROUND(p_amount * v_fee_rate, 2);
    v_merchant_amount := p_amount;
    v_customer_total  := p_amount + v_fee_amount;

    -- 10. Balance check against customer total (amount + platform fee)
    SELECT COALESCE(balance, 0) INTO v_cust_balance
    FROM payledger.account_balances
    WHERE account_id = p_customer_account;

    IF NOT FOUND THEN
        v_cust_balance := 0;
    END IF;

    IF v_cust_balance < v_customer_total THEN
        RAISE EXCEPTION 'Insufficient funds: account % has % but needs % (including platform fee %)',
            p_customer_account, v_cust_balance, v_customer_total, v_fee_amount;
    END IF;

    -- 11. Create transaction header
    v_txn_id := gen_random_uuid();

    INSERT INTO payledger.ledger_transactions (id, kind, idempotency_key, description, created_by, created_at)
    VALUES (v_txn_id, 'payment', p_idempotency_key,
            format('Payment of %s to merchant (platform fee %s, total debited %s)', p_amount, v_fee_amount, v_customer_total),
            p_created_by, v_time);

    -- 12. Create ledger entries:
    -- If fee rounds to zero: create exactly 2 entries (debit customer p_amount, credit merchant p_amount)
    -- If fee is positive: create 3 entries (debit customer v_customer_total, credit merchant v_merchant_amount, credit fee account v_fee_amount)
    IF v_fee_amount > 0 THEN
        INSERT INTO payledger.ledger_entries (transaction_id, account_id, direction, amount, created_at)
        VALUES
            (v_txn_id, p_customer_account, 'debit',  v_customer_total,  v_time),
            (v_txn_id, p_merchant_account, 'credit', v_merchant_amount, v_time),
            (v_txn_id, v_fee_account_id,   'credit', v_fee_amount,      v_time);
    ELSE
        INSERT INTO payledger.ledger_entries (transaction_id, account_id, direction, amount, created_at)
        VALUES
            (v_txn_id, p_customer_account, 'debit',  p_amount, v_time),
            (v_txn_id, p_merchant_account, 'credit', p_amount, v_time);
    END IF;

    RETURN v_txn_id;
END;
$$;

COMMENT ON FUNCTION payledger.sp_pay_merchant IS
    'Customer → Merchant payment with consumer surcharge platform fee model, atomic 3-way UUID-ordered locking, zero-fee handling, currency checks, and double-entry.';

-- ============================================================================
-- sp_refund: Partial or full refund of a payment transaction
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.sp_refund(
    p_original_transaction_id UUID,
    p_amount                  NUMERIC,
    p_idempotency_key         VARCHAR,
    p_created_by              UUID DEFAULT NULL,
    p_created_at              TIMESTAMPTZ DEFAULT now()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
#variable_conflict use_column
DECLARE
    v_txn_id                 UUID;
    v_existing_id            UUID;
    v_existing_kind          payledger.txn_kind;
    v_existing_related       UUID;
    v_orig_kind              payledger.txn_kind;
    v_orig_cust_acct         UUID;
    v_orig_merch_acct        UUID;
    v_orig_fee_acct          UUID;
    v_original_amount        NUMERIC(18,2);
    v_original_merchant_amt  NUMERIC(18,2);
    v_original_fee_amt       NUMERIC(18,2) := 0.00;
    v_already_refunded       NUMERIC(18,2);
    v_already_refunded_fee   NUMERIC(18,2);
    v_target_cumulative_fee  NUMERIC(18,2);
    v_fee_refund             NUMERIC(18,2);
    v_merchant_debit         NUMERIC(18,2);
    v_customer_account       UUID;
    v_merchant_account       UUID;
    v_fee_account_id         UUID;
    v_cust_status            payledger.account_status;
    v_merch_status           payledger.account_status;
    v_fee_status             payledger.account_status;
    v_cust_type              payledger.account_type;
    v_merch_type             payledger.account_type;
    v_fee_type               payledger.account_type;
    v_cust_curr              CHAR(3);
    v_merch_curr             CHAR(3);
    v_fee_curr               CHAR(3);
    v_merch_balance          NUMERIC(18,2);
    v_entry_count            INT;
    v_credit_count           INT;
    v_debit_count            INT;
    v_credit_sum             NUMERIC(18,2);
    v_debit_sum              NUMERIC(18,2);
    v_cust_match             INT;
    v_merch_match            INT;
    v_fee_match              INT;
    v_unexpected_count       INT;
    v_orig_total_entries     INT;
    v_orig_debit_count       INT;
    v_orig_credit_count      INT;
    v_orig_cust_debit_count  INT;
    v_orig_merch_credit_count INT;
    v_orig_fee_credit_count  INT;
    v_orig_unexpected_count  INT;
    v_time                   TIMESTAMPTZ := COALESCE(p_created_at, now());
BEGIN
    -- 1. Validate idempotency key
    IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
        RAISE EXCEPTION 'Idempotency key cannot be blank';
    END IF;

    -- 2. Validate amount and precision (must have at most 2 decimal places)
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Refund amount must be positive, got %', p_amount;
    END IF;

    IF p_amount <> ROUND(p_amount, 2) THEN
        RAISE EXCEPTION 'Refund amount % exceeds permitted precision of 2 decimal places', p_amount;
    END IF;

    -- 3. Acquire transaction-level advisory lock on the idempotency key
    PERFORM pg_advisory_xact_lock(hashtext(p_idempotency_key), hashtext('payledger:' || p_idempotency_key));

    -- 4. Idempotency validation: check if key already used
    SELECT lt.id, lt.kind, lt.related_transaction_id
    INTO v_existing_id, v_existing_kind, v_existing_related
    FROM payledger.ledger_transactions lt
    WHERE lt.idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing_kind <> 'refund' OR v_existing_related IS DISTINCT FROM p_original_transaction_id THEN
            RAISE EXCEPTION 'Idempotency key % already used with different parameters', p_idempotency_key;
        END IF;

        -- (a) Verify that the referenced original transaction is a payment
        SELECT lt.kind INTO v_orig_kind
        FROM payledger.ledger_transactions lt
        WHERE lt.id = p_original_transaction_id;

        IF NOT FOUND OR v_orig_kind <> 'payment' THEN
            RAISE EXCEPTION 'Idempotency key % references invalid or non-payment original transaction', p_idempotency_key;
        END IF;

        -- (b) Independently validate original payment's complete structure:
        --     exactly one customer debit, one merchant credit, and zero or one system_fee credit
        SELECT
            COUNT(*),
            COUNT(*) FILTER (WHERE le.direction = 'debit'),
            COUNT(*) FILTER (WHERE le.direction = 'credit'),
            COUNT(*) FILTER (WHERE le.direction = 'debit' AND a.account_type = 'customer_wallet'),
            COUNT(*) FILTER (WHERE le.direction = 'credit' AND a.account_type = 'merchant_wallet'),
            COUNT(*) FILTER (WHERE le.direction = 'credit' AND a.account_type = 'system_fee'),
            COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'debit'), 0),
            COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'credit'), 0),
            COUNT(*) FILTER (
                WHERE (le.direction = 'debit' AND a.account_type <> 'customer_wallet')
                   OR (le.direction = 'credit' AND a.account_type NOT IN ('merchant_wallet', 'system_fee'))
                   OR le.direction NOT IN ('debit', 'credit')
                   OR le.amount <= 0
            )
        INTO
            v_orig_total_entries,
            v_orig_debit_count,
            v_orig_credit_count,
            v_orig_cust_debit_count,
            v_orig_merch_credit_count,
            v_orig_fee_credit_count,
            v_debit_sum,
            v_credit_sum,
            v_orig_unexpected_count
        FROM payledger.ledger_entries le
        JOIN payledger.accounts a ON a.id = le.account_id
        WHERE le.transaction_id = p_original_transaction_id;

        IF v_orig_unexpected_count > 0
           OR v_orig_debit_count <> 1
           OR v_orig_cust_debit_count <> 1
           OR v_orig_merch_credit_count <> 1
           OR v_orig_credit_count NOT IN (1, 2)
           OR (v_orig_credit_count = 1 AND v_orig_fee_credit_count <> 0)
           OR (v_orig_credit_count = 2 AND v_orig_fee_credit_count <> 1)
           OR v_debit_sum <> v_credit_sum
        THEN
            RAISE EXCEPTION 'Idempotency key % references malformed original payment transaction %',
                p_idempotency_key, p_original_transaction_id;
        END IF;

        -- (c) Retrieve accounts deterministically without relying on MAX()
        SELECT le.account_id INTO STRICT v_orig_cust_acct
        FROM payledger.ledger_entries le
        JOIN payledger.accounts a ON a.id = le.account_id
        WHERE le.transaction_id = p_original_transaction_id
          AND le.direction = 'debit'
          AND a.account_type = 'customer_wallet';

        SELECT le.account_id INTO STRICT v_orig_merch_acct
        FROM payledger.ledger_entries le
        JOIN payledger.accounts a ON a.id = le.account_id
        WHERE le.transaction_id = p_original_transaction_id
          AND le.direction = 'credit'
          AND a.account_type = 'merchant_wallet';

        IF v_orig_fee_credit_count = 1 THEN
            SELECT le.account_id INTO STRICT v_orig_fee_acct
            FROM payledger.ledger_entries le
            JOIN payledger.accounts a ON a.id = le.account_id
            WHERE le.transaction_id = p_original_transaction_id
              AND le.direction = 'credit'
              AND a.account_type = 'system_fee';

            IF v_orig_merch_acct = v_orig_fee_acct THEN
                RAISE EXCEPTION 'Idempotency key % references malformed payment with non-distinct merchant and fee accounts', p_idempotency_key;
            END IF;
        ELSE
            v_orig_fee_acct := NULL;
        END IF;

        -- Validate existing refund entries
        SELECT
            COUNT(*),
            COUNT(*) FILTER (WHERE le.direction = 'credit'),
            COUNT(*) FILTER (WHERE le.direction = 'debit'),
            COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'credit'), 0),
            COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'debit'), 0),
            COUNT(*) FILTER (WHERE le.account_id = v_orig_cust_acct AND le.direction = 'credit' AND le.amount = p_amount),
            COUNT(*) FILTER (WHERE le.account_id = v_orig_merch_acct AND le.direction = 'debit' AND le.amount > 0),
            COUNT(*) FILTER (WHERE v_orig_fee_acct IS NOT NULL AND le.account_id = v_orig_fee_acct AND le.direction = 'debit' AND le.amount > 0),
            COUNT(*) FILTER (
                WHERE (le.direction = 'credit' AND le.account_id <> v_orig_cust_acct)
                   OR (le.direction = 'debit' AND le.account_id <> v_orig_merch_acct AND (v_orig_fee_acct IS NULL OR le.account_id <> v_orig_fee_acct))
                   OR le.direction NOT IN ('credit', 'debit')
                   OR le.amount <= 0
            )
        INTO
            v_entry_count,
            v_credit_count,
            v_debit_count,
            v_credit_sum,
            v_debit_sum,
            v_cust_match,
            v_merch_match,
            v_fee_match,
            v_unexpected_count
        FROM payledger.ledger_entries le
        WHERE le.transaction_id = v_existing_id;

        IF v_entry_count IN (2, 3)
           AND v_unexpected_count = 0
           AND v_credit_count = 1
           AND v_credit_sum = p_amount
           AND v_debit_sum = p_amount
           AND v_cust_match = 1
           AND v_merch_match = 1
           AND (
               (v_entry_count = 2 AND v_debit_count = 1 AND v_fee_match = 0)
            OR (v_entry_count = 3 AND v_debit_count = 2 AND v_fee_match = 1)
           )
        THEN
            RETURN v_existing_id;
        ELSE
            RAISE EXCEPTION 'Idempotency key % already used with different parameters', p_idempotency_key;
        END IF;
    END IF;

    -- 5. Lock the original payment transaction using SELECT ... FOR UPDATE
    --    This serialises all concurrent refund requests for this transaction
    SELECT kind INTO v_orig_kind
    FROM payledger.ledger_transactions
    WHERE id = p_original_transaction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Original transaction % not found', p_original_transaction_id;
    END IF;

    IF v_orig_kind <> 'payment' THEN
        RAISE EXCEPTION 'Can only refund payments, but transaction % is %',
            p_original_transaction_id, v_orig_kind;
    END IF;

    -- 6. Validate structure of the original payment transaction
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE le.direction = 'debit'),
        COUNT(*) FILTER (WHERE le.direction = 'credit'),
        COUNT(*) FILTER (WHERE le.direction = 'debit' AND a.account_type = 'customer_wallet'),
        COUNT(*) FILTER (WHERE le.direction = 'credit' AND a.account_type = 'merchant_wallet'),
        COUNT(*) FILTER (WHERE le.direction = 'credit' AND a.account_type = 'system_fee'),
        COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'debit'), 0),
        COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'credit'), 0),
        -- Unexpected entries
        COUNT(*) FILTER (
            WHERE (le.direction = 'debit' AND a.account_type <> 'customer_wallet')
               OR (le.direction = 'credit' AND a.account_type NOT IN ('merchant_wallet', 'system_fee'))
               OR le.direction NOT IN ('debit', 'credit')
               OR le.amount <= 0
        )
    INTO
        v_orig_total_entries,
        v_orig_debit_count,
        v_orig_credit_count,
        v_orig_cust_debit_count,
        v_orig_merch_credit_count,
        v_orig_fee_credit_count,
        v_debit_sum,
        v_credit_sum,
        v_orig_unexpected_count
    FROM payledger.ledger_entries le
    JOIN payledger.accounts a ON a.id = le.account_id
    WHERE le.transaction_id = p_original_transaction_id;

    IF v_orig_unexpected_count > 0 THEN
        RAISE EXCEPTION 'Unsupported payment structure: transaction % contains unexpected account types or directions',
            p_original_transaction_id;
    END IF;

    IF v_orig_debit_count <> 1 OR v_orig_cust_debit_count <> 1 THEN
        RAISE EXCEPTION 'Unsupported payment structure: transaction % must have exactly 1 customer debit entry (found debits: %, customer debits: %)',
            p_original_transaction_id, v_orig_debit_count, v_orig_cust_debit_count;
    END IF;

    IF v_orig_merch_credit_count <> 1 THEN
        RAISE EXCEPTION 'Unsupported payment structure: transaction % must have exactly 1 merchant credit entry (found %)',
            p_original_transaction_id, v_orig_merch_credit_count;
    END IF;

    IF v_orig_credit_count NOT IN (1, 2) THEN
        RAISE EXCEPTION 'Unsupported payment structure: transaction % has invalid credit count %',
            p_original_transaction_id, v_orig_credit_count;
    END IF;

    IF v_orig_fee_credit_count > 1 THEN
        RAISE EXCEPTION 'Unsupported payment structure: transaction % has duplicate fee credit entries (%)',
            p_original_transaction_id, v_orig_fee_credit_count;
    END IF;

    IF v_orig_credit_count = 2 AND v_orig_fee_credit_count <> 1 THEN
        RAISE EXCEPTION 'Unsupported payment structure: 3-entry transaction % must have exactly 1 system fee credit entry',
            p_original_transaction_id;
    END IF;

    IF v_debit_sum <> v_credit_sum THEN
        RAISE EXCEPTION 'Unsupported payment structure: entries do not balance in transaction %',
            p_original_transaction_id;
    END IF;

    -- Deterministic retrieval without MAX()
    SELECT le.account_id, le.amount INTO STRICT v_customer_account, v_original_amount
    FROM payledger.ledger_entries le
    JOIN payledger.accounts a ON a.id = le.account_id
    WHERE le.transaction_id = p_original_transaction_id
      AND le.direction = 'debit'
      AND a.account_type = 'customer_wallet';

    SELECT le.account_id, le.amount INTO STRICT v_merchant_account, v_original_merchant_amt
    FROM payledger.ledger_entries le
    JOIN payledger.accounts a ON a.id = le.account_id
    WHERE le.transaction_id = p_original_transaction_id
      AND le.direction = 'credit'
      AND a.account_type = 'merchant_wallet';

    IF v_orig_fee_credit_count = 1 THEN
        SELECT le.account_id, le.amount INTO STRICT v_fee_account_id, v_original_fee_amt
        FROM payledger.ledger_entries le
        JOIN payledger.accounts a ON a.id = le.account_id
        WHERE le.transaction_id = p_original_transaction_id
          AND le.direction = 'credit'
          AND a.account_type = 'system_fee';

        IF v_merchant_account = v_fee_account_id THEN
            RAISE EXCEPTION 'Unsupported payment structure: merchant and fee accounts cannot be identical in transaction %',
                p_original_transaction_id;
        END IF;
    ELSE
        v_fee_account_id := NULL;
        v_original_fee_amt := 0.00;
    END IF;

    IF (v_original_merchant_amt + v_original_fee_amt) <> v_original_amount THEN
        RAISE EXCEPTION 'Unsupported payment structure: entries do not balance in transaction %',
            p_original_transaction_id;
    END IF;

    -- 7. Calculate cumulative already refunded amount using related_transaction_id
    SELECT COALESCE(SUM(le.amount), 0) INTO v_already_refunded
    FROM payledger.ledger_transactions lt
    JOIN payledger.ledger_entries le ON le.transaction_id = lt.id
    WHERE lt.related_transaction_id = p_original_transaction_id
      AND lt.kind = 'refund'
      AND le.direction = 'credit'
      AND le.account_id = v_customer_account;

    IF p_amount + v_already_refunded > v_original_amount THEN
        RAISE EXCEPTION 'Refund exceeds original payment: original=%, already_refunded=%, requested=%',
            v_original_amount, v_already_refunded, p_amount;
    END IF;

    -- 8. Cumulative fee accounting: calculate target cumulative fee reversal, subtract already reversed fee
    IF v_original_fee_amt > 0 THEN
        SELECT COALESCE(SUM(le.amount), 0) INTO v_already_refunded_fee
        FROM payledger.ledger_transactions lt
        JOIN payledger.ledger_entries le ON le.transaction_id = lt.id
        WHERE lt.related_transaction_id = p_original_transaction_id
          AND lt.kind = 'refund'
          AND le.direction = 'debit'
          AND le.account_id = v_fee_account_id;

        IF (v_already_refunded + p_amount) >= v_original_amount THEN
            -- Final refund: reverse exactly the remaining original fee
            v_fee_refund := v_original_fee_amt - v_already_refunded_fee;
        ELSE
            -- Target cumulative fee based on total amount refunded so far
            v_target_cumulative_fee := ROUND(((v_already_refunded + p_amount) / v_original_amount) * v_original_fee_amt, 2);
            v_fee_refund := v_target_cumulative_fee - v_already_refunded_fee;
        END IF;

        -- Defensive clamps: never negative, never exceeding remaining original fee
        v_fee_refund := GREATEST(0.00, LEAST(v_fee_refund, v_original_fee_amt - v_already_refunded_fee));
    ELSE
        v_fee_refund := 0.00;
    END IF;

    v_merchant_debit := p_amount - v_fee_refund;

    -- 9. Lock accounts in deterministic UUID order to avoid deadlocks
    PERFORM id
    FROM payledger.accounts
    WHERE id IN (v_customer_account, v_merchant_account, COALESCE(v_fee_account_id, v_customer_account))
    ORDER BY id
    FOR UPDATE;

    -- 10. Validate account statuses, types, and currencies
    SELECT status, account_type, currency INTO v_cust_status, v_cust_type, v_cust_curr
    FROM payledger.accounts WHERE id = v_customer_account;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer account % not found', v_customer_account;
    END IF;

    IF v_cust_status <> 'active' THEN
        RAISE EXCEPTION 'Customer account % is not active (status: %)', v_customer_account, v_cust_status;
    END IF;

    IF v_cust_type <> 'customer_wallet' THEN
        RAISE EXCEPTION 'Customer account % is not a customer wallet (type: %)', v_customer_account, v_cust_type;
    END IF;

    SELECT status, account_type, currency INTO v_merch_status, v_merch_type, v_merch_curr
    FROM payledger.accounts WHERE id = v_merchant_account;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Merchant account % not found', v_merchant_account;
    END IF;

    IF v_merch_status <> 'active' THEN
        RAISE EXCEPTION 'Merchant account % is not active (status: %)', v_merchant_account, v_merch_status;
    END IF;

    IF v_merch_type <> 'merchant_wallet' THEN
        RAISE EXCEPTION 'Merchant account % is not a merchant wallet (type: %)', v_merchant_account, v_merch_type;
    END IF;

    IF v_cust_curr <> v_merch_curr THEN
        RAISE EXCEPTION 'Currency mismatch: customer account has %, merchant account has %',
            v_cust_curr, v_merch_curr;
    END IF;

    IF v_fee_account_id IS NOT NULL AND v_fee_refund > 0 THEN
        SELECT status, account_type, currency INTO v_fee_status, v_fee_type, v_fee_curr
        FROM payledger.accounts WHERE id = v_fee_account_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'System fee account % not found', v_fee_account_id;
        END IF;

        IF v_fee_status <> 'active' THEN
            RAISE EXCEPTION 'System fee account is not active (status: %)', v_fee_status;
        END IF;

        IF v_fee_type <> 'system_fee' THEN
            RAISE EXCEPTION 'Fee account % is not a system fee account (type: %)', v_fee_account_id, v_fee_type;
        END IF;

        IF v_cust_curr <> v_fee_curr THEN
            RAISE EXCEPTION 'Currency mismatch: customer account has %, fee account has %',
                v_cust_curr, v_fee_curr;
        END IF;
    END IF;



    -- 11. Check merchant has sufficient funds for their share of the refund
    SELECT balance INTO v_merch_balance
    FROM payledger.account_balances
    WHERE account_id = v_merchant_account;

    IF NOT FOUND THEN
        v_merch_balance := 0;
    END IF;

    IF v_merch_balance < v_merchant_debit THEN
        RAISE EXCEPTION 'Insufficient funds in merchant account for refund: has % but needs %',
            v_merch_balance, v_merchant_debit;
    END IF;

    -- 12. Create refund transaction header linked via related_transaction_id
    v_txn_id := gen_random_uuid();

    INSERT INTO payledger.ledger_transactions (
        id, kind, idempotency_key, description, created_by, created_at, related_transaction_id
    )
    VALUES (
        v_txn_id, 'refund', p_idempotency_key,
        format('Refund of %s for original txn %s', p_amount, p_original_transaction_id),
        p_created_by, v_time, p_original_transaction_id
    );

    -- 13. Create balanced ledger entries:
    -- Credit customer: full refund amount (p_amount)
    -- Debit merchant: merchant net share (v_merchant_debit)
    -- Debit fee account: fee reversal (v_fee_refund), if positive
    IF v_fee_refund > 0 THEN
        INSERT INTO payledger.ledger_entries (transaction_id, account_id, direction, amount, created_at)
        VALUES
            (v_txn_id, v_customer_account, 'credit', p_amount,         v_time),
            (v_txn_id, v_merchant_account, 'debit',  v_merchant_debit, v_time),
            (v_txn_id, v_fee_account_id,   'debit',  v_fee_refund,     v_time);
    ELSE
        INSERT INTO payledger.ledger_entries (transaction_id, account_id, direction, amount, created_at)
        VALUES
            (v_txn_id, v_customer_account, 'credit', p_amount, v_time),
            (v_txn_id, v_merchant_account, 'debit',  p_amount, v_time);
    END IF;

    RETURN v_txn_id;
END;
$$;

COMMENT ON FUNCTION payledger.sp_refund IS
    'Partial or full refund of a payment. Cumulative fee accounting, reversals, locks original transaction, and checks cumulative limit.';

-- ============================================================================
-- sp_register_user: Atomic registration creating user, wallet, and opening balance
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.sp_register_user(
    p_full_name     VARCHAR,
    p_email         VARCHAR,
    p_phone         VARCHAR,
    p_password_hash VARCHAR,
    p_role          payledger.user_role DEFAULT 'customer',
    p_currency      CHAR(3) DEFAULT 'INR',
    p_business_name VARCHAR DEFAULT NULL,
    p_fee_rate      NUMERIC DEFAULT 0.0200
)
RETURNS TABLE(user_id UUID, account_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
#variable_conflict use_column
DECLARE
    v_user_id     UUID := gen_random_uuid();
    v_account_id  UUID := gen_random_uuid();
    v_acct_type   payledger.account_type;
    v_clean_email VARCHAR;
BEGIN
    v_clean_email := LOWER(BTRIM(p_email));

    IF EXISTS (SELECT 1 FROM payledger.users WHERE LOWER(email) = v_clean_email) THEN
        RAISE EXCEPTION 'A user with this email already exists: %', v_clean_email;
    END IF;

    v_acct_type := CASE WHEN p_role = 'merchant' THEN 'merchant_wallet'::payledger.account_type ELSE 'customer_wallet'::payledger.account_type END;

    INSERT INTO payledger.users (id, full_name, email, phone, password_hash, role, status)
    VALUES (v_user_id, p_full_name, v_clean_email, p_phone, p_password_hash, p_role, 'active');

    INSERT INTO payledger.accounts (id, user_id, account_type, currency, status)
    VALUES (v_account_id, v_user_id, v_acct_type, p_currency, 'active');

    INSERT INTO payledger.account_balances (account_id, balance, updated_at)
    VALUES (v_account_id, 0.00, now())
    ON CONFLICT (account_id) DO NOTHING;

    IF p_role = 'merchant' THEN
        INSERT INTO payledger.merchant_profiles (user_id, business_name, fee_rate, settlement_frequency)
        VALUES (v_user_id, COALESCE(p_business_name, p_full_name || ' Store'), p_fee_rate, 'daily')
        ON CONFLICT (user_id) DO NOTHING;
    END IF;

    user_id := v_user_id;
    account_id := v_account_id;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION payledger.sp_register_user IS
    'Atomically creates user, assigned wallet account, and initial balance cache entry.';

-- ============================================================================
-- sp_get_active_merchants: Public list of active merchants for customer checkout
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.sp_get_active_merchants()
RETURNS TABLE (
    account_id UUID,
    user_id UUID,
    full_name VARCHAR,
    business_name VARCHAR,
    fee_rate NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
    SELECT
        a.id AS account_id,
        u.id AS user_id,
        u.full_name,
        COALESCE(mp.business_name, u.full_name)::VARCHAR AS business_name,
        COALESCE(mp.fee_rate, 0.0200)::NUMERIC AS fee_rate
    FROM payledger.accounts a
    JOIN payledger.users u ON u.id = a.user_id
    LEFT JOIN payledger.merchant_profiles mp ON mp.user_id = u.id
    WHERE a.account_type = 'merchant_wallet' AND a.status = 'active'
    ORDER BY COALESCE(mp.business_name, u.full_name);
$$;

COMMENT ON FUNCTION payledger.sp_get_active_merchants IS
    'Returns active merchant wallet accounts for customer checkout without leaking sensitive balance data.';

-- ============================================================================
-- Execute Grants for Stored Procedures
-- ============================================================================
-- Ledger tables have direct INSERT/UPDATE/DELETE revoked from PUBLIC in 003.
-- Financial operations must be performed via these SECURITY DEFINER functions.
GRANT EXECUTE ON FUNCTION payledger.sp_transfer(UUID, UUID, NUMERIC, VARCHAR, TEXT, UUID, TIMESTAMPTZ) TO PUBLIC;
GRANT EXECUTE ON FUNCTION payledger.sp_pay_merchant(UUID, UUID, NUMERIC, VARCHAR, UUID, TIMESTAMPTZ) TO PUBLIC;
GRANT EXECUTE ON FUNCTION payledger.sp_refund(UUID, NUMERIC, VARCHAR, UUID, TIMESTAMPTZ) TO PUBLIC;
GRANT EXECUTE ON FUNCTION payledger.sp_register_user(VARCHAR, VARCHAR, VARCHAR, VARCHAR, payledger.user_role, CHAR(3), VARCHAR, NUMERIC) TO PUBLIC;
GRANT EXECUTE ON FUNCTION payledger.sp_get_active_merchants() TO PUBLIC;



