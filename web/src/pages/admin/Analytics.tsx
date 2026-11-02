import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, TrendingUp, BarChart2, ShieldAlert } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { adminApi } from '@/api/client';
import { Card, Spinner } from '@/components/UI';

export const AdminAnalytics: React.FC = () => {
  const { data: dailyVolume, isLoading: volumeLoading } = useQuery({
    queryKey: ['admin_daily_volume'],
    queryFn: async () => (await adminApi.getDailyVolume()).data,
  });

  const { data: fraudTrend, isLoading: fraudLoading } = useQuery({
    queryKey: ['admin_fraud_trend'],
    queryFn: async () => (await adminApi.getFraudTrend()).data,
  });

  if (volumeLoading || fraudLoading) return <Spinner />;

  // Format volume chart points
  const volumeChartData = (dailyVolume || [])
    .slice(0, 14)
    .reverse()
    .map((d: any) => ({
      date: d.date?.slice(5),
      transfers: d.transfer_count || 0,
      payments: d.payment_count || 0,
      refunds: d.refund_count || 0,
    }));

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Activity className="w-6 h-6 text-indigo-600" /> Platform Transaction Analytics
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Real-time aggregated metrics from database views payledger.v_daily_volume & v_fraud_dashboard
        </p>
      </div>

      {/* Daily Volume Bar Chart */}
      <Card title="Daily Transaction Volume (Last 14 Days)" subtitle="Grouped by kind: P2P Transfers, Merchant Payments, Refunds">
        <div className="h-72 w-full pt-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={volumeChartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
              <XAxis dataKey="date" stroke="#9ca3af" fontSize={11} tickLine={false} />
              <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1f2937',
                  borderColor: '#374151',
                  borderRadius: '0.75rem',
                  color: '#fff',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
              <Bar dataKey="transfers" name="P2P Transfers" fill="#4f46e5" radius={[4, 4, 0, 0]} />
              <Bar dataKey="payments" name="Merchant Payments" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="refunds" name="Refunds" fill="#f43f5e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Fraud Alert Trend Grid */}
      <Card title="Fraud Engine Alert Frequency" subtitle="Alerts raised by real-time stored procedure triggers">
        <div className="overflow-x-auto -mx-6">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-800/50">
                <th className="py-3 px-6">Event Date</th>
                <th className="py-3 px-6">Severity Tier</th>
                <th className="py-3 px-6 text-right">Alert Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {fraudTrend?.slice(0, 10).map((row: any, idx: number) => (
                <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                  <td className="py-3.5 px-6 font-mono text-xs text-gray-500">{row.date}</td>
                  <td className="py-3.5 px-6">
                    <span className="font-mono text-xs uppercase font-bold text-gray-900 dark:text-gray-100">
                      {row.severity}
                    </span>
                  </td>
                  <td className="py-3.5 px-6 text-right font-bold text-rose-600 dark:text-rose-400">
                    {row.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
