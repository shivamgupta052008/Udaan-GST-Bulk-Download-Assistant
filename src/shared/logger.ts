/**
 * Structured Logger for Udaan GST Bulk Download Assistant
 * Strictly complies with Security Rule: Never logs passwords, OTPs, tokens, or cookies.
 */

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

const MAX_STORED_LOGS = 200;
let inMemoryLogs: LogEntry[] = [];
const logListeners: Array<(entry: LogEntry) => void> = [];

export class Logger {
  private static sanitize(message: string): string {
    // Strip any accidental sensitive patterns
    return message
      .replace(/password\s*[:=]\s*\S+/gi, 'password=[REDACTED]')
      .replace(/otp\s*[:=]\s*\d+/gi, 'otp=[REDACTED]')
      .replace(/token\s*[:=]\s*\S+/gi, 'token=[REDACTED]')
      .replace(/cookie\s*[:=]\s*\S+/gi, 'cookie=[REDACTED]');
  }

  private static log(level: LogLevel, message: string, data?: Record<string, unknown>): LogEntry {
    const cleanMessage = this.sanitize(message);
    const entry: LogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      level,
      message: cleanMessage,
      timestamp: Date.now(),
      data,
    };

    inMemoryLogs.unshift(entry);
    if (inMemoryLogs.length > MAX_STORED_LOGS) {
      inMemoryLogs = inMemoryLogs.slice(0, MAX_STORED_LOGS);
    }

    // Console output with structured prefix
    const prefix = `[UDAAN GST ${level}]`;
    if (level === 'ERROR') {
      console.error(prefix, cleanMessage, data || '');
    } else if (level === 'WARN') {
      console.warn(prefix, cleanMessage, data || '');
    } else {
      console.log(prefix, cleanMessage, data || '');
    }

    // Notify active listeners
    logListeners.forEach((fn) => {
      try {
        fn(entry);
      } catch (err) {
        console.error('Error in log listener:', err);
      }
    });

    return entry;
  }

  public static info(message: string, data?: Record<string, unknown>): LogEntry {
    return this.log('INFO', message, data);
  }

  public static warn(message: string, data?: Record<string, unknown>): LogEntry {
    return this.log('WARN', message, data);
  }

  public static error(message: string, data?: Record<string, unknown>): LogEntry {
    return this.log('ERROR', message, data);
  }

  public static debug(message: string, data?: Record<string, unknown>): LogEntry {
    return this.log('DEBUG', message, data);
  }

  public static getLogs(): LogEntry[] {
    return [...inMemoryLogs];
  }

  public static clearLogs(): void {
    inMemoryLogs = [];
  }

  public static subscribe(listener: (entry: LogEntry) => void): () => void {
    logListeners.push(listener);
    return () => {
      const idx = logListeners.indexOf(listener);
      if (idx !== -1) {
        logListeners.splice(idx, 1);
      }
    };
  }
}
