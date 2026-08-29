import { GSTReturnAdapter, ReturnType } from '../gst/returnTypes';

/**
 * GSTR-1 Adapter (Placeholder for Milestone 2)
 * Do NOT automate in Milestone 1.
 */
export class GSTR1Adapter implements GSTReturnAdapter {
  public readonly returnType: ReturnType = 'GSTR-1';

  public canHandlePage(url: string): boolean {
    return url.includes('gstr1') || url.includes('returns');
  }

  public async navigateToPeriod(_gstin: string, _financialYear: string, _period: string): Promise<boolean> {
    throw new Error('Not implemented — Milestone 2');
  }

  public async startDownload(): Promise<{ downloadTriggered: boolean; message: string }> {
    return {
      downloadTriggered: false,
      message: 'GSTR-1 download automation is scheduled for Milestone 2.',
    };
  }
}
