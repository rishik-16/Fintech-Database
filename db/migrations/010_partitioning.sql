-- ============================================================================
-- Migration 010: Partition Management for ledger_entries
-- PayLedger Fintech Database
--
-- ledger_entries was created as PARTITION BY RANGE (created_at) in migration 003
-- with a DEFAULT partition. This migration creates explicit monthly partitions
-- and a function to auto-create future partitions.
-- ============================================================================

SET search_path = payledger, public;

-- ============================================================================
-- sp_create_ledger_partition: Create a monthly partition if it doesn't exist
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.sp_create_ledger_partition(
    p_year  INT,
    p_month INT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
DECLARE
    v_partition_name TEXT;
    v_start_date     DATE;
    v_end_date       DATE;
    v_has_data       BOOLEAN := false;
BEGIN
    v_partition_name := format('ledger_entries_%s_%s',
                               p_year,
                               lpad(p_month::text, 2, '0'));

    v_start_date := make_date(p_year, p_month, 1);
    v_end_date   := (v_start_date + INTERVAL '1 month')::date;

    -- Check if partition already exists
    IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'payledger'
          AND c.relname = v_partition_name
    ) THEN
        RAISE NOTICE 'Partition % already exists, skipping.', v_partition_name;
        RETURN v_partition_name;
    END IF;

    -- Check if default partition exists and contains rows within target range
    IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'payledger'
          AND c.relname = 'ledger_entries_default'
    ) THEN
        EXECUTE format(
            'SELECT EXISTS (
                SELECT 1 FROM payledger.ledger_entries_default
                WHERE created_at >= %L AND created_at < %L
            )', v_start_date, v_end_date
        ) INTO v_has_data;

        IF v_has_data THEN
            EXECUTE format(
                'CREATE TEMP TABLE _tmp_partition_data ON COMMIT DROP AS
                 SELECT * FROM payledger.ledger_entries_default
                 WHERE created_at >= %L AND created_at < %L',
                v_start_date, v_end_date
            );
            ALTER TABLE payledger.ledger_entries_default DISABLE TRIGGER ledger_entries_immutable;
            EXECUTE format(
                'DELETE FROM payledger.ledger_entries_default
                 WHERE created_at >= %L AND created_at < %L',
                v_start_date, v_end_date
            );
            ALTER TABLE payledger.ledger_entries_default ENABLE TRIGGER ledger_entries_immutable;
        END IF;
    END IF;

    -- Create the partition
    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS payledger.%I PARTITION OF payledger.ledger_entries
         FOR VALUES FROM (%L) TO (%L)',
        v_partition_name, v_start_date, v_end_date
    );

    -- Move data from temp back into the new partition
    IF v_has_data THEN
        EXECUTE format(
            'INSERT INTO payledger.%I SELECT * FROM _tmp_partition_data',
            v_partition_name
        );
        DROP TABLE IF EXISTS _tmp_partition_data;
    END IF;

    RAISE NOTICE 'Created partition: payledger.%', v_partition_name;
    RETURN v_partition_name;
END;
$$;

COMMENT ON FUNCTION payledger.sp_create_ledger_partition IS
    'Creates a monthly partition of ledger_entries for the given year/month. Idempotent.';

-- ============================================================================
-- sp_create_next_month_partition: Convenience wrapper for cron jobs
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.sp_create_next_month_partition()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
DECLARE
    v_next_month DATE;
BEGIN
    v_next_month := (date_trunc('month', now()) + INTERVAL '1 month')::date;
    RETURN payledger.sp_create_ledger_partition(
        EXTRACT(YEAR  FROM v_next_month)::int,
        EXTRACT(MONTH FROM v_next_month)::int
    );
END;
$$;

COMMENT ON FUNCTION payledger.sp_create_next_month_partition IS
    'Creates the ledger_entries partition for next month. Schedule via pg_cron.';

-- ============================================================================
-- Create partitions: 6 months back + current month + 2 months ahead
-- ============================================================================
DO $$
DECLARE
    v_date  DATE;
    v_start DATE;
    v_end   DATE;
BEGIN
    v_start := (date_trunc('month', now()) - INTERVAL '6 months')::date;
    v_end   := (date_trunc('month', now()) + INTERVAL '2 months')::date;

    v_date := v_start;
    WHILE v_date <= v_end LOOP
        PERFORM payledger.sp_create_ledger_partition(
            EXTRACT(YEAR  FROM v_date)::int,
            EXTRACT(MONTH FROM v_date)::int
        );
        v_date := (v_date + INTERVAL '1 month')::date;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION payledger.sp_create_ledger_partition(INT, INT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION payledger.sp_create_next_month_partition() TO PUBLIC;

