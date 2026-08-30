import { Logger } from '../shared/logger';
import { sleep, normalizeFinancialYear, areFinancialYearsEquivalent } from '../shared/utils';

/**
 * Standard GST Month / Period Normalization Map
 */
export const MONTH_NORMALIZATION_MAP: Record<string, string> = {
  apr: 'April',
  april: 'April',
  may: 'May',
  jun: 'June',
  june: 'June',
  jul: 'July',
  july: 'July',
  aug: 'August',
  august: 'August',
  sep: 'September',
  sept: 'September',
  september: 'September',
  oct: 'October',
  october: 'October',
  nov: 'November',
  november: 'November',
  dec: 'December',
  december: 'December',
  jan: 'January',
  january: 'January',
  feb: 'February',
  february: 'February',
  mar: 'March',
  march: 'March',
};

/**
 * Helper to query element using fallback selector lists
 */
export function querySelectorFallbacks<T extends Element = HTMLElement>(
  selectors: string[],
  rootDoc?: Document | Element | null
): T | null {
  const doc = rootDoc || (typeof document !== 'undefined' ? document : null);
  if (!doc) return null;

  for (const sel of selectors) {
    try {
      if (sel.includes(':has-text(')) {
        const match = sel.match(/^(.*?):has-text\("([^"]+)"\)$/);
        if (match) {
          const tag = match[1] || '*';
          const textToFind = match[2].toLowerCase();
          const elements = Array.from(doc.querySelectorAll(tag));
          const found = elements.find((el) =>
            (el.textContent || '').toLowerCase().includes(textToFind)
          );
          if (found) return found as T;
        }
      } else {
        const el = doc.querySelector<T>(sel);
        if (el) return el;
      }
    } catch {
      // Ignore selector syntax issues in fallback chain
    }
  }
  return null;
}

/**
 * Verifies that the visible GST Portal belongs to the expected GSTIN
 */
export function verifyGstinContext(
  expectedGstin: string,
  gstinSelectors: string[],
  doc?: Document | null
): { verified: boolean; detectedGstin?: string; reason?: string } {
  if (!expectedGstin) {
    return { verified: false, reason: 'Expected GSTIN is empty or invalid' };
  }

  const cleanExpected = expectedGstin.trim().toUpperCase();
  const activeDoc = doc || (typeof document !== 'undefined' ? document : null);
  if (!activeDoc) {
    return { verified: true, detectedGstin: cleanExpected };
  }

  const gstinEl = querySelectorFallbacks(gstinSelectors, activeDoc);
  const bodyText = activeDoc.body ? activeDoc.body.innerText || activeDoc.body.textContent || '' : '';

  if (gstinEl) {
    const detected = (gstinEl.textContent || '').trim().toUpperCase();
    if (detected.includes(cleanExpected)) {
      return { verified: true, detectedGstin: cleanExpected };
    } else {
      return {
        verified: false,
        detectedGstin: detected,
        reason: `GSTIN mismatch: portal displays ${detected}, but job requires ${cleanExpected}`,
      };
    }
  }

  // Secondary search in header/profile text
  const gstinRegex = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/gi;
  const matches = bodyText.match(gstinRegex);
  if (matches && matches.length > 0) {
    const foundGstin = matches[0].toUpperCase();
    if (foundGstin === cleanExpected) {
      return { verified: true, detectedGstin: foundGstin };
    } else {
      return {
        verified: false,
        detectedGstin: foundGstin,
        reason: `GSTIN mismatch: portal has ${foundGstin}, job has ${cleanExpected}`,
      };
    }
  }

  return {
    verified: false,
    reason: 'Unable to verify GSTIN on GST Portal. Manual confirmation required.',
  };
}

/**
 * Selects Financial Year in the Returns Dashboard dropdown
 */
export async function selectFinancialYearDropdown(
  financialYear: string,
  fySelectors: string[],
  doc?: Document | null
): Promise<{ success: boolean; selected: string; error?: string }> {
  const activeDoc = doc || (typeof document !== 'undefined' ? document : null);
  if (!activeDoc) {
    return { success: true, selected: financialYear };
  }

  const fySelect = querySelectorFallbacks<HTMLSelectElement>(fySelectors, activeDoc);
  if (!fySelect) {
    return {
      success: false,
      selected: '',
      error: 'Financial Year dropdown selector not found on GST Returns Dashboard',
    };
  }

  const options = Array.from(fySelect.options);
  if (options.length === 0) {
    return {
      success: false,
      selected: '',
      error: 'Financial Year dropdown contains no selectable options',
    };
  }

  const targetFY = financialYear.trim();
  const normalizedTarget = normalizeFinancialYear(targetFY);

  const matchingOption = options.find((opt) => {
    const optText = (opt.text || '').trim();
    const optVal = (opt.value || '').trim();

    if (
      !optText ||
      optText.toLowerCase().includes('select') ||
      optText.startsWith('--') ||
      optVal.toLowerCase().includes('select')
    ) {
      return false;
    }

    const normText = normalizeFinancialYear(optText);
    const normVal = normalizeFinancialYear(optVal);

    return (
      normText === normalizedTarget ||
      normVal === normalizedTarget ||
      areFinancialYearsEquivalent(optText, targetFY) ||
      areFinancialYearsEquivalent(optVal, targetFY) ||
      optText === targetFY ||
      optVal === targetFY
    );
  });

  if (!matchingOption) {
    const available = options
      .map((o) => (o.text || o.value).trim())
      .filter((t) => t && !t.toLowerCase().includes('select') && !t.startsWith('--'))
      .join(', ');
    return {
      success: false,
      selected: '',
      error: `Requested FY '${financialYear}' (normalized: '${normalizedTarget}') not available in dropdown. Available FYs: [${available}]`,
    };
  }

  fySelect.value = matchingOption.value;
  fySelect.dispatchEvent(new Event('change', { bubbles: true }));
  fySelect.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(50);

  const selectedIndex = fySelect.selectedIndex;
  const selectedOption = selectedIndex >= 0 ? fySelect.options[selectedIndex] : matchingOption;
  const verifiedValue = (selectedOption?.text || selectedOption?.value || fySelect.value || '').trim();
  const verifiedNormalized = normalizeFinancialYear(verifiedValue);

  if (
    verifiedNormalized === normalizedTarget ||
    areFinancialYearsEquivalent(verifiedValue, targetFY)
  ) {
    Logger.info(`[FY Selection] Successfully selected FY '${verifiedValue}' (target: '${financialYear}')`);
    return {
      success: true,
      selected: verifiedValue,
    };
  }

  return {
    success: false,
    selected: verifiedValue,
    error: `Selected FY '${verifiedValue}' does not match requested '${financialYear}'`,
  };
}

/**
 * Selects Return Period (Month / Quarter) in the Returns Dashboard dropdown
 */
export async function selectReturnPeriodDropdown(
  period: string,
  periodSelectors: string[],
  doc?: Document | null
): Promise<{ success: boolean; selected: string; isAvailable: boolean; error?: string }> {
  const activeDoc = doc || (typeof document !== 'undefined' ? document : null);
  if (!activeDoc) {
    return { success: true, selected: period, isAvailable: true };
  }

  const periodSelect = querySelectorFallbacks<HTMLSelectElement>(periodSelectors, activeDoc);
  if (!periodSelect) {
    return {
      success: false,
      selected: '',
      isAvailable: false,
      error: 'Return Period dropdown selector not found on GST Returns Dashboard',
    };
  }

  const options = Array.from(periodSelect.options);
  if (options.length === 0) {
    return {
      success: false,
      selected: '',
      isAvailable: false,
      error: 'Return Period dropdown is empty or unpopulated',
    };
  }

  const targetPeriod = period.trim();
  const targetLower = targetPeriod.toLowerCase();
  const canonicalTarget = MONTH_NORMALIZATION_MAP[targetLower] || targetPeriod;

  const matchingOption = options.find((opt) => {
    const optText = (opt.text || '').trim();
    const optVal = (opt.value || '').trim();

    if (
      !optText ||
      optText.toLowerCase().includes('select') ||
      optText.startsWith('--') ||
      optVal.toLowerCase().includes('select')
    ) {
      return false;
    }

    const optTextLower = optText.toLowerCase();
    const optValLower = optVal.toLowerCase();
    const canonicalText = MONTH_NORMALIZATION_MAP[optTextLower] || optText;
    const canonicalVal = MONTH_NORMALIZATION_MAP[optValLower] || optVal;

    return (
      canonicalText.toLowerCase() === canonicalTarget.toLowerCase() ||
      canonicalVal.toLowerCase() === canonicalTarget.toLowerCase() ||
      optTextLower === targetLower ||
      optValLower === targetLower ||
      optTextLower.includes(targetLower) ||
      optValLower.includes(targetLower)
    );
  });

  if (!matchingOption) {
    const available = options
      .map((o) => (o.text || o.value).trim())
      .filter((t) => t && !t.toLowerCase().includes('select') && !t.startsWith('--'))
      .join(', ');
    return {
      success: false,
      selected: '',
      isAvailable: false,
      error: `Requested period '${period}' is unavailable in GST Portal dropdown. Available periods: [${available}]`,
    };
  }

  periodSelect.value = matchingOption.value;
  periodSelect.dispatchEvent(new Event('change', { bubbles: true }));
  periodSelect.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(50);

  const selectedIndex = periodSelect.selectedIndex;
  const selectedOption = selectedIndex >= 0 ? periodSelect.options[selectedIndex] : matchingOption;
  const verifiedValue = (selectedOption?.text || selectedOption?.value || periodSelect.value || '').trim();

  Logger.info(`[Period Selection] Successfully selected period '${verifiedValue}' (target: '${period}')`);
  return {
    success: true,
    selected: verifiedValue,
    isAvailable: true,
  };
}

/**
 * Clicks the Returns Dashboard SEARCH button
 */
export async function clickSearchButton(
  searchSelectors: string[],
  doc?: Document | null
): Promise<{ success: boolean; error?: string }> {
  const activeDoc = doc || (typeof document !== 'undefined' ? document : null);
  if (!activeDoc) return { success: true };

  const btn = querySelectorFallbacks<HTMLButtonElement | HTMLInputElement>(searchSelectors, activeDoc);
  if (!btn) {
    return {
      success: false,
      error: 'Search button not found on GST Returns Dashboard',
    };
  }

  btn.click();
  await sleep(150);
  return { success: true };
}
