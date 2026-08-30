/**
 * Operational Diagnostic Logger & Health Reporter
 * Complies strictly with Zero-Knowledge Credential Security Rule:
 * Never logs credentials, OTPs, tokens, cookies, or taxpayer transaction content.
 */
import { GstErrorCode, sanitizeErrorMessage } from './errorClassification';
import { EXTENSION_VERSION } from '../shared/constants';

export type DiagnosticLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface DiagnosticLogEntry {
  id: string;
  level: DiagnosticLogLevel;
  module: string;
  event: string;
  message: string;
  jobId?: string | null;
  errorCode?: GstErrorCode | null;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface DiagnosticSystemHealth {
  extensionStatus: 'OK' | 'ERROR';
  queueStatus: 'OK' | 'ERROR';
  storageStatus: 'OK' | 'ERROR';
  localStorageStatus: 'CONNECTED' | 'LOCAL_STORAGE_UNAVAILABLE' | 'NOT_CONFIGURED' | 'PERMISSION_DENIED';
  downloadMonitorStatus: 'OK' | 'ERROR';
  serviceWorkerStatus: 'RUNNING' | 'RECOVERED';
  activeJobId: string | null;
  totalJobs: number;
  failedJobs: number;
  syncedJobs: number;
  lastVerifiedAt: number;
}

export interface DiagnosticReport {
  extensionName: string;
  version: string;
  generatedAt: number;
  isoTimestamp: string;
  health: DiagnosticSystemHealth;
  systemHealth?: DiagnosticSystemHealth;
  recentLogs: DiagnosticLogEntry[];
  summary: {
    totalLogs: number;
    errorCount: number;
    warnCount: number;
    failedJobIds: string[];
    errorCodesEncountered: string[];
  };
}

const MAX_DIAGNOSTIC_LOGS = 300;
let diagnosticLogs: DiagnosticLogEntry[] = [];
const logListeners: Array<(entry: DiagnosticLogEntry) => void> = [];

export class DiagnosticLogger {
  /**
   * Sanitizes objects and primitives to eliminate accidental credential leaks
   */
  private static sanitizeData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!data) return undefined;
    const sanitized: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(data)) {
      const lowerKey = k.toLowerCase();
      if (
        lowerKey.includes('pass') ||
        lowerKey.includes('pwd') ||
        lowerKey.includes('otp') ||
        lowerKey.includes('token') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('auth') ||
        lowerKey.includes('cookie') ||
        lowerKey.includes('session')
      ) {
        sanitized['redacted_' + k] = '[REDACTED]';
      } else if (typeof v === 'string') {
        sanitized[k] = sanitizeErrorMessage(v);
      } else if (typeof v === 'object' && v !== null) {
        try {
          sanitized[k] = JSON.parse(JSON.stringify(v));
        } catch {
          sanitized[k] = '[Unserializable]';
        }
      } else {
        sanitized[k] = v;
      }
    }

    return sanitized;
  }

  public static log(
    level: DiagnosticLogLevel,
    module: string,
    event: string,
    message: string,
    options?: {
      jobId?: string | null;
      errorCode?: GstErrorCode | null;
      data?: Record<string, unknown>;
    }
  ): DiagnosticLogEntry {
    const cleanMessage = sanitizeErrorMessage(message);
    const entry: DiagnosticLogEntry = {
      id: `diag_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      level,
      module,
      event,
      message: cleanMessage,
      jobId: options?.jobId || null,
      errorCode: options?.errorCode || null,
      timestamp: Date.now(),
      data: this.sanitizeData(options?.data),
    };

    diagnosticLogs.unshift(entry);
    if (diagnosticLogs.length > MAX_DIAGNOSTIC_LOGS) {
      diagnosticLogs = diagnosticLogs.slice(0, MAX_DIAGNOSTIC_LOGS);
    }

    // Standard console format
    const prefix = `[UDAAN ${level}][${module}][${event}]`;
    if (level === 'ERROR') {
      console.warn(prefix, cleanMessage, entry.errorCode ? `(${entry.errorCode})` : '', options?.data || '');
    } else if (level === 'WARN') {
      console.warn(prefix, cleanMessage, entry.errorCode ? `(${entry.errorCode})` : '', options?.data || '');
    } else {
      console.log(prefix, cleanMessage, options?.data || '');
    }

    logListeners.forEach((fn) => {
      try {
        fn(entry);
      } catch (err) {
        console.error('Error in diagnostic log listener:', err);
      }
    });

    return entry;
  }

  public static info(
    module: string,
    event: string,
    message: string,
    options?: { jobId?: string | null; errorCode?: GstErrorCode | null; data?: Record<string, unknown> }
  ): DiagnosticLogEntry {
    return this.log('INFO', module, event, message, options);
  }

  public static warn(
    module: string,
    event: string,
    message: string,
    options?: { jobId?: string | null; errorCode?: GstErrorCode | null; data?: Record<string, unknown> }
  ): DiagnosticLogEntry {
    return this.log('WARN', module, event, message, options);
  }

  public static error(
    module: string,
    event: string,
    message: string,
    options?: { jobId?: string | null; errorCode?: GstErrorCode | null; data?: Record<string, unknown> }
  ): DiagnosticLogEntry {
    return this.log('ERROR', module, event, message, options);
  }

  public static debug(
    module: string,
    event: string,
    message: string,
    options?: { jobId?: string | null; errorCode?: GstErrorCode | null; data?: Record<string, unknown> }
  ): DiagnosticLogEntry {
    return this.log('DEBUG', module, event, message, options);
  }

  public static getLogs(): DiagnosticLogEntry[] {
    return [...diagnosticLogs];
  }

  public static clearLogs(): void {
    diagnosticLogs = [];
  }

  public static subscribe(listener: (entry: DiagnosticLogEntry) => void): () => void {
    logListeners.push(listener);
    return () => {
      const idx = logListeners.indexOf(listener);
      if (idx !== -1) {
        logListeners.splice(idx, 1);
      }
    };
  }

  /**
   * Generates a comprehensive, credential-free diagnostic report for troubleshooting
   */
  public static generateReport(health: DiagnosticSystemHealth): DiagnosticReport {
    const logs = [...diagnosticLogs];
    const errors = logs.filter((l) => l.level === 'ERROR');
    const warns = logs.filter((l) => l.level === 'WARN');

    const failedJobIds = Array.from(
      new Set(logs.filter((l) => l.level === 'ERROR' && l.jobId).map((l) => l.jobId as string))
    );

    const errorCodesEncountered = Array.from(
      new Set(logs.filter((l) => l.errorCode).map((l) => l.errorCode as string))
    );

    return {
      extensionName: 'Udaan GST Bulk Download Assistant',
      version: EXTENSION_VERSION,
      generatedAt: Date.now(),
      isoTimestamp: new Date().toISOString(),
      health,
      systemHealth: health,
      recentLogs: logs.slice(0, 100),
      summary: {
        totalLogs: logs.length,
        errorCount: errors.length,
        warnCount: warns.length,
        failedJobIds,
        errorCodesEncountered,
      },
    };
  }
}
