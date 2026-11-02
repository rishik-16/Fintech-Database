import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BadgeDollarSign, Plus, ArrowRight, Calendar, AlertCircle } from 'lucide-react';
import { lendingApi } from '@/api/client';
import { Card, Button, Badge, Spinner, EmptyState } from '@/components/UI';

export const Loans: React.FC = () => {
  const { data: loans, isLoading: loansLoading } = useQuery({
    queryKey: ['my_loans'],
    queryFn: async () => (await lendingApi.getMyLoans()).data,
  });

  const { data: applications, isLoading: appsLoading } = useQuery({
    queryKey: ['my_applications'],
    queryFn: async () => (await lendingApi.getMyApplications()).data,
  });

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2.5">
            <BadgeDollarSign className="w-6 h-6 text-emerald-600" />
            Lending & Amortisation
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Reducing-balance EMI amortisation with automated repayment tracking
          </p>
        </div>
        <Link to="/loans/apply">
          <Button size="sm" className="flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Apply for Loan
          </Button>
        </Link>
      </div>

      {/* Active Loans Section */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Active & Historic Loans</h2>
        {loansLoading ? (
          <Spinner />
        ) : !loans || loans.length === 0 ? (
          <Card>
            <EmptyState
              title="No loans found"
              description="You do not have any active loans. Check our competitive products and apply online."
              action={
                <Link to="/loans/apply">
                  <Button size="sm">Apply Now</Button>
                </Link>
              }
              icon={<BadgeDollarSign className="w-6 h-6" />}
            />
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {loans.map((loan: any) => {
              const outstanding = parseFloat(loan.outstanding_principal);
              const principal = parseFloat(loan.principal);
              const isClosed = loan.status === 'closed';

              return (
                <Card key={loan.id} className="relative overflow-hidden hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between mb-3">
                    <span className="font-mono text-xs text-gray-400">Loan #{loan.id.slice(0, 8)}</span>
                    <Badge variant={isClosed ? 'neutral' : loan.status === 'active' ? 'success' : 'error'}>
                      {loan.status.toUpperCase()}
                    </Badge>
                  </div>

                  <div className="flex items-baseline justify-between mb-4">
                    <div>
                      <span className="text-xs text-gray-400">Outstanding Principal</span>
                      <div className="text-2xl font-extrabold text-gray-900 dark:text-gray-100">
                        ₹{outstanding.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-gray-400">Original Principal</span>
                      <div className="text-sm font-semibold text-gray-600 dark:text-gray-300">
                        ₹{principal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs py-2 border-t border-gray-100 dark:border-gray-700 text-gray-600 dark:text-gray-300">
                    <div>
                      <span className="text-gray-400">Annual Rate:</span>{' '}
                      <span className="font-semibold">{loan.annual_rate}%</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Tenure:</span>{' '}
                      <span className="font-semibold">{loan.tenure_months} months</span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
                    <Link to={`/loans/${loan.id}`}>
                      <Button variant="outline" size="sm" className="flex items-center gap-1">
                        View Schedule & Pay EMI <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Submitted Applications Queue */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Submitted Applications</h2>
        <Card>
          {appsLoading ? (
            <Spinner />
          ) : !applications || applications.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No recent loan applications</p>
          ) : (
            <div className="overflow-x-auto -mx-6">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-800/50">
                    <th className="py-3 px-6">Submitted Date</th>
                    <th className="py-3 px-6">Application ID</th>
                    <th className="py-3 px-6">Requested Amount</th>
                    <th className="py-3 px-6">Tenure</th>
                    <th className="py-3 px-6">Status</th>
                    <th className="py-3 px-6">Notes / Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {applications.map((app: any) => {
                    const statusStyles: Record<string, 'neutral' | 'info' | 'success' | 'error'> = {
                      submitted: 'info',
                      under_review: 'neutral',
                      approved: 'success',
                      disbursed: 'success',
                      rejected: 'error',
                    };
                    return (
                      <tr key={app.id}>
                        <td className="py-3 px-6 text-xs text-gray-500 whitespace-nowrap">
                          {new Date(app.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-6 font-mono text-xs text-gray-400">
                          {app.id.slice(0, 8)}...
                        </td>
                        <td className="py-3 px-6 font-semibold">
                          ₹{parseFloat(app.amount).toFixed(2)}
                        </td>
                        <td className="py-3 px-6 text-xs text-gray-600 dark:text-gray-300">
                          {app.tenure_months} mos
                        </td>
                        <td className="py-3 px-6">
                          <Badge variant={statusStyles[app.status] || 'neutral'}>
                            {app.status.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="py-3 px-6 text-xs text-gray-500 max-w-xs truncate">
                          {app.reason || 'Pending underwriter review'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};
