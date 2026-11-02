import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeDollarSign,
  Calendar,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  Landmark,
  ShieldCheck,
  Coins,
  ArrowDownRight,
  Zap,
  Sparkles,
  Check,
} from 'lucide-react';
import { lendingApi, walletApi } from '@/api/client';
import { Card, Button, Badge, Modal, Input, Spinner } from '@/components/UI';

export const LoanDetail: React.FC = () => {
  const { id: loanId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  // EMI Payment State
  const [selectedEmi, setSelectedEmi] = useState<any>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState('');

  // Prepayment / Foreclosure State
  const [isPrepayModalOpen, setIsPrepayModalOpen] = useState(false);
  const [prepayAmount, setPrepayAmount] = useState('');
  const [prepayLoading, setPrepayLoading] = useState(false);
  const [prepayError, setPrepayError] = useState('');

  // Shared Receipt State
  const [receipt, setReceipt] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['loan_detail', loanId],
    enabled: !!loanId,
    queryFn: async () => (await lendingApi.getLoanDetail(loanId!)).data,
  });

  const { data: accounts } = useQuery({
    queryKey: ['wallet_accounts'],
    queryFn: async () => (await walletApi.getAccounts()).data,
  });

  const walletBalance = accounts?.[0]?.balance ? parseFloat(accounts[0].balance) : 0;
  const loan = data?.loan;
  const schedule = data?.emi_schedule;

  const handleOpenPayModal = (emi: any) => {
    setSelectedEmi(emi);
    const dueRemaining = parseFloat(emi.total_due) - parseFloat(emi.paid_amount || '0');
    setPayAmount(dueRemaining.toFixed(2));
    setPayError('');
  };

  const handlePayEmi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loanId || !selectedEmi) return;

    const amt = parseFloat(payAmount);
    if (isNaN(amt) || amt <= 0) {
      setPayError('Please enter a valid amount');
      return;
    }
    if (amt > walletBalance) {
      setPayError(`Insufficient funds in wallet (Available: ₹${walletBalance.toFixed(2)})`);
      return;
    }

    setPayLoading(true);
    setPayError('');
    const idempotencyKey = `emi-pay-${selectedEmi.id}-${Date.now()}`;

    try {
      await lendingApi.payEmi(loanId, { emi_id: selectedEmi.id, amount: amt }, idempotencyKey);

      const pComp = parseFloat(selectedEmi.principal_component);
      const pPortion = Math.min(amt, pComp);
      const iPortion = Math.max(0, amt - pPortion);
      const newOutstanding = Math.max(0, parseFloat(loan.outstanding_principal) - pPortion);

      setReceipt({
        is_prepayment: false,
        installment_no: selectedEmi.installment_no,
        amount: amt,
        principal_portion: pPortion,
        interest_portion: iPortion,
        new_outstanding: newOutstanding,
      });

      setSelectedEmi(null);
      queryClient.invalidateQueries({ queryKey: ['loan_detail', loanId] });
      queryClient.invalidateQueries({ queryKey: ['wallet_accounts'] });
      queryClient.invalidateQueries({ queryKey: ['my_loans'] });
    } catch (err: any) {
      setPayError(err.response?.data?.detail || 'Payment failed');
    } finally {
      setPayLoading(false);
    }
  };

  const handleOpenPrepayModal = (defaultAmt?: string) => {
    setPrepayAmount(defaultAmt || '');
    setPrepayError('');
    setIsPrepayModalOpen(true);
  };

  const handlePrepayLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loanId || !loan) return;

    const amt = parseFloat(prepayAmount);
    const outstanding = parseFloat(loan.outstanding_principal);

    if (isNaN(amt) || amt <= 0) {
      setPrepayError('Please enter a positive prepayment amount.');
      return;
    }
    if (amt > outstanding) {
      setPrepayError(
        `Prepayment amount (₹${amt.toFixed(2)}) cannot exceed outstanding principal of ₹${outstanding.toFixed(2)}.`
      );
      return;
    }
    if (amt > walletBalance) {
      setPrepayError(`Insufficient funds in wallet (Available: ₹${walletBalance.toFixed(2)}).`);
      return;
    }

    setPrepayLoading(true);
    setPrepayError('');
    const idempotencyKey = `prepay-${loanId}-${Date.now()}`;

    try {
      await lendingApi.prepayLoan(loanId, { amount: amt }, idempotencyKey);
      const isFullPayoff = amt >= outstanding;
      const newOutstanding = Math.max(0, outstanding - amt);

      setReceipt({
        is_prepayment: true,
        is_full_payoff: isFullPayoff,
        amount: amt,
        principal_portion: amt,
        interest_portion: 0,
        new_outstanding: newOutstanding,
      });

      setIsPrepayModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['loan_detail', loanId] });
      queryClient.invalidateQueries({ queryKey: ['wallet_accounts'] });
      queryClient.invalidateQueries({ queryKey: ['my_loans'] });
    } catch (err: any) {
      setPrepayError(err.response?.data?.detail || 'Prepayment processing failed.');
    } finally {
      setPrepayLoading(false);
    }
  };

  if (isLoading) return <Spinner />;
  if (!loan) return <div className="text-center py-12 text-warm-charcoal/50">Loan not found.</div>;

  const outstandingVal = parseFloat(loan.outstanding_principal);
  const statusVariant = (st: string): 'neutral' | 'info' | 'success' | 'warning' | 'error' => {
    switch (st) {
      case 'paid':
        return 'success';
      case 'overdue':
        return 'error';
      case 'partially_paid':
        return 'warning';
      default:
        return 'neutral';
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Top Breadcrumb & Header */}
      <div>
        <Link
          to="/loans"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Loans
        </Link>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-warm-charcoal dark:text-warm-sand flex items-center gap-2 font-display">
              <BadgeDollarSign className="w-6 h-6 text-emerald-600" />
              Loan #{loan.id.slice(0, 8)}
            </h1>
            <p className="text-sm text-warm-charcoal/60 dark:text-warm-sand/60 mt-0.5">
              Reducing-balance amortisation schedule with custom prepayment and early foreclosure options
            </p>
          </div>
          <div className="flex items-center gap-3">
            {loan.status === 'active' && outstandingVal > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOpenPrepayModal()}
                className="flex items-center gap-1.5 border-primary-500/40 text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-950/40 text-xs font-semibold"
              >
                <Zap className="w-4 h-4 text-primary-600" /> Prepay / Foreclose Loan
              </Button>
            )}
            <Badge variant={loan.status === 'active' ? 'success' : 'neutral'} className="text-sm px-3 py-1 font-mono">
              STATUS: {loan.status.toUpperCase()}
            </Badge>
          </div>
        </div>
      </div>

      {/* Success Receipt Banner */}
      {receipt && (
        <Card className="border-emerald-300 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold text-warm-charcoal dark:text-warm-sand flex items-center gap-2">
                    {receipt.is_prepayment
                      ? receipt.is_full_payoff
                        ? '🎉 Full Loan Foreclosure Complete!'
                        : 'Custom Principal Prepayment Processed!'
                      : `Installment #${receipt.installment_no} Repayment Successful!`}
                  </h3>
                  <p className="text-xs text-warm-charcoal/60 dark:text-warm-sand/60">
                    Total ₹{receipt.amount.toFixed(2)} debited from your personal wallet and credited to bank treasury reserves.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setReceipt(null)}>
                  Dismiss
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs font-mono">
                <div className="p-3 bg-surface dark:bg-surface-dark rounded-lg border border-warm-sand/40 dark:border-stone-700">
                  <span className="text-warm-charcoal/60 dark:text-warm-sand/60 block text-[11px]">
                    Credited to Bank Lending Pool
                  </span>
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    +₹{receipt.principal_portion.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-warm-charcoal/50 block mt-0.5">
                    Principal recovery (account: loan_pool)
                  </span>
                </div>
                <div className="p-3 bg-surface dark:bg-surface-dark rounded-lg border border-warm-sand/40 dark:border-stone-700">
                  <span className="text-warm-charcoal/60 dark:text-warm-sand/60 block text-[11px]">
                    Credited to Bank Revenue
                  </span>
                  <span className="text-sm font-bold text-primary-700 dark:text-primary-300">
                    +₹{receipt.interest_portion.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-warm-charcoal/50 block mt-0.5">
                    Interest earnings (account: system_fee)
                  </span>
                </div>
                <div className="p-3 bg-surface dark:bg-surface-dark rounded-lg border border-warm-sand/40 dark:border-stone-700">
                  <span className="text-warm-charcoal/60 dark:text-warm-sand/60 block text-[11px]">
                    New Outstanding Principal
                  </span>
                  <span className="text-sm font-bold text-warm-charcoal dark:text-warm-sand">
                    ₹{receipt.new_outstanding.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-warm-charcoal/50 block mt-0.5">
                    {receipt.is_full_payoff ? 'Loan fully settled & closed!' : `Reduced by ₹${receipt.principal_portion.toFixed(2)}`}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Loan Summary Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <span className="text-xs text-warm-charcoal/50 dark:text-warm-sand/50 uppercase font-bold tracking-wider">
            Original Principal
          </span>
          <div className="text-xl font-bold mt-1 text-warm-charcoal dark:text-warm-sand font-mono">
            ₹{parseFloat(loan.principal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        </Card>
        <Card className="p-4">
          <span className="text-xs text-warm-charcoal/50 dark:text-warm-sand/50 uppercase font-bold tracking-wider">
            Outstanding Principal
          </span>
          <div className="text-xl font-bold mt-1 text-emerald-600 dark:text-emerald-400 font-mono">
            ₹{outstandingVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        </Card>
        <Card className="p-4">
          <span className="text-xs text-warm-charcoal/50 dark:text-warm-sand/50 uppercase font-bold tracking-wider">
            Annual Rate (APR)
          </span>
          <div className="text-xl font-bold mt-1 text-warm-charcoal dark:text-warm-sand font-mono">
            {loan.annual_rate}%
          </div>
        </Card>
        <Card className="p-4">
          <span className="text-xs text-warm-charcoal/50 dark:text-warm-sand/50 uppercase font-bold tracking-wider">
            Tenure Months
          </span>
          <div className="text-xl font-bold mt-1 text-warm-charcoal dark:text-warm-sand font-mono">
            {loan.tenure_months} mos
          </div>
        </Card>
      </div>

      {/* Early Prepayment & Foreclosure Action Banner */}
      {loan.status === 'active' && outstandingVal > 0 && (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-primary-500/10 via-amber-500/10 to-emerald-500/10 border border-primary-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary-600" />
              <h3 className="font-bold text-sm text-warm-charcoal dark:text-warm-sand">
                Have Spare Funds? Prepay Principal or Foreclose Early
              </h3>
            </div>
            <p className="text-xs text-warm-charcoal/70 dark:text-warm-sand/70 max-w-2xl leading-relaxed">
              You can make a custom principal prepayment at any time outside your scheduled EMI date, or pay off the entire remaining principal (₹{outstandingVal.toFixed(2)}) in one click with zero foreclosure penalties.
            </p>
          </div>
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleOpenPrepayModal('5000.00')}
              className="text-xs"
            >
              Prepay ₹5,000
            </Button>
            <Button
              size="sm"
              onClick={() => handleOpenPrepayModal(outstandingVal.toFixed(2))}
              className="text-xs flex items-center gap-1.5"
            >
              <Zap className="w-3.5 h-3.5" /> Foreclose (₹{outstandingVal.toFixed(2)})
            </Button>
          </div>
        </div>
      )}

      {/* Bank Destination Transparency Guide */}
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs space-y-2">
        <div className="flex items-center gap-2 font-bold text-warm-charcoal dark:text-warm-sand">
          <Landmark className="w-4 h-4 text-primary-600" />
          <span>Where does your loan EMI payment go in the bank?</span>
        </div>
        <p className="text-warm-charcoal/70 dark:text-warm-sand/70 leading-relaxed">
          In PayLedger's double-entry banking core, each EMI payment is atomically split between two internal bank accounts:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div className="p-3 rounded-lg bg-surface dark:bg-stone-800 border border-warm-sand/30 dark:border-stone-700">
            <div className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
              <Coins className="w-3.5 h-3.5" /> 1. Principal Component (Capital Recovery)
            </div>
            <div className="text-[11px] text-warm-charcoal/60 dark:text-warm-sand/60 mt-1">
              Credited directly to the <strong>Bank Lending Pool (`loan_pool`)</strong>. This returns capital to bank reserves and directly lowers your outstanding loan principal.
            </div>
          </div>
          <div className="p-3 rounded-lg bg-surface dark:bg-stone-800 border border-warm-sand/30 dark:border-stone-700">
            <div className="font-semibold text-primary-700 dark:text-primary-300 flex items-center gap-1.5">
              <Landmark className="w-3.5 h-3.5" /> 2. Interest Component (Bank Profit)
            </div>
            <div className="text-[11px] text-warm-charcoal/60 dark:text-warm-sand/60 mt-1">
              Credited to the <strong>Bank System Fee Account (`system_fee`)</strong> as earned interest income / platform operating revenue.
            </div>
          </div>
        </div>
      </div>

      {/* EMI Schedule Table */}
      <Card
        title="Amortisation Schedule"
        subtitle="Individual monthly installments generated by sp_generate_emi_schedule"
      >
        <div className="overflow-x-auto -mx-6">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-warm-sand/40 dark:border-stone-700 text-xs font-semibold text-warm-charcoal/60 dark:text-warm-sand/60 bg-warm-sand/10 dark:bg-stone-800/50">
                <th className="py-3 px-6">#</th>
                <th className="py-3 px-6">Due Date</th>
                <th className="py-3 px-6 text-right">Principal</th>
                <th className="py-3 px-6 text-right">Interest</th>
                <th className="py-3 px-6 text-right">Total Due</th>
                <th className="py-3 px-6 text-right">Paid Amount</th>
                <th className="py-3 px-6">Status</th>
                <th className="py-3 px-6 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-warm-sand/20 dark:divide-stone-800 text-xs">
              {schedule?.map((emi: any) => {
                const isPaid = emi.status === 'paid';
                return (
                  <tr key={emi.id} className="hover:bg-warm-sand/10 dark:hover:bg-stone-800/30 transition-colors">
                    <td className="py-3.5 px-6 font-mono text-xs text-warm-charcoal/50 font-bold">
                      {emi.installment_no}
                    </td>
                    <td className="py-3.5 px-6 text-xs text-warm-charcoal/80 dark:text-warm-sand/80 font-medium">
                      {emi.due_date}
                    </td>
                    <td className="py-3.5 px-6 text-right font-mono text-xs text-warm-charcoal/70 dark:text-warm-sand/70">
                      ₹{parseFloat(emi.principal_component).toFixed(2)}
                    </td>
                    <td className="py-3.5 px-6 text-right font-mono text-xs text-amber-600 dark:text-amber-400">
                      ₹{parseFloat(emi.interest_component).toFixed(2)}
                    </td>
                    <td className="py-3.5 px-6 text-right font-semibold font-mono text-warm-charcoal dark:text-warm-sand">
                      ₹{parseFloat(emi.total_due).toFixed(2)}
                    </td>
                    <td className="py-3.5 px-6 text-right font-mono text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      ₹{parseFloat(emi.paid_amount || '0').toFixed(2)}
                    </td>
                    <td className="py-3.5 px-6">
                      <Badge variant={statusVariant(emi.status)}>
                        {emi.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-6 text-right">
                      {!isPaid && loan.status === 'active' && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleOpenPayModal(emi)}
                          className="text-xs py-1 px-3"
                        >
                          Pay EMI
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pay Scheduled EMI Modal */}
      <Modal
        isOpen={!!selectedEmi}
        onClose={() => setSelectedEmi(null)}
        title={`Pay EMI Installment #${selectedEmi?.installment_no}`}
      >
        {selectedEmi && (
          <form onSubmit={handlePayEmi} className="space-y-4">
            {payError && (
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{payError}</span>
              </div>
            )}

            <div className="p-3.5 rounded-xl bg-warm-sand/15 dark:bg-stone-800/60 border border-warm-sand/30 dark:border-stone-700 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-warm-charcoal/60 dark:text-warm-sand/60">Total Installment Due:</span>
                <span className="font-bold text-warm-charcoal dark:text-warm-sand font-mono">
                  ₹{parseFloat(selectedEmi.total_due).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-[11px] text-warm-charcoal/50 dark:text-warm-sand/50">
                <span>└ Principal (returns to bank loan pool):</span>
                <span className="font-mono">₹{parseFloat(selectedEmi.principal_component).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-warm-charcoal/50 dark:text-warm-sand/50">
                <span>└ Interest (bank revenue):</span>
                <span className="font-mono">₹{parseFloat(selectedEmi.interest_component).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-primary-600 dark:text-primary-400 font-semibold pt-1.5 border-t border-warm-sand/30 dark:border-stone-700">
                <span>Your Available Wallet Balance:</span>
                <span className="font-mono">₹{walletBalance.toFixed(2)}</span>
              </div>
            </div>

            <Input
              label="Amount to Pay (INR)"
              type="number"
              step="0.01"
              min="0.01"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              required
            />

            <div className="pt-2 flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setSelectedEmi(null)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={payLoading}>
                Confirm & Pay EMI
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Custom Prepayment & Foreclosure Modal */}
      <Modal
        isOpen={isPrepayModalOpen}
        onClose={() => setIsPrepayModalOpen(false)}
        title="Custom Loan Prepayment & Foreclosure"
      >
        <form onSubmit={handlePrepayLoan} className="space-y-4">
          {prepayError && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{prepayError}</span>
            </div>
          )}

          <div className="p-3.5 rounded-xl bg-warm-sand/15 dark:bg-stone-800/60 border border-warm-sand/30 dark:border-stone-700 text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-warm-charcoal/60 dark:text-warm-sand/60">Current Outstanding Principal:</span>
              <span className="font-bold text-warm-charcoal dark:text-warm-sand font-mono">
                ₹{outstandingVal.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-primary-600 dark:text-primary-400 font-semibold pt-1 border-t border-warm-sand/30 dark:border-stone-700">
              <span>Your Available Wallet Balance:</span>
              <span className="font-mono">₹{walletBalance.toFixed(2)}</span>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-xs font-semibold text-warm-charcoal/80 dark:text-warm-sand/80 block">
              Quick Prepayment Actions:
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPrepayAmount('5000.00')}
                className="px-2.5 py-1 text-xs rounded-lg border border-warm-sand/50 dark:border-stone-600 hover:border-primary-500 bg-surface dark:bg-stone-800 text-warm-charcoal dark:text-warm-sand font-mono"
              >
                +₹5,000
              </button>
              <button
                type="button"
                onClick={() => setPrepayAmount('10000.00')}
                className="px-2.5 py-1 text-xs rounded-lg border border-warm-sand/50 dark:border-stone-600 hover:border-primary-500 bg-surface dark:bg-stone-800 text-warm-charcoal dark:text-warm-sand font-mono"
              >
                +₹10,000
              </button>
              <button
                type="button"
                onClick={() => setPrepayAmount(outstandingVal.toFixed(2))}
                className="px-2.5 py-1 text-xs rounded-lg border border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 font-semibold font-mono"
              >
                Full Foreclosure (₹{outstandingVal.toFixed(2)})
              </button>
            </div>
          </div>

          <Input
            label="Prepayment Amount (INR)"
            type="number"
            step="0.01"
            min="0.01"
            max={outstandingVal}
            value={prepayAmount}
            onChange={(e) => setPrepayAmount(e.target.value)}
            placeholder="e.g. 5000.00"
            required
          />

          <div className="p-3 bg-primary-500/10 rounded-lg text-[11px] text-warm-charcoal/80 dark:text-warm-sand/80 leading-relaxed border border-primary-500/20">
            <ShieldCheck className="w-4 h-4 text-primary-600 inline mr-1 -mt-0.5" />
            <strong>100% Principal Reduction:</strong> Every rupee prepaid goes directly towards reducing your outstanding principal balance and returns capital into the Bank Lending Pool (`loan_pool`). If you pay the full outstanding balance, your loan will be closed immediately.
          </div>

          <div className="pt-2 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => setIsPrepayModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={prepayLoading} className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" /> Confirm Prepayment
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
