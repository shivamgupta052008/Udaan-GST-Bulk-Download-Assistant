/**
 * Safe Backup Export & Restore Manager
 * Implements transaction-safe backup export, schema validation, and merge/replace restore strategies.
 * Strictly complies with Zero-Knowledge Credential Security Rule.
 */
import { QueueJob, QueueState } from '../queue/queueTypes';
import { ExtensionStorage } from './extensionStorage';
import { QueueStore } from '../queue/queueStore';
import { SyncEngine } from '../sync/syncEngine';
import { LocalSyncSettings } from '../sync/syncTypes';
import { EXTENSION_NAME, EXTENSION_VERSION, SUPPORTED_RETURN_TYPES } from '../shared/constants';
import { CURRENT_STORAGE_SCHEMA_VERSION } from './schemaManager';
import { QueueIntegrityValidator, VALID_QUEUE_STATUSES } from '../diagnostics/queueIntegrity';
import { Logger } from '../shared/logger';
import { sanitizeErrorMessage } from '../diagnostics/errorClassification';

export interface UdaanBackupData {
  format?: string;
  appName?: string;
  version?: string;
  appVersion?: string;
  schemaVersion: number;
  exportedAt?: number | string;
  exportDateIso?: string;
  queueState?: QueueState;
  queue?: QueueState;
  syncSettings?: LocalSyncSettings;
  metadata?: Record<string, unknown>;
}

export interface BackupValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  totalJobs: number;
  schemaVersion?: number;
  parsed?: UdaanBackupData;
}

export interface RestoreResult {
  success: boolean;
  strategy: 'REPLACE' | 'MERGE';
  jobsRestored: number;
  jobsSkipped: number;
  jobsOverwritten: number;
  error?: string;
  details?: string[];
}

export class BackupManager {
  /**
   * Generates a sanitized, credential-free JSON backup of the extension's queue and settings
   */
  public static async exportBackup(): Promise<UdaanBackupData> {
    const queueState = await ExtensionStorage.getQueueState();
    const syncSettings = await SyncEngine.getInstance().getSettings();

    // Deep copy and sanitize jobs (strip any accidental credentials, tokens, or large downloaded payloads from backup)
    const sanitizedJobs: QueueJob[] = queueState.jobs.map((job) => ({
      id: job.id,
      gstin: (job.gstin || '').trim().toUpperCase(),
      financialYear: job.financialYear,
      period: job.period,
      returnType: job.returnType,
      status: job.status,
      isTestJob: job.isTestJob,
      retryCount: job.retryCount || 0,
      maxRetries: job.maxRetries || 3,
      error: job.error ? sanitizeErrorMessage(job.error) : null,
      createdAt: job.createdAt || Date.now(),
      updatedAt: job.updatedAt || Date.now(),
      startedAt: job.startedAt || null,
      completedAt: job.completedAt || null,
      syncStatus: job.syncStatus || 'NOT_SYNCED',
      syncError: job.syncError ? sanitizeErrorMessage(job.syncError) : null,
      localFileName: job.localFileName || null,
      localRelativePath: job.localRelativePath || null,
      syncedAt: job.syncedAt || null,
      companyName: job.companyName || null,
      lastErrorCode: job.lastErrorCode || null,
      lastErrorMessage: job.lastErrorMessage ? sanitizeErrorMessage(job.lastErrorMessage) : null,
      lastErrorAt: job.lastErrorAt || null,
      history: job.history?.slice(0, 50) || [],
    }));

    const sanitizedQueueState: QueueState = {
      jobs: sanitizedJobs,
      isRunning: false, // Backups are always restored in a paused/stopped safe state
      isPaused: false,
      activeJobId: null,
      lastUpdated: Date.now(),
    };

    const backupData: UdaanBackupData = {
      format: 'UDAAN_GST_QUEUE_BACKUP',
      appName: EXTENSION_NAME,
      version: EXTENSION_VERSION,
      appVersion: EXTENSION_VERSION,
      schemaVersion: CURRENT_STORAGE_SCHEMA_VERSION,
      exportedAt: Date.now(),
      exportDateIso: new Date().toISOString(),
      queueState: sanitizedQueueState,
      queue: sanitizedQueueState,
      syncSettings: {
        autoSyncEnabled: syncSettings.autoSyncEnabled,
        rootSelected: syncSettings.rootSelected,
        rootPathName: syncSettings.rootPathName,
        status: syncSettings.status,
        lastVerifiedAt: syncSettings.lastVerifiedAt,
      },
    };

    Logger.info(`[Backup Export] Successfully exported backup containing ${sanitizedJobs.length} job(s)`);
    return backupData;
  }

  /**
   * Generates standard suggested export file name: udaan-gst-backup-YYYY-MM-DD.json
   */
  public static getExportFilename(date = new Date()): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `udaan-gst-backup-${yyyy}-${mm}-${dd}.json`;
  }

  /**
   * Validates raw JSON string or object for backup schema compliance and safety
   */
  public static validateBackup(rawData: unknown): BackupValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!rawData || typeof rawData !== 'object') {
      return {
        valid: false,
        errors: ['Invalid backup: File content is not a valid JSON object.'],
        warnings: [],
        totalJobs: 0,
      };
    }

    const data = rawData as any;

    // 0. Format check if provided
    if (data.format && data.format !== 'UDAAN_GST_QUEUE_BACKUP') {
      errors.push(`Invalid backup format: '${data.format}'. Expected 'UDAAN_GST_QUEUE_BACKUP'.`);
    }

    // 1. Schema Version Check
    if (typeof data.schemaVersion !== 'number') {
      errors.push('Backup schema version is missing or invalid.');
    } else if (data.schemaVersion > CURRENT_STORAGE_SCHEMA_VERSION) {
      warnings.push(`Backup schema version (v${data.schemaVersion}) is higher than supported (v${CURRENT_STORAGE_SCHEMA_VERSION}).`);
    }

    // 2. QueueState Structure Check
    const queueState = data.queueState || data.queue;
    if (!queueState || !Array.isArray(queueState.jobs)) {
      errors.push('Backup is missing valid queueState or jobs array.');
      return {
        valid: false,
        errors,
        warnings,
        totalJobs: 0,
      };
    }

    data.queueState = queueState;

    const jobs = queueState.jobs;
    const seenIds = new Set<string>();
    const seenIdentities = new Set<string>();

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      if (!job || typeof job !== 'object') {
        errors.push(`Job at index ${i} is not a valid object.`);
        continue;
      }

      if (!job.id || typeof job.id !== 'string') {
        errors.push(`Job at index ${i} is missing a valid 'id'.`);
      } else if (seenIds.has(job.id)) {
        warnings.push(`Duplicate job ID '${job.id}' found in backup; will be repaired on restore.`);
      } else {
        seenIds.add(job.id);
      }

      if (!job.gstin || typeof job.gstin !== 'string') {
        errors.push(`Job '${job.id || i}' is missing a valid GSTIN.`);
      }

      if (!job.returnType || !SUPPORTED_RETURN_TYPES.includes(job.returnType as any)) {
        errors.push(`Job '${job.id || i}' has unsupported return type '${job.returnType}'.`);
      }

      if (!job.status || !VALID_QUEUE_STATUSES.includes(job.status)) {
        warnings.push(`Job '${job.id || i}' has unrecognized status '${job.status}'.`);
      }

      if (job.gstin && job.financialYear && job.period && job.returnType) {
        const idKey = `${job.gstin.trim().toUpperCase()}_${job.financialYear}_${job.period}_${job.returnType}`;
        if (seenIdentities.has(idKey)) {
          warnings.push(`Duplicate return identity '${idKey}' found in backup; will be deduplicated on restore.`);
        } else {
          seenIdentities.add(idKey);
        }
      }
    }

    // 3. Credential Security Audit Check
    const rawJsonStr = JSON.stringify(data).toLowerCase();
    if (
      rawJsonStr.includes('"password"') ||
      rawJsonStr.includes('"otp"') ||
      rawJsonStr.includes('"captcha"') ||
      rawJsonStr.includes('"secret"')
    ) {
      warnings.push('Backup contains suspicious security keys; all fields will be strictly sanitized.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      totalJobs: jobs.length,
      schemaVersion: data.schemaVersion,
      parsed: errors.length === 0 ? (data as UdaanBackupData) : undefined,
    };
  }

  /**
   * Restores a validated backup using either REPLACE or MERGE strategy
   */
  public static async restoreBackup(
    backupData: UdaanBackupData,
    strategy: 'REPLACE' | 'MERGE' = 'REPLACE'
  ): Promise<RestoreResult> {
    const validation = this.validateBackup(backupData);
    if (!validation.valid || !validation.parsed) {
      const err = `Cannot restore backup: ${validation.errors.join('; ')}`;
      Logger.error(`[Backup Restore] ${err}`);
      return {
        success: false,
        strategy,
        jobsRestored: 0,
        jobsSkipped: 0,
        jobsOverwritten: 0,
        error: err,
      };
    }

    const details: string[] = [];
    const validData = validation.parsed;
    const incomingQueueState = validData.queueState || validData.queue || { jobs: [], isRunning: false, isPaused: false, activeJobId: null, lastUpdated: 0 };
    const incomingJobs = incomingQueueState.jobs;
    const currentQueueState = await ExtensionStorage.getQueueState();

    let finalJobs: QueueJob[] = [];
    let jobsRestored = 0;
    let jobsSkipped = 0;
    let jobsOverwritten = 0;

    if (strategy === 'REPLACE') {
      // Strategy A: Replace Queue entirely
      details.push(`Replacing existing ${currentQueueState.jobs.length} jobs with ${incomingJobs.length} backup jobs.`);
      const { repairedState } = QueueIntegrityValidator.repair({
        ...backupData.queueState,
        isRunning: false,
        isPaused: false,
        activeJobId: null,
      });

      finalJobs = repairedState.jobs;
      jobsRestored = finalJobs.length;
    } else {
      // Strategy B: Merge Queue safely without duplicating identities or downgrading completed jobs
      finalJobs = [...currentQueueState.jobs];

      for (const incomingJob of incomingJobs) {
        // Find existing match by return identity (GSTIN + FY + Period + ReturnType)
        const matchIndex = finalJobs.findIndex((curr) =>
          QueueIntegrityValidator.isMatchingReturnIdentity(curr, incomingJob)
        );

        if (matchIndex === -1) {
          // New job, append safely
          finalJobs.push(incomingJob);
          jobsRestored++;
          details.push(`Added new job ${incomingJob.returnType} (${incomingJob.gstin}, ${incomingJob.period} ${incomingJob.financialYear})`);
        } else {
          // Duplicate exists: skip to preserve local queue without duplicating
          const existing = finalJobs[matchIndex];
          jobsSkipped++;
          details.push(`Skipped duplicate job ${existing.id} (${existing.returnType} for ${existing.period} ${existing.financialYear})`);
        }
      }
    }

    // Run integrity validation & repair on final merged state
    const { repairedState, repairsApplied } = QueueIntegrityValidator.repair({
      jobs: finalJobs,
      isRunning: false,
      isPaused: false,
      activeJobId: null,
      lastUpdated: Date.now(),
    });

    await ExtensionStorage.saveQueueState(repairedState);
    repairsApplied.forEach((r) => details.push(`[Integrity] ${r}`));

    Logger.info(`[Backup Restore] Restored queue (${strategy}). Restored: ${jobsRestored}, Overwritten: ${jobsOverwritten}, Skipped: ${jobsSkipped}`);

    return {
      success: true,
      strategy,
      jobsRestored,
      jobsSkipped,
      jobsOverwritten,
      details,
    };
  }
}
