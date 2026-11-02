import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BadgeDollarSign, Calculator, ArrowRight, AlertCircle, CheckCircle } from 'lucide-react';
import { lendingApi } from '@/api/client';
import { Card, Button, Input, Spinner } from '@/components/UI';

export const LoanApply: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [productId, setProductId] = useState('');
  const [amount, setAmount] = useState('');
  const [tenureMonths, setTenureMonths] = useState('');
  const [emiPreview, setEmiPreview] = useState<{ emi_amount: number; total_interest: number; total_payment: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { data: products, isLoading: prodsLoading } = useQuery({
    queryKey: ['loan_products'],
    queryFn: async () => (await lendingApi.getProducts()).data,
  });

  const selectedProduct = products?.find((p: any) => p.id === productId);

  // Set default product when loaded
  useEffect(() => {
    if (products && products.length > 0 && !productId) {
      setProductId(products[0].id);
      setAmount(String(products[0].min_amount));
      setTenureMonths(String(products[0].min_tenure_months));
    }
  }, [products]);

  // Real-time EMI calculation preview
  useEffect(() => {
    if (!selectedProduct) return;
    const p = parseFloat(amount);
    const n = parseInt(tenureMonths, 10);
    const r = parseFloat(selectedProduct.annual_rate);

    if (p > 0 && n > 0) {
      lendingApi
        .calculateEmi({ principal: p, annual_rate: r, tenure_months: n })
        .then((res) => setEmiPreview(res.data))
        .catch(() => setEmiPreview(null));
    } else {
      setEmiPreview(null);
    }
  }, [amount, tenureMonths, selectedProduct]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const p = parseFloat(amount);
    const n = parseInt(tenureMonths, 10);

    if (!selectedProduct) {
      setError('Please select a loan product');
      return;
    }
    if (p < parseFloat(selectedProduct.min_amount) || p > parseFloat(selectedProduct.max_amount)) {
      setError(`Amount must be between ₹${selectedProduct.min_amount} and ₹${selectedProduct.max_amount}`);
      return;
    }
    if (n < selectedProduct.min_tenure_months || n > selectedProduct.max_tenure_months) {
      setError(`Tenure must be between ${selectedProduct.min_tenure_months} and ${selectedProduct.max_tenure_months} months`);
      return;
    }

    setLoading(true);
    try {
      await lendingApi.applyForLoan({
        product_id: productId,
        amount: p,
        tenure_months: n,
      });

      queryClient.invalidateQueries({ queryKey: ['my_applications'] });
      navigate('/loans');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Application submission failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (prodsLoading) return <Spinner />;

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <BadgeDollarSign className="w-6 h-6 text-emerald-600" /> Apply for Loan
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Select loan product and inspect real-time reducing-balance EMI preview
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Application Form */}
        <div className="lg:col-span-2">
          <Card title="Loan Application Details">
            {error && (
              <div className="mb-6 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center gap-3 text-sm text-rose-700 dark:text-rose-300">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Choose Loan Product
                </label>
                <select
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    const prod = products?.find((p: any) => p.id === e.target.value);
                    if (prod) {
                      setAmount(String(prod.min_amount));
                      setTenureMonths(String(prod.min_tenure_months));
                    }
                  }}
                  className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3.5 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-600"
                >
                  {products?.map((prod: any) => (
                    <option key={prod.id} value={prod.id}>
                      {prod.name} ({prod.annual_rate}% APR)
                    </option>
                  ))}
                </select>
              </div>

              {selectedProduct && (
                <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-100 dark:border-gray-700 text-xs text-gray-500 space-y-1">
                  <div className="flex justify-between">
                    <span>Amount Limits:</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-200">
                      ₹{parseFloat(selectedProduct.min_amount).toLocaleString()} - ₹{parseFloat(selectedProduct.max_amount).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tenure Range:</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-200">
                      {selectedProduct.min_tenure_months} to {selectedProduct.max_tenure_months} months
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Interest Rate:</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {selectedProduct.annual_rate}% annual reducing-balance
                    </span>
                  </div>
                </div>
              )}

              <Input
                label="Requested Principal Amount (INR)"
                type="number"
                step="100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="50000"
                required
              />

              <Input
                label="Tenure (Months)"
                type="number"
                step="1"
                value={tenureMonths}
                onChange={(e) => setTenureMonths(e.target.value)}
                placeholder="12"
                required
              />

              <Button type="submit" isLoading={loading} className="w-full mt-4 flex items-center justify-center gap-2">
                Submit Application <ArrowRight className="w-4 h-4" />
              </Button>
            </form>
          </Card>
        </div>

        {/* Live EMI Calculator Preview Card */}
        <div>
          <Card title="EMI Calculator" subtitle="Reducing-balance preview">
            {emiPreview ? (
              <div className="space-y-4 pt-2">
                <div className="p-4 rounded-2xl bg-primary-50 dark:bg-primary-950/40 border border-primary-200/80 dark:border-primary-900 text-center">
                  <span className="text-xs uppercase font-bold tracking-wider text-primary-700 dark:text-primary-400">
                    Estimated Monthly EMI
                  </span>
                  <div className="text-3xl font-extrabold text-primary-800 dark:text-primary-300 my-1">
                    ₹{parseFloat(String(emiPreview.emi_amount)).toFixed(2)}
                  </div>
                  <span className="text-[11px] text-gray-500">per month for {tenureMonths} months</span>
                </div>

                <div className="space-y-2.5 text-xs text-gray-600 dark:text-gray-300 pt-2 border-t border-gray-100 dark:border-gray-700">
                  <div className="flex justify-between">
                    <span>Principal:</span>
                    <span className="font-semibold">₹{parseFloat(amount || '0').toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Interest:</span>
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      ₹{parseFloat(String(emiPreview.total_interest)).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold text-gray-900 dark:text-gray-100 pt-2 border-t border-gray-100 dark:border-gray-700">
                    <span>Total Repayment:</span>
                    <span>₹{parseFloat(String(emiPreview.total_payment)).toFixed(2)}</span>
                  </div>
                </div>

                <div className="text-[10px] text-gray-400 leading-tight pt-2">
                  * Note: Last installment principal is adjusted automatically by the database procedure to match principal sum exactly.
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-gray-400">
                <Calculator className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                Enter valid amount and tenure to preview monthly amortisation
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};
