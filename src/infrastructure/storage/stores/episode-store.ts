/**
 * Episode Store - 情景记忆存储
 * @module storage/episode-store
 *
 * 版本: v1.0.0
 * 基于 SQLite 的情景记忆存储实现
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import type { IEpisodeStore } from '../core/types';
import { createServiceLogger, type ILogger } from '../../../shared/logging';
import { FileUtils } from '../../../shared/utils/file';
import { config } from '../../../shared/config';

/** 默认数据库文件名常量 */
const DEFAULT_EPISODE_DB_NAME = 'episodes.db';

interface EpisodeStoreConfig {
  storagePath: string;
  dbName: string;
}

/**
 * 获取 EpisodeStore 配置
 * 从 ConfigManager 读取
 */
function getEpisodeStoreConfig(): EpisodeStoreConfig {
  const storageConfig = config.getConfigOrThrow<{ episodeStorePath: string }>('memoryService.storage');
  return {
    storagePath: storageConfig.episodeStorePath,
    dbName: DEFAULT_EPISODE_DB_NAME,
  };
}

/**
 * EpisodeStore
 *
 * 情景记忆存储实现
 * 使用 SQLite 存储情景和情景-记忆关联
 */
export class EpisodeStore implements IEpisodeStore {
  private logger: ILogger;
  private config: EpisodeStoreConfig;
  private dbPath: string;
  private initialized: boolean = false;
  private db: any;  // SQLite database instance

  constructor(userConfig?: Partial<EpisodeStoreConfig>) {
    // 优先使用传入配置，否则从 ConfigManager 获取
    if (userConfig && Object.keys(userConfig).length > 0) {
      const defaultConfig = getEpisodeStoreConfig();
      this.config = {
        storagePath: userConfig.storagePath || defaultConfig.storagePath,
        dbName: userConfig.dbName || defaultConfig.dbName,
      };
    } else {
      this.config = getEpisodeStoreConfig();
    }
    this.dbPath = join(this.config.storagePath, this.config.dbName);
    this.logger = createServiceLogger('EpisodeStore');
  }

  /**
   * 初始化存储
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // 确保目录存在
      await FileUtils.ensureDirectory(this.config.storagePath);

      // 动态导入 better-sqlite3
      const Database = (await import('better-sqlite3')).default;
      this.db = new Database(this.dbPath);

      // 创建表
      this.createTables();

      this.initialized = true;
      this.logger.info('EpisodeStore initialized', { dbPath: this.dbPath });
    } catch (error) {
      this.logger.error('Failed to initialize EpisodeStore', { error });
      throw error;
    }
  }

  /**
   * 创建表
   */
  private createTables(): void {
    // 情景表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        uid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        location TEXT,
        primary_memory_uid TEXT,
        emotions TEXT,
        context TEXT,
        keywords TEXT,
        agent_id TEXT NOT NULL,
        session_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        access_count INTEGER DEFAULT 0
      )
    `);

    // 情景-记忆关联表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episode_memories (
        episode_uid TEXT NOT NULL,
        memory_uid TEXT NOT NULL,
        position INTEGER,
        temporal_index INTEGER,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (episode_uid, memory_uid),
        FOREIGN KEY (episode_uid) REFERENCES episodes(uid) ON DELETE CASCADE
      )
    `);

    // 索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_episodes_time ON episodes(start_time, end_time);
      CREATE INDEX IF NOT EXISTS idx_episodes_agent ON episodes(agent_id);
      CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id);
      CREATE INDEX IF NOT EXISTS idx_episode_memories_temporal ON episode_memories(temporal_index);
    `);
  }

  /**
   * 创建情景
   */
  async create(record: EpisodeRecord): Promise<EpisodeRecord> {
    await this.ensureInitialized();

    const stmt = this.db.prepare(`
      INSERT INTO episodes (
        uid, name, description, start_time, end_time, location,
        primary_memory_uid, emotions, context, keywords,
        agent_id, session_id, created_at, updated_at, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.uid,
      record.name,
      record.description || '',
      record.startTime,
      record.endTime,
      record.location || null,
      record.primaryMemoryUid || null,
      JSON.stringify(record.emotions || []),
      record.context || '',
      JSON.stringify(record.keywords || []),
      record.agentId,
      record.sessionId || null,
      record.createdAt,
      record.updatedAt,
      record.accessCount || 0
    );

    this.logger.debug('Episode created', { uid: record.uid, name: record.name });
    return record;
  }

  /**
   * 获取情景
   */
  async get(uid: string): Promise<EpisodeRecord | null> {
    await this.ensureInitialized();

    const stmt = this.db.prepare('SELECT * FROM episodes WHERE uid = ?');
    const row = stmt.get(uid) as any;

    if (!row) return null;

    return this.rowToEpisode(row);
  }

  /**
   * 更新情景
   */
  async update(uid: string, updates: Partial<EpisodeRecord>): Promise<EpisodeRecord | null> {
    await this.ensureInitialized();

    const existing = await this.get(uid);
    if (!existing) return null;

    const updated: EpisodeRecord = {
      ...existing,
      ...updates,
      uid: existing.uid,  // 保持 UID 不变
      updatedAt: Date.now(),
    };

    const stmt = this.db.prepare(`
      UPDATE episodes SET
        name = ?, description = ?, start_time = ?, end_time = ?,
        location = ?, primary_memory_uid = ?, emotions = ?,
        context = ?, keywords = ?, updated_at = ?, access_count = ?
      WHERE uid = ?
    `);

    stmt.run(
      updated.name,
      updated.description,
      updated.startTime,
      updated.endTime,
      updated.location || null,
      updated.primaryMemoryUid || null,
      JSON.stringify(updated.emotions || []),
      updated.context || '',
      JSON.stringify(updated.keywords || []),
      updated.updatedAt,
      updated.accessCount,
      uid
    );

    this.logger.debug('Episode updated', { uid });
    return updated;
  }

  /**
   * 删除情景
   */
  async delete(uid: string): Promise<void> {
    await this.ensureInitialized();

    // 使用事务确保原子性
    const transaction = this.db.transaction(() => {
      // 先删除关联
      const deleteMemoriesStmt = this.db.prepare('DELETE FROM episode_memories WHERE episode_uid = ?');
      deleteMemoriesStmt.run(uid);

      // 再删除情景
      const deleteStmt = this.db.prepare('DELETE FROM episodes WHERE uid = ?');
      deleteStmt.run(uid);
    });

    transaction();
    this.logger.debug('Episode deleted', { uid });
  }

  /**
   * 添加记忆到情景
   */
  async addMemory(episodeUid: string, memoryUid: string, position?: number, temporalIndex?: number): Promise<void> {
    await this.ensureInitialized();

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO episode_memories (episode_uid, memory_uid, position, temporal_index, added_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      episodeUid,
      memoryUid,
      position ?? null,
      temporalIndex ?? Date.now(),
      Date.now()
    );

    // 更新情景的最后时间
    const updateStmt = this.db.prepare(`
      UPDATE episodes SET end_time = MAX(end_time, ?), updated_at = ? WHERE uid = ?
    `);
    updateStmt.run(temporalIndex ?? Date.now(), Date.now(), episodeUid);

    this.logger.debug('Memory added to episode', { episodeUid, memoryUid });
  }

  /**
   * 从情景移除记忆
   */
  async removeMemory(episodeUid: string, memoryUid: string): Promise<void> {
    await this.ensureInitialized();

    const stmt = this.db.prepare('DELETE FROM episode_memories WHERE episode_uid = ? AND memory_uid = ?');
    stmt.run(episodeUid, memoryUid);

    this.logger.debug('Memory removed from episode', { episodeUid, memoryUid });
  }

  /**
   * 获取情景的所有记忆
   */
  async getMemories(episodeUid: string): Promise<string[]> {
    await this.ensureInitialized();

    const stmt = this.db.prepare(`
      SELECT memory_uid FROM episode_memories
      WHERE episode_uid = ?
      ORDER BY temporal_index ASC
    `);

    const rows = stmt.all(episodeUid) as any[];
    return rows.map(row => row.memory_uid);
  }

  /**
   * 批量获取多个情景的记忆（优化 N+1 查询）
   */
  async getMemoriesBatch(episodeUids: string[]): Promise<Map<string, string[]>> {
    await this.ensureInitialized();

    const result = new Map<string, string[]>();

    if (episodeUids.length === 0) {
      return result;
    }

    // 使用 IN 查询批量获取所有情景的记忆
    const placeholders = episodeUids.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT episode_uid, memory_uid FROM episode_memories
      WHERE episode_uid IN (${placeholders})
      ORDER BY episode_uid, temporal_index ASC
    `);

    const rows = stmt.all(...episodeUids) as any[];

    // 按 episode_uid 分组
    for (const row of rows) {
      const episodeUid = row.episode_uid;
      if (!result.has(episodeUid)) {
        result.set(episodeUid, []);
      }
      result.get(episodeUid)!.push(row.memory_uid);
    }

    // 确保所有请求的 episodeUid 都在结果中（即使是空数组）
    for (const episodeUid of episodeUids) {
      if (!result.has(episodeUid)) {
        result.set(episodeUid, []);
      }
    }

    return result;
  }

  /**
   * 获取时间范围内的情景
   */
  async getByTimeRange(startTime: number, endTime: number, agentId?: string): Promise<EpisodeRecord[]> {
    await this.ensureInitialized();

    let query = `
      SELECT * FROM episodes
      WHERE start_time <= ? AND end_time >= ?
    `;
    const params: any[] = [endTime, startTime];

    if (agentId) {
      query += ' AND agent_id = ?';
      params.push(agentId);
    }

    query += ' ORDER BY start_time ASC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => this.rowToEpisode(row));
  }

  /**
   * 获取最近的的情景
   */
  async getRecent(limit: number, agentId?: string): Promise<EpisodeRecord[]> {
    await this.ensureInitialized();

    let query = 'SELECT * FROM episodes';
    const params: any[] = [];

    if (agentId) {
      query += ' WHERE agent_id = ?';
      params.push(agentId);
    }

    query += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(limit);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => this.rowToEpisode(row));
  }

  /**
   * 按位置获取情景
   */
  async getByLocation(location: string, agentId?: string): Promise<EpisodeRecord[]> {
    await this.ensureInitialized();

    let query = 'SELECT * FROM episodes WHERE location = ?';
    const params: any[] = [location];

    if (agentId) {
      query += ' AND agent_id = ?';
      params.push(agentId);
    }

    query += ' ORDER BY updated_at DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => this.rowToEpisode(row));
  }

  /**
   * 获取 Agent 的情景时间线
   */
  async getTimeline(agentId: string): Promise<{ uid: string; name: string; start: number; end: number; emotion: string }[]> {
    await this.ensureInitialized();

    const stmt = this.db.prepare(`
      SELECT uid, name, start_time, end_time, emotions
      FROM episodes
      WHERE agent_id = ?
      ORDER BY start_time ASC
    `);

    const rows = stmt.all(agentId) as any[];

    return rows.map(row => ({
      uid: row.uid,
      name: row.name,
      start: row.start_time,
      end: row.end_time,
      emotion: this.parseEmotions(row.emotions)[0] || 'neutral',
    }));
  }

  /**
   * 增加访问计数
   */
  async incrementAccess(uid: string): Promise<void> {
    await this.ensureInitialized();

    const stmt = this.db.prepare(`
      UPDATE episodes SET access_count = access_count + 1 WHERE uid = ?
    `);
    stmt.run(uid);
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{ count: number; avgMemoriesPerEpisode: number }> {
    await this.ensureInitialized();

    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM episodes');
    const countResult = countStmt.get() as any;
    const count = countResult.count;

    const avgStmt = this.db.prepare(`
      SELECT AVG(memory_count) as avg FROM (
        SELECT COUNT(*) as memory_count
        FROM episode_memories
        GROUP BY episode_uid
      )
    `);
    const avgResult = avgStmt.get() as any;
    const avgMemoriesPerEpisode = avgResult.avg || 0;

    return { count, avgMemoriesPerEpisode };
  }

  /**
   * 关闭存储
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.initialized = false;
      this.logger.info('EpisodeStore closed');
    }
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private rowToEpisode(row: any): EpisodeRecord {
    return {
      uid: row.uid,
      name: row.name,
      description: row.description,
      startTime: row.start_time,
      endTime: row.end_time,
      location: row.location,
      primaryMemoryUid: row.primary_memory_uid,
      emotions: this.parseEmotions(row.emotions),
      context: row.context,
      keywords: this.parseKeywords(row.keywords),
      agentId: row.agent_id,
      sessionId: row.session_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      accessCount: row.access_count,
    };
  }

  private parseEmotions(json: string): string[] {
    try {
      return JSON.parse(json || '[]');
    } catch {
      return [];
    }
  }

  private parseKeywords(json: string): string[] {
    try {
      return JSON.parse(json || '[]');
    } catch {
      return [];
    }
  }
}

/**
 * EpisodeRecord 类型（存储层用）
 */
export interface EpisodeRecord {
  uid: string;
  name: string;
  description?: string;
  startTime: number;
  endTime: number;
  location?: string;
  primaryMemoryUid?: string;
  emotions: string[];
  context?: string;
  keywords: string[];
  agentId: string;
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
  accessCount?: number;
}
