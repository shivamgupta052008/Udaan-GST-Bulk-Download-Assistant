import { QueueStore } from './queueStore';
import { QueueJob, QueueState } from './queueTypes';
import { DownloadMonitor } from '../downloads/downloadMonitor';
import { getAdapterForReturnType } from '../adapters/adapterRegistry';
import { detectPortalStatus } from '../gst/portalDetector';
import { Logger } from '../shared/logger';
import { sleep } from '../shared/utils';
import { QUEUE_CONFIG } from '../shared/constants';
import { SyncEngine } from '../sync/syncEngine';

export class DownloadQueueManager {
  private static instance: DownloadQueueManager | null = null;
  private isProcessing = false;
  private downloadMonitor: DownloadMonitor;
  private queueListeners: Array<(state: QueueState) => void> = [];
  private activeJobAbortController: AbortController | null = null;

  private constructor() {
    this.downloadMonitor = DownloadMonitor.getInstance();
    this.downloadMonitor.init();
    this.setupDownloadListeners();
  }

  public static getInstance(): DownloadQueueManager {
    if (!DownloadQueueManager.instance) {
      DownloadQueueManager.instance = new DownloadQueueManager();
    }
    return DownloadQueueManager.instance;
  }

  private setupDownloadListeners(): void {
    this.downloadMonitor.subscribe(async (download) => {
      const associatedJobId = await this.downloadMonitor.getAssociatedJobIdAsync(download.id);
      if (!associatedJobId) return;

      const jobs = await QueueStore.getQueue();
      const job = jobs.find((j) => j.id === associatedJobId);
      if (!job) return;

      if (download.state === 'complete') {
        Logger.info(`[Queue] Download verified complete for job ${job.id} (${download.filename})`);
        await QueueStore.updateJob(job.id, {
          status: 'DOWNLOADED',
          browserDownloadId: download.id,
          filename: download.filename,
          completedAt: Date.now(),
          error: null,
        });

        await QueueStore.updateQueueState({ activeJobId: null });
        await this.notifyState();

        // Trigger Auto-Sync hook if enabled
        try {
          await SyncEngine.getInstance().onDownloadCompleted(job.id);
        } catch (syncErr) {
          Logger.warn(`[Queue] Auto-Sync trigger error for job ${job.id}: ${String(syncErr)}`);
        }

        // Sequential trigger for next pending item
        const state = await QueueStore.getQueueState();
        if (state.isRunning && !state.isPaused) {
          setTimeout(() => {
            this.processNext();
          }, 300);
        }
      } else if (download.state === 'interrupted') {
        Logger.warn(`[Queue] Download interrupted for job ${job.id}: ${download.error}`);
        await this.handleJobFailure(job, download.error || 'Download was interrupted');
      }
    });
  }

  /**
   * Recovers queue state on service worker startup, extension boot, or browser restart
   */
  public async recoverQueueOnStartup(): Promise<void> {
    Logger.info('[Queue Recovery] Running startup reconciliation and recovery check...');
    await this.downloadMonitor.init();

    const state = await QueueStore.getQueueState();
    let hasModifications = false;

    // Check all jobs for interrupted or unfinalized states
    for (const job of state.jobs) {
      if (job.status === 'WAITING_FOR_DOWNLOAD' && job.browserDownloadId) {
        // Query browser download state to see if it finished during restart
        const dl = await this.downloadMonitor.queryDownloadState(job.browserDownloadId);
        if (dl && dl.state === 'complete') {
          Logger.info(`[Queue Recovery] Reconciled completed download for job ${job.id} (${dl.filename})`);
          job.status = 'DOWNLOADED';
          job.filename = dl.filename;
          job.completedAt = Date.now();
          job.error = null;
          hasModifications = true;
        } else if (dl && dl.state === 'interrupted') {
          Logger.warn(`[Queue Recovery] Reconciled interrupted download for job ${job.id}`);
          job.status = 'PENDING';
          job.retryCount = (job.retryCount || 0) + 1;
          job.error = 'Interrupted during restart. Retry scheduled.';
          hasModifications = true;
        } else {
          // Download did not start or was lost
          Logger.warn(`[Queue Recovery] Resetting unresolved download job ${job.id} to PENDING`);
          job.status = 'PENDING';
          hasModifications = true;
        }
      } else if (
        job.status === 'NAVIGATING' ||
        job.status === 'PAGE_READY' ||
        job.status === 'GENERATING'
      ) {
        Logger.info(`[Queue Recovery] Resetting in-flight job ${job.id} (${job.status}) back to PENDING`);
        job.status = 'PENDING';
        hasModifications = true;
      }
    }

    if (state.activeJobId) {
      state.activeJobId = null;
      hasModifications = true;
    }

    if (hasModifications) {
      await QueueStore.saveQueueState(state);
      await this.notifyState();
    }

    // If queue was actively running before the worker restarted, resume automatically
    if (state.isRunning && !state.isPaused) {
      Logger.info('[Queue Recovery] Queue was active prior to restart. Automatically resuming sequential processing.');
      this.isProcessing = false;
      this.processNext();
    }
  }

  public async startQueue(): Promise<void> {
    const state = await QueueStore.getQueueState();
    if (state.isRunning && !state.isPaused) {
      Logger.info('[Queue] Queue is already running');
      return;
    }

    // Reconcile any stuck non-pending jobs back to PENDING so queue never hangs
    let stateModified = false;
    for (const job of state.jobs) {
      if (
        job.status === 'NAVIGATING' ||
        job.status === 'PAGE_READY' ||
        job.status === 'GENERATING'
      ) {
        job.status = 'PENDING';
        stateModified = true;
      }
    }

    state.activeJobId = null;
    state.isRunning = true;
    state.isPaused = false;
    await QueueStore.saveQueueState(state);

    Logger.info('[Queue Started] Processing pending jobs sequentially...');
    await this.notifyState();

    this.isProcessing = false;
    this.processNext();
  }

  public async pauseQueue(): Promise<void> {
    const state = await QueueStore.getQueueState();
    state.isPaused = true;
    state.isRunning = false;

    // Reset currently active step back to PENDING so resume works cleanly without lockup
    if (state.activeJobId) {
      const activeJob = state.jobs.find((j) => j.id === state.activeJobId);
      if (
        activeJob &&
        (activeJob.status === 'NAVIGATING' ||
          activeJob.status === 'PAGE_READY' ||
          activeJob.status === 'GENERATING')
      ) {
        activeJob.status = 'PENDING';
      }
      state.activeJobId = null;
    }

    if (this.activeJobAbortController) {
      this.activeJobAbortController.abort();
      this.activeJobAbortController = null;
    }

    await QueueStore.saveQueueState(state);
    Logger.info('[Queue Paused] Sequential queue paused. Safe to resume at any time.');
    await this.notifyState();
  }

  public async resumeQueue(): Promise<void> {
    Logger.info('[Queue Resumed] Resuming sequential queue execution.');
    await this.startQueue();
  }

  public async retryJob(jobId: string): Promise<QueueJob | null> {
    const job = await QueueStore.resetFailedJob(jobId);
    if (job) {
      Logger.info(`[Queue] Job ${jobId} reset to PENDING (retryCount: 0).`);
      await this.notifyState();
      const state = await QueueStore.getQueueState();
      if (state.isRunning && !state.isPaused) {
        this.processNext();
      }
    }
    return job;
  }

  public async processNext(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const state = await QueueStore.getQueueState();
      if (!state.isRunning || state.isPaused) {
        this.isProcessing = false;
        return;
      }

      // Check if there is already a live in-flight job running
      const activeJob = state.jobs.find(
        (j) =>
          j.status === 'NAVIGATING' ||
          j.status === 'PAGE_READY' ||
          j.status === 'GENERATING' ||
          j.status === 'WAITING_FOR_DOWNLOAD'
      );

      if (activeJob && state.activeJobId === activeJob.id) {
        Logger.info(`[Queue] Job ${activeJob.id} is currently active. Waiting for completion before next.`);
        this.isProcessing = false;
        return;
      }

      // Find first PENDING job
      const nextJob = state.jobs.find((j) => j.status === 'PENDING');
      if (!nextJob) {
        Logger.info('[Queue Completed] All pending jobs in queue have been processed.');
        state.isRunning = false;
        state.activeJobId = null;
        await QueueStore.saveQueueState(state);
        await this.notifyState();
        this.isProcessing = false;
        return;
      }

      // Execute next job sequentially (1 at a time)
      await this.executeJob(nextJob);
    } catch (err) {
      Logger.error(`[Queue Error] Unexpected queue processing error: ${err}`);
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeJob(job: QueueJob): Promise<void> {
    this.activeJobAbortController = new AbortController();

    // Verify job is still valid and PENDING (duplicate execution guard)
    const freshJobs = await QueueStore.getQueue();
    const freshJob = freshJobs.find((j) => j.id === job.id);
    if (!freshJob || freshJob.status !== 'PENDING') {
      Logger.warn(`[Queue Guard] Skipping job #${job.id} because status is ${freshJob?.status ?? 'NOT_FOUND'}`);
      await QueueStore.updateQueueState({ activeJobId: null });
      return;
    }

    await QueueStore.updateQueueState({ activeJobId: job.id });

    Logger.info(`[Queue Executing] Processing job #${job.id} - ${job.returnType} (${job.period} ${job.financialYear})`);

    try {
      // Step 1: NAVIGATING
      await QueueStore.updateJob(job.id, {
        status: 'NAVIGATING',
        startedAt: Date.now(),
        error: null,
      });
      await this.notifyState();
      await sleep(QUEUE_CONFIG.STEP_DELAY_MS);

      // Check pause between steps
      if (await this.isPaused()) {
        await this.rollbackToPendingIfInterrupted(job.id);
        return;
      }

      if (job.isTestJob) {
        // Step 2: PAGE_READY
        await QueueStore.updateJob(job.id, { status: 'PAGE_READY' });
        await this.notifyState();
        await sleep(QUEUE_CONFIG.STEP_DELAY_MS);

        if (await this.isPaused()) {
          await this.rollbackToPendingIfInterrupted(job.id);
          return;
        }

        // Step 3: GENERATING
        await QueueStore.updateJob(job.id, { status: 'GENERATING' });
        await this.notifyState();
        await sleep(QUEUE_CONFIG.STEP_DELAY_MS);

        if (await this.isPaused()) {
          await this.rollbackToPendingIfInterrupted(job.id);
          return;
        }

        // Step 4: WAITING_FOR_DOWNLOAD
        await QueueStore.updateJob(job.id, { status: 'WAITING_FOR_DOWNLOAD' });
        await this.notifyState();

        // Safe Test Job Execution
        const simulatedFilename = `${job.gstin}_${job.returnType}_${job.period}_${job.financialYear.replace('-', '')}.json`;
        const downloadId = this.downloadMonitor.simulateDownload(simulatedFilename, 'complete', job.id);

        await QueueStore.updateJob(job.id, {
          browserDownloadId: downloadId,
          filename: simulatedFilename,
        });

        // Wait for the simulated download to complete
        await sleep(1500);

        // Re-fetch updated status
        const updatedJob = (await QueueStore.getQueue()).find((j) => j.id === job.id);
        if (updatedJob && updatedJob.status === 'DOWNLOADED') {
          Logger.info(`[Queue Success] Test Job ${job.id} reached DOWNLOADED state safely.`);
        }
      } else {
        // Milestone 4 — Multi-Return (GSTR-1, GSTR-2A, GSTR-2B, GSTR-3B) Live Portal Automation
        const adapter = getAdapterForReturnType(job.returnType);
        Logger.info(`[Queue M4] Executing ${job.returnType} Portal Automation for ${job.gstin} (${job.period} ${job.financialYear})...`);

        // Check if running in browser extension context with tabs
        let tabUrl = '';
        let tabTitle = '';
        if (typeof chrome !== 'undefined' && chrome.tabs) {
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
              tabUrl = tab.url || '';
              tabTitle = tab.title || '';
            }
          } catch {
            // Tab query fallback
          }
        }

        const portalStatus = detectPortalStatus(tabUrl, { title: tabTitle });
        if (portalStatus.isGSTPortal && portalStatus.isLoggedIn === false) {
          Logger.warn('[Queue Auth Guard] GST Portal detected but user is not logged in. Pausing queue for manual authentication.');
          await QueueStore.updateJob(job.id, {
            status: 'PENDING',
            error: 'GST Portal detected. Please log in manually. The extension does not handle your GST password, OTP or CAPTCHA.',
          });
          await this.pauseQueue();
          return;
        }

        // 1. Navigation & Period Selection
        try {
          await adapter.navigateToPeriod(job.gstin, job.financialYear, job.period);
        } catch (navErr: unknown) {
          const errMsg = navErr instanceof Error ? navErr.message : String(navErr);
          if (errMsg.includes('GSTIN mismatch') || errMsg.includes('Unable to verify GSTIN')) {
            Logger.warn(`[GSTIN Safety] ${errMsg}`);
            await this.handleJobFailure(job, 'Unable to verify GSTIN on GST Portal. Manual confirmation required.');
            return;
          }
          if (errMsg.includes('unavailable')) {
            Logger.warn(`[Period Guard] ${errMsg}`);
            await this.handleJobFailure(job, `Requested ${job.returnType} period '${job.period}' is unavailable on GST Portal.`);
            return;
          }
          throw navErr;
        }

        // 2. PAGE_READY
        await QueueStore.updateJob(job.id, { status: 'PAGE_READY' });
        await this.notifyState();
        await sleep(QUEUE_CONFIG.STEP_DELAY_MS);

        if (await this.isPaused()) {
          await this.rollbackToPendingIfInterrupted(job.id);
          return;
        }

        // 3. GENERATING (Trigger JSON generation)
        await QueueStore.updateJob(job.id, { status: 'GENERATING' });
        await this.notifyState();

        if (adapter.triggerGenerateJson) {
          const genRes = await adapter.triggerGenerateJson();
          if (!genRes.success) {
            throw new Error(genRes.error || `Failed to trigger ${job.returnType} JSON generation on GST Portal`);
          }
        }

        // 4. WAITING_FOR_DOWNLOAD (Poll for generated link and trigger browser download)
        await QueueStore.updateJob(job.id, { status: 'WAITING_FOR_DOWNLOAD' });
        await this.notifyState();

        if (adapter.waitForGeneratedJsonAndDownload) {
          const waitRes = await adapter.waitForGeneratedJsonAndDownload({
            abortSignal: this.activeJobAbortController?.signal,
          });

          if (!waitRes.success || !waitRes.downloadTriggered) {
            throw new Error(waitRes.error || `Timed out waiting for GST Portal to generate ${job.returnType} JSON file`);
          }
        }

        Logger.info(`[Queue] ${job.returnType} JSON download initiated on GST Portal. Awaiting Chrome download event...`);
      }

      // Clear activeJobId
      await QueueStore.updateQueueState({ activeJobId: null });
      await this.notifyState();

      // Trigger next pending job sequentially if queue is still running
      const finalState = await QueueStore.getQueueState();
      if (finalState.isRunning && !finalState.isPaused) {
        setTimeout(() => {
          this.processNext();
        }, 400);
      }
    } catch (err) {
      Logger.warn(`[Queue Execution Exception] Job ${job.id} failed with error: ${String(err)}`);
      await this.handleJobFailure(job, `Execution error: ${String(err)}`);

      // Trigger next pending job sequentially if queue is still running
      const finalState = await QueueStore.getQueueState();
      if (finalState.isRunning && !finalState.isPaused) {
        setTimeout(() => {
          this.processNext();
        }, 400);
      }
    } finally {
      this.activeJobAbortController = null;
    }
  }

  private async rollbackToPendingIfInterrupted(jobId: string): Promise<void> {
    const jobs = await QueueStore.getQueue();
    const job = jobs.find((j) => j.id === jobId);
    if (
      job &&
      (job.status === 'NAVIGATING' ||
        job.status === 'PAGE_READY' ||
        job.status === 'GENERATING')
    ) {
      await QueueStore.updateJob(jobId, {
        status: 'PENDING',
        error: null,
      });
      await QueueStore.updateQueueState({ activeJobId: null });
      await this.notifyState();
    }
  }

  public async handleJobFailure(
    jobOrId: QueueJob | string,
    errorMsg: string
  ): Promise<QueueJob | null> {
    const jobId = typeof jobOrId === 'string' ? jobOrId : jobOrId.id;
    const freshJobs = await QueueStore.getQueue();
    const existingJob =
      freshJobs.find((j) => j.id === jobId) ||
      (typeof jobOrId === 'object' ? jobOrId : null);

    if (!existingJob) {
      Logger.warn(`[Queue] Cannot handle failure: Job ${jobId} not found.`);
      return null;
    }

    const currentRetries = (existingJob.retryCount || 0) + 1;
    const maxRetries = existingJob.maxRetries || QUEUE_CONFIG.MAX_RETRIES;

    let updatedJob: QueueJob | null = null;

    if (currentRetries >= maxRetries) {
      Logger.warn(
        `[Job Failed Permanently] Job ${jobId} reached max retries (${maxRetries}). Status: FAILED — Manual action required.`
      );
      updatedJob = await QueueStore.updateJob(jobId, {
        status: 'FAILED',
        error: `FAILED — Manual action required (${errorMsg})`,
        retryCount: maxRetries,
        completedAt: Date.now(),
      });
    } else {
      Logger.warn(
        `[Job Retry Scheduled] Job ${jobId} attempt ${currentRetries}/${maxRetries} failed: ${errorMsg}. Retrying...`
      );
      updatedJob = await QueueStore.updateJob(jobId, {
        status: 'PENDING',
        error: `Attempt ${currentRetries} of ${maxRetries} failed: ${errorMsg} (Retry scheduled)`,
        retryCount: currentRetries,
      });
    }

    await QueueStore.updateQueueState({ activeJobId: null });
    await this.notifyState();

    return updatedJob;
  }

  private async isPaused(): Promise<boolean> {
    const state = await QueueStore.getQueueState();
    return !state.isRunning || state.isPaused;
  }

  public subscribe(listener: (state: QueueState) => void): () => void {
    this.queueListeners.push(listener);
    return () => {
      const idx = this.queueListeners.indexOf(listener);
      if (idx !== -1) {
        this.queueListeners.splice(idx, 1);
      }
    };
  }

  private async notifyState(): Promise<void> {
    const state = await QueueStore.getQueueState();
    this.queueListeners.forEach((fn) => {
      try {
        fn(state);
      } catch (err) {
        console.error('Error in queue listener:', err);
      }
    });
  }
}
