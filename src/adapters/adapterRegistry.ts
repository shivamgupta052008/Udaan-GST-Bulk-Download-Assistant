import { GSTReturnAdapter, ReturnType } from '../gst/returnTypes';
import { GSTR1Adapter } from './gstr1Adapter';
import { GSTR2AAdapter } from './gstr2aAdapter';
import { GSTR2BAdapter } from './gstr2bAdapter';
import { GSTR3BAdapter } from './gstr3bAdapter';

/**
 * Adapter Registry for Milestone 4 Multi-Return Automation
 * Factory and lookup service for return-specific download adapters.
 */
class AdapterRegistry {
  private static instance: AdapterRegistry | null = null;
  private adapters: Map<ReturnType, GSTReturnAdapter> = new Map();

  private constructor() {
    this.registerDefaults();
  }

  public static getInstance(): AdapterRegistry {
    if (!AdapterRegistry.instance) {
      AdapterRegistry.instance = new AdapterRegistry();
    }
    return AdapterRegistry.instance;
  }

  private registerDefaults(): void {
    this.adapters.set('GSTR-1', new GSTR1Adapter());
    this.adapters.set('GSTR-2A', new GSTR2AAdapter());
    this.adapters.set('GSTR-2B', new GSTR2BAdapter());
    this.adapters.set('GSTR-3B', new GSTR3BAdapter());
  }

  public getAdapter(returnType: ReturnType): GSTReturnAdapter {
    const adapter = this.adapters.get(returnType);
    if (!adapter) {
      throw new Error(`Unsupported return type: ${returnType}`);
    }
    return adapter;
  }

  public getAllAdapters(): GSTReturnAdapter[] {
    return Array.from(this.adapters.values());
  }

  public findAdapterForPage(url: string, documentTitle?: string): GSTReturnAdapter | null {
    for (const adapter of this.adapters.values()) {
      if (adapter.canHandlePage(url, documentTitle)) {
        return adapter;
      }
    }
    return null;
  }
}

export const adapterRegistry = AdapterRegistry.getInstance();

export function getAdapterForReturnType(returnType: ReturnType): GSTReturnAdapter {
  return adapterRegistry.getAdapter(returnType);
}
