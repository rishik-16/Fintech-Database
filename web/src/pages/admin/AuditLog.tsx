import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText, ChevronDown, ChevronRight, Eye, ShieldAlert } from 'lucide-react';
import { adminApi } from '@/api/client';
import { Card, Button, Badge, Spinner, Input } from '@/components/UI';

export const AdminAuditLog: React.FC = () => {
  const [page, setPage] = useState(1);
  const [entityFilter, setEntityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: logs, isLoading } = useQuery({
    queryKey: ['audit_log', page, entityFilter, actionFilter],
    queryFn: async () => {
      const res = await adminApi.getAuditLog({
        page,
        per_page: 30,
        entity: entityFilter || undefined,
        action: actionFilter || undefined,
      });
      return res.data;
    },
  });

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const actionVariant = (act: string): 'success' | 'warning' | 'error' | 'neutral' => {
    switch (act) {
      case 'INSERT':
        return 'success';
      case 'UPDATE':
        return 'warning';
      case 'DELETE':
        return 'error';
      default:
        return 'neutral';
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <ScrollText className="w-6 h-6 text-indigo-600" /> System Audit Trail
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Immutable audit log captured automatically by database triggers (payledger.audit_log)
        </p>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Entity Table</label>
            <select
              value={entityFilter}
              onChange={(e) => {
                setEntityFilter(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Entities</option>
              <option value="users">users</option>
              <option value="loans">loans</option>
              <option value="loan_applications">loan_applications</option>
              <option value="fraud_rules">fraud_rules</option>
              <option value="fraud_alerts">fraud_alerts</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Action Type</label>
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Actions</option>
              <option value="INSERT">INSERT</option>
              <option value="UPDATE">UPDATE</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Audit Log Table */}
      <Card>
        {isLoading ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-800/50">
                  <th className="py-3 px-6 w-10"></th>
                  <th className="py-3 px-6">Timestamp</th>
                  <th className="py-3 px-6">Entity</th>
                  <th className="py-3 px-6">Entity ID</th>
                  <th className="py-3 px-6">Action</th>
                  <th className="py-3 px-6">Actor User</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {logs?.map((log: any) => {
                  const isExpanded = expandedId === String(log.id);
                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        onClick={() => toggleExpand(String(log.id))}
                        className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                      >
                        <td className="py-3.5 px-6 text-gray-400">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </td>
                        <td className="py-3.5 px-6 text-xs text-gray-500 whitespace-nowrap">
                          {new Date(log.at).toLocaleString()}
                        </td>
                        <td className="py-3.5 px-6 font-mono text-xs font-bold text-gray-900 dark:text-gray-100">
                          {log.entity}
                        </td>
                        <td className="py-3.5 px-6 font-mono text-xs text-gray-400">
                          {log.entity_id?.slice(0, 8)}...
                        </td>
                        <td className="py-3.5 px-6">
                          <Badge variant={actionVariant(log.action)}>{log.action}</Badge>
                        </td>
                        <td className="py-3.5 px-6 text-xs text-gray-600 dark:text-gray-300">
                          {log.actor_name || (log.actor_user_id ? `${log.actor_user_id.slice(0, 8)}...` : 'System Engine')}
                        </td>
                      </tr>

                      {/* Expandable JSON Snapshot View */}
                      {isExpanded && (
                        <tr className="bg-gray-50/70 dark:bg-gray-900/50">
                          <td colSpan={6} className="p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                              {log.old_data && (
                                <div className="p-3.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                                  <span className="text-[10px] uppercase font-bold text-rose-500 block mb-1.5">
                                    Before Snapshot (OLD)
                                  </span>
                                  <pre className="text-gray-700 dark:text-gray-300 overflow-x-auto max-h-48">
                                    {JSON.stringify(log.old_data, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {log.new_data && (
                                <div className="p-3.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                                  <span className="text-[10px] uppercase font-bold text-emerald-500 block mb-1.5">
                                    After Snapshot (NEW)
                                  </span>
                                  <pre className="text-gray-700 dark:text-gray-300 overflow-x-auto max-h-48">
                                    {JSON.stringify(log.new_data, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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
              disabled={!logs || logs.length < 30}
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
