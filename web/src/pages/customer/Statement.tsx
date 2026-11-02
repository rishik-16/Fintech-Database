import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Download, ArrowDownLeft, ArrowUpRight, Search, Filter } from 'lucide-react';
import { walletApi } from '@/api/client';
import { Card, Button, Badge, Spinner, EmptyState, Input } from '@/components/UI';

export const Statement: React.FC = () => {
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const { data: accounts } = useQuery({
    queryKey: ['wallet_accounts'],
    queryFn: async () => (await walletApi.getAccounts()).data,
  });

  const primaryAccount = accounts?.[0];

  const { data: entries, isLoading } = useQuery({
    queryKey: ['account_statement_full', primaryAccount?.id, page, dateFrom, dateTo],
    enabled: !!primaryAccount?.id,
    queryFn: async () => {
      const res = await walletApi.getStatement(primaryAccount.id, {
        page,
        per_page: 25,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      return res.data;
    },
  });

  const filteredEntries = entries?.filter((e: any) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      e.description?.toLowerCase().includes(term) ||
      e.kind?.toLowerCase().includes(term) ||
      e.transaction_id?.toLowerCase().includes(term)
    );
  });

  const handleDownloadCsv = () => {
    if (!primaryAccount?.id) return;
    const csvUrl = walletApi.getStatementCsvUrl(primaryAccount.id, dateFrom, dateTo);
    window.open(csvUrl, '_blank');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary-600" /> Account Statement
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Immutable double-entry journal with running balance window computation
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleDownloadCsv} className="flex items-center gap-2">
          <Download className="w-4 h-4" /> Export CSV
        </Button>
      </div>

      {/* Filter Card */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
          <div className="sm:col-span-2">
            <Input
              label="Search Description / ID"
              placeholder="Search keyword..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div>
            <Input
              label="Date From"
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div>
            <Input
              label="Date To"
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
      </Card>

      {/* Statement Table */}
      <Card>
        {isLoading ? (
          <Spinner />
        ) : !filteredEntries || filteredEntries.length === 0 ? (
          <EmptyState
            title="No statement entries found"
            description="Try adjusting your date filters or search term."
            icon={<FileText className="w-6 h-6" />}
          />
        ) : (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-800/50">
                  <th className="py-3 px-6">Date & Time</th>
                  <th className="py-3 px-6">Transaction ID</th>
                  <th className="py-3 px-6">Kind</th>
                  <th className="py-3 px-6">Description</th>
                  <th className="py-3 px-6">Direction</th>
                  <th className="py-3 px-6 text-right">Amount</th>
                  <th className="py-3 px-6 text-right">Running Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filteredEntries.map((entry: any) => {
                  const isCredit = entry.direction === 'credit';
                  return (
                    <tr key={entry.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="py-3.5 px-6 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-6 font-mono text-xs text-gray-400">
                        {entry.transaction_id?.slice(0, 8)}...
                      </td>
                      <td className="py-3.5 px-6">
                        <span className="font-mono text-xs uppercase px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                          {entry.kind}
                        </span>
                      </td>
                      <td className="py-3.5 px-6 text-gray-900 dark:text-gray-200 font-medium max-w-xs truncate">
                        {entry.description || 'Ledger transfer'}
                      </td>
                      <td className="py-3.5 px-6">
                        <Badge variant={isCredit ? 'success' : 'error'}>
                          {isCredit ? (
                            <span className="flex items-center gap-1">
                              <ArrowDownLeft className="w-3 h-3" /> Credit
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <ArrowUpRight className="w-3 h-3" /> Debit
                            </span>
                          )}
                        </Badge>
                      </td>
                      <td className={`py-3.5 px-6 text-right font-semibold ${isCredit ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {isCredit ? '+' : '-'}₹{parseFloat(entry.amount).toFixed(2)}
                      </td>
                      <td className="py-3.5 px-6 text-right text-gray-900 dark:text-gray-100 font-mono text-xs font-medium">
                        {entry.running_balance ? `₹${parseFloat(entry.running_balance).toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-500">
          <span>Page {page}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!entries || entries.length < 25}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};
