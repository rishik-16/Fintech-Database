import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PieChart,
  AlertTriangle,
  Play,
  CheckCircle,
  ShieldAlert,
  Landmark,
  Coins,
  ArrowDownRight,
  ArrowUpRight,
  History,
} from 'lucide-react';
import { lendingApi, adminApi } from '@/api/client';
import { Card, Button, Badge, Spinner } from '@/components/UI';

export const OfficerPortfolio: React.FC = () => {
  const queryClient = useQueryClient();
  const [accruing, setAccruing] = useState(false);
  const [accrueMsg, setAccrueMsg] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['loan_portfolio_stats'],
    queryFn: async () => (await adminApi.getLoanPortfolio()).data,
  });

  const summary = data?.summary;
  const loans = data?.loans;
  const treasury = data?.treasury || [];
  const recentBankActivity = data?.recent_bank_activity || [];

  const loanPool = treasury.find((a: any) => a.account_type === 'loan_pool');
  const systemFee = treasury.find((a: any) => a.account_type === 'system_fee');

  const handleTriggerAccrual = async () => {
    setAccruing(true);
    setAccrueMsg('');
    try {
      await lendingApi.triggerNightlyAccrual();
      setAccrueMsg('Nightly interest & penalty accrual executed successfully!');
      queryClient.invalidateQueries({ queryKey: ['loan_portfolio_stats'] });
    } catch (err: any) {
      setAccrueMsg(`Accrual failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setAccruing(false);
    }
  };

  if (isLoading) return <Spinner />;

  const totalOutstanding = summary?.total_outstanding || 0;
  const npaAmount = summary?.npa_amount || 0;
  const npaRatio = totalOutstanding > 0 ? (npaAmount / totalOutstanding) * 100 : 0;

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-warm-charcoal dark:text-warm-sand flex items-center gap-2 font-display">
            <PieChart className="w-6 h-6 text-primary-600" /> Credit Portfolio & Bank Treasury
          </h1>
          <p className="text-sm text-warm-charcoal/60 dark:text-warm-sand/60 mt-0.5">
            Monitor bank liquidity reserves, loan recovery streams, NPA risk, and automated interest accruals
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleTriggerAccrual}
          isLoading={accruing}
          className="flex items-center gap-2"
        >
          <Play className="w-3.5 h-3.5 text-primary-600 fill-primary-600" /> Trigger Nightly Accrual
        </Button>
      </div>

      {accrueMsg && (
        <div className="p-4 rounded-xl bg-primary-50 dark:bg-primary-950/40 border border-primary-200 dark:border-primary-800 text-sm text-primary-800 dark:text-primary-300 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 flex-shrink-0" />
          <span>{accrueMsg}</span>
        </div>
      )}

      {/* BANK TREASURY & LIQUIDITY RESERVES */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Landmark className="w-4 h-4 text-primary-600" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-warm-charcoal/70 dark:text-warm-sand/70">
            Bank Treasury & System Reserves (Where Loan Funds & Recoveries Reside)
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="p-5 border-amber-500/20 bg-amber-500/5">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-xs font-bold text-warm-charcoal/60 dark:text-warm-sand/60 uppercase tracking-wider">
                  Bank Lending Pool Reserves (`loan_pool`)
                </span>
                <div className="text-2xl font-extrabold text-warm-charcoal dark:text-warm-sand font-mono mt-1">
                  ₹{loanPool ? parseFloat(loanPool.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
                </div>
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 flex items-center justify-center font-bold">
                <Coins className="w-5 h-5" />
              </div>
            </div>
            <p className="text-xs text-warm-charcoal/60 dark:text-warm-sand/60 mt-3 border-t border-amber-500/15 pt-2">
              Principal repayments and loan pool capital. When Alice pays EMI, the <strong>principal portion</strong> (+₹4,006.82) returns directly here.
            </p>
          </Card>

          <Card className="p-5 border-emerald-500/20 bg-emerald-500/5">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-xs font-bold text-warm-charcoal/60 dark:text-warm-sand/60 uppercase tracking-wider">
                  Bank Profit & Fee Revenue (`system_fee`)
                </span>
                <div className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300 font-mono mt-1">
                  ₹{systemFee ? parseFloat(systemFee.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}
                </div>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold">
                <Landmark className="w-5 h-5" />
              </div>
            </div>
            <p className="text-xs text-warm-charcoal/60 dark:text-warm-sand/60 mt-3 border-t border-emerald-500/15 pt-2">
              Accumulated bank profit. When Alice pays EMI, the <strong>interest component</strong> (+₹354.17) is earned as revenue here.
            </p>
          </Card>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <span className="text-xs uppercase font-bold text-warm-charcoal/50 dark:text-warm-sand/50">Total Outstanding</span>
          <div className="text-2xl font-extrabold text-warm-charcoal dark:text-warm-sand font-mono mt-1">
            ₹{totalOutstanding.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </div>
          <span className="text-[11px] text-warm-charcoal/40 dark:text-warm-sand/40">Active portfolio volume</span>
        </Card>

        <Card className="p-4">
          <span className="text-xs uppercase font-bold text-warm-charcoal/50 dark:text-warm-sand/50">NPA Ratio</span>
          <div className="text-2xl font-extrabold text-rose-600 dark:text-rose-400 font-mono mt-1">
            {npaRatio.toFixed(2)}%
          </div>
          <span className="text-[11px] text-warm-charcoal/40 dark:text-warm-sand/40">Overdue {'>'} 90 days</span>
        </Card>

        <Card className="p-4">
          <span className="text-xs uppercase font-bold text-warm-charcoal/50 dark:text-warm-sand/50">Total Loans</span>
          <div className="text-2xl font-extrabold text-warm-charcoal dark:text-warm-sand font-mono mt-1">
            {summary?.total_loans || 0}
          </div>
          <span className="text-[11px] text-warm-charcoal/40 dark:text-warm-sand/40">
            {summary?.active_loans || 0} active, {summary?.closed_loans || 0} closed
          </span>
        </Card>

        <Card className="p-4">
          <span className="text-xs uppercase font-bold text-warm-charcoal/50 dark:text-warm-sand/50">Penalties Assessed</span>
          <div className="text-2xl font-extrabold text-amber-600 dark:text-amber-400 font-mono mt-1">
            ₹{(summary?.total_penalties_assessed || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </div>
          <span className="text-[11px] text-warm-charcoal/40 dark:text-warm-sand/40">Late fees accrued</span>
        </Card>
      </div>

      {/* RECENT BANK TREASURY LEDGER ACTIVITY */}
      <Card
        title="Live Bank Treasury Ledger Stream"
        subtitle="Real-time double-entry journal records impacting loan_pool (disbursements & repayments) and system_fee (interest)"
      >
        <div className="overflow-x-auto -mx-6">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-warm-sand/40 dark:border-stone-700 text-xs font-semibold text-warm-charcoal/60 dark:text-warm-sand/60 bg-warm-sand/10 dark:bg-stone-800/50">
                <th className="py-3 px-6">Timestamp</th>
                <th className="py-3 px-6">Bank Account</th>
                <th className="py-3 px-6">Transaction Description</th>
                <th className="py-3 px-6">Flow</th>
                <th className="py-3 px-6 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-sand/20 dark:divide-stone-800 font-mono text-xs">
              {recentBankActivity.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-warm-charcoal/40">
                    No recent bank treasury activity recorded.
                  </td>
                </tr>
              ) : (
                recentBankActivity.map((e: any) => {
                  const isCredit = e.direction === 'credit';
                  return (
                    <tr key={e.id} className="hover:bg-warm-sand/10 dark:hover:bg-stone-800/30">
                      <td className="py-3 px-6 text-warm-charcoal/60 dark:text-warm-sand/60">
                        {new Date(e.created_at).toLocaleString('en-IN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-3 px-6">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            e.account_type === 'loan_pool'
                              ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300'
                          }`}
                        >
                          {e.account_type}
                        </span>
                      </td>
                      <td className="py-3 px-6 font-sans text-xs text-warm-charcoal dark:text-warm-sand font-medium">
                        {e.description || e.kind}
                      </td>
                      <td className="py-3 px-6">
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {isCredit ? <ArrowDownRight className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                          {isCredit ? 'Credit (Inflow)' : 'Debit (Outflow)'}
                        </span>
                      </td>
                      <td
                        className={`py-3 px-6 text-right font-bold ${
                          isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {isCredit ? '+' : '-'}₹{parseFloat(e.amount).toFixed(2)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Portfolio Table from v_loan_portfolio */}
      <Card title="Loans in Portfolio" subtitle="Query from payledger.v_loan_portfolio database view">
        <div className="overflow-x-auto -mx-6">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-warm-sand/40 dark:border-stone-700 text-xs font-semibold text-warm-charcoal/60 dark:text-warm-sand/60 bg-warm-sand/10 dark:bg-stone-800/50">
                <th className="py-3 px-6">Loan ID</th>
                <th className="py-3 px-6">Borrower</th>
                <th className="py-3 px-6 text-right">Principal</th>
                <th className="py-3 px-6 text-right">Outstanding</th>
                <th className="py-3 px-6">Rate</th>
                <th className="py-3 px-6">Overdue EMIs</th>
                <th className="py-3 px-6">NPA Flag</th>
                <th className="py-3 px-6">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-sand/20 dark:divide-stone-800 text-xs">
              {loans?.map((ln: any) => (
                <tr key={ln.loan_id} className="hover:bg-warm-sand/10 dark:hover:bg-stone-800/30">
                  <td className="py-3.5 px-6 font-mono text-warm-charcoal/50 dark:text-warm-sand/50">
                    {ln.loan_id.slice(0, 8)}...
                  </td>
                  <td className="py-3.5 px-6 font-medium text-warm-charcoal dark:text-warm-sand">
                    {ln.full_name}
                  </td>
                  <td className="py-3.5 px-6 text-right text-warm-charcoal/70 dark:text-warm-sand/70 font-mono">
                    ₹{parseFloat(ln.principal).toFixed(2)}
                  </td>
                  <td className="py-3.5 px-6 text-right font-bold font-mono text-warm-charcoal dark:text-warm-sand">
                    ₹{parseFloat(ln.outstanding_principal).toFixed(2)}
                  </td>
                  <td className="py-3.5 px-6 text-warm-charcoal/60 dark:text-warm-sand/60 font-mono">
                    {ln.annual_rate}%
                  </td>
                  <td className="py-3.5 px-6">
                    {ln.overdue_emi_count > 0 ? (
                      <span className="font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> {ln.overdue_emi_count} overdue
                      </span>
                    ) : (
                      <span className="text-warm-charcoal/40 dark:text-warm-sand/40">None</span>
                    )}
                  </td>
                  <td className="py-3.5 px-6">
                    {ln.is_npa ? (
                      <Badge variant="error">NPA (CRITICAL)</Badge>
                    ) : (
                      <Badge variant="success">STANDARD</Badge>
                    )}
                  </td>
                  <td className="py-3.5 px-6">
                    <Badge variant={ln.status === 'active' ? 'info' : 'neutral'}>
                      {ln.status.toUpperCase()}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
