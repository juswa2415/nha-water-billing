// src/pages/Settings/RateConfig.tsx
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import { Save } from 'lucide-react';

interface Setting { key: string; value: string; description: string | null }

const EDITABLE_KEYS = [
  { key: 'rate_per_cubicm', label: 'Rate per Cubic Meter (₱)', type: 'number', step: '0.01' },
  { key: 'organization_name', label: 'Organization Name', type: 'text' },
  { key: 'district_office', label: 'District Office', type: 'text' },
  { key: 'community_name', label: 'Community Name', type: 'text' },
  { key: 'receipt_prefix', label: 'Receipt Number Prefix', type: 'text' },
  { key: 'disconnection_notice_days', label: 'Disconnection Grace Days After Due Date', type: 'number' },
  { key: 'disconnection_trigger_unpaid_bills', label: 'Unpaid Billing Periods Allowed Before Disconnection', type: 'number' },
  { key: 'penalty_rate', label: 'Penalty Rate (%)', type: 'number', step: '0.01' },
];

export function RateConfig() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    invoke<Setting[]>('list_settings').then(data => {
      const map: Record<string, string> = {};
      data.forEach(s => { map[s.key] = s.value; });
      setSettings(map);
      setLoading(false);
    });
  }, []);

  const save = async (key: string, value: string) => {
    setSaving(true);
    try {
      await invoke('update_setting', { payload: { key, value } });
      toast.success('Setting saved.');
    } catch (err: any) {
      toast.error(err.toString());
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-sm text-gray-400">Loading…</div>;

  return (
    <div className="max-w-lg space-y-3">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">System Configuration</h3>
        <div className="space-y-4">
          {EDITABLE_KEYS.map(f => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">{f.label}</label>
              <div className="flex gap-2">
                <input
                  type={f.type}
                  step={(f as any).step}
                  value={settings[f.key] ?? ''}
                  onChange={e => setSettings(s => ({ ...s, [f.key]: e.target.value }))}
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => save(f.key, settings[f.key] ?? '')}
                  disabled={saving}
                  className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
                >
                  <Save size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
