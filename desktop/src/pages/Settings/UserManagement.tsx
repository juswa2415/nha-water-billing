// src/pages/Settings/UserManagement.tsx
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DataTable, Column } from '../../components/shared/DataTable';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { formatDateTime } from '../../utils/formatters';
import toast from 'react-hot-toast';
import { Plus, Edit2 } from 'lucide-react';

interface UserRow {
  id: number; username: string; full_name: string;
  role: string; active: boolean; last_login: string | null; created_at: string;
}

const ROLES = ['admin', 'billing_staff', 'cashier', 'field_staff'];

export function UserManagement() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [form, setForm] = useState({ username: '', password: '', full_name: '', role: 'billing_staff' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    invoke<UserRow[]>('list_users').then(d => { setUsers(d); setLoading(false); });
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditUser(null);
    setForm({ username: '', password: '', full_name: '', role: 'billing_staff' });
    setShowForm(true);
  };

  const openEdit = (u: UserRow) => {
    setEditUser(u);
    setForm({ username: u.username, password: '', full_name: u.full_name, role: u.role });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editUser) {
        await invoke('update_user', { payload: {
          id: editUser.id,
          full_name: form.full_name,
          role: form.role,
          new_password: form.password || null,
        }});
        toast.success('User updated.');
      } else {
        await invoke('create_user', { payload: { username: form.username, password: form.password, full_name: form.full_name, role: form.role }});
        toast.success('User created.');
      }
      setShowForm(false);
      load();
    } catch (err: any) {
      toast.error(err.toString());
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: UserRow) => {
    await invoke('update_user', { payload: { id: u.id, active: !u.active } });
    toast.success(u.active ? 'User deactivated.' : 'User activated.');
    load();
  };

  const columns: Column<UserRow>[] = [
    { key: 'name', header: 'Full Name', render: u => <span className="text-sm font-medium text-gray-800">{u.full_name}</span> },
    { key: 'username', header: 'Username', render: u => <span className="font-mono text-xs text-gray-500">{u.username}</span> },
    { key: 'role', header: 'Role', render: u => <span className="text-xs capitalize text-gray-600">{u.role.replace('_', ' ')}</span> },
    { key: 'status', header: 'Status', width: '80px', render: u => <StatusBadge status={u.active ? 'active' : 'inactive'} /> },
    { key: 'login', header: 'Last Login', render: u => <span className="text-xs text-gray-400">{u.last_login ? formatDateTime(u.last_login) : 'Never'}</span> },
    {
      key: 'actions', header: '', width: '100px',
      render: u => (
        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
          <button onClick={() => openEdit(u)} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
            <Edit2 size={11} /> Edit
          </button>
          <button onClick={() => toggleActive(u)} className={`text-xs ${u.active ? 'text-red-500 hover:text-red-700' : 'text-green-600 hover:text-green-800'}`}>
            {u.active ? 'Disable' : 'Enable'}
          </button>
        </div>
      ),
    },
  ];

  const inputCls = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={openNew} className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
          <Plus size={14} /> Add User
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">{editUser ? 'Edit User' : 'New User'}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            {!editUser && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Username *</label>
                <input className={inputCls} value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Full Name *</label>
              <input className={inputCls} value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Role *</label>
              <select className={inputCls} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">{editUser ? 'New Password (leave blank to keep)' : 'Password *'}</label>
              <input type="password" className={inputCls} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required={!editUser} />
            </div>
            <div className="col-span-2 flex gap-3">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 font-medium">
                {saving ? 'Saving…' : editUser ? 'Update' : 'Create User'}
              </button>
            </div>
          </form>
        </div>
      )}

      <DataTable columns={columns} data={users} rowKey={u => u.id} loading={loading} />
    </div>
  );
}