import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Store, CheckCircle2, AlertCircle, ArrowRight, ShieldCheck, HelpCircle } from 'lucide-react';
import { walletApi } from '@/api/client';
import { Card, Button, Input } from '@/components/UI';

export const PayMerchant: React.FC = () => {
  const queryClient = useQueryClient();
  const [merchantAccountId, setMerchantAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<any>(null);

  const { data: accounts } = useQuery({
    queryKey: ['wallet_accounts'],
    queryFn: async () => (await walletApi.getAccounts()).data,
  });

  const { data: merchants } = useQuery({
    queryKey: ['merchants_list'],
    queryFn: async () => (await walletApi.getMerchants()).data,
  });

  const wallet = accounts?.[0];
  const balance = wallet?.balance ? parseFloat(wallet.balance) : 0;
  const parsedAmount = parseFloat(amount) || 0;

  // Selected merchant profile and fee rate
  const selectedMerchant = merchants?.find((m: any) => m.account_id === merchantAccountId.trim());
  const feeRate = selectedMerchant?.fee_rate ?? 0.02; // Default 2%
  const feePercentStr = (feeRate * 100).toFixed(1);

  // Surcharge model calculations:
  // Alice sends base amount to merchant; platform fee is added on top
  const estimatedFee = Math.round(parsedAmount * feeRate * 100) / 100;
  const totalDebit = Math.round((parsedAmount + estimatedFee) * 100) / 100;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setReceipt(null);

    if (parsedAmount <= 0) {
      setError('Please enter an amount greater than 0');
      return;
    }
    if (totalDebit > balance) {
      setError(
        `Insufficient funds. Total charge is ₹${totalDebit.toFixed(2)} (₹${parsedAmount.toFixed(2)} + ₹${estimatedFee.toFixed(2)} platform fee), but your available balance is ₹${balance.toFixed(2)}.`
      );
      return;
    }
    if (!merchantAccountId.trim()) {
      setError('Please select or specify a merchant account UUID');
      return;
    }

    setLoading(true);
    const idempotencyKey = `pay-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    try {
      const res = await walletApi.payMerchant(
        {
          merchant_account_id: merchantAccountId.trim(),
          amount: parsedAmount,
        },
        idempotencyKey
      );

      setReceipt({
        transaction_id: res.data.transaction_id,
        merchant_name: selectedMerchant?.business_name || selectedMerchant?.full_name || 'Verified Merchant',
        merchant_account_id: merchantAccountId.trim(),
        merchant_amount: parsedAmount,
        fee: estimatedFee,
        fee_percent: feePercentStr,
        total_debit: totalDebit,
        timestamp: new Date().toISOString(),
      });

      setAmount('');
      queryClient.invalidateQueries({ queryKey: ['wallet_accounts'] });
      queryClient.invalidateQueries({ queryKey: ['account_statement'] });
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Merchant payment failed. Please check the account ID and balance.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-warm-charcoal dark:text-warm-sand flex items-center gap-2.5 font-display">
          <Store className="w-6 h-6 text-primary-600" />
          Pay Merchant
        </h1>
        <p className="text-sm text-warm-charcoal/60 dark:text-warm-sand/60 mt-0.5">
          Atomic double-entry payment with consumer surcharge fee model (GPay / PhonePe style)
        </p>
      </div>

      {receipt ? (
        <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 text-center p-8">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-300 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-warm-charcoal dark:text-warm-sand">Payment Successful!</h2>
          <div className="text-4xl font-extrabold text-emerald-600 dark:text-emerald-400 my-3 font-mono">
            ₹{receipt.total_debit.toFixed(2)}
          </div>
          <p className="text-xs text-warm-charcoal/70 dark:text-warm-sand/70 mb-6">
            Total debited from your personal wallet
          </p>

          <div className="bg-surface dark:bg-surface-dark rounded-xl p-5 text-left space-y-3 text-xs border border-warm-sand/40 dark:border-stone-700 font-mono mb-6">
            <div className="flex justify-between items-center">
              <span className="text-warm-charcoal/60 dark:text-warm-sand/60">Merchant:</span>
              <span className="text-warm-charcoal dark:text-warm-sand font-bold font-sans">{receipt.merchant_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-warm-charcoal/60 dark:text-warm-sand/60">Transaction ID:</span>
              <span className="text-warm-charcoal dark:text-warm-sand font-semibold">{receipt.transaction_id.slice(0, 20)}...</span>
            </div>
            <div className="h-px bg-warm-sand/30 dark:bg-stone-700 my-1" />
            <div className="flex justify-between">
              <span className="text-warm-charcoal/70 dark:text-warm-sand/70">Merchant Receives (Gross):</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">₹{receipt.merchant_amount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-warm-charcoal/70 dark:text-warm-sand/70">Platform Fee ({receipt.fee_percent}%):</span>
              <span className="text-primary-700 dark:text-primary-300 font-semibold">+₹{receipt.fee.toFixed(2)}</span>
            </div>
            <div className="h-px bg-warm-sand/30 dark:bg-stone-700 my-1" />
            <div className="flex justify-between text-sm font-bold pt-1">
              <span className="text-warm-charcoal dark:text-warm-sand">Total Debited from Customer:</span>
              <span className="text-warm-charcoal dark:text-warm-sand">₹{receipt.total_debit.toFixed(2)}</span>
            </div>
          </div>

          <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg text-emerald-800 dark:text-emerald-200 text-xs text-left mb-6 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600" />
            <span>
              <strong>Double-Entry Invariant Verified:</strong> Total Debits (₹{receipt.total_debit.toFixed(2)}) == Total Credits (₹{receipt.merchant_amount.toFixed(2)} merchant + ₹{receipt.fee.toFixed(2)} system fee).
            </span>
          </div>

          <Button onClick={() => setReceipt(null)} className="w-full">
            Make Another Payment
          </Button>
        </Card>
      ) : (
        <Card title="Merchant Checkout" subtitle={`Current Wallet Balance: ₹${balance.toFixed(2)}`}>
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center gap-3 text-sm text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {merchants && merchants.length > 0 && (
              <div className="p-4 rounded-xl bg-warm-sand/15 dark:bg-stone-800/40 border border-warm-sand/30 dark:border-stone-700">
                <div className="flex items-center justify-between mb-2.5">
                  <p className="text-[11px] font-semibold text-warm-charcoal/60 dark:text-warm-sand/60 uppercase tracking-wider">
                    Select Registered Merchant
                  </p>
                  <span className="text-[11px] text-primary-600 font-medium">Click to select</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {merchants.map((m: any) => {
                    const isSelected = merchantAccountId === m.account_id;
                    return (
                      <button
                        key={m.account_id}
                        type="button"
                        onClick={() => setMerchantAccountId(m.account_id)}
                        className={`p-2.5 rounded-lg text-left text-xs transition-all border ${
                          isSelected
                            ? 'bg-primary-50 dark:bg-primary-950/40 border-primary-500 text-primary-800 dark:text-primary-200 font-semibold shadow-sm'
                            : 'bg-surface dark:bg-stone-800 border-warm-sand/40 dark:border-stone-700 hover:border-primary-400 text-warm-charcoal dark:text-warm-sand'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-medium truncate">{m.business_name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-warm-sand/30 dark:bg-stone-700 text-warm-charcoal/80 dark:text-warm-sand/80">
                            {(m.fee_rate * 100).toFixed(1)}% fee
                          </span>
                        </div>
                        <div className="text-[10px] text-warm-charcoal/50 dark:text-warm-sand/50 truncate font-mono mt-0.5">
                          {m.account_id}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <Input
              label="Merchant Account UUID"
              type="text"
              value={merchantAccountId}
              onChange={(e) => setMerchantAccountId(e.target.value)}
              placeholder="e.g. 65b588e8-64b3-4320-abd2-d57059b1bdc1"
              required
            />

            <Input
              label="Amount to Send Merchant (INR)"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="500.00"
              required
            />

            {parsedAmount > 0 && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs space-y-2">
                <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-200 font-semibold text-xs mb-1">
                  <ShieldCheck className="w-4 h-4 text-primary-600" />
                  <span>Fee Breakdown (Consumer Surcharge Model)</span>
                </div>
                <div className="flex justify-between text-warm-charcoal/70 dark:text-warm-sand/70">
                  <span>Merchant Receives (Full Amount):</span>
                  <span className="font-mono font-medium text-warm-charcoal dark:text-warm-sand">₹{parsedAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-warm-charcoal/70 dark:text-warm-sand/70">
                  <span>Platform Convenience Fee ({feePercentStr}%):</span>
                  <span className="font-mono font-medium text-warm-charcoal dark:text-warm-sand">+₹{estimatedFee.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-warm-charcoal dark:text-warm-sand pt-2 border-t border-amber-500/20 text-sm">
                  <span>Total Debited from Your Wallet:</span>
                  <span className="font-mono text-primary-700 dark:text-primary-300">₹{totalDebit.toFixed(2)}</span>
                </div>
                <p className="text-[11px] text-warm-charcoal/60 dark:text-warm-sand/60 italic mt-1">
                  Like GPay or PhonePe recharges, the merchant receives the exact payment amount (₹{parsedAmount.toFixed(2)}) and the platform fee (+₹{estimatedFee.toFixed(2)}) is charged to your wallet.
                </p>
              </div>
            )}

            <Button type="submit" isLoading={loading} className="w-full mt-4 flex items-center justify-center gap-2">
              Authorize Payment <ArrowRight className="w-4 h-4" />
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
};
