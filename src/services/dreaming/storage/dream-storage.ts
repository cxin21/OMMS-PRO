/**
 * DreamStorage - 整理报告存储
 *
 * v2.1.0: 使用 SQLite 持久化存储
 */

import type { OrganizationReport, OrganizationType, OrganizationStatus } from '../types';
import type { PhaseResult } from '../types';
import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { FileUtils } from '../../../shared/utils/file';
import { createLogger, type ILogger } from '../../../shared/logging';
import { config } from '../../../shared/config';

export interface IDreamStorage {
  saveReport(report: OrganizationReport): Promise<void>;
  getAllReports(): Promise<OrganizationReport[]>;
  getReportsByType(type: OrganizationType): Promise<OrganizationReport[]>;
  getRecentReports(limit: number): Promise<OrganizationReport[]>;
  clearOldReports(beforeTimestamp: number): Promise<number>;
}

/**
 * 数据库中存储的报告格式（与 OrganizationReport 兼容）
 */
interface StoredReport {
  id: string;
  type: OrganizationType;
  status: OrganizationStatus;
  executedAt: number;
  totalDuration: number;
  memoriesMerged: number;
  memoriesArchived: number;
  memoriesDeleted: number;
  relationsRebuilt: number;
  storageFreed: number;
  phasesJson: string;  // JSON stringified phases
  extraJson: string;   // JSON stringified extra data (errors, recommendations, configSnapshot)
}

/**
 * SQLite 持久化存储实现
 */
export class DreamStorage implements IDreamStorage {
  private readonly logger: ILogger;
  private db: Database.Database | null = null;
  private readonly dbPath: string;

  constructor(userConfig?: { dbPath?: string }) {
    this.logger = createLogger('DreamStorage', { module: 'dream-storage' });

    // 从 ConfigManager 获取路径配置
    const storageConfig = config.getConfigOrThrow<{ dreamReportsDbPath: string }>('memoryService.storage');
    const dreamReportsDbPath = storageConfig.dreamReportsDbPath;

    this.dbPath = userConfig?.dbPath ?? dreamReportsDbPath;
  }

  /**
   * 初始化数据库连接和表结构
   */
  private async ensureInitialized(): Promise<void> {
    if (this.db) return;

    try {
      // Ensure directory exists
      const dir = dirname(this.dbPath);
      await FileUtils.ensureDirectory(dir);

      this.db = new Database(this.dbPath);

      // Create reports table - matches OrganizationReport fields
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS dream_reports (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          executedAt INTEGER NOT NULL,
          totalDuration INTEGER,
          memoriesMerged INTEGER DEFAULT 0,
          memoriesArchived INTEGER DEFAULT 0,
          memoriesDeleted INTEGER DEFAULT 0,
          relationsRebuilt INTEGER DEFAULT 0,
          storageFreed INTEGER DEFAULT 0,
          phasesJson TEXT NOT NULL,
          extraJson TEXT
        )
      `);

      // Create indexes
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_type ON dream_reports(type);
        CREATE INDEX IF NOT EXISTS idx_executedAt ON dream_reports(executedAt);
        CREATE INDEX IF NOT EXISTS idx_status ON dream_reports(status);
      `);

      this.logger.info('DreamStorage initialized', { dbPath: this.dbPath });
    } catch (error) {
      this.logger.error('Failed to initialize DreamStorage', { error });
      throw error;
    }
  }

  /**
   * 保存整理报告
   */
  async saveReport(report: OrganizationReport): Promise<void> {
    this.logger.info('saveReport 方法调用', {
      method: 'saveReport',
      id: report.id,
      type: report.type,
      status: report.status,
    });

    await this.ensureInitialized();

    try {
      const stmt = this.db!.prepare(`
        INSERT OR REPLACE INTO dream_reports (
          id, type, status, executedAt, totalDuration,
          memoriesMerged, memoriesArchived, memoriesDeleted, relationsRebuilt, storageFreed,
          phasesJson, extraJson
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        report.id,
        report.type,
        report.status,
        report.executedAt,
        report.totalDuration ?? null,
        report.memoriesMerged ?? 0,
        report.memoriesArchived ?? 0,
        report.memoriesDeleted ?? 0,
        report.relationsRebuilt ?? 0,
        report.storageFreed ?? 0,
        JSON.stringify(report.phases),
        JSON.stringify({})
      );

      this.logger.info('Dream report saved', { id: report.id, type: report.type });
    } catch (error) {
      this.logger.error('Failed to save dream report', { id: report.id, error });
      throw error;
    }
  }

  /**
   * 获取所有报告
   */
  async getAllReports(): Promise<OrganizationReport[]> {
    this.logger.info('getAllReports 方法调用', { method: 'getAllReports' });

    await this.ensureInitialized();

    try {
      const stmt = this.db!.prepare(`
        SELECT * FROM dream_reports ORDER BY executedAt DESC
      `);

      const rows = stmt.all() as StoredReport[];
      const reports = rows.map(this.rowToReport);
      this.logger.info('getAllReports 方法返回', { method: 'getAllReports', count: reports.length });
      return reports;
    } catch (error) {
      this.logger.error('Failed to get all reports', { error });
      return [];
    }
  }

  /**
   * 按类型获取报告
   */
  async getReportsByType(type: OrganizationType): Promise<OrganizationReport[]> {
    this.logger.info('getReportsByType 方法调用', { method: 'getReportsByType', type });

    await this.ensureInitialized();

    try {
      const stmt = this.db!.prepare(`
        SELECT * FROM dream_reports WHERE type = ? ORDER BY executedAt DESC
      `);

      const rows = stmt.all(type) as StoredReport[];
      return rows.map(this.rowToReport);
    } catch (error) {
      this.logger.error('Failed to get reports by type', { type, error });
      return [];
    }
  }

  /**
   * 获取最近的报告
   */
  async getRecentReports(limit: number): Promise<OrganizationReport[]> {
    this.logger.info('getRecentReports 方法调用', { method: 'getRecentReports', limit });

    await this.ensureInitialized();

    try {
      const stmt = this.db!.prepare(`
        SELECT * FROM dream_reports ORDER BY executedAt DESC LIMIT ?
      `);

      const rows = stmt.all(limit) as StoredReport[];
      return rows.map(this.rowToReport);
    } catch (error) {
      this.logger.error('Failed to get recent reports', { limit, error });
      return [];
    }
  }

  /**
   * 清理旧报告
   */
  async clearOldReports(beforeTimestamp: number): Promise<number> {
    this.logger.info('clearOldReports 方法调用', { method: 'clearOldReports', beforeTimestamp });

    await this.ensureInitialized();

    try {
      const stmt = this.db!.prepare(`
        DELETE FROM dream_reports WHERE executedAt < ?
      `);

      const result = stmt.run(beforeTimestamp);
      this.logger.info('Old reports cleared', { count: result.changes });
      return result.changes;
    } catch (error) {
      this.logger.error('Failed to clear old reports', { beforeTimestamp, error });
      return 0;
    }
  }

  /**
   * 将数据库行转换为 OrganizationReport
   */
  private rowToReport(row: StoredReport): OrganizationReport {
    let phases: OrganizationReport['phases'];
    try {
      phases = JSON.parse(row.phasesJson || '{"scan":{},"analyze":{},"execute":{}}');
    } catch (error) {
      this.logger.warn('Failed to parse phases JSON, using defaults', {
        reportId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
      phases = { scan: {} as PhaseResult, analyze: {} as PhaseResult, execute: {} as PhaseResult };
    }

    return {
      id: row.id,
      type: row.type,
      status: row.status,
      phases,
      memoriesMerged: row.memoriesMerged ?? 0,
      memoriesArchived: row.memoriesArchived ?? 0,
      memoriesDeleted: row.memoriesDeleted ?? 0,
      relationsRebuilt: row.relationsRebuilt ?? 0,
      storageFreed: row.storageFreed ?? 0,
      executedAt: row.executedAt,
      totalDuration: row.totalDuration ?? 0,
    };
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.logger.info('DreamStorage closed');
    }
  }
}
