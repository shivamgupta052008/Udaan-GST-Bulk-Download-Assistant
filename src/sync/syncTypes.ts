/**
 * Milestone 3: Local Storage & Auto-Sync Foundation Types
 */
import { FinancialYear, ReturnPeriod, ReturnType } from '../gst/returnTypes';

export type SyncStatus = 'NOT_SYNCED' | 'SYNCING' | 'SYNCED' | 'SYNC_FAILED';

export type LocalStorageStatus = 'NOT_CONFIGURED' | 'CONNECTED' | 'LOCAL_STORAGE_UNAVAILABLE' | 'ERROR';

export interface CompanyProfile {
  gstin: string;
  companyName: string;
  folderName: string; // Sanitized folder name e.g. "27AABCU9603R1ZM_My Company"
  createdAt: number;
  updatedAt: number;
}

export interface LocalSyncSettings {
  autoSyncEnabled: boolean;
  rootSelected: boolean;
  rootPathName: string | null;
  status: LocalStorageStatus;
  lastVerifiedAt?: number | null;
  error?: string | null;
}

export interface SyncFileResult {
  success: boolean;
  localRelativePath?: string;
  localFileName?: string;
  error?: string | null;
  isDuplicate?: boolean;
}

export interface ILocalStorageProvider {
  selectRoot(customPath?: string): Promise<{ success: boolean; pathName?: string; error?: string }>;
  verifyPermission(): Promise<boolean>;
  getRootName(): string | null;
  getStatus(): LocalStorageStatus;
  createDirectory(path: string[], dirName: string): Promise<boolean>;
  directoryExists(path: string[]): Promise<boolean>;
  writeFile(
    path: string[],
    fileName: string,
    content: string | Blob | ArrayBuffer
  ): Promise<{ success: boolean; path: string; error?: string }>;
  readFile(path: string[], fileName: string): Promise<string | null>;
  fileExists(path: string[], fileName: string): Promise<boolean>;
  listFiles(path: string[]): Promise<string[]>;
  listDirectories(path: string[]): Promise<string[]>;
  reset(): Promise<void>;
}
