import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Server, Database, Layers, Plus, CheckCircle, Activity } from 'lucide-react';
import { adminApi } from '@/api/client';
import { Card, Button, Badge, Spinner } from '@/components/UI';

export const AdminSystemHealth: React.FC = () => {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState('');

  const { data: health, isLoading } = useQuery({
    queryKey: ['system_health'],
    queryFn: async () => (await adminApi.getSystemHealth()).data,
  });

  const handleCreatePartition = async () => {
    setCreating(true);
    setMessage('');
    try {
      const res = await adminApi.createNextPartition();
      setMessage(`Success: Created partition ${res.data.partition || 'for next month'}`);
      queryClient.invalidateQueries({ queryKey: ['system_health'] });
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Server className="w-6 h-6 text-indigo-600" /> PostgreSQL 16 Engine Diagnostics
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Physical database storage, partition catalog, and live connection telemetry
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleCreatePartition}
          isLoading={creating}
          className="flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Create Next Partition
        </Button>
      </div>

      {message && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 flex-shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {/* Health Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <Card className="p-4">
          <span className="text-xs uppercase font-bold text-gray-400 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5" /> Database Disk Footprint
          </span>
          <div className="text-2xl font-extrabold text-indigo-600 dark:text-indigo-400 mt-1">
            {health?.db_size || 'N/A'}
          </div>
          <span className="text-[11px] text-gray-400">pg_database_size</span>
        </Card>

        <Card className="p-4">
          <span className="text-xs uppercase font-bold text-gray-400 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" /> Range Partitions
          </span>
          <div className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
            {health?.partition_list?.length || 0} Partitions
          </div>
          <span className="text-[11px] text-gray-400">Monthly ledger_entries ranges</span>
        </Card>

        <Card className="p-4">
          <span className="text-xs uppercase font-bold text-gray-400 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" /> Active Connections
          </span>
          <div className="text-2xl font-extrabold text-gray-900 dark:text-gray-100 mt-1">
            {health?.active_connections || 1}
          </div>
          <span className="text-[11px] text-gray-400">Connection pool status</span>
        </Card>
      </div>

      {/* Partitions List Table */}
      <Card
        title="Declarative Monthly Partitions"
        subtitle="Automatic range partitioning on payledger.ledger_entries(created_at)"
      >
        <div className="overflow-x-auto -mx-6">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-800/50">
                <th className="py-3 px-6">Partition Name</th>
                <th className="py-3 px-6">Type</th>
                <th className="py-3 px-6 text-right">Physical Size on Disk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {health?.partition_list?.map((pt: any) => (
                <tr key={pt.partition_name} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                  <td className="py-3.5 px-6 font-mono text-xs font-bold text-gray-900 dark:text-gray-100">
                    {pt.partition_name}
                  </td>
                  <td className="py-3.5 px-6">
                    <Badge variant="info">RANGE (MONTHLY)</Badge>
                  </td>
                  <td className="py-3.5 px-6 text-right font-mono text-xs text-gray-600 dark:text-gray-300">
                    {pt.size}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Table Row Counts */}
      <Card title="Relational Table Cardinality" subtitle="Catalog row estimations from pg_class.reltuples">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          {health?.table_counts &&
            Object.entries(health.table_counts).map(([tbl, cnt]) => (
              <div
                key={tbl}
                className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 flex flex-col justify-between"
              >
                <span className="font-mono text-gray-500 truncate">{tbl}</span>
                <span className="text-base font-bold text-gray-900 dark:text-gray-100 mt-1">
                  {Number(cnt).toLocaleString()} rows
                </span>
              </div>
            ))}
        </div>
      </Card>
    </div>
  );
};
