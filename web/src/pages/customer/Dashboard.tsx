import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  Store,
  FileText,
  BadgeDollarSign,
  TrendingUp,
  Clock,
  Eye,
  EyeOff,
  Send,
  CreditCard,
  Landmark,
  ShieldCheck,
  Sparkles,
  ChevronRight,
  ArrowRight,
  Copy,
  Check,
  Zap,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { walletApi, lendingApi } from '@/api/client';
import { Card, Button, Badge, Spinner, EmptyState } from '@/components/UI';
import { useAuth } from '@/hooks/useAuth';

export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [showBalance, setShowBalance] = useState(true);
  const [copiedUpi, setCopiedUpi] = useState(false);

  const { data: accounts, isLoading: accountsLoading } = useQuery({
    queryKey: ['wallet_accounts'],
    queryFn: async () => (await walletApi.getAccounts()).data,
  });

  const primaryAccount = accounts?.[0];

  const { data: statement, isLoading: statementLoading } = useQuery({
    queryKey: ['account_statement', primaryAccount?.id],
    enabled: !!primaryAccount?.id,
    queryFn: async () => (await walletApi.getStatement(primaryAccount.id, { per_page: 8 })).data,
  });

  const { data: myLoans } = useQuery({
    queryKey: ['my_loans'],
    queryFn: async () => (await lendingApi.getMyLoans()).data,
  });

  const balance = primaryAccount?.balance ? parseFloat(primaryAccount.balance) : 0;
  const activeLoans = myLoans?.filter((l: any) => l.status === 'active') || [];
  const primaryLoan = activeLoans[0];

  // UPI Handle
  const upiId = `${user?.email?.split('@')[0]}@payledger`;

  // Time-based greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  // Compute dynamic area chart points from real account statement timeline data
  const chartData = useMemo(() => {
    if (statement && statement.length > 0) {
      const chronological = [...statement].reverse();
      return chronological.map((entry) => {
        const d = new Date(entry.created_at);
        const dayLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        return {
          day: dayLabel,
          balance: entry.running_balance != null ? parseFloat(entry.running_balance) : balance,
        };
      });
    }
    return [
      { day: 'Start', balance: balance },
      { day: 'Today', balance: balance },
    ];
  }, [statement, balance]);

  const copyUpi = () => {
    navigator.clipboard.writeText(upiId);
    setCopiedUpi(true);
    setTimeout(() => setCopiedUpi(false), 2000);
  };

  if (accountsLoading) return <Spinner />;

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      {/* ── GPay/PhonePe Greeting & UPI Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-warm-charcoal dark:text-warm-sand font-display">
              {greeting}, {user?.full_name?.split(' ')[0]} 👋
            </h1>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800">
              <ShieldCheck className="w-3 h-3 text-emerald-600" /> Verified
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-warm-charcoal/60 dark:text-warm-sand/60">
            <span>PayLedger ID:</span>
            <button
              onClick={copyUpi}
              className="inline-flex items-center gap-1 font-mono font-bold text-primary-700 dark:text-primary-300 hover:underline"
              title="Click to copy UPI ID"
            >
              {upiId}
              {copiedUpi ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-warm-charcoal/40" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Link to="/statement">
            <Button variant="outline" size="sm" className="flex items-center gap-1.5 text-xs">
              <FileText className="w-3.5 h-3.5" /> Passbook
            </Button>
          </Link>
          <Link to="/send-money">
            <Button size="sm" className="flex items-center gap-1.5 text-xs shadow-warm">
              <Send className="w-3.5 h-3.5" /> Transfer Money
            </Button>
          </Link>
        </div>
      </div>

      {/* ── HERO DIGITAL WALLET / DEBIT CARD (YONO / PhonePe Style) ── */}
      <div className="relative rounded-3xl p-6 sm:p-8 bg-gradient-to-br from-[#2D1B12] via-[#21140D] to-[#150B06] text-white shadow-warm-lg border border-[#432A1C] overflow-hidden">
        {/* Subtle decorative glow circles */}
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-primary-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-56 h-56 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col justify-between h-full min-h-[190px]">
          {/* Card Top: Bank Brand & EMV Chip */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-7 rounded-md bg-amber-400/25 border border-amber-300/40 flex items-center justify-center">
                <div className="w-6 h-4 rounded-sm border border-amber-300/50 flex flex-col justify-around py-0.5 px-1">
                  <div className="h-px bg-amber-300/60" />
                  <div className="h-px bg-amber-300/60" />
                </div>
              </div>
              <span className="text-xs uppercase font-bold tracking-widest text-amber-200/90 font-sans">
                PayLedger Digital Wallet
              </span>
            </div>

            <span className="text-[11px] font-mono font-bold tracking-widest text-warm-sand/80 px-2.5 py-0.5 rounded-full bg-white/10 border border-white/15">
              ACID PROTECTED
            </span>
          </div>

          {/* Card Center: Large Available Balance */}
          <div className="my-5">
            <div className="flex items-center gap-2 text-xs text-amber-200/70 uppercase tracking-wider font-semibold">
              <span>Available Wallet Balance</span>
              <button
                onClick={() => setShowBalance(!showBalance)}
                className="text-amber-200/80 hover:text-white transition-colors"
                title={showBalance ? 'Hide Balance' : 'Show Balance'}
              >
                {showBalance ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="text-3xl sm:text-4xl font-extrabold tracking-tight font-mono text-white mt-1">
              {showBalance ? (
                <>₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
              ) : (
                <>₹••••••••</>
              )}
            </div>
          </div>

          {/* Card Bottom: Cardholder & Account ID */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-4 border-t border-white/10 text-xs font-mono">
            <div>
              <span className="text-[10px] text-amber-200/60 uppercase block">Cardholder</span>
              <span className="font-bold tracking-wider text-white font-sans uppercase">{user?.full_name}</span>
            </div>
            <div className="sm:text-right">
              <span className="text-[10px] text-amber-200/60 uppercase block">Account ID</span>
              <span className="text-warm-sand/90 font-mono">
                {primaryAccount?.id ? `•••• •••• ${primaryAccount.id.slice(-6)}` : 'Active Wallet'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── QUICK ACTIONS CIRCLE GRID (The GPay / PhonePe Essential) ── */}
      <div>
        <p className="text-xs font-bold text-warm-charcoal/50 dark:text-warm-sand/50 uppercase tracking-widest mb-3.5">
          Everyday Banking & Quick Transfers
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <Link
            to="/send-money"
            className="group p-4 rounded-2xl bg-surface dark:bg-stone-900 border border-warm-sand/40 dark:border-stone-800 hover:border-primary-500/50 hover:shadow-warm transition-all flex flex-col items-center text-center"
          >
            <div className="w-12 h-12 rounded-2xl bg-primary-500/10 text-primary-700 dark:text-primary-300 flex items-center justify-center mb-2.5 group-hover:scale-105 transition-transform">
              <Send className="w-5 h-5 text-primary-600" />
            </div>
            <span className="text-xs font-bold text-warm-charcoal dark:text-warm-sand">Send to Account</span>
            <span className="text-[10px] text-warm-charcoal/50 dark:text-warm-sand/50 mt-0.5">Instant P2P Transfer</span>
          </Link>

          <Link
            to="/pay-merchant"
            className="group p-4 rounded-2xl bg-surface dark:bg-stone-900 border border-warm-sand/40 dark:border-stone-800 hover:border-emerald-500/50 hover:shadow-warm transition-all flex flex-col items-center text-center"
          >
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 flex items-center justify-center mb-2.5 group-hover:scale-105 transition-transform">
              <Store className="w-5 h-5 text-emerald-600" />
            </div>
            <span className="text-xs font-bold text-warm-charcoal dark:text-warm-sand">Pay Merchant</span>
            <span className="text-[10px] text-warm-charcoal/50 dark:text-warm-sand/50 mt-0.5">ShopMart, Dining, etc.</span>
          </Link>

          <Link
            to="/loans"
            className="group p-4 rounded-2xl bg-surface dark:bg-stone-900 border border-warm-sand/40 dark:border-stone-800 hover:border-amber-500/50 hover:shadow-warm transition-all flex flex-col items-center text-center"
          >
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 flex items-center justify-center mb-2.5 group-hover:scale-105 transition-transform">
              <CreditCard className="w-5 h-5 text-amber-600" />
            </div>
            <span className="text-xs font-bold text-warm-charcoal dark:text-warm-sand">Loans & EMIs</span>
            <span className="text-[10px] text-warm-charcoal/50 dark:text-warm-sand/50 mt-0.5">Pay EMI or Prepay</span>
          </Link>

          <Link
            to="/statement"
            className="group p-4 rounded-2xl bg-surface dark:bg-stone-900 border border-warm-sand/40 dark:border-stone-800 hover:border-warm-charcoal/40 hover:shadow-warm transition-all flex flex-col items-center text-center"
          >
            <div className="w-12 h-12 rounded-2xl bg-warm-sand/20 dark:bg-stone-800 text-warm-charcoal dark:text-warm-sand flex items-center justify-center mb-2.5 group-hover:scale-105 transition-transform">
              <FileText className="w-5 h-5 text-warm-charcoal dark:text-warm-sand" />
            </div>
            <span className="text-xs font-bold text-warm-charcoal dark:text-warm-sand">Bank Passbook</span>
            <span className="text-[10px] text-warm-charcoal/50 dark:text-warm-sand/50 mt-0.5">All Transactions & CSV</span>
          </Link>
        </div>
      </div>

      {/* ── ACTIVE LOAN & BORROWING SNAPSHOT (YONO SBI Style) ── */}
      {primaryLoan ? (
        <Card className="border-amber-500/25 bg-amber-500/5 p-6 rounded-3xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                  Active Borrowing
                </span>
                <span className="text-xs font-bold text-warm-charcoal dark:text-warm-sand">
                  Loan #{primaryLoan.id.slice(0, 8)} • {primaryLoan.annual_rate}% APR
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-extrabold text-warm-charcoal dark:text-warm-sand font-mono">
                ₹{parseFloat(primaryLoan.outstanding_principal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                <span className="text-xs font-normal text-warm-charcoal/50 font-sans ml-2">outstanding of ₹{parseFloat(primaryLoan.principal).toLocaleString('en-IN')}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link to={`/loans/${primaryLoan.id}`}>
                <Button size="sm" className="text-xs flex items-center gap-1 shadow-warm">
                  View Schedule & Pay <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </div>
          </div>

          {/* Progress bar */}
          {(() => {
            const principal = parseFloat(primaryLoan.principal);
            const outstanding = parseFloat(primaryLoan.outstanding_principal);
            const paid = Math.max(0, principal - outstanding);
            const pct = Math.min(100, Math.round((paid / principal) * 100));
            return (
              <div className="mt-4 pt-4 border-t border-amber-500/15 space-y-1.5">
                <div className="flex justify-between text-xs text-warm-charcoal/70 dark:text-warm-sand/70">
                  <span>Repayment Progress: {pct}% Completed</span>
                  <span className="font-mono">₹{paid.toFixed(2)} paid</span>
                </div>
                <div className="w-full h-2 rounded-full bg-warm-sand/30 dark:bg-stone-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-emerald-600 rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })()}
        </Card>
      ) : (
        <Card className="p-6 rounded-3xl border-primary-500/20 bg-primary-500/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-primary-700 dark:text-primary-300 font-bold text-xs uppercase tracking-wider">
              <Sparkles className="w-4 h-4 text-primary-600" /> Pre-Approved Education & Personal Loans
            </div>
            <p className="text-sm font-bold text-warm-charcoal dark:text-warm-sand">
              Borrow up to ₹2,00,000 at competitive reducing-balance rates from 8.5% APR.
            </p>
            <p className="text-xs text-warm-charcoal/60 dark:text-warm-sand/60">
              Instant disbursement directly into your PayLedger wallet upon approval.
            </p>
          </div>
          <Link to="/loans/apply">
            <Button size="sm" className="text-xs flex items-center gap-1">
              Apply Now <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </Card>
      )}

      {/* ── TWO COLUMN SECTION: BALANCE TRAJECTORY & PASSBOOK FEED ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Recent Passbook Transactions (PhonePe / GPay Style) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-warm-charcoal dark:text-warm-sand flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary-600" /> Recent Transactions
            </h2>
            <Link to="/statement" className="text-xs font-semibold text-primary-600 hover:text-primary-700 flex items-center gap-0.5">
              View All <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          <Card className="p-0 overflow-hidden rounded-3xl">
            {statementLoading ? (
              <div className="py-12"><Spinner /></div>
            ) : !statement || statement.length === 0 ? (
              <EmptyState
                title="No transactions yet"
                description="Send money or receive payments to see double-entry records here."
                icon={<Clock className="w-6 h-6" />}
              />
            ) : (
              <div className="divide-y divide-warm-sand/30 dark:divide-stone-800">
                {statement.slice(0, 6).map((entry: any) => {
                  const isCredit = entry.direction === 'credit';
                  const dateStr = new Date(entry.created_at).toLocaleString('en-IN', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  // Intuitive category icons
                  const isMerchant = entry.kind === 'payment';
                  const isLoan = entry.kind === 'disbursement' || entry.kind === 'loan_repayment';

                  return (
                    <div
                      key={entry.id}
                      className="p-4 sm:p-5 flex items-center justify-between gap-4 hover:bg-warm-sand/10 dark:hover:bg-stone-800/40 transition-colors"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        {/* Transaction Icon Avatar */}
                        <div
                          className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                            isCredit
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : isMerchant
                              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                              : isLoan
                              ? 'bg-primary-500/10 text-primary-700 dark:text-primary-400'
                              : 'bg-warm-sand/30 dark:bg-stone-800 text-warm-charcoal dark:text-warm-sand'
                          }`}
                        >
                          {isCredit ? (
                            <ArrowDownLeft className="w-5 h-5" />
                          ) : isMerchant ? (
                            <Store className="w-5 h-5" />
                          ) : isLoan ? (
                            <Landmark className="w-5 h-5" />
                          ) : (
                            <ArrowUpRight className="w-5 h-5" />
                          )}
                        </div>

                        {/* Title & Notes */}
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-bold text-warm-charcoal dark:text-warm-sand truncate">
                            {entry.description || (isCredit ? 'Received Funds' : 'Paid Out')}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-warm-charcoal/50 dark:text-warm-sand/50">
                            <span>{dateStr}</span>
                            <span>•</span>
                            <span className="capitalize">{entry.kind?.replace('_', ' ')}</span>
                          </div>
                        </div>
                      </div>

                      {/* Amount & Running Balance */}
                      <div className="text-right flex-shrink-0">
                        <div
                          className={`text-sm sm:text-base font-extrabold font-mono ${
                            isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-warm-charcoal dark:text-warm-sand'
                          }`}
                        >
                          {isCredit ? '+' : '-'}₹{parseFloat(entry.amount).toFixed(2)}
                        </div>
                        {entry.running_balance != null && (
                          <div className="text-[10px] text-warm-charcoal/40 dark:text-warm-sand/40 font-mono mt-0.5">
                            Bal: ₹{parseFloat(entry.running_balance).toFixed(2)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Right 1 Col: Balance Trajectory Area Chart */}
        <div className="space-y-4">
          <h2 className="text-base font-bold text-warm-charcoal dark:text-warm-sand flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary-600" /> Wallet Balance Trend
          </h2>
          <Card className="p-5 rounded-3xl">
            <div className="h-60 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#87532B" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#87532B" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" stroke="#A8988B" fontSize={10} tickLine={false} />
                  <YAxis stroke="#A8988B" fontSize={10} tickLine={false} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#221813',
                      borderColor: '#3D2A1E',
                      borderRadius: '0.875rem',
                      color: '#FAF5EE',
                      fontSize: '11px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="balance"
                    stroke="#87532B"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#balanceGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="text-[11px] text-warm-charcoal/50 dark:text-warm-sand/50 text-center mt-2 border-t border-warm-sand/20 pt-2">
              Calculated from immutable append-only ledger entries
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
};
