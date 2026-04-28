/**
 * RecallStrategy - 多维度记忆召回策略
 *
 * 实现增强的召回策略：
 * - 时间衰减：近期记忆更重要
 * - 多样性：确保结果多样性
 * - 上下文感知：考虑当前上下文
 * - 反馈循环：学习召回模式
 *
 * @module memory/recall-strategy
 */

import { createLogger } from '../../../shared/logging';
import type { ILogger } from '../../../shared/logging';
import type { Memory, MemoryScope, MemoryType } from '../../../types/memory';

export interface RecallStrategyConfig {
  /** 时间衰减因子 (0-1, 越小衰减越快) */
  timeDecayFactor: number;
  /** 多样性权重 (0-1) */
  diversityWeight: number;
  /** 上下文权重 (0-1) */
  contextWeight: number;
  /** 反馈循环权重 (0-1) */
  feedbackWeight: number;
  /** 最大召回结果数 */
  maxResults: number;
  /** 最小多样性分数 */
  minDiversityScore: number;
  /** 反馈衰减时间 (ms) */
  feedbackDecayMs: number;
}

export interface RecallContext {
  agentId: string;
  sessionId?: string;
  currentTime?: number;
  activeMemoryIds?: string[];
  query?: string;
  scope?: MemoryScope;
  type?: MemoryType;
}

export interface RecallResult {
  memory: Memory;
  score: number;
  scoreBreakdown: {
    relevance: number;
    recency: number;
    diversity: number;
    context: number;
    feedback: number;
  };
  reason: string;
}

export interface FeedbackEntry {
  memoryId: string;
  action: 'recall' | 'dismiss' | 'refine' | 'use';
  agentId: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

/**
 * Diversity constraints for recall results
 */
interface DiversityConstraint {
  type: 'scope' | 'type' | 'agent' | 'tag';
  maxPerGroup?: number;
  minPerGroup?: number;
}

/**
 * RecallStrategy - 多维度召回策略引擎
 */
export class RecallStrategy {
  private logger: ILogger;
  private feedbackHistory: Map<string, FeedbackEntry[]> = new Map();
  private recallCounts: Map<string, number> = new Map();
  private contextSimilarityCache: Map<string, number> = new Map();

  constructor(private config: RecallStrategyConfig) {
    this.logger = createLogger('RecallStrategy');
  }

  /**
   * 计算单条记忆的召回分数
   */
  calculateRecallScore(
    memory: Memory,
    context: RecallContext
  ): RecallResult {
    const now = context.currentTime ?? Date.now();
    const memoryAge = now - memory.updatedAt;

    // 1. Relevance score (基础相似度，假设从向量搜索获得)
    const relevance = memory.importance * 0.5 + memory.scopeScore * 0.5;

    // 2. Recency score (时间衰减)
    const recency = this.calculateRecencyScore(memoryAge);

    // 3. Context score (上下文相关性)
    const contextScore = this.calculateContextScore(memory, context);

    // 4. Feedback score (反馈循环)
    const feedbackScore = this.calculateFeedbackScore(memory.uid, context.agentId);

    // 5. Diversity contribution (初始化为0，实际由策略计算)
    const diversity = 0;

    // 加权总分（权重归一化）
    // recency 作为 relevance 的调制因子，权重之和 = 1
    const totalScore =
      (relevance * (1 - this.config.timeDecayFactor) + recency * this.config.timeDecayFactor) * (1 - this.config.contextWeight - this.config.feedbackWeight) +
      contextScore * this.config.contextWeight +
      feedbackScore * this.config.feedbackWeight;

    return {
      memory,
      score: totalScore,
      scoreBreakdown: {
        relevance,
        recency,
        diversity,
        context: contextScore,
        feedback: feedbackScore
      },
      reason: this.generateReason(relevance, recency, contextScore, feedbackScore)
    };
  }

  /**
   * 排序和过滤召回结果
   */
  rankRecallResults(
    results: RecallResult[],
    constraints: DiversityConstraint[] = []
  ): RecallResult[] {
    // Sort by total score
    const sorted = [...results].sort((a, b) => b.score - a.score);

    // Apply diversity constraints
    const diversified = this.applyDiversityConstraints(sorted, constraints);

    // Limit results
    return diversified.slice(0, this.config.maxResults);
  }

  /**
   * 添加反馈
   */
  addFeedback(entry: FeedbackEntry): void {
    const key = `${entry.agentId}:${entry.memoryId}`;
    const history = this.feedbackHistory.get(key) || [];
    history.push(entry);
    this.feedbackHistory.set(key, history);

    // Update recall count
    if (entry.action === 'recall' || entry.action === 'use') {
      const count = this.recallCounts.get(entry.memoryId) || 0;
      this.recallCounts.set(entry.memoryId, count + 1);
    }

    // Cleanup old feedback
    this.cleanupOldFeedback(entry.agentId);

    this.logger.debug('Feedback added', { memoryId: entry.memoryId, action: entry.action });
  }

  /**
   * 获取记忆的反馈分数
   */
  getFeedbackScore(memoryId: string, agentId: string): number {
    const key = `${agentId}:${memoryId}`;
    const history = this.feedbackHistory.get(key);

    if (!history || history.length === 0) {
      return 0.5; // Neutral
    }

    const now = Date.now();
    let weightedSum = 0;
    let weightTotal = 0;

    for (const entry of history) {
      const age = now - entry.timestamp;
      const decay = Math.exp(-age / this.config.feedbackDecayMs);

      let value: number;
      switch (entry.action) {
        case 'use':
          value = 1.0;
          break;
        case 'recall':
          value = 0.7;
          break;
        case 'refine':
          value = 0.5;
          break;
        case 'dismiss':
          value = 0.2;
          break;
        default:
          value = 0.5;
      }

      weightedSum += value * decay;
      weightTotal += decay;
    }

    return weightTotal > 0 ? weightedSum / weightTotal : 0.5;
  }

  /**
   * 批量计算召回分数
   */
  async calculateScoresBatch(
    memories: Memory[],
    context: RecallContext
  ): Promise<RecallResult[]> {
    return memories.map(memory => this.calculateRecallScore(memory, context));
  }

  /**
   * 计算上下文相似度
   */
  calculateContextSimilarity(
    memory: Memory,
    currentContext: RecallContext
  ): number {
    const cacheKey = `${memory.uid}:${currentContext.agentId}:${currentContext.sessionId || 'none'}`;
    const cached = this.contextSimilarityCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    let score = 0;
    let weight = 0;

    // Agent match
    if (memory.agentId === currentContext.agentId) {
      score += 0.3;
    }
    weight += 0.3;

    // Session match
    const memorySessionId = memory.metadata?.sessionId;
    if (memorySessionId && memorySessionId === currentContext.sessionId) {
      score += 0.2;
    }
    weight += 0.2;

    // Scope match
    if (memory.scope === currentContext.scope) {
      score += 0.25;
    } else if (memory.scope === 'global' || currentContext.scope === 'global') {
      score += 0.1;
    }
    weight += 0.25;

    // Type match
    if (memory.type === currentContext.type) {
      score += 0.25;
    }
    weight += 0.25;

    const result = weight > 0 ? score / weight : 0;
    this.contextSimilarityCache.set(cacheKey, result);

    // Limit cache size
    if (this.contextSimilarityCache.size > 10000) {
      const firstKey = this.contextSimilarityCache.keys().next().value;
      if (firstKey) {
        this.contextSimilarityCache.delete(firstKey);
      }
    }

    return result;
  }

  /**
   * 清除反馈历史
   */
  clearFeedbackHistory(agentId?: string): void {
    if (agentId) {
      for (const key of this.feedbackHistory.keys()) {
        if (key.startsWith(`${agentId}:`)) {
          this.feedbackHistory.delete(key);
        }
      }
    } else {
      this.feedbackHistory.clear();
    }
    this.recallCounts.clear();
    this.logger.info('Feedback history cleared', { agentId: agentId || 'all' });
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalFeedbackEntries: number;
    uniqueMemoriesWithFeedback: number;
    avgRecallCount: number;
    contextCacheSize: number;
  } {
    let totalFeedback = 0;
    const uniqueMemories = new Set<string>();

    for (const entries of this.feedbackHistory.values()) {
      totalFeedback += entries.length;
      for (const entry of entries) {
        uniqueMemories.add(entry.memoryId);
      }
    }

    const recallCounts = Array.from(this.recallCounts.values());
    const avgRecall = recallCounts.length > 0
      ? recallCounts.reduce((a, b) => a + b, 0) / recallCounts.length
      : 0;

    return {
      totalFeedbackEntries: totalFeedback,
      uniqueMemoriesWithFeedback: uniqueMemories.size,
      avgRecallCount: avgRecall,
      contextCacheSize: this.contextSimilarityCache.size
    };
  }

  // Private helper methods

  /**
   * 计算时间衰减分数
   */
  private calculateRecencyScore(memoryAgeMs: number): number {
    const decayConstant = this.config.timeDecayFactor;
    // Half-life at decayConstant fraction of a day
    const halfLifeMs = 24 * 60 * 60 * 1000 * decayConstant;
    return Math.exp(-0.693 * memoryAgeMs / halfLifeMs);
  }

  /**
   * 计算上下文分数
   */
  private calculateContextScore(memory: Memory, context: RecallContext): number {
    return this.calculateContextSimilarity(memory, context);
  }

  /**
   * 计算反馈分数
   */
  private calculateFeedbackScore(memoryId: string, agentId: string): number {
    return this.getFeedbackScore(memoryId, agentId);
  }

  /**
   * 应用多样性约束
   */
  private applyDiversityConstraints(
    results: RecallResult[],
    constraints: DiversityConstraint[]
  ): RecallResult[] {
    if (constraints.length === 0) {
      return results;
    }

    const selected: RecallResult[] = [];
    const groupCounts: Record<string, Record<string, number>> = {};

    for (const result of results) {
      let valid = true;

      for (const constraint of constraints) {
        const groupKey = this.getGroupKey(result.memory, constraint.type);
        if (!groupCounts[constraint.type]) {
          groupCounts[constraint.type] = {};
        }

        const currentCount = groupCounts[constraint.type][groupKey] || 0;

        if (constraint.maxPerGroup && currentCount >= constraint.maxPerGroup) {
          valid = false;
          break;
        }
      }

      if (valid) {
        selected.push(result);

        // Update counts
        for (const constraint of constraints) {
          const groupKey = this.getGroupKey(result.memory, constraint.type);
          groupCounts[constraint.type][groupKey] = (groupCounts[constraint.type][groupKey] || 0) + 1;
        }
      }

      if (selected.length >= this.config.maxResults) {
        break;
      }
    }

    return selected;
  }

  /**
   * 获取记忆的分组键
   */
  private getGroupKey(memory: Memory, type: DiversityConstraint['type']): string {
    switch (type) {
      case 'scope':
        return memory.scope;
      case 'type':
        return memory.type;
      case 'agent':
        return memory.agentId;
      case 'tag':
        return memory.tags?.[0] || 'untagged';
      default:
        return 'unknown';
    }
  }

  /**
   * 生成召回原因描述
   */
  private generateReason(
    relevance: number,
    recency: number,
    context: number,
    feedback: number
  ): string {
    const factors: string[] = [];

    if (relevance > 0.7) {
      factors.push('高相关性');
    } else if (relevance > 0.4) {
      factors.push('中等相关性');
    }

    if (recency > 0.8) {
      factors.push('近期更新');
    } else if (recency > 0.5) {
      factors.push('中期记忆');
    } else {
      factors.push('早期记忆');
    }

    if (context > 0.7) {
      factors.push('上下文高度匹配');
    }

    if (feedback > 0.7) {
      factors.push('正向反馈');
    } else if (feedback < 0.3) {
      factors.push('负向反馈');
    }

    return factors.length > 0 ? factors.join(', ') : '综合分数';
  }

  /**
   * 清理旧反馈
   */
  private cleanupOldFeedback(agentId: string): void {
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days

    for (const [key, entries] of this.feedbackHistory.entries()) {
      if (!key.startsWith(`${agentId}:`)) continue;

      const validEntries = entries.filter(
        entry => Date.now() - entry.timestamp < maxAge
      );

      if (validEntries.length === 0) {
        this.feedbackHistory.delete(key);
      } else if (validEntries.length < entries.length) {
        this.feedbackHistory.set(key, validEntries);
      }
    }
  }
}