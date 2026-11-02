import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users as UsersIcon, Shield, Search, CheckCircle, Ban } from 'lucide-react';
import { adminApi } from '@/api/client';
import { Card, Button, Badge, Spinner, Input } from '@/components/UI';

export const AdminUsers: React.FC = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin_users', page, roleFilter],
    queryFn: async () => {
      const res = await adminApi.getUsers({
        page,
        per_page: 25,
        role: roleFilter || undefined,
      });
      return res.data;
    },
  });

  const handleToggleStatus = async (user: any) => {
    const nextStatus = user.status === 'active' ? 'suspended' : 'active';
    setUpdatingId(user.id);
    try {
      await adminApi.updateUserStatus(user.id, nextStatus);
      queryClient.invalidateQueries({ queryKey: ['admin_users'] });
    } catch (err: any) {
      alert(`Status update failed: ${err.message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <UsersIcon className="w-6 h-6 text-indigo-600" /> Platform User Management
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Role assignments & account status administration across all 5 roles
          </p>
        </div>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-4">
          <label className="text-xs font-medium text-gray-500">Filter by Role:</label>
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All Roles</option>
            <option value="customer">Customer</option>
            <option value="merchant">Merchant</option>
            <option value="loan_officer">Loan Officer</option>
            <option value="risk_analyst">Risk Analyst</option>
            <option value="admin">Administrator</option>
          </select>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto -mx-6">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-800/50">
                  <th className="py-3 px-6">User Name</th>
                  <th className="py-3 px-6">Email Address</th>
                  <th className="py-3 px-6">Phone</th>
                  <th className="py-3 px-6">Role</th>
                  <th className="py-3 px-6">Status</th>
                  <th className="py-3 px-6">Registered</th>
                  <th className="py-3 px-6 text-right">Access Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {users?.map((u: any) => {
                  const isActive = u.status === 'active';
                  return (
                    <tr key={u.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                      <td className="py-3.5 px-6 font-medium text-gray-900 dark:text-gray-100">
                        {u.full_name}
                      </td>
                      <td className="py-3.5 px-6 text-xs text-gray-500">{u.email}</td>
                      <td className="py-3.5 px-6 text-xs text-gray-500">{u.phone || '—'}</td>
                      <td className="py-3.5 px-6">
                        <span className="font-mono text-xs uppercase px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                          {u.role.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3.5 px-6">
                        <Badge variant={isActive ? 'success' : 'error'}>
                          {u.status.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-6 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <Button
                          size="sm"
                          variant={isActive ? 'outline' : 'primary'}
                          isLoading={updatingId === u.id}
                          onClick={() => handleToggleStatus(u)}
                          className="text-xs py-1 px-3"
                        >
                          {isActive ? 'Suspend' : 'Activate'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

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
              disabled={!users || users.length < 25}
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
