/**
 * Shared utility functions for Udaan GST Bulk Download Assistant
 */

export function generateId(prefix = 'job'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export function formatTimestamp(timestamp?: number | null): string {
  if (!timestamp) return '—';
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatFullDate(timestamp?: number | null): string {
  if (!timestamp) return '—';
  const d = new Date(timestamp);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isGSTDomain(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return (
      url.hostname === 'services.gst.gov.in' ||
      url.hostname === 'gst.gov.in' ||
      url.hostname.endsWith('.gst.gov.in')
    );
  } catch {
    return false;
  }
}

/**
 * Normalizes financial year strings to standard short format: 'YYYY-YY'.
 * Works mathematically and generically without hardcoding specific years.
 *
 * Examples:
 *   normalizeFinancialYear("2025-2026") -> "2025-26"
 *   normalizeFinancialYear("2025-26")   -> "2025-26"
 *   normalizeFinancialYear("2026-2027") -> "2026-27"
 *   normalizeFinancialYear("2026-27")   -> "2026-27"
 *   normalizeFinancialYear("2029-2030") -> "2029-30"
 */
export function normalizeFinancialYear(fy: string): string {
  if (!fy) return '';
  const trimmed = fy.trim().replace(/^FY\s*/i, '');

  // 1. Format: YYYY-YYYY or YYYY/YYYY (e.g. 2025-2026 -> 2025-26)
  const fullYearMatch = trimmed.match(/^(\d{4})[-/](\d{4})$/);
  if (fullYearMatch) {
    const startYear = fullYearMatch[1];
    const endYear = fullYearMatch[2];
    return `${startYear}-${endYear.slice(-2)}`;
  }

  // 2. Format: YYYY-YY or YYYY/YY (e.g. 2025-26 -> 2025-26)
  const shortYearMatch = trimmed.match(/^(\d{4})[-/](\d{2})$/);
  if (shortYearMatch) {
    return `${shortYearMatch[1]}-${shortYearMatch[2]}`;
  }

  return trimmed;
}

/**
 * Checks if two financial year strings represent the identical financial year.
 */
export function areFinancialYearsEquivalent(fy1: string, fy2: string): boolean {
  if (!fy1 || !fy2) return false;
  const n1 = normalizeFinancialYear(fy1).toLowerCase();
  const n2 = normalizeFinancialYear(fy2).toLowerCase();
  if (n1 && n2 && n1 === n2) return true;
  return fy1.trim().toLowerCase() === fy2.trim().toLowerCase();
}
