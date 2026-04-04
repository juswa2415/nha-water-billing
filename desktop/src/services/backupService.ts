import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

export async function chooseBackupDestination(defaultName: string): Promise<string | null> {
  const target = await save({
    defaultPath: defaultName,
    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
  });

  return typeof target === 'string' ? target : null;
}

export async function backupDatabase(backupPath: string): Promise<void> {
  await invoke('backup_database', { backupPath });
}

export async function chooseRestoreSource(): Promise<string | null> {
  const target = await open({
    multiple: false,
    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
  });

  return typeof target === 'string' ? target : null;
}

export async function restoreDatabase(backupPath: string): Promise<void> {
  await invoke('restore_database', { backupPath });
}
