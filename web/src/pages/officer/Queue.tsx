import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, CheckCircle, XCircle, AlertCircle, Clock } from 'lucide-react';
import { lendingApi } from '@/api/client';
import { Card, Button, Badge, Modal, Input, Spinner, EmptyState } from '@/components/UI';

export const OfficerQueue: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedApp, setSelectedApp] = useState<any>(null);
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const { data: queue, isLoading } = useQuery({
    queryKey: ['officer_queue'],
    queryFn: async () => (await lendingApi.getOfficerQueue()).data,
  });

  const handleOpenDecision = (app: any, dec: 'approved' | 'rejected') => {
    setSelectedApp(app);
    setDecision(dec);
    setReason(dec === 'approved' ? 'Approved based on credit assessment and KYC' : 'Does not meet current credit underwriting criteria');
    setError('');
  };

  const handleSubmitDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApp) return;

    setLoading(true);
    setError('');
    try {
      await lendingApi.decideLoan(selectedApp.id, {
        decision,
        reason: reason.trim() || undefined,
      });

      setSuccessMsg(`Application ${decision === 'approved' ? 'Approved' : 'Rejected'} successfully!`);
      setSelectedApp(null);
      queryClient.invalidateQueries({ queryKey: ['officer_queue'] });
      queryClient.invalidateQueries({ queryKey: ['loan_portfolio'] });
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to submit decision');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-primary-600" /> Loan Underwriting Queue
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Review customer applications and authorize fund disbursement via sp_decide_loan
        </p>
      </div>

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <Card title={`Pending Applications (${queue?.length || 0})`}>
        {isLoading ? (
          <Spinner />
        ) : !queue || queue.length === 0 ? (
          <EmptyState
            title="Queue is empty"
            description="All submitted customer loan applications have been reviewed."
            icon={<Clock className="w-6 h-6" />}
          />
        ) : (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-800/50">
                  <th className="py-3 px-6">Submission Time</th>
                  <th className="py-3 px-6">Application ID</th>
                  <th className="py-3 px-6">Applicant UUID</th>
                  <th className="py-3 px-6 text-right">Requested Amount</th>
                  <th className="py-3 px-6">Tenure</th>
                  <th className="py-3 px-6">Status</th>
                  <th className="py-3 px-6 text-right">Underwriting Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {queue.map((app: any) => (
                  <tr key={app.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                    <td className="py-3.5 px-6 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(app.created_at).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-6 font-mono text-xs text-gray-400">
                      {app.id.slice(0, 8)}...
                    </td>
                    <td className="py-3.5 px-6 font-mono text-xs text-primary-600 dark:text-primary-400">
                      {app.user_id.slice(0, 8)}...
                    </td>
                    <td className="py-3.5 px-6 text-right font-bold text-gray-900 dark:text-gray-100">
                      ₹{parseFloat(app.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3.5 px-6 text-xs text-gray-600 dark:text-gray-300">
                      {app.tenure_months} months
                    </td>
                    <td className="py-3.5 px-6">
                      <Badge variant="warning">{app.status.toUpperCase()}</Badge>
                    </td>
                    <td className="py-3.5 px-6 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => handleOpenDecision(app, 'approved')}
                          className="flex items-center gap-1 text-xs py-1 px-2.5 bg-emerald-600 hover:bg-emerald-700"
                        >
                          <CheckCircle className="w-3.5 h-3.5" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleOpenDecision(app, 'rejected')}
                          className="flex items-center gap-1 text-xs py-1 px-2.5"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Reject
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Decision Modal */}
      <Modal
        isOpen={!!selectedApp}
        onClose={() => setSelectedApp(null)}
        title={`${decision === 'approved' ? 'Approve' : 'Reject'} Application`}
      >
        {selectedApp && (
          <form onSubmit={handleSubmitDecision} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Applicant:</span>
                <span className="font-mono text-gray-900 dark:text-gray-100">{selectedApp.user_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Principal Requested:</span>
                <span className="font-bold text-gray-900 dark:text-gray-100">
                  ₹{parseFloat(selectedApp.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Tenure:</span>
                <span className="font-semibold text-gray-900 dark:text-gray-100">{selectedApp.tenure_months} months</span>
              </div>
            </div>

            <Input
              label="Underwriter Notes / Decision Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Provide reason for approval or rejection"
              required
            />

            <div className="pt-2 flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setSelectedApp(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={decision === 'approved' ? 'primary' : 'danger'}
                isLoading={loading}
              >
                Confirm {decision === 'approved' ? 'Approval' : 'Rejection'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
