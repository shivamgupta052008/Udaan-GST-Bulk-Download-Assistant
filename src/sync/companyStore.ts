/**
 * Company Profiles Store
 * Manages registered GSTIN to Company mappings and local folder names
 */
import { CompanyProfile } from './syncTypes';
import { getCompanyFolderName } from './pathUtils';
import { ExtensionStorage } from '../storage/extensionStorage';
import { Logger } from '../shared/logger';

const STORAGE_KEY_COMPANIES = 'udaan_gst_companies';
const STORAGE_KEY_ACTIVE_COMPANY = 'udaan_gst_active_company';

export class CompanyStore {
  private static cachedCompanies: Map<string, CompanyProfile> = new Map();
  private static activeGstin: string | null = null;
  private static isInitialized = false;

  public static async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    try {
      const stored = await ExtensionStorage.get<CompanyProfile[]>(STORAGE_KEY_COMPANIES, []);
      for (const comp of stored) {
        this.cachedCompanies.set(comp.gstin.toUpperCase(), comp);
      }
      this.activeGstin = await ExtensionStorage.get<string | null>(STORAGE_KEY_ACTIVE_COMPANY, null);
      Logger.info(`[CompanyStore] Initialized with ${this.cachedCompanies.size} company profile(s)`);
    } catch (err) {
      Logger.error(`[CompanyStore] Init failed: ${String(err)}`);
    }
  }

  public static async getAllCompanies(): Promise<CompanyProfile[]> {
    await this.init();
    return Array.from(this.cachedCompanies.values());
  }

  public static async getCompany(gstin: string): Promise<CompanyProfile | undefined> {
    await this.init();
    return this.cachedCompanies.get(gstin.trim().toUpperCase());
  }

  public static async saveCompany(gstin: string, companyName: string): Promise<CompanyProfile> {
    await this.init();
    const cleanGstin = gstin.trim().toUpperCase();
    const cleanName = companyName.trim() || 'My Company';
    const folderName = getCompanyFolderName(cleanGstin, cleanName);

    const existing = this.cachedCompanies.get(cleanGstin);
    const profile: CompanyProfile = {
      gstin: cleanGstin,
      companyName: cleanName,
      folderName,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    this.cachedCompanies.set(cleanGstin, profile);
    await ExtensionStorage.set(STORAGE_KEY_COMPANIES, Array.from(this.cachedCompanies.values()));
    Logger.info(`[CompanyStore] Saved company profile: ${cleanGstin} -> ${folderName}`);
    return profile;
  }

  public static async getActiveCompanyGstin(): Promise<string | null> {
    await this.init();
    return this.activeGstin;
  }

  public static async setActiveCompanyGstin(gstin: string | null): Promise<void> {
    await this.init();
    this.activeGstin = gstin ? gstin.trim().toUpperCase() : null;
    await ExtensionStorage.set(STORAGE_KEY_ACTIVE_COMPANY, this.activeGstin);
  }

  public static async clearAll(): Promise<void> {
    this.cachedCompanies.clear();
    this.activeGstin = null;
    await ExtensionStorage.remove(STORAGE_KEY_COMPANIES);
    await ExtensionStorage.remove(STORAGE_KEY_ACTIVE_COMPANY);
  }
}
