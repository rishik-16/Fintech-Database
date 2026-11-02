import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Sliders, Plus, Edit2, CheckCircle, AlertCircle, Shield } from 'lucide-react';
import { riskApi } from '@/api/client';
import { Card, Button, Badge, Modal, Input, Spinner } from '@/components/UI';

export const RiskRules: React.FC = () => {
  const queryClient = useQueryClient();
  const [editingRule, setEditingRule] = useState<any>(null);
  const [thresholdJsonStr, setThresholdJsonStr] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('high');
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { data: rules, isLoading } = useQuery({
    queryKey: ['fraud_rules'],
    queryFn: async () => (await riskApi.getRules()).data,
  });

  const handleOpenEdit = (rule: any) => {
    setEditingRule(rule);
    setDescription(rule.description || '');
    setSeverity(rule.severity || 'high');
    setActive(rule.active);
    setThresholdJsonStr(JSON.stringify(rule.threshold_json, null, 2));
    setError('');
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRule) return;

    let parsedJson: any;
    try {
      parsedJson = JSON.parse(thresholdJsonStr);
    } catch {
      setError('Invalid JSON syntax in Threshold JSON');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await riskApi.updateRule(editingRule.id, {
        description,
        threshold_json: parsedJson,
        severity,
        active,
      });

      setEditingRule(null);
      queryClient.invalidateQueries({ queryKey: ['fraud_rules'] });
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update rule');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (rule: any) => {
    try {
      await riskApi.updateRule(rule.id, { active: !rule.active });
      queryClient.invalidateQueries({ queryKey: ['fraud_rules'] });
    } catch (err: any) {
      alert(`Toggle failed: ${err.message}`);
    }
  };

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Sliders className="w-6 h-6 text-indigo-600" /> Fraud Detection Rules Engine
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Configurable heuristic rules evaluated automatically by PostgreSQL trigger on every money movement
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {rules?.map((rule: any) => (
          <Card key={rule.id} className="relative overflow-hidden flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-sm font-bold text-indigo-600 dark:text-indigo-400">
                  {rule.code}
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant={rule.severity === 'critical' ? 'error' : rule.severity === 'high' ? 'warning' : 'info'}>
                    {rule.severity.toUpperCase()}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => handleToggleActive(rule)}
                    className={`text-xs px-2 py-0.5 rounded-full font-semibold border transition-colors ${
                      rule.active
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-300'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-400 border-gray-300'
                    }`}
                  >
                    {rule.active ? 'ACTIVE' : 'DISABLED'}
                  </button>
                </div>
              </div>

              <p className="text-xs text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">
                {rule.description}
              </p>

              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-3 border border-gray-200 dark:border-gray-800 mb-4">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
                  Threshold JSONB Configuration
                </span>
                <pre className="text-xs font-mono text-gray-700 dark:text-gray-300 overflow-x-auto">
                  {JSON.stringify(rule.threshold_json, null, 2)}
                </pre>
              </div>
            </div>

            <div className="pt-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOpenEdit(rule)}
                className="flex items-center gap-1.5 text-xs"
              >
                <Edit2 className="w-3.5 h-3.5" /> Edit Thresholds
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Edit Rule Modal */}
      <Modal
        isOpen={!!editingRule}
        onClose={() => setEditingRule(null)}
        title={`Edit Rule: ${editingRule?.code}`}
      >
        {editingRule && (
          <form onSubmit={handleSaveRule} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-rose-50 text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Input
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Severity</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Thresholds JSON (JSONB in PostgreSQL)
              </label>
              <textarea
                value={thresholdJsonStr}
                onChange={(e) => setThresholdJsonStr(e.target.value)}
                rows={5}
                className="w-full font-mono text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>

            <div className="pt-2 flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setEditingRule(null)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={loading}>
                Save Changes
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
