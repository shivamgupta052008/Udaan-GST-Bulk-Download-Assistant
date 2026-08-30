/**
 * Centralized Typed Error Classification System
 * Strictly complies with Zero-Knowledge Credential Security Rule:
 * Never exposes passwords, OTPs, CAPTCHAs, secret tokens, or session cookies in messages or logs.
 */

export type GstErrorCode =
  | 'PORTAL_UNAVAILABLE'
  | 'PORTAL_AUTH_REQUIRED'
  | 'AUTH_SESSION_EXPIRED'
  | 'PORTAL_RATE_LIMITED'
  | 'GSTIN_MISMATCH'
  | 'FY_UNAVAILABLE'
  | 'PERIOD_UNAVAILABLE'
  | 'RETURN_UNAVAILABLE'
  | 'GENERATION_TIMEOUT'
  | 'PORTAL_GENERATION_ERROR'
  | 'DOWNLOAD_INTERRUPTED'
  | 'DOWNLOAD_FAILED'
  | 'DOWNLOAD_CONTENT_MISSING'
  | 'INVALID_JSON'
  | 'HTML_CONTENT_REJECTED'
  | 'EMPTY_CONTENT'
  | 'LOCAL_STORAGE_UNAVAILABLE'
  | 'LOCAL_STORAGE_PERMISSION_DENIED'
  | 'LOCAL_SYNC_FAILED'
  | 'QUEUE_ERROR'
  | 'STORAGE_ERROR'
  | 'RECOVERY_ERROR'
  | 'UNKNOWN_ERROR';

export interface ClassifiedError {
  code: GstErrorCode;
  userMessage: string;
  technicalDetail?: string;
  timestamp: number;
  jobId?: string;
}

const ERROR_MESSAGE_MAP: Record<GstErrorCode, string> = {
  PORTAL_UNAVAILABLE: 'The GST Portal appears unreachable. Please verify your internet connection or portal status.',
  PORTAL_AUTH_REQUIRED: 'GST Portal authentication required. Please log into the GST portal in your active tab.',
  AUTH_SESSION_EXPIRED: 'Your GST portal session has expired. Please log in again in the active tab.',
  PORTAL_RATE_LIMITED: 'GST Portal rate limit reached (HTTP 429). The portal is temporarily throttling requests.',
  GSTIN_MISMATCH: 'GSTIN mismatch detected. The active portal session does not match the requested taxpayer profile.',
  FY_UNAVAILABLE: 'The requested Financial Year is not available or not yet selectable on the GST Portal.',
  PERIOD_UNAVAILABLE: 'The requested Return Period (Month/Quarter) is unavailable on the GST Portal.',
  RETURN_UNAVAILABLE: 'The requested GST Return type is not supported or not available for this filing period.',
  GENERATION_TIMEOUT: 'GST Portal timed out while generating the JSON file. The portal queue may be congested.',
  PORTAL_GENERATION_ERROR: 'GST Portal returned an error while attempting to generate return data.',
  DOWNLOAD_INTERRUPTED: 'The browser file download was interrupted before completion.',
  DOWNLOAD_FAILED: 'Failed to initiate or complete the file download from the GST Portal.',
  DOWNLOAD_CONTENT_MISSING: 'Download finished but file payload content is missing or unreadable.',
  INVALID_JSON: 'Downloaded return content is not valid JSON data.',
  HTML_CONTENT_REJECTED: 'GST Portal returned an HTML error/login page instead of valid return JSON.',
  EMPTY_CONTENT: 'Downloaded return file contains zero bytes or empty data.',
  LOCAL_STORAGE_UNAVAILABLE: 'Local storage directory is unavailable or unmounted.',
  LOCAL_STORAGE_PERMISSION_DENIED: 'Permission to access the local storage root folder was denied or revoked.',
  LOCAL_SYNC_FAILED: 'Failed to synchronize downloaded return file into the local organized directory.',
  QUEUE_ERROR: 'An error occurred during queue execution or state persistence.',
  STORAGE_ERROR: 'Failed to read or write extension local storage data.',
  RECOVERY_ERROR: 'An error occurred during queue or storage recovery.',
  UNKNOWN_ERROR: 'An unexpected error occurred during operation.',
};

/**
 * Strips sensitive credentials, tokens, OTPs, or cookies from any error string.
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message) return '';
  return message
    .replace(/password\s*[:=]\s*\S+/gi, 'password=[REDACTED]')
    .replace(/otp\s*[:=]\s*\d+/gi, 'otp=[REDACTED]')
    .replace(/token\s*[:=]\s*\S+/gi, 'token=[REDACTED]')
    .replace(/cookie\s*[:=]\s*\S+/gi, 'cookie=[REDACTED]')
    .replace(/auth(?:orization)?\s*[:=]\s*\S+/gi, 'auth=[REDACTED]')
    .replace(/bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]');
}

/**
 * Classifies an unknown error into a structured ClassifiedError object
 */
export function classifyError(
  err: unknown,
  defaultCode: GstErrorCode = 'UNKNOWN_ERROR',
  jobId?: string
): ClassifiedError {
  const rawMessage = err instanceof Error ? err.message : String(err || '');
  const cleanRaw = sanitizeErrorMessage(rawMessage);
  const lower = cleanRaw.toLowerCase();

  let code: GstErrorCode = defaultCode;

  if (lower.includes('rate limit') || lower.includes('429')) {
    code = 'PORTAL_RATE_LIMITED';
  } else if (lower.includes('session expired') || lower.includes('session has timed out') || lower.includes('timed out due to inactivity') || lower.includes('session timeout')) {
    code = 'AUTH_SESSION_EXPIRED';
  } else if (lower.includes('503') || lower.includes('service unavailable') || lower.includes('unreachable') || lower.includes('portal unavailable')) {
    code = 'PORTAL_UNAVAILABLE';
  } else if (lower.includes('gstin mismatch') || lower.includes('unable to verify gstin')) {
    code = 'GSTIN_MISMATCH';
  } else if (lower.includes('auth') || lower.includes('log in') || lower.includes('not logged in')) {
    code = 'PORTAL_AUTH_REQUIRED';
  } else if (lower.includes('financial year') && (lower.includes('unavailable') || lower.includes('not found'))) {
    code = 'FY_UNAVAILABLE';
  } else if (lower.includes('period') && (lower.includes('unavailable') || lower.includes('not found') || lower.includes('invalid period'))) {
    code = 'PERIOD_UNAVAILABLE';
  } else if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('generation timeout')) {
    code = 'GENERATION_TIMEOUT';
  } else if (lower.includes('html') || lower.includes('doctype html') || lower.includes('rejected html')) {
    code = 'HTML_CONTENT_REJECTED';
  } else if (lower.includes('invalid json') || lower.includes('json parse')) {
    code = 'INVALID_JSON';
  } else if (lower.includes('empty') || lower.includes('zero byte')) {
    code = 'EMPTY_CONTENT';
  } else if (lower.includes('interrupted') || lower.includes('download interrupted')) {
    code = 'DOWNLOAD_INTERRUPTED';
  } else if (lower.includes('permission') && (lower.includes('storage') || lower.includes('denied') || lower.includes('revoked'))) {
    code = 'LOCAL_STORAGE_PERMISSION_DENIED';
  } else if (lower.includes('local storage') || lower.includes('root folder') || lower.includes('root path')) {
    code = 'LOCAL_STORAGE_UNAVAILABLE';
  } else if (lower.includes('sync failed') || lower.includes('sync error')) {
    code = 'LOCAL_SYNC_FAILED';
  } else if (lower.includes('portal') && (lower.includes('error') || lower.includes('failed to trigger'))) {
    code = 'PORTAL_GENERATION_ERROR';
  } else if (lower.includes('queue')) {
    code = 'QUEUE_ERROR';
  }

  return {
    code,
    userMessage: ERROR_MESSAGE_MAP[code] || ERROR_MESSAGE_MAP.UNKNOWN_ERROR,
    technicalDetail: cleanRaw || undefined,
    timestamp: Date.now(),
    jobId,
  };
}

/**
 * Creates a ClassifiedError directly with a given code
 */
export function createClassifiedError(
  code: GstErrorCode,
  userMessageOverride?: string,
  technicalDetail?: string,
  jobId?: string
): ClassifiedError {
  return {
    code,
    userMessage: userMessageOverride || ERROR_MESSAGE_MAP[code] || ERROR_MESSAGE_MAP.UNKNOWN_ERROR,
    technicalDetail: technicalDetail ? sanitizeErrorMessage(technicalDetail) : undefined,
    timestamp: Date.now(),
    jobId,
  };
}

/**
 * Gets a user-friendly safe description for an error code
 */
export function getSafeUserMessage(code: GstErrorCode): string {
  return ERROR_MESSAGE_MAP[code] || ERROR_MESSAGE_MAP.UNKNOWN_ERROR;
}
