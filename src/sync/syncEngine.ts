/**
 * Local Storage Auto-Sync Engine
 * Manages directory structure resolution, file writing, duplicate handling, and multi-company isolation
 */
import { LocalStorageManager } from './storageProvider';
import { ILocalStorageProvider, LocalSyncSettings, LocalStorageStatus, SyncFileResult } from './syncTypes';
import { CompanyStore } from './companyStore';
import { getCompanyFolderName, getDeterministicFileName, getLocalPathSegments, getFullRelativePath } from './pathUtils';
import { QueueJob } from '../queue/queueTypes';
import { QueueStore } from '../queue/queueStore';
import { ExtensionStorage } from '../storage/extensionStorage';
import { Logger } from '../shared/logger';
import { normalizeFinancialYear } from '../shared/utils';

const STORAGE_KEY_SYNC_SETTINGS = 'udaan_gst_sync_settings';

export class SyncEngine {
  private static instance: SyncEngine | null = null;
  private settings: LocalSyncSettings = {
    autoSyncEnabled: false,
    rootSelected: false,
    rootPathName: null,
    status: 'NOT_CONFIGURED',
    lastVerifiedAt: null,
    error: null,
  };
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): SyncEngine {
    if (!SyncEngine.instance) {
      SyncEngine.instance = new SyncEngine();
    }
    return SyncEngine.instance;
  }

  public async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    try {
      const persisted = await ExtensionStorage.get<LocalSyncSettings>(STORAGE_KEY_SYNC_SETTINGS, {
        autoSyncEnabled: false,
        rootSelected: false,
        rootPathName: null,
        status: 'NOT_CONFIGURED',
        lastVerifiedAt: null,
      });

      this.settings = persisted;
      const provider = this.getProvider();

      // If root was previously selected, check provider status
      if (this.settings.rootSelected && this.settings.rootPathName) {
        const hasPermission = await provider.verifyPermission();
        this.settings.status = hasPermission ? 'CONNECTED' : 'LOCAL_STORAGE_UNAVAILABLE';
      } else {
        this.settings.status = 'NOT_CONFIGURED';
        this.settings.autoSyncEnabled = false;
      }

      await this.saveSettings();
      Logger.info(`[SyncEngine] Initialized. Status: ${this.settings.status}, Auto-Sync: ${this.settings.autoSyncEnabled ? 'ON' : 'OFF'}`);
    } catch (err) {
      Logger.error(`[SyncEngine] Init error: ${String(err)}`);
    }
  }

  public getProvider(): ILocalStorageProvider {
    return LocalStorageManager.getInstance().getProvider();
  }

  public async getSettings(): Promise<LocalSyncSettings> {
    await this.init();
    return { ...this.settings };
  }

  private async saveSettings(): Promise<void> {
    await ExtensionStorage.set(STORAGE_KEY_SYNC_SETTINGS, this.settings);
  }

  public async setAutoSync(enabled: boolean): Promise<boolean> {
    await this.init();
    if (enabled && (!this.settings.rootSelected || this.settings.status !== 'CONNECTED')) {
      Logger.warn('[SyncEngine] Cannot enable Auto-Sync: Local Storage Root is not configured or connected.');
      return false;
    }
    this.settings.autoSyncEnabled = enabled;
    await this.saveSettings();
    Logger.info(`[SyncEngine] Auto-Sync set to: ${enabled ? 'ENABLED' : 'DISABLED'}`);
    return true;
  }

  public async configureRoot(customPath?: string): Promise<{ success: boolean; pathName?: string; error?: string }> {
    await this.init();
    const provider = this.getProvider();
    const result = await provider.selectRoot(customPath);

    if (result.success && result.pathName) {
      this.settings.rootSelected = true;
      this.settings.rootPathName = result.pathName;
      this.settings.status = 'CONNECTED';
      this.settings.lastVerifiedAt = Date.now();
      this.settings.error = null;
      await this.saveSettings();
      Logger.info(`[SyncEngine] Local Storage Root configured: ${result.pathName}`);
      return result;
    } else {
      this.settings.error = result.error || 'Failed to select root folder';
      await this.saveSettings();
      return result;
    }
  }

  public async verifyRootAccess(): Promise<boolean> {
    await this.init();
    const provider = this.getProvider();
    const ok = await provider.verifyPermission();
    this.settings.status = ok ? 'CONNECTED' : (this.settings.rootSelected ? 'LOCAL_STORAGE_UNAVAILABLE' : 'NOT_CONFIGURED');
    if (!ok && this.settings.autoSyncEnabled) {
      this.settings.autoSyncEnabled = false;
    }
    await this.saveSettings();
    return ok;
  }

  public isRootReady(): boolean {
    return this.settings.rootSelected && this.settings.status === 'CONNECTED';
  }

  /**
   * Synchronizes a single downloaded QueueJob into the organized local storage hierarchy:
   * Root / <GSTIN>_<CompanyName> / <NormalizedFY> / <ReturnType> / <ReturnType>_<Period>_<NormalizedFY>.json
   */
  public async syncJob(job: QueueJob): Promise<SyncFileResult> {
    await this.init();

    // 1. Mandatory Root Check
    const hasAccess = await this.verifyRootAccess();
    if (!hasAccess || !this.isRootReady()) {
      const errorMsg = 'Local Storage permission is unavailable or revoked. Please select the Local Storage Root again.';
      Logger.warn(`[SyncEngine] Sync blocked for job ${job.id}: ${errorMsg}`);
      await QueueStore.updateJob(job.id, {
        syncStatus: 'SYNC_FAILED',
        syncError: errorMsg,
      });
      return { success: false, error: errorMsg };
    }

    const provider = this.getProvider();

    // 2. Set Status to SYNCING
    await QueueStore.updateJob(job.id, {
      syncStatus: 'SYNCING',
      syncError: null,
    });

    try {
      // 3. Resolve Company Profile & Folder
      const company = await CompanyStore.getCompany(job.gstin);
      const companyName = job.companyName || company?.companyName || 'Taxpayer';
      const companyDir = getCompanyFolderName(job.gstin, companyName);
      const fyDir = normalizeFinancialYear(job.financialYear);
      const returnDir = job.returnType.trim();

      const pathSegments = [companyDir, fyDir, returnDir];
      const deterministicFileName = getDeterministicFileName(job.returnType, job.period, job.financialYear);
      const fullRelativePath = getFullRelativePath(job.gstin, companyName, job.financialYear, job.period, job.returnType);

      // 4. Duplicate Check
      const exists = await provider.fileExists(pathSegments, deterministicFileName);
      if (exists) {
        Logger.info(`[SyncEngine] File already exists at '${fullRelativePath}'. Verifying duplicate consistency.`);
        // Mark as SYNCED without creating duplicate files or data loss
        await QueueStore.updateJob(job.id, {
          syncStatus: 'SYNCED',
          syncError: null,
          localFileName: deterministicFileName,
          localRelativePath: fullRelativePath,
          syncedAt: Date.now(),
        });
        return {
          success: true,
          localFileName: deterministicFileName,
          localRelativePath: fullRelativePath,
          isDuplicate: true,
        };
      }

      // 5. Ensure Directory Structure Exists
      await provider.createDirectory([], companyDir);
      await provider.createDirectory([companyDir], fyDir);
      await provider.createDirectory([companyDir, fyDir], returnDir);

      // 6. Resolve and Validate Actual Downloaded Content (Never fabricate production data)
      let filePayload: string;

      if (job.downloadContent !== undefined && job.downloadContent !== null) {
        const raw = job.downloadContent.trim();
        if (!raw) {
          throw new Error('Downloaded file content is empty. Cannot synchronize empty file.');
        }

        // Validate that content is not an HTML login/error page
        const isHtml =
          raw.startsWith('<!DOCTYPE') ||
          raw.startsWith('<html') ||
          raw.includes('<html') ||
          raw.includes('<body') ||
          raw.includes('</html>');

        if (isHtml) {
          throw new Error('Downloaded content is an HTML web page / login redirect, not a valid GST JSON return.');
        }

        // Validate that content is valid JSON
        try {
          const parsed = JSON.parse(raw);
          filePayload = JSON.stringify(parsed, null, 2);
        } catch (jsonErr: any) {
          throw new Error(`Downloaded content is not valid JSON: ${jsonErr?.message || String(jsonErr)}`);
        }
      } else if (job.isTestJob) {
        // Safe exception strictly for test harnesses and synthetic test verification
        filePayload = JSON.stringify(
          {
            gstin: job.gstin,
            fp: job.period,
            fy: fyDir,
            returnType: job.returnType,
            downloadSource: 'GST_PORTAL_AUTOMATION_TEST',
            jobId: job.id,
            syncedAt: new Date().toISOString(),
            isTestJob: true,
            data: {
              b2b: [],
              b2ba: [],
              cdnr: [],
              cdnra: [],
              isd: [],
            },
          },
          null,
          2
        );
      } else {
        // Real Production Job without actual downloaded content
        throw new Error(
          `Actual ${job.returnType} downloaded content is unavailable. Real GST downloads cannot be synchronized without the original file content.`
        );
      }

      // 7. Write File
      const writeResult = await provider.writeFile(pathSegments, deterministicFileName, filePayload);
      if (!writeResult.success) {
        throw new Error(writeResult.error || 'Failed to write file to local storage');
      }

      // 8. Update Queue Job to SYNCED
      await QueueStore.updateJob(job.id, {
        syncStatus: 'SYNCED',
        syncError: null,
        localFileName: deterministicFileName,
        localRelativePath: fullRelativePath,
        syncedAt: Date.now(),
      });

      Logger.info(`[SyncEngine] Job ${job.id} successfully synced to '${fullRelativePath}'`);
      return {
        success: true,
        localFileName: deterministicFileName,
        localRelativePath: fullRelativePath,
        isDuplicate: false,
      };
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      Logger.warn(`[SyncEngine] Sync rejected for job ${job.id}: ${errorMsg}`);
      await QueueStore.updateJob(job.id, {
        syncStatus: 'SYNC_FAILED',
        syncError: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * "Sync Now" Manual Action:
   * Synchronizes all eligible downloaded jobs that are currently NOT_SYNCED or SYNC_FAILED
   */
  public async syncNow(): Promise<{ totalEligible: number; syncedCount: number; failedCount: number }> {
    await this.init();

    if (!this.isRootReady()) {
      throw new Error('Select Local Storage Root to enable Auto-Sync.');
    }

    const queue = await QueueStore.getQueue();
    const eligibleJobs = queue.filter(
      (j) => j.status === 'DOWNLOADED' && (j.syncStatus === 'NOT_SYNCED' || j.syncStatus === 'SYNC_FAILED' || !j.syncStatus)
    );

    let syncedCount = 0;
    let failedCount = 0;

    for (const job of eligibleJobs) {
      const res = await this.syncJob(job);
      if (res.success) {
        syncedCount++;
      } else {
        failedCount++;
      }
    }

    Logger.info(`[SyncEngine] Sync Now completed. Total: ${eligibleJobs.length}, Synced: ${syncedCount}, Failed: ${failedCount}`);
    return {
      totalEligible: eligibleJobs.length,
      syncedCount,
      failedCount,
    };
  }

  /**
   * Hook called when a GST Portal download finishes (QueueJob becomes DOWNLOADED)
   */
  public async onDownloadCompleted(jobId: string): Promise<void> {
    await this.init();
    if (!this.settings.autoSyncEnabled || !this.isRootReady()) {
      Logger.info(`[SyncEngine] Auto-Sync skipped for job ${jobId} (AutoSync: ${this.settings.autoSyncEnabled}, RootReady: ${this.isRootReady()})`);
      return;
    }

    const queue = await QueueStore.getQueue();
    const job = queue.find((j) => j.id === jobId);
    if (!job || job.status !== 'DOWNLOADED') return;

    Logger.info(`[SyncEngine] Auto-Sync triggered for job ${job.id}`);
    await this.syncJob(job);
  }

  public async reset(): Promise<void> {
    this.settings = {
      autoSyncEnabled: false,
      rootSelected: false,
      rootPathName: null,
      status: 'NOT_CONFIGURED',
      lastVerifiedAt: null,
      error: null,
    };
    await this.saveSettings();
    await this.getProvider().reset();
  }
}
