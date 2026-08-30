/**
 * Storage Schema Versioning and Migration Manager
 * Ensures future extension upgrades and schema changes can safely migrate without data loss.
 */
import { ExtensionStorage } from './extensionStorage';
import { QueueStore } from '../queue/queueStore';
import { QueueIntegrityValidator } from '../diagnostics/queueIntegrity';
import { Logger } from '../shared/logger';
import { STORAGE_KEYS } from '../shared/constants';

export const CURRENT_STORAGE_SCHEMA_VERSION = 1;
export const STORAGE_KEY_SCHEMA_VERSION = 'udaan_gst_schema_version';

export interface StorageMigrationResult {
  fromVersion: number;
  toVersion: number;
  migrated: boolean;
  logs: string[];
}

export class SchemaManager {
  /**
   * Retrieves current schema version from storage (defaults to CURRENT_STORAGE_SCHEMA_VERSION for fresh installs)
   */
  public static async getSchemaVersion(): Promise<number> {
    return await ExtensionStorage.get<number>(STORAGE_KEY_SCHEMA_VERSION, 0);
  }

  /**
   * Updates schema version marker
   */
  public static async setSchemaVersion(version: number): Promise<void> {
    await ExtensionStorage.set(STORAGE_KEY_SCHEMA_VERSION, version);
  }

  /**
   * Runs non-destructive schema migrations forward up to CURRENT_STORAGE_SCHEMA_VERSION
   */
  public static async migrate(): Promise<StorageMigrationResult> {
    const fromVersion = await this.getSchemaVersion();
    const logs: string[] = [];

    if (fromVersion === CURRENT_STORAGE_SCHEMA_VERSION) {
      return {
        fromVersion,
        toVersion: CURRENT_STORAGE_SCHEMA_VERSION,
        migrated: false,
        logs: [`Storage schema is already up-to-date (v${CURRENT_STORAGE_SCHEMA_VERSION})`],
      };
    }

    Logger.info(`[Schema Migration] Starting migration from v${fromVersion} to v${CURRENT_STORAGE_SCHEMA_VERSION}...`);
    logs.push(`Initiated migration v${fromVersion} -> v${CURRENT_STORAGE_SCHEMA_VERSION}`);

    try {
      let current = fromVersion;

      // Migration v0 -> v1 (Base schema baseline initialization & sanitization)
      if (current === 0) {
        logs.push('Executing migration step: v0 -> v1 (Baseline Queue & Diagnostics normalization)');
        const rawQueueState = await ExtensionStorage.getQueueState();
        const { repairedState, repairsApplied } = QueueIntegrityValidator.repair(rawQueueState);

        await ExtensionStorage.saveQueueState(repairedState);
        repairsApplied.forEach((r) => logs.push(`[v0->v1] ${r}`));

        current = 1;
        await this.setSchemaVersion(1);
        logs.push('Successfully applied schema v1');
      }

      // Placeholder for future forward migrations:
      // if (current === 1) { ... current = 2; await this.setSchemaVersion(2); }

      Logger.info(`[Schema Migration] Completed migration to schema v${CURRENT_STORAGE_SCHEMA_VERSION}`);
      return {
        fromVersion,
        toVersion: CURRENT_STORAGE_SCHEMA_VERSION,
        migrated: true,
        logs,
      };
    } catch (err) {
      const errMsg = `Schema migration failed: ${String(err)}`;
      Logger.error(`[Schema Migration Error] ${errMsg}`);
      logs.push(errMsg);
      return {
        fromVersion,
        toVersion: fromVersion,
        migrated: false,
        logs,
      };
    }
  }

  /**
   * Validates storage integrity and repairs corrupted queue structure safely
   */
  public static async validateAndRepairStorage(): Promise<{
    healthy: boolean;
    issuesFound: string[];
    repairsApplied: string[];
  }> {
    const issuesFound: string[] = [];
    const repairsApplied: string[] = [];

    try {
      const queueState = await ExtensionStorage.getQueueState();
      const report = QueueIntegrityValidator.validate(queueState);

      if (!report.isValid || report.violations.length > 0) {
        report.violations.forEach((v) => issuesFound.push(`[${v.severity}] ${v.message}`));
        const repairResult = QueueIntegrityValidator.repair(queueState);
        await ExtensionStorage.saveQueueState(repairResult.repairedState);
        repairsApplied.push(...repairResult.repairsApplied);
      }

      return {
        healthy: issuesFound.length === 0,
        issuesFound,
        repairsApplied,
      };
    } catch (err) {
      issuesFound.push(`Storage exception: ${String(err)}`);
      return {
        healthy: false,
        issuesFound,
        repairsApplied,
      };
    }
  }
}
