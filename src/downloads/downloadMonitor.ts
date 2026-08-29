import { Logger } from '../shared/logger';
import { ExtensionStorage } from '../storage/extensionStorage';

export interface DownloadItemInfo {
  id: number;
  filename: string;
  state: 'in_progress' | 'complete' | 'interrupted';
  bytesReceived: number;
  totalBytes: number;
  error?: string | null;
  startTime: number;
  endTime?: number;
}

export type DownloadEventListener = (info: DownloadItemInfo) => void;

export class DownloadMonitor {
  private static instance: DownloadMonitor | null = null;
  private trackedDownloads: Map<number, DownloadItemInfo> = new Map();
  private jobAssociations: Map<number, string> = new Map(); // downloadId -> jobId
  private listeners: Set<DownloadEventListener> = new Set();
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): DownloadMonitor {
    if (!DownloadMonitor.instance) {
      DownloadMonitor.instance = new DownloadMonitor();
    }
    return DownloadMonitor.instance;
  }

  public async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // 1. Hydrate persistent download associations from storage (survives Service Worker restarts)
    try {
      const persisted = await ExtensionStorage.getDownloadAssociations();
      for (const [dIdStr, jId] of Object.entries(persisted)) {
        const dId = Number(dIdStr);
        if (!isNaN(dId) && jId) {
          this.jobAssociations.set(dId, jId);
        }
      }
      Logger.info(`[Download Monitor] Restored ${this.jobAssociations.size} persistent download association(s)`);
    } catch (err) {
      Logger.error(`[Download Monitor] Failed to load persistent associations: ${String(err)}`);
    }

    // 2. Set up Chrome downloads event listeners if running in extension environment
    if (typeof chrome !== 'undefined' && chrome.downloads) {
      Logger.info('[Download Monitor] Initializing chrome.downloads listener');

      chrome.downloads.onCreated.addListener((item) => {
        const info: DownloadItemInfo = {
          id: item.id,
          filename: item.filename || 'downloading...',
          state: (item.state as 'in_progress' | 'complete' | 'interrupted') || 'in_progress',
          bytesReceived: item.bytesReceived || 0,
          totalBytes: item.totalBytes || 0,
          startTime: Date.now(),
        };

        this.trackedDownloads.set(item.id, info);
        Logger.info(`[Download Detected] ID ${item.id}: ${info.filename}`, { downloadId: item.id });
        this.notifyListeners(info);
      });

      chrome.downloads.onChanged.addListener(async (delta) => {
        const existing = this.trackedDownloads.get(delta.id) || {
          id: delta.id,
          filename: delta.filename?.current || 'unknown',
          state: 'in_progress',
          bytesReceived: 0,
          totalBytes: 0,
          startTime: Date.now(),
        };

        if (delta.filename) {
          existing.filename = delta.filename.current;
        }

        if (delta.state) {
          existing.state = delta.state.current as 'in_progress' | 'complete' | 'interrupted';
          if (existing.state === 'complete') {
            existing.endTime = Date.now();
            Logger.info(`[Download Complete] ID ${delta.id}: ${existing.filename}`, { downloadId: delta.id });
          } else if (existing.state === 'interrupted') {
            existing.error = delta.error?.current || 'Download interrupted';
            Logger.warn(`[Download Interrupted] ID ${delta.id}: ${existing.error}`, { downloadId: delta.id });
          }
        }

        if (delta.error) {
          existing.error = delta.error.current;
        }

        this.trackedDownloads.set(delta.id, existing);
        this.notifyListeners(existing);
      });
    } else {
      Logger.info('[Download Monitor] Running in sandbox/preview mode (chrome.downloads simulated)');
    }
  }

  public associateDownloadWithJob(downloadId: number, jobId: string): void {
    this.jobAssociations.set(downloadId, jobId);
    // Write persistently to storage to survive Service Worker idle shutdowns
    ExtensionStorage.setDownloadAssociation(downloadId, jobId).catch((err) => {
      Logger.error(`[Download Monitor] Failed to persist association ${downloadId} -> ${jobId}: ${String(err)}`);
    });
    Logger.info(`[Download Association] Associated download #${downloadId} with job ${jobId} (persisted)`);
  }

  public getAssociatedJobId(downloadId: number): string | undefined {
    return this.jobAssociations.get(downloadId);
  }

  public async getAssociatedJobIdAsync(downloadId: number): Promise<string | undefined> {
    if (this.jobAssociations.has(downloadId)) {
      return this.jobAssociations.get(downloadId);
    }
    const persisted = await ExtensionStorage.getDownloadAssociations();
    const found = persisted[String(downloadId)];
    if (found) {
      this.jobAssociations.set(downloadId, found);
    }
    return found;
  }

  public getDownload(downloadId: number): DownloadItemInfo | undefined {
    return this.trackedDownloads.get(downloadId);
  }

  public getAllDownloads(): DownloadItemInfo[] {
    return Array.from(this.trackedDownloads.values());
  }

  public subscribe(listener: DownloadEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(info: DownloadItemInfo): void {
    this.listeners.forEach((fn) => {
      try {
        fn(info);
      } catch (err) {
        console.error('Error in download listener:', err);
      }
    });
  }

  /**
   * Reconciles any downloads that finished while the service worker was sleeping or restarting
   */
  public async queryDownloadState(downloadId: number): Promise<DownloadItemInfo | null> {
    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.search) {
      return new Promise((resolve) => {
        chrome.downloads.search({ id: downloadId }, (items) => {
          if (items && items.length > 0) {
            const it = items[0];
            const info: DownloadItemInfo = {
              id: it.id,
              filename: it.filename,
              state: (it.state as 'in_progress' | 'complete' | 'interrupted') || 'in_progress',
              bytesReceived: it.bytesReceived,
              totalBytes: it.totalBytes,
              error: it.error,
              startTime: it.startTime ? new Date(it.startTime).getTime() : Date.now(),
              endTime: it.endTime ? new Date(it.endTime).getTime() : undefined,
            };
            this.trackedDownloads.set(it.id, info);
            resolve(info);
          } else {
            resolve(null);
          }
        });
      });
    }
    return this.trackedDownloads.get(downloadId) || null;
  }

  /**
   * Helper to simulate a browser download event (used for test jobs and sandbox verification)
   */
  public simulateDownload(
    filename: string,
    outcome: 'complete' | 'interrupted' = 'complete',
    associatedJobId?: string
  ): number {
    const downloadId = Math.floor(Math.random() * 900000) + 100000;
    const info: DownloadItemInfo = {
      id: downloadId,
      filename,
      state: 'in_progress',
      bytesReceived: 0,
      totalBytes: 1024 * 45,
      startTime: Date.now(),
    };

    this.trackedDownloads.set(downloadId, info);
    if (associatedJobId) {
      this.associateDownloadWithJob(downloadId, associatedJobId);
    }

    Logger.info(`[Download Detected] ID ${downloadId}: ${filename}`, { downloadId });
    this.notifyListeners(info);

    // Simulate progress and completion after delay
    setTimeout(() => {
      if (outcome === 'complete') {
        info.state = 'complete';
        info.bytesReceived = info.totalBytes;
        info.endTime = Date.now();
        Logger.info(`[Download Complete] ID ${downloadId}: ${filename}`, { downloadId });
      } else {
        info.state = 'interrupted';
        info.error = 'Network connection interrupted during GST return generation';
        Logger.warn(`[Download Interrupted] ID ${downloadId}: ${info.error}`, { downloadId });
      }
      this.trackedDownloads.set(downloadId, info);
      this.notifyListeners(info);
    }, 1200);

    return downloadId;
  }
}
