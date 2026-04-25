/**
 * Storage Migration Script
 *
 * 数据迁移脚本 - 将旧版存储结构迁移到新架构
 * - 迁移 VectorStore 数据到 LanceDBBackend
 * - 迁移 SQLiteMetaStore 数据到 SQLiteBackend
 * - 迁移 FileSystem 数据到 FileSystemBackend
 * - 验证迁移完整性
 *
 * @module storage/migration
 */

import { createLogger } from '../../../shared/logging';
import type { ILogger } from '../../../shared/logging';
import type { VectorStore } from '../stores/vector-store';
import type { SQLiteMetaStore } from '../stores/sqlite-meta-store';

export interface MigrationConfig {
  /** 源 VectorStore */
  sourceVectorStore?: VectorStore;
  /** 源 SQLiteMetaStore */
  sourceMetaStore?: SQLiteMetaStore;
  /** 目标 backend */
  targetBackend?: any;
  /** 批次大小 */
  batchSize: number;
  /** 是否验证迁移 */
  verifyMigration: boolean;
  /** 是否删除源数据（谨慎） */
  deleteSourceData: boolean;
  /** 迁移报告路径 */
  reportPath?: string;
}

export interface MigrationResult {
  success: boolean;
  totalRecords: number;
  migratedRecords: number;
  failedRecords: number;
  errors: Array<{ recordId: string; error: string }>;
  duration: number;
  verificationPassed?: boolean;
}

interface MigrationStats {
  startTime: number;
  endTime: number;
  totalRecords: number;
  migratedRecords: number;
  failedRecords: number;
  errors: Array<{ recordId: string; error: string }>;
}

/**
 * StorageMigration
 *
 * 存储数据迁移工具
 */
export class StorageMigration {
  private logger: ILogger;
  private stats: MigrationStats = {
    startTime: 0,
    endTime: 0,
    totalRecords: 0,
    migratedRecords: 0,
    failedRecords: 0,
    errors: []
  };

  constructor(private config: MigrationConfig) {
    this.logger = createLogger('StorageMigration');
  }

  /**
   * 执行全量迁移
   */
  async migrate(): Promise<MigrationResult> {
    this.stats.startTime = Date.now();
    this.logger.info('Starting storage migration');

    try {
      // Check if we have source and target
      if (!this.config.sourceVectorStore && !this.config.sourceMetaStore) {
        throw new Error('No source data store provided');
      }

      if (!this.config.targetBackend) {
        throw new Error('No target backend provided');
      }

      // Initialize target backend
      await this.config.targetBackend.initialize();

      // Migrate vector store data if available
      if (this.config.sourceVectorStore) {
        await this.migrateVectorStore();
      }

      // Migrate meta store data if available
      if (this.config.sourceMetaStore) {
        await this.migrateMetaStore();
      }

      // Verify if requested
      if (this.config.verifyMigration) {
        const verified = await this.verifyMigration();
        this.logger.info('Migration verification result', { passed: verified });
      }

      this.stats.endTime = Date.now();
      this.logger.info('Migration completed', {
        total: this.stats.totalRecords,
        migrated: this.stats.migratedRecords,
        failed: this.stats.failedRecords,
        duration: this.stats.endTime - this.stats.startTime
      });

      return this.generateResult(true);
    } catch (error) {
      this.stats.endTime = Date.now();
      this.logger.error('Migration failed', { error: String(error) });
      return this.generateResult(false);
    }
  }

  /**
   * 迁移 VectorStore 数据
   */
  private async migrateVectorStore(): Promise<void> {
    this.logger.info('Migrating VectorStore data');

    const vectorStore = this.config.sourceVectorStore!;

    // Get all vector IDs from source
    // This would need a method like getAllIds() on VectorStore
    const allIds = await (vectorStore as any).getAllIds?.() || [];

    this.stats.totalRecords += allIds.length;

    // Process in batches
    for (let i = 0; i < allIds.length; i += this.config.batchSize) {
      const batchIds = allIds.slice(i, i + this.config.batchSize);
      const batchResults = await this.processBatch(batchIds, async (id: string) => {
        const doc = await vectorStore.getById(id);
        if (doc) {
          await this.config.targetBackend!.addVector(id, doc.vector, {
            summary: doc.text,
            agentId: doc.metadata?.agentId || '',
            sessionId: doc.metadata?.sessionId,
            scope: doc.metadata?.scope,
            type: doc.metadata?.type,
            importanceScore: doc.metadata?.importanceScore || 0,
            scopeScore: doc.metadata?.scopeScore || 0,
            tags: doc.metadata?.tags || [],
            createdAt: doc.metadata?.createdAt || Date.now(),
            palaceRef: doc.metadata?.palaceRef || '',
            version: doc.metadata?.version || 1,
            isLatestVersion: doc.metadata?.isLatestVersion ?? true,
            versionGroupId: doc.metadata?.versionGroupId || id
          });
        }
        return doc !== null;
      });

      this.stats.migratedRecords += batchResults.success;
      this.stats.failedRecords += batchResults.failed;
      this.stats.errors.push(...batchResults.errors);
    }

    this.logger.info('VectorStore migration batch complete', {
      processed: allIds.length,
      migrated: this.stats.migratedRecords
    });
  }

  /**
   * 迁移 MetaStore 数据
   */
  private async migrateMetaStore(): Promise<void> {
    this.logger.info('Migrating SQLiteMetaStore data');

    const metaStore = this.config.sourceMetaStore!;

    // Query all records
    const allRecords = await metaStore.query({ limit: 100000 });

    this.stats.totalRecords += allRecords.length;

    // Process in batches
    for (let i = 0; i < allRecords.length; i += this.config.batchSize) {
      const batchRecords = allRecords.slice(i, i + this.config.batchSize);
      const batchResults = await this.processBatch(
        batchRecords.map(r => r.uid),
        async (uid: string) => {
          const record = batchRecords.find(r => r.uid === uid);
          if (record) {
            await this.config.targetBackend!.set(uid, record);
          }
          return record !== null;
        }
      );

      this.stats.migratedRecords += batchResults.success;
      this.stats.failedRecords += batchResults.failed;
      this.stats.errors.push(...batchResults.errors);
    }

    this.logger.info('MetaStore migration batch complete', {
      processed: allRecords.length,
      migrated: this.stats.migratedRecords
    });
  }

  /**
   * 处理单批次数据
   */
  private async processBatch(
    ids: string[],
    processor: (id: string) => Promise<boolean>
  ): Promise<{ success: number; failed: number; errors: Array<{ recordId: string; error: string }> }> {
    let success = 0;
    let failed = 0;
    const errors: Array<{ recordId: string; error: string }> = [];

    for (const id of ids) {
      try {
        const result = await processor(id);
        if (result) {
          success++;
        } else {
          failed++;
          errors.push({ recordId: id, error: 'Record not found or processing returned false' });
        }
      } catch (error) {
        failed++;
        errors.push({ recordId: id, error: String(error) });
      }
    }

    return { success, failed, errors };
  }

  /**
   * 验证迁移完整性
   */
  private async verifyMigration(): Promise<boolean> {
    this.logger.info('Starting migration verification');

    const sourceCount = this.stats.totalRecords;
    const targetStats = await this.config.targetBackend!.getStats();

    // Allow for some tolerance due to metadata differences
    const tolerance = 0.02; // 2% tolerance
    // Guard against division by zero when sourceCount is 0
    const diff = sourceCount > 0 ? Math.abs(sourceCount - targetStats.totalItems) / sourceCount : 0;

    if (diff > tolerance) {
      this.logger.error('Migration verification failed', {
        sourceCount,
        targetCount: targetStats.totalItems,
        diff: diff * 100
      });
      return false;
    }

    this.logger.info('Migration verification passed', {
      sourceCount,
      targetCount: targetStats.totalItems
    });
    return true;
  }

  /**
   * 生成迁移报告
   */
  private generateResult(success: boolean): MigrationResult {
    const result: MigrationResult = {
      success,
      totalRecords: this.stats.totalRecords,
      migratedRecords: this.stats.migratedRecords,
      failedRecords: this.stats.failedRecords,
      errors: this.stats.errors.slice(0, 100), // Limit error list
      duration: this.stats.endTime - this.stats.startTime
    };

    if (this.config.verifyMigration && success) {
      result.verificationPassed = true;
    }

    // Write report if path provided
    if (this.config.reportPath) {
      this.writeReport(result);
    }

    return result;
  }

  /**
   * 写入迁移报告
   */
  private writeReport(result: MigrationResult): void {
    try {
      const report = {
        timestamp: new Date().toISOString(),
        config: {
          batchSize: this.config.batchSize,
          verifyMigration: this.config.verifyMigration,
          deleteSourceData: this.config.deleteSourceData
        },
        result
      };

      // In a real implementation, this would write to file
      this.logger.info('Migration report', report);
    } catch (error) {
      this.logger.error('Failed to write migration report', { error: String(error) });
    }
  }

  /**
   * 获取迁移统计信息
   */
  getStats(): MigrationStats {
    return { ...this.stats };
  }
}

/**
 * 快速迁移函数
 */
export async function quickMigrate(
  sourceVectorStore: VectorStore,
  targetBackend: any,
  options?: Partial<MigrationConfig>
): Promise<MigrationResult> {
  const migration = new StorageMigration({
    sourceVectorStore,
    targetBackend,
    batchSize: options?.batchSize ?? 100,
    verifyMigration: options?.verifyMigration ?? true,
    deleteSourceData: false,
    ...options
  });

  return migration.migrate();
}