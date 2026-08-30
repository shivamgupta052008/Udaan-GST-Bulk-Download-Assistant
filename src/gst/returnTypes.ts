/**
 * GST Return Types and Adapter Specifications
 * Milestone 4 Multi-Return Automation (GSTR-1, GSTR-2A, GSTR-2B, GSTR-3B)
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

export interface AdapterExecutionResult {
  success: boolean;
  downloadTriggered: boolean;
  message: string;
  downloadId?: number;
  filename?: string;
  error?: string;
}

/**
 * Universal Return Adapter Interface
 */
export interface GSTReturnAdapter {
  returnType: ReturnType;
  canHandlePage(url: string, documentTitle?: string): boolean;
  navigateToPeriod(
    gstin: string,
    financialYear: string,
    period: string,
    options?: { doc?: Document }
  ): Promise<boolean>;
  startDownload(options?: {
    gstin?: string;
    financialYear?: string;
    period?: string;
    doc?: Document;
    abortSignal?: AbortSignal;
  }): Promise<AdapterExecutionResult>;
  verifyGstinContext?(
    expectedGstin: string,
    doc?: Document
  ): { verified: boolean; detectedGstin?: string; reason?: string };
  selectFinancialYear?(
    financialYear: string,
    doc?: Document
  ): Promise<{ success: boolean; selected: string; error?: string }>;
  selectReturnPeriod?(
    period: string,
    doc?: Document
  ): Promise<{ success: boolean; selected: string; isAvailable: boolean; error?: string }>;
  clickSearch?(doc?: Document): Promise<{ success: boolean; error?: string }>;
  triggerGenerateJson?(
    doc?: Document
  ): Promise<{
    success: boolean;
    state?: 'READY' | 'GENERATING' | 'ERROR' | 'UNEXPECTED';
    isAlreadyGenerated?: boolean;
    error?: string;
  }>;
  waitForGeneratedJsonAndDownload?(options?: {
    pollIntervalMs?: number;
    timeoutMs?: number;
    doc?: Document;
    abortSignal?: AbortSignal;
  }): Promise<{ success: boolean; downloadTriggered: boolean; downloadLink?: string; error?: string }>;
}
