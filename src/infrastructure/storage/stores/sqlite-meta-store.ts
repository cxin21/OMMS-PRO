/**
 * SQLite Meta Store - 基于 SQLite 的元数据索引存储
 * @module storage/sqlite-meta-store
 *
 * 版本: v2.2.0
 * - UID 作为主键
 * - 版本链管理 (独立表 memory_versions)
 * - Palace 层级化存储
 */

import type { MemoryScope, MemoryType, MemoryBlock } from '../../../core/types/memory';
import type {
  ISQLiteMetaStore,
  MemoryMetaRecord,
  SQLiteQueryOptions,
  VersionInfo,
} from '../core/types';
import { createServiceLogger, ILogger } from '../../../shared/logging';
import { FileUtils } from '../../../shared/utils/file';
import { dirname } from 'path';
import Database from 'better-sqlite3';
import { config } from '../../../shared/config';

/**
 * Version record stored in the separate memory_versions table
 */
interface VersionRecord {
  id: string;
  uid: string;
  versionGroupId: string;
  version: number;
  palaceRef: string;
  summary: string;
  contentLength: number;
  createdAt: number;
  isLatestVersion: boolean;
}

/**
 * SQLite Meta Store
 * 负责记忆元数据的索引存储，提供高效的条件过滤查询
 * 支持版本化管理
 */
export class SQLiteMetaStore implements ISQLiteMetaStore {
  private logger: ILogger;
  private db: any; // better-sqlite3 database
  private initialized: boolean;
  private migrated: boolean;
  private config: { dbPath: string };

  constructor(userConfig: Partial<{ dbPath: string }> = {}) {
    this.config = { dbPath: userConfig?.dbPath ?? '' };
    this.logger = createServiceLogger('SQLiteMetaStore');
    this.db = null;
    this.initialized = false;
    this.migrated = false;
  }

  /**
   * 初始化数据库连接和表结构
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 从 ConfigManager 读取配置
    const storageConfig = config.getConfigOrThrow<{ metaStoreDbPath: string }>('memoryService.storage');
    this.config.dbPath = this.config.dbPath || storageConfig.metaStoreDbPath;

    try {
      // Ensure directory exists - use dirname() for cross-platform compatibility
      await FileUtils.ensureDirectory(dirname(this.config.dbPath));

      this.db = new Database(this.config.dbPath);

      // Create table with version support
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS memory_meta (
          uid TEXT PRIMARY KEY,
          version INTEGER NOT NULL DEFAULT 1,

          -- 类型与来源
          agentId TEXT NOT NULL,
          sessionId TEXT,
          type TEXT NOT NULL,
          topicId TEXT,

          -- 评分
          importanceScore REAL NOT NULL,
          scopeScore REAL NOT NULL,
          scope TEXT NOT NULL,

          -- Palace 位置 (v2.1.0)
          wingId TEXT NOT NULL,
          hallId TEXT NOT NULL,
          roomId TEXT NOT NULL,
          closetId TEXT NOT NULL,

          -- 版本
          versionChain TEXT NOT NULL DEFAULT '[]',
          isLatestVersion INTEGER NOT NULL DEFAULT 1,
          versionGroupId TEXT NOT NULL,

          -- 其他
          tags TEXT NOT NULL DEFAULT '[]',
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          lastRecalledAt INTEGER,
          recallCount INTEGER NOT NULL DEFAULT 0,
          usedByAgents TEXT NOT NULL DEFAULT '[]',

          -- 指向当前版本内容
          currentPalaceRef TEXT NOT NULL
        )
      `);

      // Create indexes for common queries
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_agentId ON memory_meta(agentId);
        CREATE INDEX IF NOT EXISTS idx_sessionId ON memory_meta(sessionId);
        CREATE INDEX IF NOT EXISTS idx_scope ON memory_meta(scope);
        CREATE INDEX IF NOT EXISTS idx_type ON memory_meta(type);
        CREATE INDEX IF NOT EXISTS idx_topicId ON memory_meta(topicId);
        CREATE INDEX IF NOT EXISTS idx_createdAt ON memory_meta(createdAt);
        CREATE INDEX IF NOT EXISTS idx_importanceScore ON memory_meta(importanceScore);
        CREATE INDEX IF NOT EXISTS idx_isLatestVersion ON memory_meta(isLatestVersion);
        CREATE INDEX IF NOT EXISTS idx_versionGroupId ON memory_meta(versionGroupId);
        CREATE INDEX IF NOT EXISTS idx_lastRecalledAt ON memory_meta(lastRecalledAt);
        CREATE INDEX IF NOT EXISTS idx_recallCount ON memory_meta(recallCount);
        CREATE INDEX IF NOT EXISTS idx_wingId ON memory_meta(wingId);
        CREATE INDEX IF NOT EXISTS idx_hallId ON memory_meta(hallId);
        CREATE INDEX IF NOT EXISTS idx_roomId ON memory_meta(roomId);
      `);

      // 迁移: 为旧数据库添加 usedByAgents 列（如果不存在）
      // 注意: runMigrations() 也会在每次 ensureInitialized() 后执行，
      // 此处提前运行是为了兼容全新数据库的首次初始化路径
      try {
        this.db.exec(`ALTER TABLE memory_meta ADD COLUMN usedByAgents TEXT NOT NULL DEFAULT '[]'`);
        this.logger.info('Migrated memory_meta: added usedByAgents column');
      } catch {
        // 列已存在，忽略
      }

      // Create memory_versions table for efficient version queries (v2.2.0)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS memory_versions (
          id TEXT PRIMARY KEY,
          uid TEXT NOT NULL,
          versionGroupId TEXT NOT NULL,
          version INTEGER NOT NULL,
          palaceRef TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          contentLength INTEGER NOT NULL,
          createdAt INTEGER NOT NULL,
          isLatestVersion INTEGER NOT NULL DEFAULT 0
        )
      `);

      // Create indexes for memory_versions
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_versions_uid ON memory_versions(uid);
        CREATE INDEX IF NOT EXISTS idx_versions_versionGroupId ON memory_versions(versionGroupId);
        CREATE INDEX IF NOT EXISTS idx_versions_createdAt ON memory_versions(createdAt);
      `);

      // 迁移: 为旧数据库添加 topicId 列（如果不存在）
      try {
        this.db.exec(`ALTER TABLE memory_meta ADD COLUMN topicId TEXT`);
        this.logger.info('Migrated memory_meta: added topicId column');
      } catch {
        // 列已存在，忽略
      }

      // 迁移: 检测 memory_versions 表是否存在，如不存在则创建
      this.ensureMemoryVersionsTable();

      this.initialized = true;
      this.logger.info('SQLiteMetaStore initialized', { dbPath: this.config.dbPath });
    } catch (error) {
      this.logger.error('Failed to initialize SQLiteMetaStore', { error });
      throw error;
    }
  }

  /**
   * 确保 memory_versions 表存在（幂等迁移）
   */
  private ensureMemoryVersionsTable(): void {
    try {
      const result = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_versions'").get();
      if (!result) {
        this.db.exec(`
          CREATE TABLE memory_versions (
            id TEXT PRIMARY KEY,
            uid TEXT NOT NULL,
            versionGroupId TEXT NOT NULL,
            version INTEGER NOT NULL,
            palaceRef TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            contentLength INTEGER NOT NULL,
            createdAt INTEGER NOT NULL,
            isLatestVersion INTEGER NOT NULL DEFAULT 0
          )
        `);
        this.db.exec(`
          CREATE INDEX idx_versions_uid ON memory_versions(uid);
          CREATE INDEX idx_versions_versionGroupId ON memory_versions(versionGroupId);
          CREATE INDEX idx_versions_createdAt ON memory_versions(createdAt);
        `);
        this.logger.info('Created memory_versions table for version chain storage');
      }
    } catch (error) {
      this.logger.warn('Failed to ensure memory_versions table', { error });
    }
  }

  /**
   * 插入元数据记录
   */
  async insert(record: MemoryMetaRecord): Promise<void> {
    await this.ensureInitialized();

    try {
      const stmt = this.db.prepare(`
        INSERT INTO memory_meta (
          uid, version, agentId, sessionId, type, importanceScore, scopeScore, scope,
          wingId, hallId, roomId, closetId,
          versionChain, isLatestVersion, versionGroupId, tags, createdAt, updatedAt, lastRecalledAt, recallCount, usedByAgents, currentPalaceRef
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        record.uid,
        record.version,
        record.agentId,
        record.sessionId ?? null,
        record.type,
        record.importanceScore,
        record.scopeScore,
        record.scope,
        record.palace.wingId,
        record.palace.hallId,
        record.palace.roomId,
        record.palace.closetId,
        JSON.stringify(record.versionChain),
        record.isLatestVersion ? 1 : 0,
        record.versionGroupId,
        JSON.stringify(record.tags),
        record.createdAt,
        record.updatedAt,
        record.lastRecalledAt ?? null,
        record.recallCount ?? 0,
        JSON.stringify(record.usedByAgents ?? [record.agentId]),
        record.currentPalaceRef
      );

      // v2.2.0: 同时写入 memory_versions 表（第一个版本）
      if (record.versionChain && record.versionChain.length > 0) {
        this.insertVersionRecord(record.uid, record.versionGroupId, record.versionChain[0]);
      }

      this.logger.debug('Meta record inserted', { uid: record.uid, versionGroupId: record.versionGroupId });
    } catch (error) {
      this.logger.error('Failed to insert meta record', { uid: record.uid, error });
      throw error;
    }
  }

  /**
   * 批量插入
   */
  async insertBatch(records: MemoryMetaRecord[]): Promise<void> {
    await this.ensureInitialized();

    const transaction = this.db.transaction(() => {
      for (const record of records) {
        const stmt = this.db.prepare(`
          INSERT INTO memory_meta (
            uid, version, agentId, sessionId, type, importanceScore, scopeScore, scope,
            wingId, hallId, roomId, closetId,
            versionChain, isLatestVersion, versionGroupId, tags, createdAt, updatedAt, lastRecalledAt, recallCount, usedByAgents, currentPalaceRef
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          record.uid,
          record.version,
          record.agentId,
          record.sessionId ?? null,
          record.type,
          record.importanceScore,
          record.scopeScore,
          record.scope,
          record.palace.wingId,
          record.palace.hallId,
          record.palace.roomId,
          record.palace.closetId,
          JSON.stringify(record.versionChain),
          record.isLatestVersion ? 1 : 0,
          record.versionGroupId,
          JSON.stringify(record.tags),
          record.createdAt,
          record.updatedAt,
          record.lastRecalledAt ?? null,
          record.recallCount ?? 0,
          JSON.stringify(record.usedByAgents ?? [record.agentId]),
          record.currentPalaceRef
        );

        // v2.2.0: 同时写入 memory_versions 表（第一个版本）
        if (record.versionChain && record.versionChain.length > 0) {
          this.insertVersionRecord(record.uid, record.versionGroupId, record.versionChain[0]);
        }
      }
    });

    try {
      transaction();
      this.logger.debug('Meta records batch inserted', { count: records.length });
    } catch (error) {
      this.logger.error('Failed to batch insert meta records', { error });
      throw error;
    }
  }

  /**
   * 更新元数据记录
   */
  async update(uid: string, updates: Partial<MemoryMetaRecord>): Promise<void> {
    await this.ensureInitialized();

    try {
      const fields: string[] = [];
      const values: any[] = [];

      if (updates.version !== undefined) {
        fields.push('version = ?');
        values.push(updates.version);
      }
      if (updates.agentId !== undefined) {
        fields.push('agentId = ?');
        values.push(updates.agentId);
      }
      if (updates.sessionId !== undefined) {
        fields.push('sessionId = ?');
        values.push(updates.sessionId);
      }
      if (updates.scope !== undefined) {
        fields.push('scope = ?');
        values.push(updates.scope);
      }
      if (updates.scopeScore !== undefined) {
        fields.push('scopeScore = ?');
        values.push(updates.scopeScore);
      }
      if (updates.type !== undefined) {
        fields.push('type = ?');
        values.push(updates.type);
      }
      if (updates.importanceScore !== undefined) {
        fields.push('importanceScore = ?');
        values.push(updates.importanceScore);
      }
      if (updates.isLatestVersion !== undefined) {
        fields.push('isLatestVersion = ?');
        values.push(updates.isLatestVersion ? 1 : 0);
      }
      if (updates.versionChain !== undefined) {
        fields.push('versionChain = ?');
        values.push(JSON.stringify(updates.versionChain));
      }
      if (updates.tags !== undefined) {
        fields.push('tags = ?');
        values.push(JSON.stringify(updates.tags));
      }
      if (updates.currentPalaceRef !== undefined) {
        fields.push('currentPalaceRef = ?');
        values.push(updates.currentPalaceRef);
      }
      if (updates.lastRecalledAt !== undefined) {
        fields.push('lastRecalledAt = ?');
        values.push(updates.lastRecalledAt);
      }
      if (updates.recallCount !== undefined) {
        fields.push('recallCount = ?');
        values.push(updates.recallCount);
      }
      if (updates.usedByAgents !== undefined) {
        fields.push('usedByAgents = ?');
        values.push(JSON.stringify(updates.usedByAgents));
      }
      if (updates.summary !== undefined) {
        fields.push('summary = ?');
        values.push(updates.summary);
      }
      if (updates.palace !== undefined) {
        fields.push('wingId = ?');
        values.push(updates.palace.wingId);
        fields.push('hallId = ?');
        values.push(updates.palace.hallId);
        fields.push('roomId = ?');
        values.push(updates.palace.roomId);
        fields.push('closetId = ?');
        values.push(updates.palace.closetId);
      }

      fields.push('updatedAt = ?');
      values.push(Date.now());

      values.push(uid);

      const stmt = this.db.prepare(`
        UPDATE memory_meta SET ${fields.join(', ')} WHERE uid = ?
      `);

      stmt.run(...values);
      this.logger.debug('Meta record updated', { uid });
    } catch (error) {
      this.logger.error('Failed to update meta record', { uid, error });
      throw error;
    }
  }

  /**
   * 删除元数据记录
   */
  async delete(uid: string): Promise<void> {
    await this.ensureInitialized();

    try {
      const stmt = this.db.prepare('DELETE FROM memory_meta WHERE uid = ?');
      stmt.run(uid);
      this.logger.debug('Meta record deleted', { uid });
    } catch (error) {
      this.logger.error('Failed to delete meta record', { uid, error });
      throw error;
    }
  }

  /**
   * 批量删除
   */
  async deleteBatch(uids: string[]): Promise<void> {
    await this.ensureInitialized();

    if (uids.length === 0) return;

    const transaction = this.db.transaction(() => {
      const stmt = this.db.prepare('DELETE FROM memory_meta WHERE uid = ?');
      for (const uid of uids) {
        stmt.run(uid);
      }
    });

    try {
      transaction();
      this.logger.debug('Meta records batch deleted', { count: uids.length });
    } catch (error) {
      this.logger.error('Failed to batch delete meta records', { error });
      throw error;
    }
  }

  /**
   * 条件查询
   */
  async query(options: SQLiteQueryOptions): Promise<MemoryMetaRecord[]> {
    await this.ensureInitialized();

    try {
      const { whereClause, params, orderByClause } = this.buildQuery(options);

      const sql = `
        SELECT * FROM memory_meta
        ${whereClause}
        ${orderByClause}
        ${options.limit ? `LIMIT ${options.limit}` : ''}
        ${options.offset ? `OFFSET ${options.offset}` : ''}
      `;

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params);

      return rows.map(this.rowToRecord);
    } catch (error) {
      this.logger.error('Query failed', { error });
      throw error;
    }
  }

  /**
   * 根据 UID 获取记录
   */
  async getById(uid: string): Promise<MemoryMetaRecord | null> {
    await this.ensureInitialized();

    try {
      const stmt = this.db.prepare('SELECT * FROM memory_meta WHERE uid = ?');
      const row = stmt.get(uid);

      return row ? this.rowToRecord(row) : null;
    } catch (error) {
      this.logger.error('Failed to get by uid', { uid, error });
      throw error;
    }
  }

  /**
   * 根据 UIDs 批量获取
   */
  async getByIds(uids: string[]): Promise<MemoryMetaRecord[]> {
    await this.ensureInitialized();

    if (uids.length === 0) return [];

    try {
      const placeholders = uids.map(() => '?').join(',');
      const stmt = this.db.prepare(`SELECT * FROM memory_meta WHERE uid IN (${placeholders})`);
      const rows = stmt.all(...uids);

      return rows.map(this.rowToRecord);
    } catch (error) {
      this.logger.error('Failed to get by uids', { error });
      throw error;
    }
  }

  /**
   * 统计数量
   */
  async count(options?: Partial<SQLiteQueryOptions>): Promise<number> {
    await this.ensureInitialized();

    try {
      const queryOptions: SQLiteQueryOptions = { ...options } as SQLiteQueryOptions;
      const { whereClause, params } = this.buildQuery(queryOptions);

      const sql = `SELECT COUNT(*) as count FROM memory_meta ${whereClause}`;
      const stmt = this.db.prepare(sql);
      const result = stmt.get(...params);

      return result.count;
    } catch (error) {
      this.logger.error('Count failed', { error });
      throw error;
    }
  }

  /**
   * 获取版本历史 (v2.2.0 - 优先从 memory_versions 表查询)
   */
  async getVersionHistory(uid: string): Promise<VersionInfo[]> {
    await this.ensureInitialized();

    try {
      // v2.2.0: 优先从 memory_versions 表查询（高效索引查询）
      const stmt = this.db.prepare(`
        SELECT version, palaceRef, summary, contentLength, createdAt
        FROM memory_versions
        WHERE uid = ?
        ORDER BY createdAt ASC
      `);
      const rows = stmt.all(uid);

      if (rows && rows.length > 0) {
        return rows.map((row: any) => ({
          version: row.version,
          palaceRef: row.palaceRef,
          summary: row.summary,
          contentLength: row.contentLength,
          createdAt: row.createdAt,
        }));
      }

      // Fallback: 从 versionChain JSON 列读取（兼容旧数据）
      const record = await this.getById(uid);
      if (!record) {
        return [];
      }
      return record.versionChain;
    } catch (error) {
      this.logger.warn('Failed to get version history from memory_versions, falling back to versionChain', { uid, error });
      const record = await this.getById(uid);
      return record?.versionChain ?? [];
    }
  }

  /**
   * 获取版本组的所有版本 (v2.2.0)
   */
  async getVersionsByGroupId(versionGroupId: string): Promise<VersionInfo[]> {
    await this.ensureInitialized();

    try {
      const stmt = this.db.prepare(`
        SELECT version, palaceRef, summary, contentLength, createdAt
        FROM memory_versions
        WHERE versionGroupId = ?
        ORDER BY createdAt ASC
      `);
      const rows = stmt.all(versionGroupId);

      return rows.map((row: any) => ({
        version: row.version,
        palaceRef: row.palaceRef,
        summary: row.summary,
        contentLength: row.contentLength,
        createdAt: row.createdAt,
      }));
    } catch (error) {
      this.logger.error('Failed to get versions by groupId', { versionGroupId, error });
      throw error;
    }
  }

  /**
   * 插入版本记录到 memory_versions 表 (v2.2.0)
   */
  private insertVersionRecord(uid: string, versionGroupId: string, versionInfo: VersionInfo): void {
    try {
      const versionId = `version_record_${uid}_${versionInfo.version}`;
      const stmt = this.db.prepare(`
        INSERT INTO memory_versions (id, uid, versionGroupId, version, palaceRef, summary, contentLength, createdAt, isLatestVersion)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `);
      stmt.run(
        versionId,
        uid,
        versionGroupId,
        versionInfo.version,
        versionInfo.palaceRef,
        versionInfo.summary ?? '',
        versionInfo.contentLength ?? 0,
        versionInfo.createdAt
      );
      this.logger.debug('Version record inserted into memory_versions', { versionId, uid, version: versionInfo.version });
    } catch (error) {
      this.logger.warn('Failed to insert version record', { uid, version: versionInfo.version, error });
    }
  }

  /**
   * 添加新版本
   */
  async addVersion(uid: string, versionInfo: VersionInfo): Promise<void> {
    await this.ensureInitialized();

    try {
      const record = await this.getById(uid);
      if (!record) {
        throw new Error(`Memory not found: ${uid}`);
      }

      const newVersionChain = [...record.versionChain, versionInfo];
      const stmt = this.db.prepare(`
        UPDATE memory_meta SET
          version = ?,
          versionChain = ?,
          isLatestVersion = 1,
          currentPalaceRef = ?,
          updatedAt = ?
        WHERE uid = ?
      `);

      stmt.run(
        versionInfo.version,
        JSON.stringify(newVersionChain),
        versionInfo.palaceRef,
        Date.now(),
        uid
      );

      // v2.2.0: 更新 memory_versions 表
      this.db.prepare(`UPDATE memory_versions SET isLatestVersion = 0 WHERE uid = ? AND isLatestVersion = 1`).run(uid);
      this.insertVersionRecord(uid, record.versionGroupId, versionInfo);

      this.logger.debug('Version added', { uid, version: versionInfo.version });
    } catch (error) {
      this.logger.error('Failed to add version', { uid, error });
      throw error;
    }
  }

  /**
   * 清理旧版本
   */
  async pruneVersions(uid: string, maxVersions: number): Promise<void> {
    await this.ensureInitialized();

    try {
      const record = await this.getById(uid);
      if (!record) {
        return;
      }

      if (record.versionChain.length <= maxVersions) {
        return;
      }

      // 删除超出的旧版本
      const toDelete = record.versionChain.slice(0, record.versionChain.length - maxVersions);
      const newChain = record.versionChain.slice(-maxVersions);

      const stmt = this.db.prepare(`
        UPDATE memory_meta SET
          versionChain = ?,
          updatedAt = ?
        WHERE uid = ?
      `);

      stmt.run(JSON.stringify(newChain), Date.now(), uid);

      this.logger.debug('Versions pruned', { uid, deleted: toDelete.length, remaining: newChain.length });

      // 返回需要删除的 palaceRef 列表（由调用方删除）
      return;
    } catch (error) {
      this.logger.error('Failed to prune versions', { uid, error });
      throw error;
    }
  }

  /**
   * 获取需要删除的旧版本 palaceRefs
   */
  async getOldVersionPalaceRefs(uid: string, maxVersions: number): Promise<string[]> {
    const record = await this.getById(uid);
    if (!record) {
      return [];
    }

    if (record.versionChain.length <= maxVersions) {
      return [];
    }

    return record.versionChain.slice(0, record.versionChain.length - maxVersions).map(v => v.palaceRef);
  }

  /**
   * 构建查询条件
   */
  private buildQuery(options: SQLiteQueryOptions): {
    whereClause: string;
    params: any[];
    orderByClause: string;
  } {
    const conditions: string[] = [];
    const params: any[] = [];

    // UID
    if (options.uid) {
      conditions.push('uid = ?');
      params.push(options.uid);
    }

    // UIDs (IN)
    if (options.uids && options.uids.length > 0) {
      const placeholders = options.uids.map(() => '?').join(',');
      conditions.push(`uid IN (${placeholders})`);
      params.push(...options.uids);
    }

    // agentId
    if (options.agentId) {
      conditions.push('agentId = ?');
      params.push(options.agentId);
    }

    // agentId 不等于
    if (options.agentIdNotEq) {
      conditions.push('agentId != ?');
      params.push(options.agentIdNotEq);
    }

    // sessionId
    if (options.sessionId) {
      conditions.push('sessionId = ?');
      params.push(options.sessionId);
    }

    // scope
    if (options.scope) {
      conditions.push('scope = ?');
      params.push(options.scope);
    }

    // scopes (IN)
    if (options.scopes && options.scopes.length > 0) {
      const placeholders = options.scopes.map(() => '?').join(',');
      conditions.push(`scope IN (${placeholders})`);
      params.push(...options.scopes);
    }

    // type
    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    // types (IN)
    if (options.types && options.types.length > 0) {
      const placeholders = options.types.map(() => '?').join(',');
      conditions.push(`type IN (${placeholders})`);
      params.push(...options.types);
    }

    // importance range
    if (options.minImportance !== undefined) {
      conditions.push('importanceScore >= ?');
      params.push(options.minImportance);
    }
    if (options.maxImportance !== undefined) {
      conditions.push('importanceScore <= ?');
      params.push(options.maxImportance);
    }

    // scopeScore range
    if (options.minScopeScore !== undefined) {
      conditions.push('scopeScore >= ?');
      params.push(options.minScopeScore);
    }
    if (options.maxScopeScore !== undefined) {
      conditions.push('scopeScore <= ?');
      params.push(options.maxScopeScore);
    }

    // time range
    if (options.timeRange) {
      conditions.push('createdAt >= ?');
      params.push(options.timeRange.start);
      conditions.push('createdAt <= ?');
      params.push(options.timeRange.end);
    }

    // isLatestVersion
    if (options.isLatestVersion !== undefined) {
      conditions.push('isLatestVersion = ?');
      params.push(options.isLatestVersion ? 1 : 0);
    }

    // versionGroupId
    if (options.versionGroupId) {
      conditions.push('versionGroupId = ?');
      params.push(options.versionGroupId);
    }

    // tags (JSON array contains)
    if (options.tags && options.tags.length > 0) {
      for (const tag of options.tags) {
        conditions.push("tags LIKE ?");
        params.push(`%"${tag}"%`);
      }
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // order by - validate to prevent SQL injection
    const allowedOrderBy = ['createdAt', 'updatedAt', 'importanceScore', 'scopeScore'];
    const allowedOrderDir = ['asc', 'desc'];
    const orderBy = allowedOrderBy.includes(options.orderBy || '') ? options.orderBy : 'createdAt';
    const orderDir = allowedOrderDir.includes(options.orderDir || '') ? options.orderDir : 'desc';
    const orderByClause = `ORDER BY ${orderBy} ${orderDir}`;

    return { whereClause, params, orderByClause };
  }

  /**
   * 行数据转换为记录
   */
  private rowToRecord(row: any): MemoryMetaRecord {
    return {
      uid: row.uid,
      version: row.version,
      agentId: row.agentId,
      sessionId: row.sessionId ?? undefined,
      type: row.type as MemoryType,
      importanceScore: row.importanceScore,
      scopeScore: row.scopeScore,
      scope: row.scope as MemoryScope,
      palace: {
        wingId: row.wingId,
        hallId: row.hallId,
        roomId: row.roomId,
        closetId: row.closetId,
      },
      versionChain: JSON.parse(row.versionChain || '[]'),
      isLatestVersion: row.isLatestVersion === 1,
      versionGroupId: row.versionGroupId,
      tags: JSON.parse(row.tags || '[]'),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastRecalledAt: row.lastRecalledAt ?? undefined,
      recallCount: row.recallCount ?? 0,
      usedByAgents: JSON.parse(row.usedByAgents || '[]'),
      currentPalaceRef: row.currentPalaceRef,
    };
  }

  /**
   * 确保已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    // 迁移检查独立于初始化标志，保证热重载/已运行服务也能执行迁移
    // 注意：runMigrations 必须是同步的且幂等的，因为不能 await 非异步调用
    if (!this.migrated) {
      this.runMigrations();
    }
  }

  /**
   * 执行增量 Schema 迁移（幂等，可多次调用）
   * 注意：这是一个同步方法，必须幂等
   */
  private runMigrations(): void {
    try {
      // 检查列是否已存在（使用同步查询）
      const result = this.db.exec("PRAGMA table_info(memory_meta)");
      const columns = result[0]?.values?.map((row: any) => row[1]) || [];
      if (!columns.includes('usedByAgents')) {
        this.db.exec(`ALTER TABLE memory_meta ADD COLUMN usedByAgents TEXT NOT NULL DEFAULT '[]'`);
        this.logger.info('Migration applied: added usedByAgents column to memory_meta');
      } else {
        this.logger.debug('Migration skipped: usedByAgents column already exists');
      }
      // 迁移成功后设置标志（即使列已存在也设置，避免重复检查）
      this.migrated = true;
    } catch (error) {
      // 记录错误但不设置标志，下次调用时会重试迁移
      // 这样可以避免数据库在迁移失败后处于不一致状态
      this.logger.error('Migration failed - will retry on next operation', { error: String(error) });
      // 不设置 this.migrated = true，让迁移在下次操作时重试
    }
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
    this.logger.info('SQLiteMetaStore closed');
  }

  /**
   * 获取数据库统计
   */
  async getStats(): Promise<{
    total: number;
    byScope: Record<string, number>;
    byType: Record<string, number>;
    avgScopeScore: number;
  }> {
    await this.ensureInitialized();

    const total = await this.count();

    const scopeStmt = this.db.prepare('SELECT scope, COUNT(*) as count FROM memory_meta GROUP BY scope');
    const scopeRows = scopeStmt.all();
    const byScope: Record<string, number> = {};
    for (const row of scopeRows) {
      byScope[row.scope] = row.count;
    }

    const typeStmt = this.db.prepare('SELECT type, COUNT(*) as count FROM memory_meta GROUP BY type');
    const typeRows = typeStmt.all();
    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      byType[row.type] = row.count;
    }

    const avgRow = this.db.prepare('SELECT AVG(scopeScore) as avg FROM memory_meta').get() as { avg: number | null };
    const avgScopeScore = Math.round((avgRow?.avg ?? 0) * 100) / 100;

    return { total, byScope, byType, avgScopeScore };
  }
}
