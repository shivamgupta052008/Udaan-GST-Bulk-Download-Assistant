/**
 * Udaan GST Bulk Download Assistant - Constants
 * Milestone 1 Foundation
 */

export const EXTENSION_NAME = 'Udaan GST Bulk Download Assistant';
export const EXTENSION_VERSION = '1.0.0';

// Official GST Portal Domains
export const GST_PORTAL_HOSTS = [
  'services.gst.gov.in',
  'gst.gov.in',
  'www.gst.gov.in',
  'return.gst.gov.in',
] as const;

export const GST_PORTAL_URLS = {
  LOGIN: 'https://services.gst.gov.in/services/login',
  DASHBOARD: 'https://services.gst.gov.in/services/auth/dashboard',
  RETURNS_DASHBOARD: 'https://services.gst.gov.in/services/returns',
  BASE: 'https://services.gst.gov.in',
} as const;

// Storage Keys
export const STORAGE_KEYS = {
  QUEUE: 'udaan_gst_queue',
  LOGS: 'udaan_gst_logs',
  SETTINGS: 'udaan_gst_settings',
  PORTAL_STATUS: 'udaan_gst_portal_status',
  DOWNLOAD_ASSOCIATIONS: 'udaan_gst_download_associations',
  RECOVERY_STATE: 'udaan_gst_recovery_state',
} as const;

// Chrome Alarms
export const ALARM_NAMES = {
  WATCHDOG: 'udaan_queue_watchdog',
} as const;

// Queue & Engine Constants
export const QUEUE_CONFIG = {
  MAX_RETRIES: 3,
  POLL_INTERVAL_MS: 1500,
  DOWNLOAD_TIMEOUT_MS: 30000,
  STEP_DELAY_MS: 300,
  WATCHDOG_INTERVAL_MIN: 1,
} as const;

// GST Return Types
export const SUPPORTED_RETURN_TYPES = ['GSTR-1', 'GSTR-2A', 'GSTR-2B', 'GSTR-3B'] as const;

// Financial Years
export const DEFAULT_FINANCIAL_YEARS = [
  '2025-2026',
  '2024-2025',
  '2023-2024',
  '2022-2023',
] as const;

// Return Periods
export const RETURN_PERIODS = [
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
  'January',
  'February',
  'March',
] as const;
