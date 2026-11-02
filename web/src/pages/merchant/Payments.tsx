import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Store, RotateCcw, AlertCircle, CheckCircle2, ArrowDownLeft } from 'lucide-react';
import { walletApi } from '@/api/client';
import { Card, Button, Badge, Modal, Input, Spinner, EmptyState } from '@/components/UI';

export const MerchantPayments: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedTxn, setSelectedTxn] = useState<any>(null);
  const [refundAmount, setRefundAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const { data: accounts, isLoading: accountsLoading } = useQuery({
    queryKey: ['wallet_accounts'],
    queryFn: async () => (await walletApi.getAccounts()).data,
  });

  const merchantAccount = accounts?.[0];

  const { data: entries, isLoading: entriesLoading } = useQuery({
    queryKey: ['merchant_payments', merchantAccount?.id],
    enabled: !!merchantAccount?.id,
    queryFn: async () => {
      const res = await walletApi.getStatement(merchantAccount.id, { per_page: 50 });
      return res.data;
    },
  });

  const handleOpenRefund = (txn: any) => {
    setSelectedTxn(txn);
    setRefundAmount(parseFloat(txn.amount).toFixed(2));
    setError('');
    setSuccessMsg('');
  };

  const handleRefundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTxn) return;

    const amt = parseFloat(refundAmount);
    if (isNaN(amt) || amt <= 0 || amt > parseFloat(selectedTxn.amount)) {
      setError(`Refund amount must be between 0.01 and ₹${parseFloat(selectedTxn.amount).toFixed(2)}`);
      return;
    }

    setLoading(true);
    setError('');
    const idempotencyKey = `refund-${selectedTxn.transaction_id}-${Date.now()}`;

    try {
      await walletApi.refund(
        {
          original_transaction_id: selectedTxn.transaction_id,
          amount: amt,
        },
        idempotencyKey
      );

      setSuccessMsg(`Refund of ₹${amt.toFixed(2)} processed successfully`);
      setSelectedTxn(null);
      queryClient.invalidateQueries({ queryKey: ['merchant_payments'] });
      queryClient.invalidateQueries({ queryKey: ['wallet_accounts'] });
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Refund failed');
    } finally {
      setLoading(false);
    }
  };

  if (accountsLoading) return <Spinner />;

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Store className="w-6 h-6 text-indigo-600" /> Merchant Payments & Refunds
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Incoming customer transactions with partial/full refund capabilities via sp_refund
          </p>
        </div>
        <div className="text-right">
          <span className="text-xs text-gray-400">Merchant Balance</span>
          <div className="text-xl font-bold text-gray-900 dark:text-gray-100">
            ₹{parseFloat(merchantAccount?.balance || '0').toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <Card title="Incoming Customer Transactions">
        {entriesLoading ? (
          <Spinner />
        ) : !entries || entries.length === 0 ? (
          <EmptyState
            title="No incoming payments yet"
            description="When customers pay you via Pay Merchant, transactions will appear here."
            icon={<Store className="w-6 h-6" />}
          />
        ) : (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-800/50">
                  <th className="py-3 px-6">Timestamp</th>
                  <th className="py-3 px-6">Transaction ID</th>
                  <th className="py-3 px-6">Kind</th>
                  <th className="py-3 px-6">Description</th>
                  <th className="py-3 px-6 text-right">Net Amount</th>
                  <th className="py-3 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {entries.map((entry: any) => {
                  const isCredit = entry.direction === 'credit';
                  return (
                    <tr key={entry.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                      <td className="py-3.5 px-6 text-xs text-gray-500 whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-6 font-mono text-xs text-gray-400">
                        {entry.transaction_id?.slice(0, 8)}...
                      </td>
                      <td className="py-3.5 px-6">
                        <Badge variant={entry.kind === 'refund' ? 'warning' : 'info'}>
                          {entry.kind.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-6 text-gray-900 dark:text-gray-200 font-medium">
                        {entry.description || 'Customer purchase'}
                      </td>
                      <td className={`py-3.5 px-6 text-right font-semibold ${isCredit ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {isCredit ? '+' : '-'}₹{parseFloat(entry.amount).toFixed(2)}
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        {isCredit && entry.kind === 'payment' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenRefund(entry)}
                            className="flex items-center gap-1.5 text-xs py-1"
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-rose-500" /> Refund
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Refund Modal */}
      <Modal
        isOpen={!!selectedTxn}
        onClose={() => setSelectedTxn(null)}
        title="Issue Refund to Customer"
      >
        {selectedTxn && (
          <form onSubmit={handleRefundSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Original Transaction:</span>
                <span className="font-mono text-gray-900 dark:text-gray-100">{selectedTxn.transaction_id.slice(0, 16)}...</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Original Received:</span>
                <span className="font-bold text-gray-900 dark:text-gray-100">₹{parseFloat(selectedTxn.amount).toFixed(2)}</span>
              </div>
            </div>

            <Input
              label="Refund Amount (INR)"
              type="number"
              step="0.01"
              min="0.01"
              max={parseFloat(selectedTxn.amount)}
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              helper="Supports partial or full refund up to original received amount"
              required
            />

            <div className="pt-2 flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setSelectedTxn(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" isLoading={loading}>
                Confirm & Refund
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
