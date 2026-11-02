-- ============================================================================
-- Migration 008: Fraud Detection and Reconciliation Procedures
-- PayLedger Fintech Database
-- ============================================================================

SET search_path = payledger, public;

-- ============================================================================
-- sp_evaluate_fraud_rules: Evaluate all active rules against a transaction
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.sp_evaluate_fraud_rules(
    p_transaction_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
DECLARE
    v_alert_count       INT := 0;
    v_rule              RECORD;
    v_txn               RECORD;
    v_entry             RECORD;
    v_account           RECORD;
    v_count             INT;
    v_avg_amount        NUMERIC(18,2);
    v_threshold         JSONB;
    v_should_alert      BOOLEAN;
BEGIN
    -- Get the transaction details
    SELECT * INTO v_txn
    FROM payledger.ledger_transactions
    WHERE id = p_transaction_id;

    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    -- Only evaluate for transfer and payment kinds
    IF v_txn.kind NOT IN ('transfer', 'payment') THEN
        RETURN 0;
    END IF;

    -- Get the primary debit entry (the account initiating the transaction)
    SELECT le.*, a.account_type, a.user_id, a.created_at AS account_created_at
    INTO v_entry
    FROM payledger.ledger_entries le
    JOIN payledger.accounts a ON a.id = le.account_id
    WHERE le.transaction_id = p_transaction_id
      AND le.direction = 'debit'
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    -- Iterate over all active fraud rules
    FOR v_rule IN
        SELECT * FROM payledger.fraud_rules WHERE active = true
    LOOP
        v_threshold := v_rule.threshold_json;
        v_should_alert := false;

        -- ============================================================
        -- RULE: VELOCITY — too many transactions in a time window
        -- ============================================================
        IF v_rule.code = 'VELOCITY' THEN
            SELECT COUNT(*) INTO v_count
            FROM payledger.ledger_entries le2
            WHERE le2.account_id = v_entry.account_id
              AND le2.direction = 'debit'
              AND le2.created_at >= (v_txn.created_at - make_interval(
                    mins := (v_threshold->>'window_minutes')::int))
              AND le2.created_at <= v_txn.created_at;

            IF v_count > (v_threshold->>'max_count')::int THEN
                v_should_alert := true;
            END IF;

        -- ============================================================
        -- RULE: LARGE_AMOUNT — single large transaction
        -- ============================================================
        ELSIF v_rule.code = 'LARGE_AMOUNT' THEN
            -- Absolute threshold check
            IF v_entry.amount > (v_threshold->>'absolute_threshold')::numeric THEN
                v_should_alert := true;
            END IF;

            -- Rolling average multiplier check
            IF NOT v_should_alert AND v_threshold ? 'avg_multiplier' THEN
                SELECT COALESCE(AVG(le3.amount), 0) INTO v_avg_amount
                FROM payledger.ledger_entries le3
                WHERE le3.account_id = v_entry.account_id
                  AND le3.direction = 'debit'
                  AND le3.created_at >= (v_txn.created_at - INTERVAL '30 days')
                  AND le3.created_at < v_txn.created_at;

                IF v_avg_amount > 0
                   AND v_entry.amount > v_avg_amount * (v_threshold->>'avg_multiplier')::numeric THEN
                    v_should_alert := true;
                END IF;
            END IF;

        -- ============================================================
        -- RULE: ROUND_TRIP — A→B then B→A within window
        -- ============================================================
        ELSIF v_rule.code = 'ROUND_TRIP' THEN
            DECLARE
                v_credit_account UUID;
            BEGIN
                -- Find the credit account in this transaction
                SELECT le4.account_id INTO v_credit_account
                FROM payledger.ledger_entries le4
                WHERE le4.transaction_id = p_transaction_id
                  AND le4.direction = 'credit'
                  AND le4.account_id <> v_entry.account_id
                LIMIT 1;

                IF v_credit_account IS NOT NULL THEN
                    -- Look for a reverse transaction (B→A) within the window
                    SELECT COUNT(*) INTO v_count
                    FROM payledger.ledger_entries le_debit
                    JOIN payledger.ledger_entries le_credit
                        ON le_credit.transaction_id = le_debit.transaction_id
                        AND le_credit.direction = 'credit'
                    JOIN payledger.ledger_transactions lt
                        ON lt.id = le_debit.transaction_id
                    WHERE le_debit.account_id = v_credit_account
                      AND le_debit.direction = 'debit'
                      AND le_credit.account_id = v_entry.account_id
                      AND lt.id <> p_transaction_id
                      AND lt.created_at >= (v_txn.created_at - make_interval(
                            mins := (v_threshold->>'window_minutes')::int))
                      AND lt.created_at <= v_txn.created_at;

                    IF v_count > 0 THEN
                        v_should_alert := true;
                    END IF;
                END IF;
            END;

        -- ============================================================
        -- RULE: NEW_ACCOUNT_HIGH_VALUE — young account, big transaction
        -- ============================================================
        ELSIF v_rule.code = 'NEW_ACCOUNT_HIGH_VALUE' THEN
            IF v_entry.account_created_at IS NOT NULL
               AND (v_txn.created_at::date - v_entry.account_created_at::date)
                    < (v_threshold->>'account_age_days')::int
               AND v_entry.amount > (v_threshold->>'amount_threshold')::numeric THEN
                v_should_alert := true;
            END IF;

        -- ============================================================
        -- RULE: STRUCTURING — many transactions just below threshold
        -- ============================================================
        ELSIF v_rule.code = 'STRUCTURING' THEN
            DECLARE
                v_report_threshold  NUMERIC;
                v_lower_bound       NUMERIC;
            BEGIN
                v_report_threshold := (v_threshold->>'report_threshold')::numeric;
                -- "Just below" = within 10% of the threshold
                v_lower_bound := v_report_threshold * 0.90;

                SELECT COUNT(*) INTO v_count
                FROM payledger.ledger_entries le5
                JOIN payledger.ledger_transactions lt5
                    ON lt5.id = le5.transaction_id
                WHERE le5.account_id = v_entry.account_id
                  AND le5.direction = 'debit'
                  AND le5.amount >= v_lower_bound
                  AND le5.amount < v_report_threshold
                  AND lt5.created_at >= (v_txn.created_at - make_interval(
                        hours := (v_threshold->>'window_hours')::int))
                  AND lt5.created_at <= v_txn.created_at;

                IF v_count >= (v_threshold->>'min_count')::int THEN
                    v_should_alert := true;
                END IF;
            END;
        END IF;

        -- Create alert if rule triggered
        IF v_should_alert THEN
            INSERT INTO payledger.fraud_alerts (
                rule_id, ledger_transaction_id, account_id, severity
            ) VALUES (
                v_rule.id, p_transaction_id, v_entry.account_id, v_rule.severity
            )
            ON CONFLICT (rule_id, ledger_transaction_id) DO NOTHING;

            v_alert_count := v_alert_count + 1;
        END IF;

    END LOOP;

    RETURN v_alert_count;
END;
$$;

COMMENT ON FUNCTION payledger.sp_evaluate_fraud_rules IS
    'Evaluates all active fraud rules against a transaction. Returns count of alerts generated.';

-- ============================================================================
-- Trigger: Automatically evaluate fraud rules on new ledger entries
-- Only for transfer and payment kinds (not internal movements).
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.trg_fraud_check_on_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
DECLARE
    v_kind payledger.txn_kind;
BEGIN
    -- Look up the transaction kind
    SELECT kind INTO v_kind
    FROM payledger.ledger_transactions
    WHERE id = NEW.transaction_id;

    -- Only run fraud checks for external-facing transaction types
    IF v_kind IN ('transfer', 'payment') THEN
        -- Fire once per transaction (only on the first entry = debit)
        IF NEW.direction = 'debit' THEN
            PERFORM payledger.sp_evaluate_fraud_rules(NEW.transaction_id);
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

-- Use a STATEMENT-level trigger would be ideal, but on partitioned tables
-- we need row-level. We guard against double-evaluation with ON CONFLICT
-- in sp_evaluate_fraud_rules.
DROP TRIGGER IF EXISTS ledger_entries_fraud_check ON payledger.ledger_entries;
CREATE TRIGGER ledger_entries_fraud_check
    AFTER INSERT ON payledger.ledger_entries
    FOR EACH ROW
    EXECUTE FUNCTION payledger.trg_fraud_check_on_entry();

-- ============================================================================
-- sp_reconcile: Match bank statement lines to ledger transactions
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.sp_reconcile(
    p_import_id UUID,
    p_run_by    UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
DECLARE
    v_run_id        UUID;
    v_line          RECORD;
    v_matched_txn   UUID;
    v_matched_amt   NUMERIC(18,2);
    v_matched       INT := 0;
    v_unmatched     INT := 0;
    v_mismatch      INT := 0;
BEGIN
    -- Validate import exists
    IF NOT EXISTS (SELECT 1 FROM payledger.bank_statement_imports WHERE id = p_import_id) THEN
        RAISE EXCEPTION 'Bank statement import % not found', p_import_id;
    END IF;

    -- Process each unmatched line
    FOR v_line IN
        SELECT * FROM payledger.bank_statement_lines
        WHERE import_id = p_import_id
          AND match_status = 'unmatched'
        FOR UPDATE
    LOOP
        v_matched_txn := NULL;

        -- Strategy 1: Match by idempotency_key = bank_reference
        IF v_line.bank_reference IS NOT NULL THEN
            SELECT id INTO v_matched_txn
            FROM payledger.ledger_transactions
            WHERE idempotency_key = v_line.bank_reference;
        END IF;

        -- Strategy 2: Match by transaction UUID = bank_reference
        IF v_matched_txn IS NULL AND v_line.bank_reference IS NOT NULL THEN
            BEGIN
                SELECT id INTO v_matched_txn
                FROM payledger.ledger_transactions
                WHERE id = v_line.bank_reference::uuid;
            EXCEPTION
                WHEN invalid_text_representation THEN
                    NULL; -- bank_reference is not a valid UUID, skip
            END;
        END IF;

        IF v_matched_txn IS NOT NULL THEN
            -- Verify amount matches: sum of debit entries for the transaction
            SELECT COALESCE(SUM(amount), 0) INTO v_matched_amt
            FROM payledger.ledger_entries
            WHERE transaction_id = v_matched_txn
              AND direction = 'debit';

            IF v_matched_amt = v_line.amount THEN
                UPDATE payledger.bank_statement_lines
                SET match_status = 'matched',
                    matched_transaction_id = v_matched_txn
                WHERE id = v_line.id;

                v_matched := v_matched + 1;
            ELSE
                UPDATE payledger.bank_statement_lines
                SET match_status = 'amount_mismatch',
                    matched_transaction_id = v_matched_txn
                WHERE id = v_line.id;

                v_mismatch := v_mismatch + 1;
            END IF;
        ELSE
            -- No match found — stays unmatched
            v_unmatched := v_unmatched + 1;
        END IF;
    END LOOP;

    -- Record the reconciliation run
    v_run_id := gen_random_uuid();

    INSERT INTO payledger.reconciliation_runs (
        id, import_id, run_by, matched_count, unmatched_count, mismatch_count
    ) VALUES (
        v_run_id, p_import_id, p_run_by, v_matched, v_unmatched, v_mismatch
    );

    RETURN v_run_id;
END;
$$;

COMMENT ON FUNCTION payledger.sp_reconcile IS
    'Matches bank statement lines to ledger transactions by reference and amount.';

-- ============================================================================
-- Execute Grants for Fraud & Reconciliation Procedures
-- ============================================================================
GRANT EXECUTE ON FUNCTION payledger.sp_evaluate_fraud_rules(UUID) TO PUBLIC;
GRANT EXECUTE ON FUNCTION payledger.sp_reconcile(UUID, UUID) TO PUBLIC;

