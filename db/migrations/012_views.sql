-- ============================================================================
-- Migration 012: Views and Materialised Views
-- PayLedger Fintech Database
-- ============================================================================

SET search_path = payledger, public;

-- ============================================================================
-- v_account_statement: Running balance per account using window functions
-- ============================================================================
CREATE OR REPLACE VIEW payledger.v_account_statement
WITH (security_invoker = true) AS
SELECT
    le.account_id,
    le.id           AS entry_id,
    lt.id           AS transaction_id,
    lt.kind,
    lt.description,
    le.direction,
    le.amount,
    le.created_at,
    -- Running balance: credits add, debits subtract, ordered chronologically
    SUM(
        CASE le.direction
            WHEN 'credit' THEN  le.amount
            WHEN 'debit'  THEN -le.amount
        END
    ) OVER (
        PARTITION BY le.account_id
        ORDER BY le.created_at, le.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_balance
FROM payledger.ledger_entries le
JOIN payledger.ledger_transactions lt ON lt.id = le.transaction_id
ORDER BY le.account_id, le.created_at, le.id;

COMMENT ON VIEW payledger.v_account_statement IS
    'Account statement with running balance computed via window functions.';

-- ============================================================================
-- v_loan_portfolio: Loan portfolio summary
-- ============================================================================
CREATE OR REPLACE VIEW payledger.v_loan_portfolio
WITH (security_invoker = true) AS
SELECT
    l.id                AS loan_id,
    l.user_id,
    u.full_name,
    l.principal,
    l.outstanding_principal,
    l.annual_rate,
    l.tenure_months,
    l.status,
    l.disbursed_at,
    -- Count of overdue EMIs
    COALESCE(ov.overdue_count, 0) AS overdue_emi_count,
    -- Total amount overdue
    COALESCE(ov.overdue_amount, 0) AS overdue_amount,
    -- Total penalties assessed
    COALESCE(pen.total_penalties, 0) AS total_penalties,
    -- NPA flag: loan is non-performing if any EMI is >90 days overdue
    CASE
        WHEN EXISTS (
            SELECT 1 FROM payledger.emi_schedule es
            WHERE es.loan_id = l.id
              AND es.status = 'overdue'
              AND es.due_date < CURRENT_DATE - 90
        ) THEN true
        ELSE false
    END AS is_npa
FROM payledger.loans l
JOIN payledger.users u ON u.id = l.user_id
LEFT JOIN LATERAL (
    SELECT
        COUNT(*)                              AS overdue_count,
        SUM(es.total_due - es.paid_amount)    AS overdue_amount
    FROM payledger.emi_schedule es
    WHERE es.loan_id = l.id AND es.status = 'overdue'
) ov ON true
LEFT JOIN LATERAL (
    SELECT SUM(p.amount) AS total_penalties
    FROM payledger.penalties p
    WHERE p.loan_id = l.id
) pen ON true;

COMMENT ON VIEW payledger.v_loan_portfolio IS
    'Portfolio overview: outstanding, overdue, NPA flag per loan.';

-- ============================================================================
-- v_daily_volume: Daily transaction volume and total amount
-- ============================================================================
CREATE OR REPLACE VIEW payledger.v_daily_volume AS
SELECT
    d.day::date                      AS txn_date,
    COALESCE(agg.txn_count, 0)       AS transaction_count,
    COALESCE(agg.total_amount, 0)    AS total_amount,
    COALESCE(agg.transfer_count, 0)  AS transfer_count,
    COALESCE(agg.payment_count, 0)   AS payment_count,
    COALESCE(agg.refund_count, 0)    AS refund_count
FROM generate_series(
    CURRENT_DATE - INTERVAL '90 days',
    CURRENT_DATE,
    '1 day'
) d(day)
LEFT JOIN LATERAL (
    SELECT
        COUNT(*)                                            AS txn_count,
        SUM(le.amount)                                      AS total_amount,
        COUNT(*) FILTER (WHERE lt.kind = 'transfer')        AS transfer_count,
        COUNT(*) FILTER (WHERE lt.kind = 'payment')         AS payment_count,
        COUNT(*) FILTER (WHERE lt.kind = 'refund')          AS refund_count
    FROM payledger.ledger_transactions lt
    JOIN payledger.ledger_entries le ON le.transaction_id = lt.id AND le.direction = 'debit'
    WHERE lt.created_at >= d.day
      AND lt.created_at <  d.day + INTERVAL '1 day'
) agg ON true
ORDER BY txn_date;

COMMENT ON VIEW payledger.v_daily_volume IS
    'Daily transaction volume and amounts for the last 90 days.';

-- ============================================================================
-- v_fraud_dashboard: Fraud alert counts by status and severity
-- ============================================================================
CREATE OR REPLACE VIEW payledger.v_fraud_dashboard AS
SELECT
    fa.status,
    fa.severity,
    COUNT(*)                                                    AS alert_count,
    MIN(fa.created_at)                                          AS oldest_alert,
    MAX(fa.created_at)                                          AS newest_alert,
    COUNT(*) FILTER (WHERE fa.created_at >= now() - INTERVAL '24 hours') AS last_24h
FROM payledger.fraud_alerts fa
GROUP BY fa.status, fa.severity
ORDER BY
    CASE fa.status
        WHEN 'open'          THEN 1
        WHEN 'investigating' THEN 2
        WHEN 'resolved'      THEN 3
        WHEN 'false_positive' THEN 4
    END,
    CASE fa.severity
        WHEN 'critical' THEN 1
        WHEN 'high'     THEN 2
        WHEN 'medium'   THEN 3
        WHEN 'low'      THEN 4
    END;

COMMENT ON VIEW payledger.v_fraud_dashboard IS
    'Fraud alert aggregation for the risk operations dashboard.';

-- ============================================================================
-- v_reconciliation_summary: Match statistics per import
-- ============================================================================
CREATE OR REPLACE VIEW payledger.v_reconciliation_summary AS
SELECT
    bsi.id              AS import_id,
    bsi.filename,
    bsi.imported_at,
    total.total_lines,
    COALESCE(m.matched_count, 0)    AS matched_count,
    COALESCE(um.unmatched_count, 0) AS unmatched_count,
    COALESCE(mm.mismatch_count, 0)  AS mismatch_count,
    CASE
        WHEN total.total_lines > 0
        THEN ROUND(COALESCE(m.matched_count, 0)::numeric / total.total_lines * 100, 1)
        ELSE 0
    END AS match_rate_pct,
    rr.last_run_at
FROM payledger.bank_statement_imports bsi
CROSS JOIN LATERAL (
    SELECT COUNT(*) AS total_lines
    FROM payledger.bank_statement_lines
    WHERE import_id = bsi.id
) total
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS matched_count
    FROM payledger.bank_statement_lines
    WHERE import_id = bsi.id AND match_status = 'matched'
) m ON true
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS unmatched_count
    FROM payledger.bank_statement_lines
    WHERE import_id = bsi.id AND match_status = 'unmatched'
) um ON true
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS mismatch_count
    FROM payledger.bank_statement_lines
    WHERE import_id = bsi.id AND match_status = 'amount_mismatch'
) mm ON true
LEFT JOIN LATERAL (
    SELECT MAX(run_at) AS last_run_at
    FROM payledger.reconciliation_runs
    WHERE import_id = bsi.id
) rr ON true;

COMMENT ON VIEW payledger.v_reconciliation_summary IS
    'Match statistics per bank statement import with match rate.';

-- ============================================================================
-- v_merchant_settlement_due: Merchants with unsettled balances
-- ============================================================================
CREATE OR REPLACE VIEW payledger.v_merchant_settlement_due
WITH (security_invoker = true) AS
SELECT
    mp.user_id,
    u.full_name,
    mp.business_name,
    mp.settlement_frequency     AS settlement_frequency,
    ab.balance                  AS current_balance,
    COALESCE(ps.pending_sum, 0) AS pending_settlement_amount,
    ls.last_settled_at
FROM payledger.merchant_profiles mp
JOIN payledger.users u ON u.id = mp.user_id
JOIN payledger.accounts a ON a.user_id = mp.user_id AND a.account_type = 'merchant_wallet'
LEFT JOIN payledger.account_balances ab ON ab.account_id = a.id
LEFT JOIN LATERAL (
    SELECT SUM(s.amount) AS pending_sum
    FROM payledger.settlements s
    WHERE s.merchant_user_id = mp.user_id AND s.status = 'pending'
) ps ON true
LEFT JOIN LATERAL (
    SELECT MAX(s.settled_at) AS last_settled_at
    FROM payledger.settlements s
    WHERE s.merchant_user_id = mp.user_id AND s.status = 'completed'
) ls ON true
WHERE ab.balance > 0 OR COALESCE(ps.pending_sum, 0) > 0;

COMMENT ON VIEW payledger.v_merchant_settlement_due IS
    'Merchants with balances or pending settlements awaiting payout.';

-- ============================================================================
-- mv_daily_stats: Materialised view of daily aggregates (refresh on demand)
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS payledger.mv_daily_stats AS
SELECT
    (lt.created_at AT TIME ZONE 'UTC')::date    AS stat_date,
    lt.kind,
    COUNT(*)                                     AS txn_count,
    SUM(le.amount)                               AS total_debit_amount,
    AVG(le.amount)                               AS avg_debit_amount,
    MAX(le.amount)                               AS max_debit_amount,
    COUNT(DISTINCT le.account_id)                AS unique_accounts
FROM payledger.ledger_transactions lt
JOIN payledger.ledger_entries le ON le.transaction_id = lt.id AND le.direction = 'debit'
GROUP BY stat_date, lt.kind
ORDER BY stat_date DESC, lt.kind
WITH NO DATA;  -- Populated on first REFRESH

-- Create a unique index for concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_stats_pk
    ON payledger.mv_daily_stats (stat_date, kind);

COMMENT ON MATERIALIZED VIEW payledger.mv_daily_stats IS
    'Daily aggregate statistics per transaction kind. REFRESH MATERIALIZED VIEW CONCURRENTLY to update.';

-- Convenience function to refresh the materialized view
CREATE OR REPLACE FUNCTION payledger.sp_refresh_daily_stats()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY payledger.mv_daily_stats;
END;
$$;

GRANT EXECUTE ON FUNCTION payledger.sp_refresh_daily_stats() TO PUBLIC;

-- View SELECT permissions for application roles
GRANT SELECT ON payledger.v_account_statement TO app_customer, app_merchant, app_officer, app_risk, app_admin, app_api;
GRANT SELECT ON payledger.v_loan_portfolio TO app_officer, app_admin, app_api;
GRANT SELECT ON payledger.v_merchant_settlement_due TO app_merchant, app_officer, app_risk, app_admin, app_api;
GRANT SELECT ON payledger.v_daily_volume TO app_admin, app_risk, app_api;
GRANT SELECT ON payledger.v_fraud_dashboard TO app_risk, app_admin, app_api;
GRANT SELECT ON payledger.v_reconciliation_summary TO app_risk, app_admin, app_api;
GRANT SELECT ON payledger.mv_daily_stats TO app_admin, app_risk, app_api;

