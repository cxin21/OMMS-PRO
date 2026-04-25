/**
 * Tag Manager - 标签管理器
 *
 * v2.0.0: 使用内存存储，标签由 MemoryCaptureService 捕获时关联
 */

import { createLogger, type ILogger } from '../../../shared/logging';
import type {
  UserTag,
  TagCategory,
  TagSource,
  TagMetadata,
} from '../types';

export interface TagManagerOptions {
  maxTagsPerUser?: number;
  autoExpireDays?: number;
  enableTagRecommendation?: boolean;
}

/**
 * 标签管理器类
 * v2.0.0: 内存存储版本
 */
export class TagManager {
  private logger: ILogger;
  private options: Required<TagManagerOptions>;
  // v2.0.0: 使用内存存储
  private tags: Map<string, UserTag[]> = new Map();

  constructor(options?: TagManagerOptions) {
    this.logger = createLogger('tag-manager');
    this.options = {
      maxTagsPerUser: options?.maxTagsPerUser ?? 50,
      autoExpireDays: options?.autoExpireDays ?? 90,
      enableTagRecommendation: options?.enableTagRecommendation ?? true,
    };
  }

  /**
   * 添加标签
   */
  addTag(
    userId: string,
    name: string,
    category: TagCategory,
    source: TagSource,
    confidence: number = 0.8,
    weight: number = 1.0,
    metadata?: TagMetadata,
    expiresAt?: number
  ): UserTag {
    const now = Date.now();
    const tag: UserTag = {
      id: this.generateTagId(userId, name),
      userId,
      name,
      category,
      source,
      confidence,
      weight,
      createdAt: now,
      updatedAt: now,
      expiresAt: expiresAt ?? (now + this.options.autoExpireDays * 24 * 60 * 60 * 1000),
      metadata: metadata ?? {},
    };

    // 获取用户标签
    const userTags = this.tags.get(userId) ?? [];

    // 检查标签数量限制
    if (userTags.length >= this.options.maxTagsPerUser) {
      // 删除权重最低的标签
      const sortedTags = [...userTags].sort((a, b) => a.weight - b.weight);
      const toRemove = sortedTags[0];
      if (toRemove) {
        const idx = userTags.findIndex(t => t.id === toRemove.id);
        if (idx !== -1) userTags.splice(idx, 1);
        this.logger.debug(`Removed lowest weight tag to make room for new tag`);
      }
    }

    // 保存标签
    userTags.push(tag);
    this.tags.set(userId, userTags);

    this.logger.debug(
      `Added tag "${name}" (${category}) to user ${userId} with weight ${weight}`
    );

    return tag;
  }

  /**
   * 移除标签
   */
  removeTag(userId: string, tagId: string): void {
    const userTags = this.tags.get(userId) ?? [];
    const idx = userTags.findIndex(t => t.id === tagId);
    if (idx !== -1) {
      userTags.splice(idx, 1);
      this.tags.set(userId, userTags);
    }
    this.logger.debug(`Removed tag ${tagId} from user ${userId}`);
  }

  /**
   * 获取用户标签
   */
  getTags(userId: string, category?: TagCategory): UserTag[] {
    const allTags = this.tags.get(userId) ?? [];

    if (category) {
      return allTags.filter(tag => tag.category === category);
    }

    return allTags;
  }

  /**
   * 获取标签
   */
  getTag(userId: string, tagId: string): UserTag | undefined {
    const tags = this.tags.get(userId) ?? [];
    return tags.find(tag => tag.id === tagId);
  }

  /**
   * 更新标签权重
   */
  updateTagWeight(
    userId: string,
    tagId: string,
    weight: number
  ): UserTag | undefined {
    const tag = this.getTag(userId, tagId);
    if (!tag) {
      this.logger.warn(`Tag ${tagId} not found for user ${userId}`);
      return undefined;
    }

    tag.weight = weight;
    tag.updatedAt = Date.now();

    this.logger.debug(`Updated weight of tag ${tagId} to ${weight}`);

    return tag;
  }

  /**
   * 更新标签置信度
   */
  updateTagConfidence(
    userId: string,
    tagId: string,
    confidence: number
  ): UserTag | undefined {
    const tag = this.getTag(userId, tagId);
    if (!tag) {
      this.logger.warn(`Tag ${tagId} not found for user ${userId}`);
      return undefined;
    }

    tag.confidence = confidence;
    tag.updatedAt = Date.now();

    this.logger.debug(`Updated confidence of tag ${tagId} to ${confidence}`);

    return tag;
  }

  /**
   * 清理过期标签
   */
  cleanupExpiredTags(userId: string): number {
    const now = Date.now();
    const userTags = this.tags.get(userId) ?? [];
    const expiredTags = userTags.filter(tag => tag.expiresAt && tag.expiresAt < now);

    for (const tag of expiredTags) {
      const idx = userTags.findIndex(t => t.id === tag.id);
      if (idx !== -1) userTags.splice(idx, 1);
    }

    this.tags.set(userId, userTags);

    if (expiredTags.length > 0) {
      this.logger.info(`Cleaned up ${expiredTags.length} expired tags for user ${userId}`);
    }

    return expiredTags.length;
  }

  /**
   * 推荐标签
   */
  recommendTags(
    userId: string,
    context: {
      interests?: string[];
      behaviors?: string[];
      existingTags?: UserTag[];
    }
  ): UserTag[] {
    if (!this.options.enableTagRecommendation) {
      return [];
    }

    const recommendations: UserTag[] = [];
    const existingTagNames = new Set(
      context.existingTags?.map(tag => tag.name) ?? []
    );

    // 基于兴趣推荐
    if (context.interests) {
      for (const interest of context.interests) {
        if (!existingTagNames.has(interest)) {
          recommendations.push(
            this.createRecommendedTag(userId, interest, 'interest', 0.7)
          );
        }
      }
    }

    // 基于行为推荐
    if (context.behaviors) {
      const behaviorTags = this.extractTagsFromBehaviors(context.behaviors);
      for (const tag of behaviorTags) {
        if (!existingTagNames.has(tag)) {
          recommendations.push(
            this.createRecommendedTag(userId, tag, 'behavioral', 0.6)
          );
        }
      }
    }

    this.logger.debug(
      `Recommended ${recommendations.length} tags for user ${userId}`
    );

    return recommendations;
  }

  /**
   * 合并相似标签
   */
  mergeSimilarTags(userId: string): number {
    const userTags = this.tags.get(userId) ?? [];
    const mergedCount = 0;

    // 按名称分组（忽略大小写）
    const tagGroups = new Map<string, UserTag[]>();
    for (const tag of userTags) {
      const normalizedName = tag.name.toLowerCase();
      const group = tagGroups.get(normalizedName) ?? [];
      group.push(tag);
      tagGroups.set(normalizedName, group);
    }

    // 合并相似标签
    for (const [_, group] of tagGroups) {
      if (group.length > 1) {
        // 保留权重最高的标签
        const bestTag = group.reduce((a, b) => (a.weight > b.weight ? a : b));

        // 更新权重为总和
        bestTag.weight = group.reduce((sum, tag) => sum + tag.weight, 0);
        bestTag.updatedAt = Date.now();

        // 删除其他标签
        for (const tag of group) {
          if (tag.id !== bestTag.id) {
            const idx = userTags.findIndex(t => t.id === tag.id);
            if (idx !== -1) userTags.splice(idx, 1);
          }
        }
      }
    }

    this.tags.set(userId, userTags);

    return mergedCount;
  }

  /**
   * 获取标签统计
   */
  getTagStats(userId: string): {
    totalTags: number;
    byCategory: Map<TagCategory, number>;
    bySource: Map<TagSource, number>;
    averageWeight: number;
    averageConfidence: number;
  } {
    const userTags = this.tags.get(userId) ?? [];

    const byCategory = new Map<TagCategory, number>();
    const bySource = new Map<TagSource, number>();
    let totalWeight = 0;
    let totalConfidence = 0;

    for (const tag of userTags) {
      // 按分类统计
      byCategory.set(tag.category, (byCategory.get(tag.category) ?? 0) + 1);

      // 按来源统计
      bySource.set(tag.source, (bySource.get(tag.source) ?? 0) + 1);

      totalWeight += tag.weight;
      totalConfidence += tag.confidence;
    }

    return {
      totalTags: userTags.length,
      byCategory,
      bySource,
      averageWeight: userTags.length > 0 ? totalWeight / userTags.length : 0,
      averageConfidence: userTags.length > 0 ? totalConfidence / userTags.length : 0,
    };
  }

  /**
   * 从行为中提取标签
   */
  private extractTagsFromBehaviors(behaviors: string[]): string[] {
    const tagSet = new Set<string>();

    // 简单的关键词提取
    const patterns = {
      skill: ['擅长', '精通', '熟悉', '使用', '开发'],
      interest: ['喜欢', '爱好', '经常', '关注', '研究'],
      role: ['工程师', '开发者', '设计师', '产品经理', '学生'],
    };

    for (const behavior of behaviors) {
      const text = behavior.toLowerCase();

      for (const [category, keywords] of Object.entries(patterns)) {
        for (const keyword of keywords) {
          if (text.includes(keyword)) {
            // 提取关键词附近的词作为标签
            const index = text.indexOf(keyword);
            const start = Math.max(0, index - 10);
            const end = Math.min(text.length, index + 20);
            const extracted = text.substring(start, end).trim();
            tagSet.add(extracted);
          }
        }
      }
    }

    return Array.from(tagSet).slice(0, 10);
  }

  /**
   * 创建推荐标签
   */
  private createRecommendedTag(
    userId: string,
    name: string,
    categoryStr: string,
    confidence: number
  ): UserTag {
    const now = Date.now();
    const category = categoryStr as TagCategory;

    return {
      id: this.generateTagId(userId, name),
      userId,
      name,
      category,
      source: 'inferred',
      confidence,
      weight: 0.5,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.options.autoExpireDays * 24 * 60 * 60 * 1000,
      metadata: {
        evidence: ['recommendation'],
      },
    };
  }

  /**
   * 生成标签 ID
   */
  private generateTagId(userId: string, name: string): string {
    const normalizedName = name.toLowerCase().replace(/\s+/g, '-');
    return `tag-${userId}-${normalizedName}`;
  }
}
