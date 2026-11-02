import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgeDollarSign, Clock, CheckCircle } from 'lucide-react';
import { walletApi } from '@/api/client';
import { Card, Badge, Spinner, EmptyState } from '@/components/UI';

export const MerchantSettlements: React.FC = () => {
  const { data: accounts, isLoading } = useQuery({
    queryKey: ['wallet_accounts'],
    queryFn: async () => (await walletApi.getAccounts()).data,
  });

  const merchantAccount = accounts?.[0];
  const balance = merchantAccount?.balance ? parseFloat(merchantAccount.balance) : 0;

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <BadgeDollarSign className="w-6 h-6 text-indigo-600" /> Merchant Settlements & Payouts
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Automated batch payouts from merchant wallet to linked bank accounts
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <Card className="p-4">
          <span className="text-xs uppercase font-bold text-gray-400">Current Unsettled Balance</span>
          <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 mt-1">
            ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
          <span className="text-[11px] text-gray-400">Accrued from customer payments</span>
        </Card>
        <Card className="p-4">
          <span className="text-xs uppercase font-bold text-gray-400">Settlement Frequency</span>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">Daily (EOD)</div>
          <span className="text-[11px] text-gray-400">Configured in merchant profile</span>
        </Card>
        <Card className="p-4">
          <span className="text-xs uppercase font-bold text-gray-400">Next Scheduled Payout</span>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">Today 23:59 IST</div>
          <span className="text-[11px] text-gray-400">Automated ledger settlement</span>
        </Card>
      </div>

      <Card title="Settlement History">
        <EmptyState
          title="Daily Settlements in Progress"
          description="Automatic daily sweeps transfer eligible funds to your designated counterparty bank account."
          icon={<Clock className="w-6 h-6" />}
        />
      </Card>
    </div>
  );
};
