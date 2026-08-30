/**
 * Queue Integrity Validator & Safe Recovery Engine
 * Detects structural corruptions, multi-active job anomalies, invalid transitions,
 * and repairs queue state non-destructively without losing taxpayer download requests.
 */
import { QueueJob, QueueState, QueueStatus } from '../queue/queueTypes';
import { areFinancialYearsEquivalent, generateId } from '../shared/utils';
import { GstErrorCode } from './errorClassification';
import { Logger } from '../shared/logger';
import { isValidTransition } from '../queue/stateMachine';

export const VALID_QUEUE_STATUSES: QueueStatus[] = [
  'PENDING',
  'NAVIGATING',
  'PAGE_READY',
  'GENERATING',
  'WAITING_FOR_DOWNLOAD',
  'DOWNLOADED',
  'VALIDATING',
  'IMPORTED',
  'SYNCED',
  'PAUSED',
  'FAILED',
  'CANCELLED',
];

export const ACTIVE_IN_FLIGHT_STATUSES: QueueStatus[] = [
  'NAVIGATING',
  'PAGE_READY',
  'GENERATING',
  'WAITING_FOR_DOWNLOAD',
];

export interface QueueIntegrityViolation {
  code: 'DUPLICATE_JOB_ID' | 'DUPLICATE_RETURN_IDENTITY' | 'INVALID_STATUS' | 'INVALID_ACTIVE_JOB_ID' | 'MULTIPLE_ACTIVE_JOBS' | 'MALFORMED_JOB' | 'INVALID_RETRY_COUNT';
  severity: 'ERROR' | 'WARNING';
  message: string;
  jobId?: string;
  details?: Record<string, unknown>;
}

export interface QueueIntegrityReport {
  isValid: boolean;
  totalJobs: number;
  violations: QueueIntegrityViolation[];
  duplicateIds: string[];
  duplicateIdentities: string[];
  activeJobIssues: string[];
  malformedCount: number;
  checkedAt: number;
}

export class QueueIntegrityValidator {
  /**
   * Evaluates return identity match (GSTIN + FY + Period + ReturnType)
   */
  public static isMatchingReturnIdentity(
    jobA: { gstin?: string; financialYear?: string; period?: string; returnType?: string },
    jobB: { gstin?: string; financialYear?: string; period?: string; returnType?: string }
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
      gstinA.length > 0 &&
      gstinA === gstinB &&
      (fyA === fyB || areFinancialYearsEquivalent(jobA.financialYear || '', jobB.financialYear || '')) &&
      periodA === periodB &&
      returnTypeA === returnTypeB
    );
  }

  /**
   * Audits a QueueState for data integrity, active job consistency, and format compliance.
   */
  public static validate(state: QueueState): QueueIntegrityReport {
    const violations: QueueIntegrityViolation[] = [];
    const seenIds = new Set<string>();
    const duplicateIds: string[] = [];
    const duplicateIdentities: string[] = [];
    const activeJobIssues: string[] = [];
    let malformedCount = 0;

    if (!state || !Array.isArray(state.jobs)) {
      return {
        isValid: false,
        totalJobs: 0,
        violations: [
          {
            code: 'MALFORMED_JOB',
            severity: 'ERROR',
            message: 'Queue state is null or jobs collection is not an array.',
          },
        ],
        duplicateIds: [],
        duplicateIdentities: [],
        activeJobIssues: ['Queue state is not an array'],
        malformedCount: 1,
        checkedAt: Date.now(),
      };
    }

    const activeInFlightJobs: QueueJob[] = [];

    // 1. Inspect each individual job
    for (let i = 0; i < state.jobs.length; i++) {
      const job = state.jobs[i];

      // Structural check
      if (!job || typeof job !== 'object' || !job.id || !job.gstin || !job.returnType) {
        malformedCount++;
        violations.push({
          code: 'MALFORMED_JOB',
          severity: 'ERROR',
          message: `Job at index ${i} is missing required fields (id, gstin, or returnType).`,
          jobId: job?.id,
        });
        continue;
      }

      // Duplicate ID check
      if (seenIds.has(job.id)) {
        duplicateIds.push(job.id);
        violations.push({
          code: 'DUPLICATE_JOB_ID',
          severity: 'ERROR',
          message: `Duplicate job ID detected: '${job.id}'`,
          jobId: job.id,
        });
      } else {
        seenIds.add(job.id);
      }

      // Status validity check
      if (!VALID_QUEUE_STATUSES.includes(job.status)) {
        violations.push({
          code: 'INVALID_STATUS',
          severity: 'ERROR',
          message: `Job '${job.id}' has unrecognized status '${job.status}'`,
          jobId: job.id,
        });
      }

      // Retry count check
      if (typeof job.retryCount !== 'number' || isNaN(job.retryCount) || job.retryCount < 0) {
        violations.push({
          code: 'INVALID_RETRY_COUNT',
          severity: 'WARNING',
          message: `Job '${job.id}' has invalid retryCount (${job.retryCount})`,
          jobId: job.id,
        });
      }

      // In-flight active tracking
      if (ACTIVE_IN_FLIGHT_STATUSES.includes(job.status)) {
        activeInFlightJobs.push(job);
      }

      // Duplicate identity check (against prior jobs)
      for (let j = 0; j < i; j++) {
        const priorJob = state.jobs[j];
        if (
          priorJob &&
          priorJob.id !== job.id &&
          this.isMatchingReturnIdentity(priorJob, job) &&
          priorJob.status !== 'CANCELLED' &&
          priorJob.status !== 'FAILED' &&
          job.status !== 'CANCELLED' &&
          job.status !== 'FAILED'
        ) {
          const idKey = `${job.gstin}_${job.financialYear}_${job.period}_${job.returnType}`;
          duplicateIdentities.push(idKey);
          violations.push({
            code: 'DUPLICATE_RETURN_IDENTITY',
            severity: 'ERROR',
            message: `Duplicate active return identity between jobs '${priorJob.id}' and '${job.id}' (${idKey})`,
            jobId: job.id,
          });
        }
      }
    }

    // 2. Multi-Active Job Invariant Check
    if (activeInFlightJobs.length > 1) {
      const msg = `Invariant Violation: Multiple active in-flight jobs detected (${activeInFlightJobs.map((j) => `${j.id}:${j.status}`).join(', ')})`;
      activeJobIssues.push(msg);
      violations.push({
        code: 'MULTIPLE_ACTIVE_JOBS',
        severity: 'ERROR',
        message: msg,
      });
    }

    // 3. activeJobId Consistency Check
    if (state.activeJobId) {
      const target = state.jobs.find((j) => j.id === state.activeJobId);
      if (!target) {
        const msg = `activeJobId '${state.activeJobId}' references a non-existent job ID.`;
        activeJobIssues.push(msg);
        violations.push({
          code: 'INVALID_ACTIVE_JOB_ID',
          severity: 'ERROR',
          message: msg,
        });
      } else if (!ACTIVE_IN_FLIGHT_STATUSES.includes(target.status) && target.status !== 'PENDING') {
        const msg = `activeJobId '${state.activeJobId}' references job with terminal status '${target.status}'.`;
        activeJobIssues.push(msg);
        violations.push({
          code: 'INVALID_ACTIVE_JOB_ID',
          severity: 'WARNING',
          message: msg,
          jobId: target.id,
        });
      }
    }

    return {
      isValid: violations.filter((v) => v.severity === 'ERROR').length === 0,
      totalJobs: state.jobs.length,
      violations,
      duplicateIds,
      duplicateIdentities,
      activeJobIssues,
      malformedCount,
      checkedAt: Date.now(),
    };
  }

  /**
   * Safely repairs detected discrepancies in QueueState non-destructively:
   * - Deduplicates job IDs by generating unique fresh IDs
   * - Standardizes invalid status values to PENDING
   * - Enforces single active job invariant by resetting excess in-flight jobs to PENDING
   * - Clears invalid or dangling activeJobId references
   * - Sanitizes retry counts
   */
  public static repair(state: QueueState): {
    repairedState: QueueState;
    repairsApplied: string[];
  } {
    const repairsApplied: string[] = [];
    if (!state || !Array.isArray(state.jobs)) {
      return {
        repairedState: {
          jobs: [],
          isRunning: false,
          isPaused: false,
          activeJobId: null,
          lastUpdated: Date.now(),
        },
        repairsApplied: ['Replaced corrupt non-array state with empty queue state.'],
      };
    }

    const seenIds = new Set<string>();
    const repairedJobs: QueueJob[] = [];
    let foundFirstActive = false;

    for (let i = 0; i < state.jobs.length; i++) {
      const rawJob = state.jobs[i];
      if (!rawJob || typeof rawJob !== 'object') {
        repairsApplied.push(`Removed completely unrecoverable malformed job at index ${i}`);
        continue;
      }

      let jobId = rawJob.id || generateId('recovered_job');
      if (seenIds.has(jobId)) {
        const newId = `${jobId}_repaired_${Math.random().toString(36).substring(2, 6)}`;
        repairsApplied.push(`Deduplicated duplicate job ID '${jobId}' -> '${newId}'`);
        jobId = newId;
      }
      seenIds.add(jobId);

      let status: QueueStatus = rawJob.status || 'PENDING';
      if (!VALID_QUEUE_STATUSES.includes(status)) {
        repairsApplied.push(`Corrected invalid status '${status}' on job '${jobId}' to 'PENDING'`);
        status = 'PENDING';
      }

      // Enforce single active in-flight job invariant
      if (ACTIVE_IN_FLIGHT_STATUSES.includes(status)) {
        if (!foundFirstActive) {
          foundFirstActive = true;
        } else {
          repairsApplied.push(`Reset secondary active job '${jobId}' (${status}) back to 'PENDING'`);
          status = 'PENDING';
        }
      }

      const retryCount = typeof rawJob.retryCount === 'number' && !isNaN(rawJob.retryCount) && rawJob.retryCount >= 0
        ? rawJob.retryCount
        : 0;

      const repairedJob: QueueJob = {
        ...rawJob,
        id: jobId,
        gstin: (rawJob.gstin || 'UNKNOWN').trim().toUpperCase(),
        financialYear: rawJob.financialYear || '2025-2026',
        period: rawJob.period || 'April',
        returnType: rawJob.returnType || 'GSTR-2B',
        status,
        isTestJob: rawJob.isTestJob ?? true,
        retryCount,
        maxRetries: rawJob.maxRetries || 3,
        createdAt: rawJob.createdAt || Date.now(),
        updatedAt: Date.now(),
      };

      repairedJobs.push(repairedJob);
    }

    // Deduplicate active return identities (keep earliest created)
    const finalDeduplicatedJobs: QueueJob[] = [];
    for (const job of repairedJobs) {
      if (job.status !== 'CANCELLED' && job.status !== 'FAILED') {
        const existingIndex = finalDeduplicatedJobs.findIndex((ej) =>
          this.isMatchingReturnIdentity(ej, job) && ej.status !== 'CANCELLED' && ej.status !== 'FAILED'
        );
        if (existingIndex !== -1) {
          const existing = finalDeduplicatedJobs[existingIndex];
          if ((job.createdAt || 0) < (existing.createdAt || 0)) {
            finalDeduplicatedJobs[existingIndex] = job;
            repairsApplied.push(`Deduplicated return identity: preserved earlier job '${job.id}'`);
          } else {
            repairsApplied.push(`Deduplicated return identity: removed duplicate later job '${job.id}'`);
          }
          continue;
        }
      }
      finalDeduplicatedJobs.push(job);
    }

    let activeJobId = state.activeJobId;
    if (activeJobId) {
      const exists = finalDeduplicatedJobs.find((j) => j.id === activeJobId);
      if (!exists || !ACTIVE_IN_FLIGHT_STATUSES.includes(exists.status)) {
        repairsApplied.push(`Cleared dangling or non-active activeJobId '${activeJobId}'`);
        activeJobId = null;
      }
    }

    const repairedState: QueueState = {
      ...state,
      jobs: finalDeduplicatedJobs,
      activeJobId,
      lastUpdated: Date.now(),
    };

    if (repairsApplied.length > 0) {
      Logger.info(`[Queue Integrity] Repaired ${repairsApplied.length} issue(s) safely.`, { repairs: repairsApplied });
    }

    return {
      repairedState,
      repairsApplied,
    };
  }
}
