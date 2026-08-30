import { FinancialYear, ReturnPeriod, ReturnType } from '../gst/returnTypes';
import { SyncStatus } from '../sync/syncTypes';
import { GstErrorCode } from '../diagnostics/errorClassification';

export type { SyncStatus };
export type { GstErrorCode };

export type QueueStatus =
  | 'PENDING'
  | 'NAVIGATING'
  | 'PAGE_READY'
  | 'GENERATING'
  | 'WAITING_FOR_DOWNLOAD'
  | 'DOWNLOADED'
  | 'VALIDATING'
  | 'IMPORTED'
  | 'SYNCED'
  | 'PAUSED'
  | 'FAILED'
  | 'CANCELLED';

export interface JobHistoryEvent {
  timestamp: number;
  status: QueueStatus;
  errorCode?: GstErrorCode | null;
  message?: string | null;
}

export interface QueueJob {
  id: string;
  gstin: string;
  financialYear: FinancialYear;
  period: ReturnPeriod;
  returnType: ReturnType;
  status: QueueStatus;
  isTestJob: boolean;
  retryCount: number;
  maxRetries: number;
  error?: string | null;
  browserDownloadId?: number | null;
  filename?: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt?: number | null;
  completedAt?: number | null;

  // Milestone 3: Local Storage Sync properties
  syncStatus?: SyncStatus;
  syncError?: string | null;
  localFileName?: string | null;
  localRelativePath?: string | null;
  syncedAt?: number | null;
  companyName?: string | null;
  downloadContent?: string | null;

  // Milestone 6: Diagnostic & Reliability properties
  lastErrorCode?: GstErrorCode | null;
  lastErrorMessage?: string | null;
  lastErrorAt?: number | null;
  history?: JobHistoryEvent[];
}

export interface QueueState {
  jobs: QueueJob[];
  isRunning: boolean;
  isPaused: boolean;
  activeJobId: string | null;
  lastUpdated: number;
}

