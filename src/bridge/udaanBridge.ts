import { QueueJob } from '../queue/queueTypes';
import { Logger } from '../shared/logger';

export interface DownloadedFileMetadata {
  jobId: string;
  gstin: string;
  financialYear: string;
  period: string;
  returnType: string;
  filename: string;
  fileSizeBytes?: number;
  checksum?: string;
  downloadedAt: number;
}

export interface UdaanBridgeStatus {
  isConnected: boolean;
  endpointUrl?: string;
  lastPing?: number;
}

/**
 * Udaan Recon Pro Bridge Interface (Future Integration)
 * Milestone 1 creates the contracts and types without forcing an external server.
 */
export class UdaanBridge {
  private static instance: UdaanBridge | null = null;
  private isConnected = false;

  private constructor() {}

  public static getInstance(): UdaanBridge {
    if (!UdaanBridge.instance) {
      UdaanBridge.instance = new UdaanBridge();
    }
    return UdaanBridge.instance;
  }

  public async connect(): Promise<UdaanBridgeStatus> {
    Logger.info('[Udaan Bridge] Initializing local bridge handshake (Milestone 3 planned)...');
    // Milestone 1 returns ready-state without throwing or failing
    this.isConnected = true;
    return {
      isConnected: this.isConnected,
      lastPing: Date.now(),
    };
  }

  public async sendJobStatus(job: QueueJob): Promise<{ success: boolean; message: string }> {
    Logger.info(`[Udaan Bridge] Buffering job status update for ${job.id} (${job.status})`);
    return {
      success: true,
      message: `Status for job ${job.id} registered for local bridge sync.`,
    };
  }

  public async sendDownloadedFileMetadata(
    data: DownloadedFileMetadata
  ): Promise<{ success: boolean; message: string }> {
    Logger.info(`[Udaan Bridge] Registered downloaded file: ${data.filename} (${data.returnType} - ${data.period})`);
    return {
      success: true,
      message: `Metadata for ${data.filename} queued for Udaan Reconciliation Import (Milestone 5).`,
    };
  }
}
