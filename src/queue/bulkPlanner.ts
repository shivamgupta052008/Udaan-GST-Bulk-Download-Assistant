import { QueueJob, QueueStatus, SyncStatus } from './queueTypes';
import { FinancialYear, ReturnPeriod, ReturnType } from '../gst/returnTypes';
import { QueueStore } from './queueStore';
import { generateId } from '../shared/utils';
import { QUEUE_CONFIG } from '../shared/constants';
import { Logger } from '../shared/logger';
import { SyncEngine } from '../sync/syncEngine';

export interface BulkPlanParams {
  gstin: string;
  companyName?: string;
  financialYear: FinancialYear;
  periods: ReturnPeriod[];
  returnTypes: ReturnType[];
}

export interface BulkDuplicateDetail {
  gstin: string;
  financialYear: string;
  period: string;
  returnType: string;
  existingJobId: string;
  existingStatus: QueueStatus;
}

export interface BulkPlannedJobItem {
  gstin: string;
  financialYear: string;
  period: string;
  returnType: string;
}

export interface BulkPlanPreview {
  gstin: string;
  companyName?: string;
  financialYear: string;
  selectedPeriods: ReturnPeriod[];
  selectedReturnTypes: ReturnType[];
  totalRequested: number;
  duplicateCount: number;
  newJobsCount: number;
  duplicates: BulkDuplicateDetail[];
  newJobs: BulkPlannedJobItem[];
}

export interface BulkCreationResult {
  requested: number;
  created: number;
  skippedDuplicates: number;
  failed: number;
  createdJobs: QueueJob[];
  skippedDetails: BulkDuplicateDetail[];
  errors: string[];
}

export interface QueueFilterState {
  status: 'ALL' | 'PENDING' | 'ACTIVE' | 'DOWNLOADED' | 'FAILED' | 'CANCELLED' | 'SYNCED';
  returnType: 'ALL' | ReturnType;
  financialYear: 'ALL' | string;
  gstin: 'ALL' | string;
  searchQuery: string;
}

export class BulkPlanner {
  /**
   * Calculates the planned combinations and preview statistics against existing queue jobs.
   */
  public static calculatePlan(
    params: BulkPlanParams,
    existingJobs: QueueJob[]
  ): BulkPlanPreview {
    const cleanGstin = (params.gstin || '').trim().toUpperCase();
    const cleanFy = params.financialYear;
    const periods = Array.from(new Set(params.periods));
    const returnTypes = Array.from(new Set(params.returnTypes));

    const totalRequested = periods.length * returnTypes.length;
    const duplicates: BulkDuplicateDetail[] = [];
    const newJobs: BulkPlannedJobItem[] = [];

    for (const period of periods) {
      for (const returnType of returnTypes) {
        const item: BulkPlannedJobItem = {
          gstin: cleanGstin,
          financialYear: cleanFy,
          period,
          returnType,
        };

        const duplicate = existingJobs.find(
          (j) =>
            QueueStore.isMatchingReturnIdentity(j, item) &&
            j.status !== 'CANCELLED' &&
            j.status !== 'FAILED'
        );

        if (duplicate) {
          duplicates.push({
            gstin: cleanGstin,
            financialYear: cleanFy,
            period,
            returnType,
            existingJobId: duplicate.id,
            existingStatus: duplicate.status,
          });
        } else {
          newJobs.push(item);
        }
      }
    }

    return {
      gstin: cleanGstin,
      companyName: params.companyName?.trim() || undefined,
      financialYear: cleanFy,
      selectedPeriods: periods,
      selectedReturnTypes: returnTypes,
      totalRequested,
      duplicateCount: duplicates.length,
      newJobsCount: newJobs.length,
      duplicates,
      newJobs,
    };
  }

  /**
   * Atomically and duplicate-safely creates bulk jobs in QueueStore.
   * Skips duplicates without failing the entire batch, returning a detailed result.
   */
  public static async executeBulkCreation(
    params: BulkPlanParams,
    options?: { isTestJob?: boolean }
  ): Promise<BulkCreationResult> {
    const state = await QueueStore.getQueueState();
    const isTestJob = options?.isTestJob ?? true;
    const cleanGstin = (params.gstin || '').trim().toUpperCase();
    const cleanCompanyName = params.companyName?.trim() || null;
    const now = Date.now();

    const plan = this.calculatePlan(params, state.jobs);
    const createdJobs: QueueJob[] = [];
    const errors: string[] = [];

    for (const item of plan.newJobs) {
      try {
        const job: QueueJob = {
          id: generateId('job'),
          gstin: cleanGstin,
          financialYear: item.financialYear,
          period: item.period,
          returnType: item.returnType as ReturnType,
          status: 'PENDING',
          isTestJob,
          retryCount: 0,
          maxRetries: QUEUE_CONFIG.MAX_RETRIES,
          error: null,
          syncStatus: 'NOT_SYNCED',
          syncError: null,
          companyName: cleanCompanyName,
          createdAt: now,
          updatedAt: now,
        };

        state.jobs.push(job);
        createdJobs.push(job);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to plan job ${item.returnType} ${item.period}: ${msg}`);
      }
    }

    // Persist all newly created jobs in storage atomically
    if (createdJobs.length > 0) {
      state.lastUpdated = now;
      await QueueStore.saveQueueState(state);
      Logger.info(
        `[Bulk Planner] Created ${createdJobs.length} jobs for ${cleanGstin} (${params.financialYear}). Skipped ${plan.duplicateCount} duplicates.`
      );
    }

    return {
      requested: plan.totalRequested,
      created: createdJobs.length,
      skippedDuplicates: plan.duplicateCount,
      failed: errors.length,
      createdJobs,
      skippedDetails: plan.duplicates,
      errors,
    };
  }

  /**
   * Filters queue jobs based on status, return type, financial year, GSTIN, and text search.
   * UI-level filter; does not mutate underlying jobs.
   */
  public static filterJobs(
    jobs: QueueJob[],
    filters: QueueFilterState,
    activeJobId?: string | null
  ): QueueJob[] {
    const query = (filters.searchQuery || '').trim().toLowerCase();

    return jobs.filter((job) => {
      // 1. Status filter
      if (filters.status !== 'ALL') {
        if (filters.status === 'ACTIVE') {
          const isActive =
            job.status === 'NAVIGATING' ||
            job.status === 'PAGE_READY' ||
            job.status === 'GENERATING' ||
            job.status === 'WAITING_FOR_DOWNLOAD' ||
            job.status === 'VALIDATING' ||
            job.id === activeJobId;
          if (!isActive) return false;
        } else if (filters.status === 'SYNCED') {
          const isSynced = job.syncStatus === 'SYNCED' || job.status === 'SYNCED';
          if (!isSynced) return false;
        } else {
          if (job.status !== filters.status) return false;
        }
      }

      // 2. Return type filter
      if (filters.returnType !== 'ALL' && job.returnType !== filters.returnType) {
        return false;
      }

      // 3. Financial Year filter
      if (filters.financialYear !== 'ALL') {
        const matchFy =
          job.financialYear === filters.financialYear ||
          QueueStore.isMatchingReturnIdentity(
            { gstin: '', financialYear: job.financialYear, period: '', returnType: '' },
            { gstin: '', financialYear: filters.financialYear, period: '', returnType: '' }
          );
        if (!matchFy) return false;
      }

      // 4. GSTIN filter
      if (filters.gstin !== 'ALL') {
        if (job.gstin.trim().toUpperCase() !== filters.gstin.trim().toUpperCase()) {
          return false;
        }
      }

      // 5. Search query (GSTIN, Company Name, Job ID, Return Type, Period)
      if (query.length > 0) {
        const matchGstin = (job.gstin || '').toLowerCase().includes(query);
        const matchCompany = (job.companyName || '').toLowerCase().includes(query);
        const matchId = (job.id || '').toLowerCase().includes(query);
        const matchType = (job.returnType || '').toLowerCase().includes(query);
        const matchPeriod = (job.period || '').toLowerCase().includes(query);
        const matchFy = (job.financialYear || '').toLowerCase().includes(query);

        if (!matchGstin && !matchCompany && !matchId && !matchType && !matchPeriod && !matchFy) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Bulk Retry Action: Retries selected FAILED jobs using the standard QueueStore mechanism.
   * Ignores non-failed jobs safely.
   */
  public static async retrySelectedJobs(
    selectedIds: string[],
    jobs: QueueJob[]
  ): Promise<{ retriedCount: number; skippedCount: number }> {
    let retriedCount = 0;
    let skippedCount = 0;

    for (const id of selectedIds) {
      const job = jobs.find((j) => j.id === id);
      if (job && job.status === 'FAILED') {
        const res = await QueueStore.resetFailedJob(id);
        if (res) retriedCount++;
        else skippedCount++;
      } else {
        skippedCount++;
      }
    }

    if (retriedCount > 0) {
      Logger.info(`[Bulk Action] Retried ${retriedCount} failed jobs (${skippedCount} non-failed skipped).`);
    }

    return { retriedCount, skippedCount };
  }

  /**
   * Bulk Remove Action: Removes selected jobs. Never silently removes an ACTIVE job without explicit permission.
   */
  public static async removeSelectedJobs(
    selectedIds: string[],
    activeJobId: string | null,
    allowActiveRemoval = false
  ): Promise<{ removedCount: number; skippedActiveCount: number }> {
    let removedCount = 0;
    let skippedActiveCount = 0;

    for (const id of selectedIds) {
      if (id === activeJobId && !allowActiveRemoval) {
        skippedActiveCount++;
        Logger.warn(`[Bulk Action] Skipped removing active job ID: ${id}`);
        continue;
      }
      const ok = await QueueStore.removeJob(id);
      if (ok) removedCount++;
    }

    Logger.info(
      `[Bulk Action] Removed ${removedCount} jobs (${skippedActiveCount} active jobs protected/skipped).`
    );

    return { removedCount, skippedActiveCount };
  }

  /**
   * Bulk Sync Action: Synchronizes selected downloaded jobs into the local storage folder.
   */
  public static async syncSelectedJobs(
    selectedIds: string[],
    jobs: QueueJob[],
    syncEngine: SyncEngine
  ): Promise<{ syncedCount: number; failedCount: number; skippedCount: number }> {
    let syncedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const id of selectedIds) {
      const job = jobs.find((j) => j.id === id);
      if (job && job.status === 'DOWNLOADED') {
        try {
          const res = await syncEngine.syncJob(job);
          if (res.success) {
            syncedCount++;
          } else {
            failedCount++;
          }
        } catch {
          failedCount++;
        }
      } else {
        skippedCount++;
      }
    }

    Logger.info(
      `[Bulk Action] Bulk sync finished: ${syncedCount} synced, ${failedCount} failed, ${skippedCount} skipped.`
    );

    return { syncedCount, failedCount, skippedCount };
  }
}
