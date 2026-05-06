/**
 * Interaction Recorder - 交互记录器
 *
 * v3.0.0: SQLite 持久化支持，append-only 写入
 *         内存 Map 作为读写缓存，SQLite 作为持久化后端
 */

import { createServiceLogger, type ILogger } from '../../../shared/logging';
import { config } from '../../../shared/config';
import { FileUtils } from '../../../shared/utils/file';
import { dirname } from 'path';
import Database from 'better-sqlite3';
import { ONE_DAY_MS } from '../../../config';
import type {
  UserInteraction,
  InteractionType,
  InteractionMetadata,
  InteractionFeedback,
  HistoryOptions,
  UserStats,
} from '../types';

const MEMORY_LOAD_LIMIT = 1000; // Aligned with config.default.json: memoryService.cache.maxSize

/**
 * 交互记录器类
 * v3.0.0: SQLite 持久化版本，append-only 写入
 */
export class InteractionRecorder {
  private logger: ILogger;
  // v2.0.0: 使用内存存储
  private interactions: Map<string, UserInteraction[]> = new Map();
  // v3.0.0: SQLite 数据库
  private db: InstanceType<typeof Database> | null = null;
  private initialized: boolean = false;

  constructor() {
    this.logger = createServiceLogger('InteractionRecorder');
  }

  /**
   * 初始化 SQLite 连接和表结构
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    let dbPath: string;
    try {
      // 优先从 memoryService.storage.interactionDbPath 获取
      const cfg = config.getConfig<{ interactionDbPath?: string }>('memoryService.storage');
      dbPath = cfg?.interactionDbPath ?? '';
    } catch {
      dbPath = '';
    }

    if (!dbPath) {
      this.logger.warn('InteractionRecorder: no dbPath configured, running in memory-only mode');
      this.initialized = true;
      return;
    }

    try {
      await FileUtils.ensureDirectory(dirname(dbPath));

      this.db = new Database(dbPath);

      // Create table (idempotent)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS user_interactions (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          type TEXT NOT NULL,
          input TEXT,
          output TEXT,
          metadata TEXT NOT NULL DEFAULT '{}',
          sessionId TEXT,
          agentId TEXT,
          memoryIds TEXT NOT NULL DEFAULT '[]',
          feedback TEXT,
          sentiment TEXT,
          tags TEXT NOT NULL DEFAULT '[]'
        )
      `);

      // Create indexes (idempotent)
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_ui_userId ON user_interactions(userId);
        CREATE INDEX IF NOT EXISTS idx_ui_userId_timestamp ON user_interactions(userId, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_ui_userId_type ON user_interactions(userId, type);
        CREATE INDEX IF NOT EXISTS idx_ui_sessionId ON user_interactions(sessionId);
        CREATE INDEX IF NOT EXISTS idx_ui_agentId ON user_interactions(agentId);
        CREATE INDEX IF NOT EXISTS idx_ui_timestamp ON user_interactions(timestamp DESC);
      `);

      // Load recent interactions into memory per user
      this.loadRecentIntoMemory();

      this.initialized = true;
      this.logger.info('InteractionRecorder SQLite initialized', { dbPath });
    } catch (error) {
      this.logger.error('Failed to initialize InteractionRecorder SQLite', { error });
      // fall back to memory-only mode
      this.db = null;
      this.initialized = true;
    }
  }

  /**
   * 从 SQLite 加载最近 1000 条到内存 Map（按 timestamp DESC）
   */
  private loadRecentIntoMemory(): void {
    if (!this.db) return;

    try {
      // Get all distinct userIds
      const userIds = this.db.prepare(
        'SELECT DISTINCT userId FROM user_interactions'
      ).all() as { userId: string }[];

      const loadStmt = this.db.prepare(`
        SELECT * FROM user_interactions
        WHERE userId = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `);

      for (const { userId } of userIds) {
        const rows = loadStmt.all(userId, MEMORY_LOAD_LIMIT) as any[];
        const parsed = rows.map(this.rowToInteraction);
        this.interactions.set(userId, parsed);
      }

      this.logger.debug('Loaded recent interactions into memory', {
        userCount: userIds.length,
      });
    } catch (error) {
      this.logger.error('Failed to load recent interactions into memory', { error });
    }
  }

  /**
   * SQLite row -> UserInteraction
   */
  private rowToInteraction(row: any): UserInteraction {
    return {
      id: row.id,
      userId: row.userId,
      timestamp: row.timestamp,
      type: row.type as InteractionType,
      input: row.input ?? undefined,
      output: row.output ?? undefined,
      metadata: JSON.parse(row.metadata || '{}'),
      sessionId: row.sessionId ?? undefined,
      agentId: row.agentId ?? undefined,
      memoryIds: JSON.parse(row.memoryIds || '[]'),
      feedback: row.feedback ? JSON.parse(row.feedback) : undefined,
      sentiment: row.sentiment ? JSON.parse(row.sentiment) : undefined,
      tags: JSON.parse(row.tags || '[]'),
    };
  }

  /**
   * 确保已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * 记录交互
   * v3.0.0: 同步写入 SQLite（append-only），然后更新内存 Map
   */
  async recordInteraction(
    userId: string,
    type: InteractionType,
    input?: string,
    output?: string,
    metadata?: InteractionMetadata,
    sessionId?: string,
    agentId?: string,
    memoryIds?: string[]
  ): Promise<UserInteraction> {
    await this.ensureInitialized();

    const now = Date.now();
    const interaction: UserInteraction = {
      id: this.generateInteractionId(userId, now),
      userId,
      timestamp: now,
      type,
      input,
      output,
      metadata: metadata ?? {},
      sessionId,
      agentId,
      memoryIds,
    };

    // Append to SQLite
    // 如果 SQLite 写入失败，交互仍然保存在内存中，但会记录错误
    // 下次 cleanup 时可以恢复 SQLite 的数据一致性
    let sqliteSuccess = false;
    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT INTO user_interactions (
            id, userId, timestamp, type, input, output, metadata,
            sessionId, agentId, memoryIds, feedback, sentiment, tags
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '[]')
        `);
        stmt.run(
          interaction.id,
          interaction.userId,
          interaction.timestamp,
          interaction.type,
          interaction.input ?? null,
          interaction.output ?? null,
          JSON.stringify(interaction.metadata),
          interaction.sessionId ?? null,
          interaction.agentId ?? null,
          JSON.stringify(interaction.memoryIds ?? [])
        );
        sqliteSuccess = true;
      } catch (error) {
        this.logger.error('Failed to persist interaction to SQLite', {
          error,
          interactionId: interaction.id,
          userId
        });
      }
    }

    // 保存到内存（即使 SQLite 失败也保存到内存，确保数据不丢失）
    const userInteractions = this.interactions.get(userId) ?? [];
    userInteractions.push(interaction);
    this.interactions.set(userId, userInteractions);

    this.logger.debug(
      `Recorded ${type} interaction for user ${userId} (id: ${interaction.id})`
    );

    return interaction;
  }

  /**
   * 添加反馈
   * v3.0.0: 同时更新 SQLite
   */
  async addFeedback(
    interactionId: string,
    userId: string,
    feedback: InteractionFeedback
  ): Promise<void> {
    await this.ensureInitialized();

    const interactions = this.getInteractions(userId, { limit: 1000 });

    const interaction = interactions.find(i => i.id === interactionId);
    if (!interaction) {
      this.logger.warn(`Interaction ${interactionId} not found for user ${userId}`);
      return;
    }

    interaction.feedback = feedback;

    // Persist to SQLite
    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          UPDATE user_interactions SET feedback = ? WHERE id = ?
        `);
        stmt.run(JSON.stringify(feedback), interactionId);
      } catch (error) {
        this.logger.error('Failed to persist feedback to SQLite', { interactionId, error });
      }
    }

    this.logger.debug(`Added feedback to interaction ${interactionId} for user ${userId}`);
  }

  /**
   * 获取交互历史
   */
  getInteractionHistory(
    userId: string,
    options?: HistoryOptions
  ): UserInteraction[] {
    return this.getInteractions(userId, options);
  }

  /**
   * 获取交互列表
   * v3.0.0: 先查内存，内存不足时从 SQLite 分页加载
   */
  private getInteractions(userId: string, options?: HistoryOptions): UserInteraction[] {
    const memoryInteractions = this.interactions.get(userId) ?? [];
    const requestedLimit = options?.limit ?? MEMORY_LOAD_LIMIT;

    let allInteractions: UserInteraction[];

    // If memory is empty or has fewer than requested, supplement from SQLite
    if (memoryInteractions.length < requestedLimit && this.db) {
      const fromDb = this.loadFromSqlite(userId, requestedLimit, options);
      // Merge: SQLite results (already timestamp DESC)
      const seen = new Set(memoryInteractions.map(i => i.id));
      for (const i of fromDb) {
        if (!seen.has(i.id)) {
          memoryInteractions.push(i);
          seen.add(i.id);
        }
      }
    }

    allInteractions = memoryInteractions;

    let filtered = allInteractions;

    // 按类型过滤
    if (options?.types && options.types.length > 0) {
      filtered = filtered.filter(i => options.types!.includes(i.type));
    }

    // 按时间范围过滤
    if (options?.startDate) {
      filtered = filtered.filter(i => i.timestamp >= options.startDate!);
    }
    if (options?.endDate) {
      filtered = filtered.filter(i => i.timestamp <= options.endDate!);
    }

    // 排序
    filtered = filtered.sort((a, b) => b.timestamp - a.timestamp);

    // 分页
    if (options?.offset) {
      filtered = filtered.slice(options.offset);
    }
    if (options?.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  /**
   * 从 SQLite 分页加载交互记录
   * v3.0.0
   */
  private loadFromSqlite(
    userId: string,
    limit: number,
    options?: HistoryOptions
  ): UserInteraction[] {
    if (!this.db) return [];

    try {
      const conditions: string[] = ['userId = ?'];
      const params: any[] = [userId];

      if (options?.types && options.types.length > 0) {
        const placeholders = options.types.map(() => '?').join(',');
        conditions.push(`type IN (${placeholders})`);
        params.push(...options.types);
      }
      if (options?.startDate) {
        conditions.push('timestamp >= ?');
        params.push(options.startDate);
      }
      if (options?.endDate) {
        conditions.push('timestamp <= ?');
        params.push(options.endDate);
      }

      const whereClause = conditions.join(' AND ');
      const sql = `
        SELECT * FROM user_interactions
        WHERE ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ?
      `;

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params, limit) as any[];

      return rows.map(this.rowToInteraction);
    } catch (error) {
      this.logger.error('Failed to load interactions from SQLite', { userId, error });
      return [];
    }
  }

  /**
   * 获取用户统计
   */
  getUserStats(userId: string): UserStats {
    const interactions = this.getInteractions(userId, { limit: 1000 });

    // v2.0.0: 直接从 interactions 计算统计
    const dbStats = this.calculateStatsFromInteractions(interactions, userId);

    // 计算平均会话时长
    const sessionDurations = this.calculateSessionDurations(interactions);
    const avgSessionDuration =
      sessionDurations.length > 0
        ? sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length
        : 0;

    // 计算最活跃时间段
    const mostActiveHours = this.calculateMostActiveHours(interactions);
    const mostActiveDays = this.calculateMostActiveDays(interactions);

    // 获取热门主题
    const favoriteTopics = this.extractFavoriteTopics(interactions);

    // 计算参与度分数
    const engagementScore = this.calculateEngagementScore(
      dbStats.totalInteractions,
      dbStats.firstInteraction,
      dbStats.lastInteraction
    );

    const stats: UserStats = {
      userId,
      totalInteractions: dbStats.totalInteractions,
      totalSessions: dbStats.totalSessions,
      averageSessionDuration: avgSessionDuration,
      firstInteraction: dbStats.firstInteraction ?? 0,
      lastInteraction: dbStats.lastInteraction ?? 0,
      mostActiveHours,
      mostActiveDays,
      favoriteTopics,
      frequentlyUsedFeatures: this.extractCommonFeatures(interactions),
      engagementScore,
    };

    return stats;
  }

  /**
   * 从交互列表计算统计
   */
  private calculateStatsFromInteractions(interactions: UserInteraction[], userId: string): {
    totalInteractions: number;
    totalSessions: number;
    firstInteraction: number | null;
    lastInteraction: number | null;
  } {
    if (interactions.length === 0) {
      return { totalInteractions: 0, totalSessions: 0, firstInteraction: null, lastInteraction: null };
    }

    const sessionIds = new Set<string>();
    for (const i of interactions) {
      if (i.sessionId) {
        sessionIds.add(i.sessionId);
      }
    }

    const timestamps = interactions.map(i => i.timestamp).sort((a, b) => a - b);

    return {
      totalInteractions: interactions.length,
      totalSessions: sessionIds.size,
      firstInteraction: timestamps[0],
      lastInteraction: timestamps[timestamps.length - 1],
    };
  }

  /**
   * 删除用户所有交互数据
   * v3.0.0: 用于 GDPR 等数据删除场景
   */
  async deleteUserData(userId: string): Promise<void> {
    await this.ensureInitialized();

    // 从内存 Map 删除
    this.interactions.delete(userId);

    // 从 SQLite 删除
    if (this.db) {
      try {
        this.db.prepare('DELETE FROM user_interactions WHERE userId = ?').run(userId);
      } catch (error) {
        this.logger.error('Failed to delete interactions from SQLite', { userId, error });
        throw error;
      }
    }

    this.logger.debug('Deleted all interactions for user', { userId });
  }

  /**
   * 清理旧交互（实际删除）
   */
  async cleanupOldInteractions(
    userId: string,
    maxAgeDays: number = 90
  ): Promise<number> {
    const cutoffTime = Date.now() - maxAgeDays * ONE_DAY_MS;
    const interactions = this.getInteractions(userId, {
      endDate: cutoffTime,
      limit: 10000,
    });

    if (interactions.length === 0) {
      return 0;
    }

    // 执行实际删除：从 SQLite 和内存中删除
    // 只有 SQLite 删除成功时才从内存中删除，保持一致性
    let deletedCount = 0;
    const successfullyDeletedIds: Set<string> = new Set();

    for (const interaction of interactions) {
      try {
        // 从 SQLite 删除（better-sqlite3 是同步 API，无需 await）
        if (this.db) {
          this.db.prepare('DELETE FROM user_interactions WHERE id = ?').run(interaction.id);
        }
        successfullyDeletedIds.add(interaction.id);
        deletedCount++;
      } catch (error) {
        this.logger.error('Failed to delete interaction from SQLite', {
          interactionId: interaction.id,
          error: String(error),
        });
      }
    }

    // 从内存 Map 中删除（只删除 SQLite 成功删除的记录）
    if (successfullyDeletedIds.size > 0) {
      const userInteractions = this.interactions.get(userId) ?? [];
      const remainingInteractions = userInteractions.filter(i => !successfullyDeletedIds.has(i.id));
      this.interactions.set(userId, remainingInteractions);
    }

    this.logger.info(`Cleaned up ${deletedCount} old interactions for user ${userId}`);
    return deletedCount;
  }

  /**
   * 导出交互历史
   */
  exportInteractions(
    userId: string,
    options?: HistoryOptions
  ): UserInteraction[] {
    this.logger.info(`Exporting interactions for user ${userId}`);
    return this.getInteractions(userId, options);
  }

  /**
   * 计算会话时长
   */
  private calculateSessionDurations(interactions: UserInteraction[]): number[] {
    const sessionGroups = new Map<string, UserInteraction[]>();

    // 按会话分组
    for (const interaction of interactions) {
      if (interaction.sessionId) {
        const session = sessionGroups.get(interaction.sessionId) ?? [];
        session.push(interaction);
        sessionGroups.set(interaction.sessionId, session);
      }
    }

    // 计算每个会话的时长
    const durations: number[] = [];
    for (const session of sessionGroups.values()) {
      if (session.length > 1) {
        const timestamps = session.map(i => i.timestamp).sort((a, b) => a - b);
        const duration = timestamps[timestamps.length - 1] - timestamps[0];
        durations.push(duration);
      }
    }

    return durations;
  }

  /**
   * 计算最活跃小时
   */
  private calculateMostActiveHours(interactions: UserInteraction[]): number[] {
    const hourCounts = new Map<number, number>();

    for (const interaction of interactions) {
      const hour = new Date(interaction.timestamp).getHours();
      hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
    }

    return Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hour]) => hour)
      .sort((a, b) => a - b);
  }

  /**
   * 计算最活跃星期
   */
  private calculateMostActiveDays(interactions: UserInteraction[]): number[] {
    const dayCounts = new Map<number, number>();

    for (const interaction of interactions) {
      const day = new Date(interaction.timestamp).getDay();
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }

    return Array.from(dayCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([day]) => day)
      .sort((a, b) => a - b);
  }

  /**
   * 提取热门主题
   */
  private extractFavoriteTopics(interactions: UserInteraction[]): string[] {
    const topicCounts = new Map<string, number>();

    for (const interaction of interactions) {
      const topics = interaction.metadata?.custom?.['topics'] as string[] | undefined;
      if (topics) {
        for (const topic of topics) {
          topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
        }
      }
    }

    return Array.from(topicCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic]) => topic);
  }

  /**
   * 提取常用功能
   */
  private extractCommonFeatures(interactions: UserInteraction[]): string[] {
    const featureCounts = new Map<string, number>();

    for (const interaction of interactions) {
      const features = interaction.metadata?.custom?.['features'] as string[] | undefined;
      if (features) {
        for (const feature of features) {
          featureCounts.set(feature, (featureCounts.get(feature) ?? 0) + 1);
        }
      }
    }

    return Array.from(featureCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([feature]) => feature);
  }

  /**
   * 计算参与度分数
   */
  private calculateEngagementScore(
    totalInteractions: number,
    firstInteraction: number | null,
    lastInteraction: number | null
  ): number {
    if (!firstInteraction || !lastInteraction) {
      return 0;
    }

    const daysSinceFirst = (Date.now() - firstInteraction) / ONE_DAY_MS;
    const daysSinceLast = (Date.now() - lastInteraction) / ONE_DAY_MS;

    // 基础分数：交互数量
    const interactionScore = Math.min(totalInteractions / 100, 1);

    // 活跃度分数：最近是否活跃
    const recencyScore = daysSinceLast < 7 ? 1 : Math.max(1 - daysSinceLast / 30, 0);

    // 持续性分数：平均交互频率
    const frequencyScore = daysSinceFirst > 0 ? (totalInteractions / daysSinceFirst) / 5 : 0;

    // 加权计算
    return (interactionScore * 0.4 + recencyScore * 0.4 + frequencyScore * 0.2) * 10;
  }

  /**
   * 生成交互 ID
   */
  private generateInteractionId(userId: string, timestamp: number): string {
    return `interaction-${userId}-${timestamp}`;
  }
}
