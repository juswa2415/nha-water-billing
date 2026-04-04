// src/services/syncService.ts
// Option A: Encrypted JSON file export/import (offline-first, no LAN needed)

import { invoke } from '@tauri-apps/api/core';

export interface SyncPayload {
  version: string;
  exported_at: string;
  billing_cycle_id: number;
  exported_by: string;
  readings: MobileReading[];
  checksum: string;
}

export interface MobileReading {
  unit_id: number;
  unit_number: string;
  building_code: string;
  previous_reading: number;
  current_reading: number;
  notes?: string;
  photo_filename?: string;
  read_at: string;
  submitted_by_username: string;
}

// Desktop: Import readings from mobile export file
export async function importMobileReadings(filePath: string): Promise<ImportResult> {
  return await invoke('import_mobile_readings', { filePath });
}

export async function exportReadingList(cycleId: number, outputPath: string): Promise<number> {
  return await invoke('export_reading_list', { cycleId, outputPath });
}

// Conflict resolution strategy:
// 1. Same unit_id + billing_cycle_id = duplicate → skip (keep first)
// 2. Different read_at timestamps → prefer most recent
// 3. Anomaly flags are preserved through import

export interface ImportResult {
  total: number;
  imported: number;
  duplicates: number;
  flagged: number;
  errors: string[];
}
