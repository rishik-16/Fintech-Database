import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, CheckCircle2, AlertCircle, Copy, Check, ArrowRight } from 'lucide-react';
import { walletApi, adminApi } from '@/api/client';
import { Card, Button, Input, Badge, Spinner } from '@/components/UI';

export const SendMoney: React.FC = () => {
  const queryClient = useQueryClient();
  const [recipientAccountId, setRecipientAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  // Fetch current user's wallet
  const { data: accounts } = useQuery({
    queryKey: ['wallet_accounts'],
    queryFn: async () => (await walletApi.getAccounts()).data,
  });

  // Fetch demo accounts for easy quick-fill testing
  const { data: demoUsers } = useQuery({
    queryKey: ['demo_users_quickpick'],
    queryFn: async () => (await adminApi.getUsers({ per_page: 10, role: 'customer' })).data,
  });

  const wallet = accounts?.[0];
  const balance = wallet?.balance ? parseFloat(wallet.balance) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setReceipt(null);

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid amount greater than 0');
      return;
    }
    if (parsedAmount > balance) {
      setError(`Insufficient funds. Your wallet balance is ₹${balance.toFixed(2)}`);
      return;
    }
    if (!recipientAccountId.trim()) {
      setError('Recipient account ID is required');
      return;
    }

    setLoading(true);
    // Generate fresh idempotency key
    const idempotencyKey = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    try {
      const res = await walletApi.transfer(
        {
          to_account_id: recipientAccountId.trim(),
          amount: parsedAmount,
          description: description.trim() || 'Peer-to-peer transfer',
        },
        idempotencyKey
      );

      setReceipt({
        transaction_id: res.data.transaction_id,
        amount: parsedAmount,
        recipient: recipientAccountId.trim(),
        description: description.trim() || 'Peer-to-peer transfer',
        idempotency_key: idempotencyKey,
        timestamp: new Date().toISOString(),
      });

      // Clear form & refresh wallet balances
      setAmount('');
      setDescription('');
      queryClient.invalidateQueries({ queryKey: ['wallet_accounts'] });
      queryClient.invalidateQueries({ queryKey: ['account_statement'] });
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Transfer failed. Check recipient ID and try again.');
    } finally {
      setLoading(false);
    }
  };

  const copyTxnId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2.5">
          <ArrowRightLeft className="w-6 h-6 text-primary-600" />
          Send Money
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Atomic double-entry transfer with deadlock avoidance & non-negative invariant checks
        </p>
      </div>

      {receipt ? (
        /* Success Receipt Card */
        <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/20 text-center p-8">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-300 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Transfer Successful!</h2>
          <div className="text-4xl font-extrabold text-emerald-600 dark:text-emerald-400 my-4">
            ₹{receipt.amount.toFixed(2)}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto mb-6">
            Ledger entries written and running balances atomically updated in PostgreSQL.
          </p>

          <div className="bg-white dark:bg-gray-800 rounded-xl p-4 text-left space-y-2.5 text-xs border border-gray-200 dark:border-gray-700 font-mono mb-6">
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Transaction UUID:</span>
              <div className="flex items-center gap-1.5 font-semibold text-gray-900 dark:text-gray-100">
                <span>{receipt.transaction_id.slice(0, 16)}...</span>
                <button
                  type="button"
                  onClick={() => copyTxnId(receipt.transaction_id)}
                  className="p-1 hover:text-indigo-600"
                  title="Copy UUID"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Recipient Account:</span>
              <span className="text-gray-900 dark:text-gray-100 font-semibold">{receipt.recipient.slice(0, 16)}...</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Idempotency Key:</span>
              <span className="text-gray-500">{receipt.idempotency_key}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Time:</span>
              <span className="text-gray-500">{new Date(receipt.timestamp).toLocaleTimeString()}</span>
            </div>
          </div>

          <Button onClick={() => setReceipt(null)} className="w-full">
            Make Another Transfer
          </Button>
        </Card>
      ) : (
        /* Transfer Form */
        <Card title="Transfer Details" subtitle={`Available Balance: ₹${balance.toFixed(2)}`}>
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center gap-3 text-sm text-rose-700 dark:text-rose-300">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <Input
              label="Recipient Account UUID"
              type="text"
              value={recipientAccountId}
              onChange={(e) => setRecipientAccountId(e.target.value)}
              placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
              helper="The destination wallet account ID in PayLedger"
              required
            />

            {/* Quick-Pick Recipients */}
            {demoUsers && demoUsers.length > 0 && (
              <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Demo Quick-Pick Customer ID
                </p>
                <div className="flex flex-wrap gap-2">
                  {demoUsers.slice(0, 4).map((u: any) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setRecipientAccountId(u.id)}
                      className="px-2.5 py-1 rounded-md text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 hover:border-indigo-500 text-gray-700 dark:text-gray-200"
                    >
                      {u.full_name} ({u.email})
                    </button>
                  ))}
                </div>
              </div>
            )}

            <Input
              label="Amount (INR)"
              type="number"
              step="0.01"
              min="0.01"
              max={balance}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              helper={`Max transferable: ₹${balance.toFixed(2)}`}
              required
            />

            <Input
              label="Transfer Note / Purpose"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Dinner split, rent, gift..."
            />

            <Button type="submit" isLoading={loading} className="w-full mt-4 flex items-center justify-center gap-2">
              Confirm & Transfer <ArrowRight className="w-4 h-4" />
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
};
