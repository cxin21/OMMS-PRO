/**
 * Interaction Recorder - 交互记录器
 *
 * v2.0.0: 使用内存存储，持久化由 MemoryService 处理
 */

import { createLogger, type ILogger } from '../../../shared/logging';
import type {
  UserInteraction,
  InteractionType,
  InteractionMetadata,
  InteractionFeedback,
  HistoryOptions,
  UserStats,
} from '../types';

/**
 * 交互记录器类
 * v2.0.0: 内存存储版本，交互历史由 MemoryCaptureService 捕获
 */
export class InteractionRecorder {
  private logger: ILogger;
  // v2.0.0: 使用内存存储
  private interactions: Map<string, UserInteraction[]> = new Map();

  constructor() {
    this.logger = createLogger('interaction-recorder');
  }

  /**
   * 记录交互
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

    // 保存到内存
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
   */
  async addFeedback(
    interactionId: string,
    userId: string,
    feedback: InteractionFeedback
  ): Promise<void> {
    const interactions = this.getInteractions(userId, { limit: 1000 });

    const interaction = interactions.find(i => i.id === interactionId);
    if (!interaction) {
      this.logger.warn(`Interaction ${interactionId} not found for user ${userId}`);
      return;
    }

    interaction.feedback = feedback;
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
   */
  private getInteractions(userId: string, options?: HistoryOptions): UserInteraction[] {
    const interactions = this.interactions.get(userId) ?? [];

    let filtered = interactions;

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
    if (options?.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
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
   * 清理旧交互
   */
  cleanupOldInteractions(
    userId: string,
    maxAgeDays: number = 90
  ): number {
    const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const interactions = this.getInteractions(userId, {
      endDate: cutoffTime,
      limit: 10000,
    });

    this.logger.info(
      `Would cleanup ${interactions.length} interactions older than ${maxAgeDays} days for user ${userId}`
    );

    return interactions.length;
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

    const daysSinceFirst = (Date.now() - firstInteraction) / (24 * 60 * 60 * 1000);
    const daysSinceLast = (Date.now() - lastInteraction) / (24 * 60 * 60 * 1000);

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
