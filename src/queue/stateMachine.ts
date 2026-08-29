import { QueueStatus } from './queueTypes';
import { Logger } from '../shared/logger';

/**
 * Milestone 1.1 Formal Queue Job State Machine Transitions
 */
export const VALID_TRANSITIONS: Record<QueueStatus, readonly QueueStatus[]> = {
  PENDING: ['NAVIGATING', 'CANCELLED', 'FAILED', 'PAUSED'],
  NAVIGATING: ['PAGE_READY', 'PENDING', 'FAILED', 'CANCELLED', 'PAUSED'],
  PAGE_READY: ['GENERATING', 'WAITING_FOR_DOWNLOAD', 'PENDING', 'FAILED', 'CANCELLED', 'PAUSED'],
  GENERATING: ['WAITING_FOR_DOWNLOAD', 'PENDING', 'FAILED', 'CANCELLED', 'PAUSED'],
  WAITING_FOR_DOWNLOAD: ['DOWNLOADED', 'PENDING', 'FAILED', 'CANCELLED', 'PAUSED'],
  DOWNLOADED: ['VALIDATING', 'IMPORTED', 'SYNCED', 'PENDING'],
  VALIDATING: ['IMPORTED', 'FAILED', 'PENDING'],
  IMPORTED: ['SYNCED', 'PENDING'],
  SYNCED: ['PENDING'],
  PAUSED: ['PENDING', 'NAVIGATING', 'CANCELLED', 'FAILED'],
  FAILED: ['PENDING'], // Can be manually retried / reset to PENDING
  CANCELLED: ['PENDING'], // Can be re-queued to PENDING
} as const;

export function isValidTransition(from: QueueStatus, to: QueueStatus): boolean {
  if (from === to) return true; // Idempotent no-op
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function assertValidTransition(from: QueueStatus, to: QueueStatus, jobId?: string): void {
  if (!isValidTransition(from, to)) {
    const msg = `[State Machine Error] Invalid job state transition from '${from}' to '${to}'${jobId ? ` for job ${jobId}` : ''}`;
    Logger.error(msg);
    throw new Error(msg);
  }
}
