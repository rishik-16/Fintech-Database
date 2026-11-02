import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('payledger_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('payledger_token');
      localStorage.removeItem('payledger_user');
      if (window.location.pathname !== '/login' && window.location.pathname !== '/' && window.location.pathname !== '/register') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

/* ─── Auth ─── */
export const authApi = {
  login: (data: { email: string; password: string }) =>
    apiClient.post('/api/auth/login', data),
  register: (data: { full_name: string; email: string; phone?: string; password: string; role: string }) =>
    apiClient.post('/api/auth/register', data),
  me: () => apiClient.get('/api/auth/me'),
};

/* ─── Wallet & Ledger ─── */
export const walletApi = {
  getAccounts: () => apiClient.get('/api/wallet/accounts'),
  getBalance: (accountId: string) => apiClient.get(`/api/wallet/accounts/${accountId}/balance`),
  getStatement: (accountId: string, params?: { page?: number; per_page?: number; date_from?: string; date_to?: string }) =>
    apiClient.get(`/api/wallet/accounts/${accountId}/statement`, { params }),
  getStatementCsvUrl: (accountId: string, date_from?: string, date_to?: string) => {
    const url = new URL(`${API_URL}/api/wallet/accounts/${accountId}/statement/csv`);
    if (date_from) url.searchParams.set('date_from', date_from);
    if (date_to) url.searchParams.set('date_to', date_to);
    return url.toString();
  },
  transfer: (data: { to_account_id: string; amount: number; description?: string }, idempotencyKey: string) =>
    apiClient.post('/api/wallet/transfer', data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  getMerchants: () => apiClient.get('/api/wallet/merchants'),
  getContacts: () => apiClient.get('/api/wallet/contacts'),
  payMerchant: (data: { merchant_account_id: string; amount: number }, idempotencyKey: string) =>
    apiClient.post('/api/wallet/pay-merchant', data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  refund: (data: { original_transaction_id: string; amount: number }, idempotencyKey: string) =>
    apiClient.post('/api/wallet/refund', data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
};

/* ─── Lending ─── */
export const lendingApi = {
  getProducts: () => apiClient.get('/api/lending/products'),
  calculateEmi: (data: { principal: number; annual_rate: number; tenure_months: number }) =>
    apiClient.post('/api/lending/emi-calculator', data),
  applyForLoan: (data: { product_id: string; amount: number; tenure_months: number }) =>
    apiClient.post('/api/lending/apply', data),
  getMyApplications: () => apiClient.get('/api/lending/my-applications'),
  getMyLoans: () => apiClient.get('/api/lending/my-loans'),
  getLoanDetail: (loanId: string) => apiClient.get(`/api/lending/loans/${loanId}`),
  payEmi: (loanId: string, data: { emi_id: string; amount: number }, idempotencyKey: string) =>
    apiClient.post(`/api/lending/loans/${loanId}/pay-emi`, data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  prepayLoan: (loanId: string, data: { amount: number }, idempotencyKey: string) =>
    apiClient.post(`/api/lending/loans/${loanId}/prepay`, data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  getOfficerQueue: () => apiClient.get('/api/lending/officer/queue'),
  decideLoan: (applicationId: string, data: { decision: string; reason?: string }) =>
    apiClient.post(`/api/lending/officer/decide/${applicationId}`, data),
  getPortfolio: () => apiClient.get('/api/lending/portfolio'),
  triggerNightlyAccrual: () => apiClient.post('/api/lending/admin/accrue'),
};

/* ─── Risk & Fraud & Reconciliation ─── */
export const riskApi = {
  getAlerts: (params?: { status?: string; severity?: string; page?: number; per_page?: number }) =>
    apiClient.get('/api/risk/alerts', { params }),
  assignAlert: (alertId: string, assigned_to: string) =>
    apiClient.post(`/api/risk/alerts/${alertId}/assign`, { assigned_to }),
  resolveAlert: (alertId: string, data: { status: string; notes?: string }) =>
    apiClient.post(`/api/risk/alerts/${alertId}/resolve`, data),
  getRules: () => apiClient.get('/api/risk/rules'),
  createRule: (data: { code: string; description?: string; threshold_json: Record<string, unknown>; severity: string; active?: boolean }) =>
    apiClient.post('/api/risk/rules', data),
  updateRule: (ruleId: string, data: Record<string, unknown>) =>
    apiClient.put(`/api/risk/rules/${ruleId}`, data),
  importStatement: (formData: FormData) =>
    apiClient.post('/api/risk/import-statement', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  reconcile: (importId: string) =>
    apiClient.post(`/api/risk/reconcile/${importId}`),
  getReconciliation: (runId: string) =>
    apiClient.get(`/api/risk/reconciliation/${runId}`),
  getImports: () => apiClient.get('/api/risk/imports'),
};

/* ─── Admin & DB Lab ─── */
export const adminApi = {
  getUsers: (params?: { page?: number; per_page?: number; role?: string }) =>
    apiClient.get('/api/admin/users', { params }),
  updateUserStatus: (userId: string, newStatus: string) =>
    apiClient.put(`/api/admin/users/${userId}/status?new_status=${newStatus}`),
  getAuditLog: (params?: { entity?: string; action?: string; date_from?: string; date_to?: string; page?: number; per_page?: number }) =>
    apiClient.get('/api/admin/audit-log', { params }),
  getDailyVolume: () => apiClient.get('/api/admin/analytics/daily-volume'),
  getLoanPortfolio: () => apiClient.get('/api/admin/analytics/loan-portfolio'),
  getFraudTrend: () => apiClient.get('/api/admin/analytics/fraud-trend'),
  getSystemHealth: () => apiClient.get('/api/admin/system/health'),
  getPartitions: () => apiClient.get('/api/admin/system/partitions'),
  createNextPartition: () => apiClient.post('/api/admin/system/create-partition'),
  // DB Lab
  runConcurrencyDemo: () => apiClient.get('/api/admin/db-lab/concurrency-demo'),
  checkInvariant: () => apiClient.get('/api/admin/db-lab/invariant-check'),
  getDbLabPartitions: () => apiClient.get('/api/admin/db-lab/partitions'),
  getRlsDemo: () => apiClient.get('/api/admin/db-lab/rls-demo'),
  getExplainResults: () => apiClient.get('/api/admin/db-lab/explain-results'),
  getBankTreasury: () => apiClient.get('/api/admin/db-lab/bank-treasury'),
};
