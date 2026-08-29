import { STORAGE_KEYS } from '../shared/constants';
import { LogEntry } from '../shared/logger';
import { QueueJob, QueueState } from '../queue/queueTypes';

/**
 * Universal Storage Layer
 * Supports Chrome Extension `chrome.storage.local` with fallback to browser `localStorage`
 */
export class ExtensionStorage {
  private static memoryFallback: Record<string, string> = {};

  private static isChromeStorageAvailable(): boolean {
    return (
      typeof chrome !== 'undefined' &&
      typeof chrome.storage !== 'undefined' &&
      typeof chrome.storage.local !== 'undefined'
    );
  }

  private static isLocalStorageAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  }

  public static async get<T>(key: string, defaultValue: T): Promise<T> {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
          if (chrome.runtime.lastError) {
            console.error('chrome.storage.local error:', chrome.runtime.lastError);
            resolve(defaultValue);
          } else {
            resolve(result[key] !== undefined ? (result[key] as T) : defaultValue);
          }
        });
      });
    } else if (this.isLocalStorageAvailable()) {
      try {
        const item = window.localStorage.getItem(key);
        return item ? (JSON.parse(item) as T) : defaultValue;
      } catch {
        return defaultValue;
      }
    } else {
      const item = this.memoryFallback[key];
      return item ? (JSON.parse(item) as T) : defaultValue;
    }
  }

  public static async set<T>(key: string, value: T): Promise<void> {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.set({ [key]: value }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
    } else if (this.isLocalStorageAvailable()) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (err) {
        console.error('localStorage setItem error:', err);
      }
    } else {
      this.memoryFallback[key] = JSON.stringify(value);
    }
  }

  public static async remove(key: string): Promise<void> {
    if (this.isChromeStorageAvailable()) {
      return new Promise((resolve) => {
        chrome.storage.local.remove([key], () => resolve());
      });
    } else if (this.isLocalStorageAvailable()) {
      window.localStorage.removeItem(key);
    } else {
      delete this.memoryFallback[key];
    }
  }

  // Queue Specific Helpers
  public static async getQueueState(): Promise<QueueState> {
    return this.get<QueueState>(STORAGE_KEYS.QUEUE, {
      jobs: [],
      isRunning: false,
      isPaused: false,
      activeJobId: null,
      lastUpdated: Date.now(),
    });
  }

  public static async saveQueueState(state: QueueState): Promise<void> {
    await this.set(STORAGE_KEYS.QUEUE, {
      ...state,
      lastUpdated: Date.now(),
    });
  }

  public static async updateQueueState(
    partial: Partial<Omit<QueueState, 'jobs'>> & { jobs?: QueueJob[] }
  ): Promise<QueueState> {
    const current = await this.getQueueState();
    const updated: QueueState = {
      ...current,
      ...partial,
      jobs: partial.jobs ?? current.jobs,
      lastUpdated: Date.now(),
    };
    await this.saveQueueState(updated);
    return updated;
  }

  public static async getJobs(): Promise<QueueJob[]> {
    const state = await this.getQueueState();
    return state.jobs;
  }

  public static async saveJobs(jobs: QueueJob[]): Promise<void> {
    const current = await this.getQueueState();
    await this.saveQueueState({
      ...current,
      jobs,
    });
  }

  // Download Associations Helpers (Persistent downloadId -> jobId mapping)
  public static async getDownloadAssociations(): Promise<Record<string, string>> {
    return this.get<Record<string, string>>(STORAGE_KEYS.DOWNLOAD_ASSOCIATIONS, {});
  }

  public static async saveDownloadAssociations(associations: Record<string, string>): Promise<void> {
    await this.set(STORAGE_KEYS.DOWNLOAD_ASSOCIATIONS, associations);
  }

  public static async setDownloadAssociation(downloadId: number, jobId: string): Promise<void> {
    const map = await this.getDownloadAssociations();
    map[String(downloadId)] = jobId;
    await this.saveDownloadAssociations(map);
  }

  public static async removeDownloadAssociation(downloadId: number): Promise<void> {
    const map = await this.getDownloadAssociations();
    delete map[String(downloadId)];
    await this.saveDownloadAssociations(map);
  }

  // Logs Specific Helpers
  public static async getLogs(): Promise<LogEntry[]> {
    return this.get<LogEntry[]>(STORAGE_KEYS.LOGS, []);
  }

  public static async saveLogs(logs: LogEntry[]): Promise<void> {
    await this.set(STORAGE_KEYS.LOGS, logs.slice(0, 100));
  }
}
