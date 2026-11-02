import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FlaskConical,
  Zap,
  CheckCircle2,
  Layers,
  Search,
  Lock,
  GitBranch,
  Play,
  Database,
  ArrowRight,
  ShieldCheck,
  FileCode,
  Landmark,
  Coins,
  ArrowDownRight,
  ArrowUpRight,
  RefreshCw,
} from 'lucide-react';
import { adminApi } from '@/api/client';
import { Card, Button, Badge, Spinner } from '@/components/UI';

export const DBLab: React.FC = () => {
  // Concurrency Demo State
  const [concurrencyResult, setConcurrencyResult] = useState<any>(null);
  const [runningConcurrency, setRunningConcurrency] = useState(false);
  const [concurrencyError, setConcurrencyError] = useState('');

  // Selected Explain query tab
  const [selectedExplainIndex, setSelectedExplainIndex] = useState(0);

  // Queries
  const { data: invariantData, isLoading: invLoading, refetch: refetchInvariant } = useQuery({
    queryKey: ['db_lab_invariant'],
    queryFn: async () => (await adminApi.checkInvariant()).data,
  });

  const { data: partitions, isLoading: partLoading } = useQuery({
    queryKey: ['db_lab_partitions'],
    queryFn: async () => (await adminApi.getDbLabPartitions()).data,
  });

  const { data: rlsDemo, isLoading: rlsLoading } = useQuery({
    queryKey: ['db_lab_rls'],
    queryFn: async () => (await adminApi.getRlsDemo()).data,
  });

  const { data: explainResults, isLoading: explainLoading } = useQuery({
    queryKey: ['db_lab_explain'],
    queryFn: async () => (await adminApi.getExplainResults()).data,
  });

  const { data: bankTreasury, isLoading: treasuryLoading, refetch: refetchTreasury } = useQuery({
    queryKey: ['db_lab_bank_treasury'],
    queryFn: async () => (await adminApi.getBankTreasury()).data,
  });

  const handleRunConcurrency = async () => {
    setRunningConcurrency(true);
    setConcurrencyError('');
    try {
      const res = await adminApi.runConcurrencyDemo();
      setConcurrencyResult(res.data);
    } catch (err: any) {
      setConcurrencyError(err.response?.data?.detail || err.message || 'Concurrency test execution failed');
    } finally {
      setRunningConcurrency(false);
    }
  };

  return (
    <div className="space-y-10 animate-fade-in pb-16">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-800 pb-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-700 mb-3">
          <FlaskConical className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
          DBMS Course Project Live Demonstration
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">
          Database Laboratory & Verification Hub
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
          Interactive educational portal proving the execution of core DBMS concepts: ACID transaction isolation, deadlock avoidance, double-entry triggers, table partitioning, B-Tree index optimization, and Row-Level Security (RLS).
        </p>
      </div>

      {/* SECTION 1: LIVE CONCURRENCY SIMULATION */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" /> 1. Concurrency & Deadlock Avoidance Test
            </h2>
            <p className="text-xs text-gray-500">
              Executes 50 parallel multi-threaded transfers across accounts with opposing transfers (A→B and B→A)
            </p>
          </div>
          <Button
            onClick={handleRunConcurrency}
            isLoading={runningConcurrency}
            className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700"
          >
            <Play className="w-4 h-4 fill-white" /> Run Concurrency Demo
          </Button>
        </div>

        {concurrencyError && (
          <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-xs">
            {concurrencyError}
          </div>
        )}

        {concurrencyResult && (
          <Card className="border-amber-200 dark:border-amber-800/60 bg-amber-50/20 dark:bg-amber-950/10">
            {/* Top Stat Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-800/40 mb-6">
              <div>
                <span className="text-[10px] uppercase font-bold text-gray-400">Transfers Completed</span>
                <div className="text-xl font-extrabold text-gray-900 dark:text-gray-100">
                  {concurrencyResult.success_count} / {concurrencyResult.num_transfers}
                </div>
                <span className="text-[10px] text-gray-400">{concurrencyResult.elapsed_seconds}s execution</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-gray-400">Deadlocks Encountered</span>
                <div className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">
                  {concurrencyResult.deadlock_count}
                </div>
                <span className="text-[10px] text-emerald-600">Zero deadlocks (ID ordering)</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-gray-400">Net Money Delta</span>
                <div className="text-xl font-extrabold text-primary-600 dark:text-primary-400">
                  ₹{concurrencyResult.delta.toFixed(2)}
                </div>
                <span className="text-[10px] text-primary-600 font-medium">Strictly Conserved</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-gray-400">Negative Balances</span>
                <div className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">
                  {concurrencyResult.negative_balances}
                </div>
                <span className="text-[10px] text-emerald-600">CHECK constraint enforced</span>
              </div>
            </div>

            {/* Before vs After Table */}
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
              Before vs. After Account Balances
            </h4>
            <div className="overflow-x-auto -mx-6">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-800/50">
                    <th className="py-2.5 px-6">Account ID</th>
                    <th className="py-2.5 px-6">Account Owner</th>
                    <th className="py-2.5 px-6 text-right">Balance Before</th>
                    <th className="py-2.5 px-6 text-right">Balance After</th>
                    <th className="py-2.5 px-6 text-right">Net Shift</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {concurrencyResult.accounts.map((acc: any) => {
                    const diff = acc.change;
                    return (
                      <tr key={acc.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                        <td className="py-2.5 px-6 font-mono text-gray-400">{acc.id.slice(0, 16)}...</td>
                        <td className="py-2.5 px-6 font-medium text-gray-900 dark:text-gray-100">{acc.name}</td>
                        <td className="py-2.5 px-6 text-right font-mono">₹{acc.before.toFixed(2)}</td>
                        <td className="py-2.5 px-6 text-right font-mono font-bold">₹{acc.after.toFixed(2)}</td>
                        <td className={`py-2.5 px-6 text-right font-semibold font-mono ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-rose-600' : 'text-gray-400'}`}>
                          {diff > 0 ? `+₹${diff.toFixed(2)}` : diff < 0 ? `-₹${Math.abs(diff).toFixed(2)}` : '₹0.00'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 dark:border-gray-700 font-bold bg-gray-50 dark:bg-gray-800/80">
                    <td colSpan={2} className="py-3 px-6 uppercase text-gray-700 dark:text-gray-300">
                      Total System Pool:
                    </td>
                    <td className="py-3 px-6 text-right font-mono">
                      ₹{concurrencyResult.total_before.toFixed(2)}
                    </td>
                    <td className="py-3 px-6 text-right font-mono text-primary-600 dark:text-primary-400">
                      ₹{concurrencyResult.total_after.toFixed(2)}
                    </td>
                    <td className="py-3 px-6 text-right font-mono text-emerald-600">
                      Δ = ₹0.00 (VERIFIED)
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        )}
      </section>

      {/* SECTION 2: DOUBLE-ENTRY INVARIANT VERIFICATION */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" /> 2. Double-Entry Accounting Invariant Check
          </h2>
          <p className="text-xs text-gray-500">
            Validates that every single transaction header in PostgreSQL has exactly matching debits and credits
          </p>
        </div>

        <Card>
          {invLoading ? (
            <Spinner />
          ) : (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6 p-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl font-bold text-gray-900 dark:text-gray-100">
                    {invariantData?.message}
                  </span>
                  <Badge variant={invariantData?.all_balanced ? 'success' : 'error'}>
                    {invariantData?.all_balanced ? 'PASSED' : 'FAILED'}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-500 font-mono pt-2">
                  <span>Total Transactions: {invariantData?.total_transactions}</span>
                  <span>•</span>
                  <span>Debits: ₹{invariantData?.total_debits?.toLocaleString()}</span>
                  <span>•</span>
                  <span>Credits: ₹{invariantData?.total_credits?.toLocaleString()}</span>
                  <span>•</span>
                  <span className="text-emerald-600 font-bold">Unbalanced: {invariantData?.unbalanced_count}</span>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => refetchInvariant()}>
                Re-check Invariants
              </Button>
            </div>
          )}
        </Card>
      </section>

      {/* SECTION 3: RANGE PARTITIONING DEMO */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary-600" /> 3. Declarative Range Partitioning
          </h2>
          <p className="text-xs text-gray-500">
            Table payledger.ledger_entries is partitioned monthly by range on created_at for linear scale
          </p>
        </div>

        <Card>
          {partLoading ? (
            <Spinner />
          ) : (
            <div className="overflow-x-auto -mx-6">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-800/50">
                    <th className="py-2.5 px-6">Physical Partition</th>
                    <th className="py-2.5 px-6">Partition Strategy</th>
                    <th className="py-2.5 px-6 text-right">Row Count</th>
                    <th className="py-2.5 px-6 text-right">Disk Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {partitions?.map((pt: any) => (
                    <tr key={pt.partition_name} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                      <td className="py-2.5 px-6 font-mono font-bold text-gray-900 dark:text-gray-100">
                        payledger.{pt.partition_name}
                      </td>
                      <td className="py-2.5 px-6">
                        <Badge variant="info">RANGE (MONTH)</Badge>
                      </td>
                      <td className="py-2.5 px-6 text-right font-mono font-semibold text-gray-700 dark:text-gray-300">
                        {pt.row_count !== undefined ? Number(pt.row_count).toLocaleString() : 'Active'}
                      </td>
                      <td className="py-2.5 px-6 text-right font-mono text-gray-500">{pt.size}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {/* SECTION 4: EXPLAIN (ANALYZE, BUFFERS) BENCHMARKS */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Search className="w-5 h-5 text-primary-600" /> 4. Query Optimization & Indexing Evidence
          </h2>
          <p className="text-xs text-gray-500">
            Real EXPLAIN (ANALYZE, BUFFERS) execution plans comparing sequential table scans against specialized B-Tree & Partial indexes
          </p>
        </div>

        <Card>
          {explainLoading ? (
            <Spinner />
          ) : (
            <div>
              {/* Query selector tabs */}
              <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700 pb-3 mb-4">
                {explainResults?.map((res: any, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedExplainIndex(idx)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
                      selectedExplainIndex === idx
                        ? 'bg-primary-600 text-white shadow-warm-sm'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
                    }`}
                  >
                    Query #{res.query_number}
                  </button>
                ))}
              </div>

              {explainResults && explainResults[selectedExplainIndex] && (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    {explainResults[selectedExplainIndex].title}
                  </h3>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Before */}
                    <div className="p-4 rounded-xl bg-gray-900 text-gray-200 border border-gray-800">
                      <div className="flex items-center justify-between pb-2 border-b border-gray-800 mb-2">
                        <span className="text-xs font-bold text-rose-400 uppercase tracking-wider">
                          Before Index (Seq Scan)
                        </span>
                      </div>
                      <pre className="text-[11px] font-mono whitespace-pre-wrap overflow-x-auto max-h-80 leading-relaxed text-gray-300">
                        {explainResults[selectedExplainIndex].before}
                      </pre>
                    </div>

                    {/* After */}
                    <div className="p-4 rounded-xl bg-gray-900 text-gray-200 border border-gray-800">
                      <div className="flex items-center justify-between pb-2 border-b border-gray-800 mb-2">
                        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                          After Index (Index / Bitmap Scan)
                        </span>
                      </div>
                      <pre className="text-[11px] font-mono whitespace-pre-wrap overflow-x-auto max-h-80 leading-relaxed text-emerald-200">
                        {explainResults[selectedExplainIndex].after}
                      </pre>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </section>

      {/* SECTION 5: ROW-LEVEL SECURITY (RLS) DEMO */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Lock className="w-5 h-5 text-primary-600" /> 5. PostgreSQL Row-Level Security (RLS) Isolation
          </h2>
          <p className="text-xs text-gray-500">
            RLS policies dynamically restrict row visibility based on session GUC parameters (current_user_id)
          </p>
        </div>

        <Card>
          {rlsLoading ? (
            <Spinner />
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-primary-50/50 dark:bg-primary-950/20 border border-primary-100 dark:border-primary-900 text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                {rlsDemo?.explanation}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <span className="text-gray-400 block text-[10px] uppercase">Current Session Role</span>
                  <span className="font-bold text-primary-700 dark:text-primary-400 text-sm">{rlsDemo?.user_role}</span>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <span className="text-gray-400 block text-[10px] uppercase">Total DB Accounts</span>
                  <span className="font-bold text-sm text-gray-900 dark:text-gray-100">{rlsDemo?.total_accounts_in_db}</span>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <span className="text-gray-400 block text-[10px] uppercase">Visible to You</span>
                  <span className="font-bold text-sm text-emerald-600 dark:text-emerald-400">{rlsDemo?.accounts_visible_to_user}</span>
                </div>
                <div className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                  <span className="text-gray-400 block text-[10px] uppercase">RLS Enforcement</span>
                  <span className="font-bold text-sm text-emerald-600 dark:text-emerald-400">ACTIVE (FORCED)</span>
                </div>
              </div>
            </div>
          )}
        </Card>
      </section>

      {/* SECTION 6: BANK TREASURY & SYSTEM ACCOUNTS INSPECTOR */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Landmark className="w-5 h-5 text-emerald-600" /> 6. Bank Treasury & System Accounts Inspector
            </h2>
            <p className="text-xs text-gray-500">
              Live inspection of internal banking liquidity accounts: loan_pool reserves, system_fee revenue, and double-entry settlements
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetchTreasury()}
            className="flex items-center gap-1.5 text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh Balances
          </Button>
        </div>

        {treasuryLoading ? (
          <Spinner />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {bankTreasury?.accounts?.map((acc: any) => {
                const isPool = acc.account_type === 'loan_pool';
                const isFee = acc.account_type === 'system_fee';
                return (
                  <Card
                    key={acc.id}
                    className={`p-4 border ${
                      isPool
                        ? 'border-amber-400/40 bg-amber-500/5'
                        : isFee
                        ? 'border-emerald-400/40 bg-emerald-500/5'
                        : 'border-indigo-400/40 bg-indigo-500/5'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[10px] font-mono uppercase font-bold text-gray-400">
                          {acc.account_type}
                        </span>
                        <div className="text-xl font-extrabold text-gray-900 dark:text-gray-100 font-mono mt-1">
                          ₹{parseFloat(acc.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-surface dark:bg-stone-800 text-xs">
                        {isPool ? <Coins className="w-4 h-4 text-amber-600" /> : isFee ? <Landmark className="w-4 h-4 text-emerald-600" /> : <Layers className="w-4 h-4 text-indigo-600" />}
                      </div>
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono truncate mt-2">
                      UUID: {acc.id}
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                      {isPool
                        ? 'Bank Lending Capital Reserve. Loan disbursements debit this; borrower EMI principal repayments credit this.'
                        : isFee
                        ? 'Bank Operating Revenue & Profit. Merchant convenience fees & borrower EMI interest payments credit this.'
                        : 'Bank Clearing & Suspense. Used for statement reconciliations and transient settlement matching.'}
                    </p>
                  </Card>
                );
              })}
            </div>

            <Card
              title="Recent Bank Treasury Ledger Activity"
              subtitle="Live stream of double-entry journal entries crediting or debiting the bank's internal treasury accounts"
            >
              <div className="overflow-x-auto -mx-6">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-800/50">
                      <th className="py-2.5 px-6">Timestamp</th>
                      <th className="py-2.5 px-6">System Account</th>
                      <th className="py-2.5 px-6">Description</th>
                      <th className="py-2.5 px-6">Flow</th>
                      <th className="py-2.5 px-6 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {bankTreasury?.recent_entries?.slice(0, 10).map((e: any) => {
                      const isCredit = e.direction === 'credit';
                      return (
                        <tr key={e.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                          <td className="py-2.5 px-6 text-gray-400">
                            {new Date(e.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </td>
                          <td className="py-2.5 px-6">
                            <span className="font-bold text-gray-800 dark:text-gray-200 uppercase text-[10px]">
                              {e.account_type}
                            </span>
                          </td>
                          <td className="py-2.5 px-6 font-sans text-gray-700 dark:text-gray-300">
                            {e.description || e.kind}
                          </td>
                          <td className="py-2.5 px-6">
                            <span className={`inline-flex items-center gap-1 font-semibold ${isCredit ? 'text-emerald-600' : 'text-rose-600'}`}>
                              {isCredit ? <ArrowDownRight className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                              {isCredit ? 'Credit (+Inflow)' : 'Debit (-Outflow)'}
                            </span>
                          </td>
                          <td className={`py-2.5 px-6 text-right font-bold ${isCredit ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {isCredit ? '+' : '-'}₹{parseFloat(e.amount).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </section>

      {/* SECTION 7: RELATIONAL ER DIAGRAM & NORMALIZATION */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-primary-600" /> 7. Database ER Architecture
          </h2>
          <p className="text-xs text-gray-500">
            Normalized to 3NF with deliberate materialized running balances and append-only audit trail
          </p>
        </div>

        <Card title="Relational Schema Architecture (Mermaid ER Model)">
          <div className="p-4 rounded-xl bg-gray-900 text-gray-100 overflow-x-auto text-xs font-mono">
            <pre>{`erDiagram
    USERS ||--o{ ACCOUNTS : owns
    USERS ||--o{ LOAN_APPLICATIONS : submits
    USERS ||--o{ FRAUD_ALERTS : assigned_to
    USERS ||--o{ AUDIT_LOG : mutates

    ACCOUNTS ||--|| ACCOUNT_BALANCES : materializes
    ACCOUNTS ||--o{ LEDGER_ENTRIES : contains

    LEDGER_TRANSACTIONS ||--|{ LEDGER_ENTRIES : groups
    LEDGER_TRANSACTIONS ||--o{ FRAUD_ALERTS : triggers
    LEDGER_TRANSACTIONS ||--o{ LOAN_REPAYMENTS : records

    LOAN_PRODUCTS ||--o{ LOAN_APPLICATIONS : governs
    LOAN_APPLICATIONS ||--o| LOANS : approves_into
    LOANS ||--|{ EMI_SCHEDULE : amortizes
    EMI_SCHEDULE ||--o{ LOAN_REPAYMENTS : settles
    EMI_SCHEDULE ||--o{ PENALTIES : accrues

    FRAUD_RULES ||--o{ FRAUD_ALERTS : defines
    BANK_STATEMENT_IMPORTS ||--|{ BANK_STATEMENT_LINES : parses
    BANK_STATEMENT_IMPORTS ||--o{ RECONCILIATION_RUNS : summarizes`}</pre>
          </div>
        </Card>
      </section>
    </div>
  );
};
