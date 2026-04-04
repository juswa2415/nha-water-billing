// src/pages/Settings/BackupRestore.tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import toast from 'react-hot-toast';
import { Database, Upload, Download } from 'lucide-react';

export function BackupRestore() {
  const [backing, setBacking] = useState(false);

  const handleBackup = async () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const path = await save({
      defaultPath: `nha_billing_backup_${timestamp}.db`,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    });
    if (!path) return;
    setBacking(true);
    try {
      await invoke('backup_database', { backupPath: path });
      toast.success('Database backed up successfully.');
    } catch (err: any) {
      toast.error(err.toString());
    } finally {
      setBacking(false);
    }
  };

  return (
    <div className="max-w-lg space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-1 flex items-center gap-2">
          <Database size={15} /> Backup Database
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          Creates a full copy of the SQLite database file. Store backups on a USB drive or external storage.
        </p>
        <button
          onClick={handleBackup}
          disabled={backing}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors font-medium"
        >
          <Download size={15} />
          {backing ? 'Backing up…' : 'Backup Database Now'}
        </button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-amber-800 mb-1">Restore from Backup</h3>
        <p className="text-xs text-amber-700 mb-3">
          To restore: close this application, replace the database file in the app data folder with your backup,
          then restart the application. The database file is located at:
        </p>
        <div className="font-mono text-xs bg-amber-100 rounded-lg px-3 py-2 text-amber-900">
          %APPDATA%\nha-water-billing\nha_billing.db
        </div>
        <p className="text-xs text-amber-600 mt-2">
          Automatic in-app restore is not supported to prevent accidental data loss.
          Always keep at least 3 backup copies.
        </p>
      </div>
    </div>
  );
}