/**
 * GST Return Types and Adapter Specifications
 */

export type ReturnType = 'GSTR-1' | 'GSTR-2A' | 'GSTR-2B' | 'GSTR-3B';

export type FinancialYear = '2025-2026' | '2024-2025' | '2023-2024' | '2022-2023' | string;

export type ReturnPeriod =
  | 'April'
  | 'May'
  | 'June'
  | 'July'
  | 'August'
  | 'September'
  | 'October'
  | 'November'
  | 'December'
  | 'January'
  | 'February'
  | 'March'
  | string;

/**
 * Future Return Adapter Interface for Milestone 2+
 */
export interface GSTReturnAdapter {
  returnType: ReturnType;
  canHandlePage(url: string, documentTitle?: string): boolean;
  navigateToPeriod(gstin: string, financialYear: string, period: string): Promise<boolean>;
  startDownload(): Promise<{ downloadTriggered: boolean; message: string }>;
}
