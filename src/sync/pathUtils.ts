/**
 * Central path and file name sanitization utility for Local Storage Sync
 */
import { normalizeFinancialYear } from '../shared/utils';
import { FinancialYear, ReturnPeriod, ReturnType } from '../gst/returnTypes';

/**
 * Sanitizes folder names by stripping or replacing invalid Windows/POSIX filesystem characters:
 * Invalid chars: \ / : * ? " < > | and control characters.
 * Trims leading/trailing whitespace and dots.
 */
export function sanitizeFolderName(name: string): string {
  if (!name) return 'Unknown_Entity';

  // Replace invalid characters with an underscore or clean replacement
  let sanitized = name
    .replace(/[\\/:*?"<>|]/g, '_')
    // Remove control characters
    .replace(/[\x00-\x1F\x7F]/g, '')
    // Replace multiple spaces/underscores with a single space/underscore
    .replace(/_+/g, '_')
    .trim();

  // Remove leading/trailing dots or spaces (Windows prohibited)
  sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, '');

  if (!sanitized) {
    return 'Default_Entity';
  }

  // Windows reserved device names check (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  if (reservedNames.test(sanitized)) {
    sanitized = `${sanitized}_Dir`;
  }

  return sanitized;
}

/**
 * Generates canonical Company folder name: `<GSTIN>_<Sanitized Company Name>`
 */
export function getCompanyFolderName(gstin: string, companyName?: string): string {
  const cleanGstin = (gstin || 'UNKNOWN_GSTIN').trim().toUpperCase();
  const rawCompanyName = (companyName || '').trim();
  const cleanName = rawCompanyName ? sanitizeFolderName(rawCompanyName) : 'Taxpayer';
  return `${cleanGstin}_${cleanName}`;
}

/**
 * Generates deterministic GST return file name:
 * `<ReturnType>_<Period>_<NormalizedFY>.json`
 * Example: `GSTR-2B_April_2025-26.json`
 */
export function getDeterministicFileName(
  returnType: ReturnType,
  period: ReturnPeriod,
  financialYear: FinancialYear
): string {
  const normalizedFY = normalizeFinancialYear(financialYear);
  const cleanReturnType = returnType.trim();
  const cleanPeriod = period.trim();
  return `${cleanReturnType}_${cleanPeriod}_${normalizedFY}.json`;
}

/**
 * Generates full relative directory path segments for a return:
 * `[CompanyFolder, NormalizedFY, ReturnType]`
 */
export function getLocalPathSegments(
  gstin: string,
  companyName: string | undefined,
  financialYear: FinancialYear,
  returnType: ReturnType
): string[] {
  const companyDir = getCompanyFolderName(gstin, companyName);
  const fyDir = normalizeFinancialYear(financialYear);
  const returnDir = returnType.trim();
  return [companyDir, fyDir, returnDir];
}

/**
 * Returns formatted relative path string for display / storage:
 * e.g. `27AABCU9603R1ZM_My Company/2025-26/GSTR-2B/GSTR-2B_April_2025-26.json`
 */
export function getFullRelativePath(
  gstin: string,
  companyName: string | undefined,
  financialYear: FinancialYear,
  period: ReturnPeriod,
  returnType: ReturnType
): string {
  const segments = getLocalPathSegments(gstin, companyName, financialYear, returnType);
  const fileName = getDeterministicFileName(returnType, period, financialYear);
  return `${segments.join('/')}/${fileName}`;
}
