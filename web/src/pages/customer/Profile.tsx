import React from 'react';
import { User, ShieldCheck, Mail, Phone, Calendar, CreditCard } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useQuery } from '@tanstack/react-query';
import { walletApi } from '@/api/client';
import { Card, Badge, Spinner } from '@/components/UI';

export const Profile: React.FC = () => {
  const { user, role } = useAuth();

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['wallet_accounts'],
    queryFn: async () => (await walletApi.getAccounts()).data,
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <User className="w-6 h-6 text-indigo-600" /> User Profile & KYC
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Identity management, role permissions & database account identifiers
        </p>
      </div>

      <Card title="Account Overview">
        <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-100 dark:border-gray-700">
          <div className="w-16 h-16 rounded-2xl bg-indigo-600 text-white font-bold text-2xl flex items-center justify-center shadow-md shadow-indigo-300 dark:shadow-none">
            {user?.full_name?.charAt(0) || 'U'}
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{user?.full_name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="info" className="uppercase text-[10px]">
                ROLE: {role?.replace('_', ' ')}
              </Badge>
              <Badge variant="success" className="text-[10px]">
                STATUS: {user?.status?.toUpperCase() || 'ACTIVE'}
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700">
            <span className="text-xs text-gray-400 flex items-center gap-1.5 mb-1">
              <Mail className="w-3.5 h-3.5" /> Email Address
            </span>
            <span className="font-semibold text-gray-900 dark:text-gray-200">{user?.email}</span>
          </div>

          <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700">
            <span className="text-xs text-gray-400 flex items-center gap-1.5 mb-1">
              <Phone className="w-3.5 h-3.5" /> Phone Number
            </span>
            <span className="font-semibold text-gray-900 dark:text-gray-200">{user?.phone || '+91-9876543210'}</span>
          </div>

          <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700">
            <span className="text-xs text-gray-400 flex items-center gap-1.5 mb-1">
              <ShieldCheck className="w-3.5 h-3.5" /> KYC Status
            </span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">Verified (Simulated)</span>
          </div>

          <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700">
            <span className="text-xs text-gray-400 flex items-center gap-1.5 mb-1">
              <Calendar className="w-3.5 h-3.5" /> User UUID
            </span>
            <span className="font-mono text-xs text-gray-500 break-all">{user?.id}</span>
          </div>
        </div>
      </Card>

      <Card title="Linked Double-Entry Accounts">
        <div className="space-y-3">
          {accounts?.map((acc: any) => (
            <div
              key={acc.id}
              className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-gray-800"
            >
              <div>
                <span className="text-xs uppercase font-bold text-indigo-600 dark:text-indigo-400 tracking-wider">
                  {acc.account_type.replace('_', ' ')}
                </span>
                <p className="font-mono text-xs text-gray-400 mt-0.5">ID: {acc.id}</p>
              </div>
              <div className="text-right">
                <span className="text-xs text-gray-400">Current Balance</span>
                <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  ₹{parseFloat(acc.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
