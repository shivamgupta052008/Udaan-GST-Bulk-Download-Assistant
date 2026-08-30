import { ExtensionStorage } from '../storage/extensionStorage';
import { QueueJob, QueueState, QueueStatus, JobHistoryEvent } from './queueTypes';
import { generateId, areFinancialYearsEquivalent } from '../shared/utils';
import { QUEUE_CONFIG } from '../shared/constants';
import { Logger } from '../shared/logger';
import { isValidTransition } from './stateMachine';
import { GstErrorCode } from '../diagnostics/errorClassification';

export class QueueStore {
  public static readonly MAX_JOB_HISTORY = 50;

  public static async getQueue(): Promise<QueueJob[]> {
    return await ExtensionStorage.getJobs();
  }

  public static async getQueueState(): Promise<QueueState> {
    return await ExtensionStorage.getQueueState();
  }

  public static async saveQueue(jobs: QueueJob[]): Promise<void> {
    await ExtensionStorage.saveJobs(jobs);
  }

  public static async saveQueueState(state: QueueState): Promise<void> {
    await ExtensionStorage.saveQueueState(state);
  }

  public static async updateQueueState(
    partial: Partial<Omit<QueueState, 'jobs'>>
  ): Promise<QueueState> {
    return await ExtensionStorage.updateQueueState(partial);
  }

  /**
   * Helper to append an event to a job's bounded history (<= 50 entries)
   */
  public static appendHistoryEvent(
    job: QueueJob,
    status: QueueStatus,
    errorCode?: GstErrorCode | null,
    message?: string | null
  ): JobHistoryEvent[] {
    const existing = job.history || [];
    const event: JobHistoryEvent = {
      timestamp: Date.now(),
      status,
      errorCode: errorCode || null,
      message: message || null,
    };
    const updated = [event, ...existing];
    return updated.slice(0, this.MAX_JOB_HISTORY);
  }

  /**
   * Evaluates whether two job definitions represent identical tax return downloads.
   * Compares normalized GSTIN, Financial Year, Return Period, and Return Type.
   */
  public static isMatchingReturnIdentity(
    jobA: { gstin: string; financialYear: string; period: string; returnType: string },
    jobB: { gstin: string; financialYear: string; period: string; returnType: string }
  ): boolean {
    const gstinA = (jobA.gstin || '').trim().toUpperCase();
    const gstinB = (jobB.gstin || '').trim().toUpperCase();

    const fyA = (jobA.financialYear || '').trim().toLowerCase();
    const fyB = (jobB.financialYear || '').trim().toLowerCase();

    const periodA = (jobA.period || '').trim().toLowerCase();
    const periodB = (jobB.period || '').trim().toLowerCase();

    const returnTypeA = (jobA.returnType || '').trim().toUpperCase();
    const returnTypeB = (jobB.returnType || '').trim().toUpperCase();

    return (
      gstinA === gstinB &&
      (fyA === fyB || areFinancialYearsEquivalent(jobA.financialYear, jobB.financialYear)) &&
      periodA === periodB &&
      returnTypeA === returnTypeB
    );
  }

  /**
   * Find an existing duplicate job for the same GSTIN, FY, Period, and ReturnType
   */
  public static async findDuplicateJob(
    gstin: string,
    financialYear: string,
    period: string,
    returnType: string,
    excludeJobId?: string
  ): Promise<QueueJob | undefined> {
    const jobs = await this.getQueue();
    const target = { gstin, financialYear, period, returnType };

    return jobs.find(
      (j) =>
        j.id !== excludeJobId &&
        this.isMatchingReturnIdentity(j, target) &&
        j.status !== 'CANCELLED' &&
        j.status !== 'FAILED'
    );
  }

  public static async addJob(
    jobData: Omit<QueueJob, 'id' | 'createdAt' | 'updatedAt' | 'retryCount' | 'maxRetries' | 'status'> & {
      status?: QueueStatus;
      maxRetries?: number;
      allowDuplicates?: boolean;
    }
  ): Promise<QueueJob> {
    const state = await this.getQueueState();
    const now = Date.now();

    // Duplicate download protection check
    if (!jobData.allowDuplicates) {
      const existing = state.jobs.find(
        (j) =>
          this.isMatchingReturnIdentity(j, jobData) &&
          j.status !== 'CANCELLED' &&
          j.status !== 'FAILED'
      );
      if (existing) {
        const errorMsg = `Duplicate job: A job for ${jobData.returnType} ${jobData.gstin.trim().toUpperCase()} (${jobData.period} ${jobData.financialYear}) already exists in queue with status ${existing.status}.`;
        Logger.warn(`[Duplicate Protection] ${errorMsg}`);
        throw new Error(errorMsg);
      }
    }

    const initialStatus = jobData.status || 'PENDING';
    const newJob: QueueJob = {
      id: generateId('job'),
      gstin: jobData.gstin.trim().toUpperCase(),
      financialYear: jobData.financialYear,
      period: jobData.period,
      returnType: jobData.returnType,
      status: initialStatus,
      isTestJob: jobData.isTestJob ?? true,
      retryCount: 0,
      maxRetries: jobData.maxRetries ?? QUEUE_CONFIG.MAX_RETRIES,
      error: null,
      syncStatus: jobData.syncStatus || 'NOT_SYNCED',
      syncError: null,
      companyName: jobData.companyName || null,
      createdAt: now,
      updatedAt: now,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorAt: null,
      history: [
        {
          timestamp: now,
          status: initialStatus,
          errorCode: null,
          message: 'Job initialized and added to queue',
        },
      ],
    };

    state.jobs.push(newJob);
    await this.saveQueueState(state);

    Logger.info(`[Job Created] ${newJob.isTestJob ? '[TEST JOB] ' : ''}${newJob.returnType} for ${newJob.gstin} (${newJob.period} ${newJob.financialYear})`, {
      jobId: newJob.id,
    });

    return newJob;
  }

  public static async updateJob(id: string, updates: Partial<QueueJob>): Promise<QueueJob | null> {
    const state = await this.getQueueState();
    const index = state.jobs.findIndex((j) => j.id === id);

    if (index === -1) {
      Logger.warn(`Cannot update job: ID ${id} not found.`);
      return null;
    }

    const currentJob = state.jobs[index];

    // State machine transition validation
    if (updates.status && updates.status !== currentJob.status) {
      if (!isValidTransition(currentJob.status, updates.status)) {
        Logger.warn(
          `[State Machine Warning] Transition from ${currentJob.status} to ${updates.status} for job ${id} is non-standard.`
        );
      }
    }

    const targetStatus = updates.status || currentJob.status;
    let history = currentJob.history || [];

    // Append to history if status changed or new error provided
    if ((updates.status && updates.status !== currentJob.status) || updates.lastErrorCode || updates.error) {
      history = this.appendHistoryEvent(
        currentJob,
        targetStatus,
        updates.lastErrorCode || currentJob.lastErrorCode,
        updates.lastErrorMessage || updates.error || (updates.status ? `Transition to ${updates.status}` : undefined)
      );
    }

    const updatedJob: QueueJob = {
      ...currentJob,
      ...updates,
      history: updates.history || history,
      updatedAt: Date.now(),
    };

    state.jobs[index] = updatedJob;

    // Queue state consistency: clear activeJobId if terminal
    if (
      updatedJob.status === 'DOWNLOADED' ||
      updatedJob.status === 'FAILED' ||
      updatedJob.status === 'CANCELLED'
    ) {
      if (state.activeJobId === id) {
        state.activeJobId = null;
      }
    }

    await this.saveQueueState(state);
    return updatedJob;
  }

  public static async removeJob(id: string): Promise<boolean> {
    const state = await this.getQueueState();
    const initialLen = state.jobs.length;
    const filtered = state.jobs.filter((j) => j.id !== id);

    if (filtered.length === initialLen) return false;

    const wasActive = state.activeJobId === id;
    await this.saveQueueState({
      ...state,
      jobs: filtered,
      activeJobId: wasActive ? null : state.activeJobId,
    });

    Logger.info(`[Job Removed] Removed job ID: ${id}`);
    return true;
  }

  public static async clearCompleted(): Promise<void> {
    const state = await this.getQueueState();
    const remaining = state.jobs.filter(
      (j) => j.status !== 'DOWNLOADED' && j.status !== 'CANCELLED' && j.status !== 'IMPORTED' && j.status !== 'SYNCED'
    );

    await this.saveQueueState({
      ...state,
      jobs: remaining,
    });

    Logger.info('[Queue] Cleared completed/cancelled jobs.');
  }

  public static async clearAll(): Promise<void> {
    await this.saveQueueState({
      jobs: [],
      isRunning: false,
      isPaused: false,
      activeJobId: null,
      lastUpdated: Date.now(),
    });

    Logger.info('[Queue] All jobs cleared.');
  }

  public static async resetFailedJob(id: string): Promise<QueueJob | null> {
    const state = await this.getQueueState();
    const index = state.jobs.findIndex((j) => j.id === id);

    if (index === -1) return null;

    const current = state.jobs[index];
    const updatedHistory = this.appendHistoryEvent(
      current,
      'PENDING',
      null,
      'Manual retry / job reset to PENDING'
    );

    state.jobs[index] = {
      ...current,
      status: 'PENDING',
      error: null,
      retryCount: 0,
      startedAt: null,
      completedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastErrorAt: null,
      history: updatedHistory,
      updatedAt: Date.now(),
    };

    await this.saveQueueState(state);
    Logger.info(`[Job Reset for Retry] Job ID: ${id} cleared and set to PENDING`);
    return state.jobs[index];
  }

  /**
   * Milestone 5: Bulk Job Creation Integration
   */
  public static async bulkAddJobs(
    params: {
      gstin: string;
      companyName?: string;
      financialYear: string;
      periods: string[];
      returnTypes: string[];
    },
    options?: { isTestJob?: boolean }
  ) {
    const { BulkPlanner } = await import('./bulkPlanner');
    return await BulkPlanner.executeBulkCreation(params as any, options);
  }
}


