/**
 * Preference Inferer - 偏好推断器
 *
 * 基于用户行为和交互历史自动推断用户偏好
 */

import { createServiceLogger, type ILogger } from '../../../shared/logging';
import { config } from '../../../shared/config';
import type {
  UserPreferences,
  InteractionPreferences,
  ContentPreferences,
  TechnicalPreferences,
  PersonalizationPreferences,
  PreferenceSource,
  TopicPreference,
  ContentFormatPreference,
  ContentFormat,
  ResponseLengthPreference,
  ResponseSpeedPreference,
  ComplexityLevel,
} from '../types';

export interface PreferenceInfererOptions {
  minInteractions?: number;
  confidenceThreshold?: number;
  decayFactor?: number;
}

interface InferredPreferences {
  interaction: Partial<InteractionPreferences>;
  content: Partial<ContentPreferences>;
  technical: Partial<TechnicalPreferences>;
  personalization: Partial<PersonalizationPreferences>;
  confidence: number;
  sources: PreferenceSource[];
}

// 默认配置
const DEFAULT_PREFERENCE_INFERER_CONFIG: Required<PreferenceInfererOptions> = {
  minInteractions: 10,
  confidenceThreshold: 0.6,
  decayFactor: 0.9,
};

/**
 * 偏好推断器类
 */
export class PreferenceInferer {
  private logger: ILogger;
  private options: Required<PreferenceInfererOptions>;

  constructor(options?: PreferenceInfererOptions) {
    this.logger = createServiceLogger('PreferenceInferer');

    // 从 ConfigManager 读取配置
    let managerConfig: Partial<PreferenceInfererOptions> = {};
    if (config.isInitialized()) {
      try {
        const cfg = config.getConfig<PreferenceInfererOptions>('memoryService.profileService.preferenceInferer');
        if (cfg) {
          managerConfig = cfg;
        }
      } catch {
        // ConfigManager not available, will use defaults
      }
    }

    // 合并: 默认值 -> ConfigManager -> 用户选项
    this.options = {
      minInteractions: options?.minInteractions ?? managerConfig.minInteractions ?? DEFAULT_PREFERENCE_INFERER_CONFIG.minInteractions,
      confidenceThreshold: options?.confidenceThreshold ?? managerConfig.confidenceThreshold ?? DEFAULT_PREFERENCE_INFERER_CONFIG.confidenceThreshold,
      decayFactor: options?.decayFactor ?? managerConfig.decayFactor ?? DEFAULT_PREFERENCE_INFERER_CONFIG.decayFactor,
    };
  }

  /**
   * 从用户行为推断偏好
   */
  async inferFromBehaviors(
    userId: string,
    behaviors: UserBehavior[],
    existingPreferences?: UserPreferences
  ): Promise<UserPreferences> {
    this.logger.info(`Inferring preferences for user ${userId} from ${behaviors.length} behaviors`);

    if (behaviors.length < this.options.minInteractions) {
      this.logger.warn(
        `Insufficient behaviors (${behaviors.length}) for preference inference, minimum required: ${this.options.minInteractions}`
      );
    }

    // 分析行为模式
    const patterns = this.analyzeBehaviorPatterns(behaviors);

    // 推断偏好
    const inferred = this.inferPreferences(patterns, behaviors);

    // 合并现有偏好
    const merged = this.mergeWithExisting(inferred, existingPreferences);

    const now = Date.now();
    const preferences: UserPreferences = {
      userId,
      updatedAt: now,
      interaction: merged.interaction,
      content: merged.content,
      technical: merged.technical,
      personalization: merged.personalization,
      confidence: merged.confidence,
      sources: merged.sources,
    };

    this.logger.info(
      `Inferred preferences for user ${userId} with confidence ${preferences.confidence}`
    );

    return preferences;
  }

  /**
   * 分析行为模式
   */
  private analyzeBehaviorPatterns(behaviors: UserBehavior[]): BehaviorPatterns {
    const patterns: BehaviorPatterns = {
      responseLength: [],
      responseSpeed: [],
      topics: new Map<string, number>(),
      formats: new Map<string, number>(),
      complexityLevels: [],
      interactionTimes: [],
      sessionDurations: [],
      feedbackRatings: [],
      toolUsage: new Map<string, number>(),
      languageUsage: new Map<string, number>(),
    };

    for (const behavior of behaviors) {
      // 响应长度偏好
      if (behavior.responseLength) {
        patterns.responseLength.push(behavior.responseLength);
      }

      // 响应速度偏好
      if (behavior.responseSpeed) {
        patterns.responseSpeed.push(behavior.responseSpeed);
      }

      // 主题兴趣
      if (behavior.topics) {
        for (const topic of behavior.topics) {
          patterns.topics.set(topic, (patterns.topics.get(topic) ?? 0) + 1);
        }
      }

      // 内容格式偏好
      if (behavior.contentFormat) {
        patterns.formats.set(
          behavior.contentFormat,
          (patterns.formats.get(behavior.contentFormat) ?? 0) + 1
        );
      }

      // 复杂度级别
      if (behavior.complexityLevel) {
        patterns.complexityLevels.push(behavior.complexityLevel);
      }

      // 交互时间
      if (behavior.timestamp) {
        const hour = new Date(behavior.timestamp).getHours();
        patterns.interactionTimes.push(hour);
      }

      // 会话时长
      if (behavior.sessionDuration) {
        patterns.sessionDurations.push(behavior.sessionDuration);
      }

      // 反馈评分
      if (behavior.feedbackRating !== undefined) {
        patterns.feedbackRatings.push(behavior.feedbackRating);
      }

      // 工具使用
      if (behavior.toolsUsed) {
        for (const tool of behavior.toolsUsed) {
          patterns.toolUsage.set(tool, (patterns.toolUsage.get(tool) ?? 0) + 1);
        }
      }

      // 语言使用
      if (behavior.language) {
        patterns.languageUsage.set(
          behavior.language,
          (patterns.languageUsage.get(behavior.language) ?? 0) + 1
        );
      }
    }

    return patterns;
  }

  /**
   * 推断偏好
   */
  private inferPreferences(
    patterns: BehaviorPatterns,
    behaviors: UserBehavior[]
  ): InferredPreferences {
    const inferred: InferredPreferences = {
      interaction: {},
      content: {},
      technical: {},
      personalization: {},
      confidence: 0,
      sources: [],
    };

    // 推断交互偏好
    inferred.interaction = this.inferInteractionPreferences(patterns);

    // 推断内容偏好
    inferred.content = this.inferContentPreferences(patterns);

    // 推断技术偏好
    inferred.technical = this.inferTechnicalPreferences(patterns);

    // 推断个性化偏好
    inferred.personalization = this.inferPersonalizationPreferences(patterns, behaviors);

    // 计算整体置信度
    inferred.confidence = this.calculateOverallConfidence(patterns, behaviors);

    // 添加来源
    inferred.sources = [
      {
        type: 'inferred',
        timestamp: Date.now(),
        confidence: inferred.confidence,
        evidence: `Based on ${behaviors.length} behaviors`,
      },
    ];

    return inferred;
  }

  /**
   * 推断交互偏好
   */
  private inferInteractionPreferences(patterns: BehaviorPatterns): Partial<InteractionPreferences> {
    const prefs: Partial<InteractionPreferences> = {};

    // 响应长度偏好
    if (patterns.responseLength.length > 0) {
      const mode = this.findMode(patterns.responseLength);
      prefs.responseLength = mode as ResponseLengthPreference;
    }

    // 响应速度偏好
    if (patterns.responseSpeed.length > 0) {
      const mode = this.findMode(patterns.responseSpeed);
      prefs.responseSpeed = mode as ResponseSpeedPreference;
    }

    // 活跃时间
    if (patterns.interactionTimes.length > 0) {
      const activeHours = this.findActiveHours(patterns.interactionTimes);
      if (activeHours.length > 0) {
        prefs.activeHours = activeHours.map(hour => ({
          start: `${hour.toString().padStart(2, '0')}:00`,
          end: `${((hour + 1) % 24).toString().padStart(2, '0')}:00`,
        }));
      }
    }

    return prefs;
  }

  /**
   * 推断内容偏好
   */
  private inferContentPreferences(patterns: BehaviorPatterns): Partial<ContentPreferences> {
    const prefs: Partial<ContentPreferences> = {};

    // 主题偏好
    if (patterns.topics.size > 0) {
      const sortedTopics = Array.from(patterns.topics.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      prefs.topics = sortedTopics.map(([topic, count]) => ({
        topic,
        interest: this.normalizeScore(count, patterns.topics),
        expertise: 0.5, // 默认中等专业水平
        lastInteracted: Date.now(),
      }));
    }

    // 格式偏好
    if (patterns.formats.size > 0) {
      const sortedFormats = Array.from(patterns.formats.entries())
        .sort((a, b) => b[1] - a[1]);

      prefs.formats = sortedFormats.map(([format, count]) => ({
        format: format as ContentFormat,
        preference: this.normalizeScore(count, patterns.formats),
      }));
    }

    // 复杂度级别
    if (patterns.complexityLevels.length > 0) {
      const mode = this.findMode(patterns.complexityLevels);
      prefs.complexityLevel = mode as ComplexityLevel;
    }

    return prefs;
  }

  /**
   * 推断技术偏好
   */
  private inferTechnicalPreferences(patterns: BehaviorPatterns): Partial<TechnicalPreferences> {
    const prefs: Partial<TechnicalPreferences> = {};

    // 工具使用偏好
    if (patterns.toolUsage.size > 0) {
      const sortedTools = Array.from(patterns.toolUsage.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tool]) => tool);

      prefs.preferredTools = sortedTools;
    }

    return prefs;
  }

  /**
   * 推断个性化偏好
   */
  private inferPersonalizationPreferences(
    patterns: BehaviorPatterns,
    behaviors: UserBehavior[]
  ): Partial<PersonalizationPreferences> {
    const prefs: Partial<PersonalizationPreferences> = {};

    // 基于反馈推断
    if (patterns.feedbackRatings.length > 0) {
      const avgRating =
        patterns.feedbackRatings.reduce((a, b) => a + b, 0) / patterns.feedbackRatings.length;

      // 高评分用户可能喜欢个性化
      prefs.useName = avgRating >= 4;
      prefs.rememberContext = avgRating >= 3.5;
      prefs.adaptTone = avgRating >= 4;
      prefs.suggestRelated = avgRating >= 3.5;
      prefs.learnFromFeedback = avgRating >= 4;
    } else {
      // 默认值
      prefs.useName = true;
      prefs.rememberContext = true;
      prefs.adaptTone = true;
      prefs.suggestRelated = false;
      prefs.learnFromFeedback = true;
    }

    return prefs;
  }

  /**
   * 合并现有偏好
   */
  private mergeWithExisting(
    inferred: InferredPreferences,
    existing?: UserPreferences
  ): {
    interaction: InteractionPreferences;
    content: ContentPreferences;
    technical: TechnicalPreferences;
    personalization: PersonalizationPreferences;
    confidence: number;
    sources: PreferenceSource[];
  } {
    if (!existing) {
      return {
        interaction: this.fillDefaultInteractionPrefs(inferred.interaction),
        content: this.fillDefaultContentPrefs(inferred.content),
        technical: this.fillDefaultTechnicalPrefs(inferred.technical),
        personalization: this.fillDefaultPersonalizationPrefs(inferred.personalization),
        confidence: inferred.confidence,
        sources: inferred.sources,
      };
    }

    // 合并偏好
    const merged = {
      interaction: {
        ...existing.interaction,
        ...inferred.interaction,
      },
      content: {
        ...existing.content,
        ...inferred.content,
      },
      technical: {
        ...existing.technical,
        ...inferred.technical,
      },
      personalization: {
        ...existing.personalization,
        ...inferred.personalization,
      },
      confidence: this.updateConfidence(existing.confidence, inferred.confidence),
      sources: [
        ...existing.sources.slice(-10),
        ...inferred.sources,
      ],
    };

    return merged;
  }

  /**
   * 填充默认交互偏好
   */
  private fillDefaultInteractionPrefs(
    partial: Partial<InteractionPreferences>
  ): InteractionPreferences {
    return {
      responseLength: partial.responseLength ?? 'moderate',
      responseSpeed: partial.responseSpeed ?? 'balanced',
      interactionFrequency: 'moderate',
      notificationPreference: {
        enabled: false,
        types: [],
      },
      activeHours: partial.activeHours,
    };
  }

  /**
   * 填充默认内容偏好
   */
  private fillDefaultContentPrefs(partial: Partial<ContentPreferences>): ContentPreferences {
    return {
      topics: partial.topics ?? [],
      formats: partial.formats ?? [],
      languages: [],
      complexityLevel: partial.complexityLevel ?? 'intermediate',
      examplesPreference: true,
      visualAidsPreference: false,
    };
  }

  /**
   * 填充默认技术偏好
   */
  private fillDefaultTechnicalPrefs(partial: Partial<TechnicalPreferences>): TechnicalPreferences {
    return {
      preferredTools: partial.preferredTools ?? [],
      programmingLanguages: [],
      frameworks: [],
      platforms: [],
      accessibilityNeeds: [],
    };
  }

  /**
   * 填充默认个性化偏好
   */
  private fillDefaultPersonalizationPrefs(
    partial: Partial<PersonalizationPreferences>
  ): PersonalizationPreferences {
    return {
      useName: partial.useName ?? true,
      rememberContext: partial.rememberContext ?? true,
      adaptTone: partial.adaptTone ?? true,
      suggestRelated: partial.suggestRelated ?? false,
      learnFromFeedback: partial.learnFromFeedback ?? true,
      customInstructions: partial.customInstructions,
    };
  }

  /**
   * 计算整体置信度
   */
  private calculateOverallConfidence(
    patterns: BehaviorPatterns,
    behaviors: UserBehavior[]
  ): number {
    const totalBehaviors = behaviors.length;
    const minRequired = this.options.minInteractions;

    if (totalBehaviors < minRequired) {
      return (totalBehaviors / minRequired) * 0.5;
    }

    // 基于数据量和一致性的置信度
    const dataConfidence = Math.min(1.0, totalBehaviors / (minRequired * 2)) * 0.5;

    // 计算模式的一致性
    const consistency = this.calculatePatternConsistency(patterns);
    const consistencyConfidence = consistency * 0.5;

    return dataConfidence + consistencyConfidence;
  }

  /**
   * 计算模式一致性
   */
  private calculatePatternConsistency(patterns: BehaviorPatterns): number {
    let totalConsistency = 0;
    let count = 0;

    // 响应长度一致性
    if (patterns.responseLength.length > 0) {
      const mode = this.findMode(patterns.responseLength);
      const modeCount = patterns.responseLength.filter(l => l === mode).length;
      totalConsistency += modeCount / patterns.responseLength.length;
      count++;
    }

    // 主题集中度
    if (patterns.topics.size > 0) {
      const totalTopicCount = Array.from(patterns.topics.values()).reduce((a, b) => a + b, 0);
      const maxTopicCount = Math.max(...Array.from(patterns.topics.values()));
      totalConsistency += maxTopicCount / totalTopicCount;
      count++;
    }

    return count > 0 ? totalConsistency / count : 0.5;
  }

  /**
   * 更新置信度
   */
  private updateConfidence(existing: number, newConfidence: number): number {
    // 使用衰减因子，更重视新的证据
    return existing * (1 - this.options.decayFactor) + newConfidence * this.options.decayFactor;
  }

  /**
   * 查找众数
   */
  private findMode<T>(array: T[]): T | undefined {
    if (array.length === 0) return undefined;

    const counts = new Map<T, number>();
    for (const item of array) {
      counts.set(item, (counts.get(item) ?? 0) + 1);
    }

    let mode: T | undefined;
    let maxCount = 0;

    for (const [item, count] of counts) {
      if (count > maxCount) {
        mode = item;
        maxCount = count;
      }
    }

    return mode;
  }

  /**
   * 查找活跃时间段
   */
  private findActiveHours(hours: number[]): number[] {
    const hourCounts = new Map<number, number>();
    for (const hour of hours) {
      hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
    }

    const sortedHours = Array.from(hourCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hour]) => hour);

    return sortedHours.sort((a, b) => a - b);
  }

  /**
   * 归一化分数
   */
  private normalizeScore(value: number, map: Map<any, number>): number {
    const maxValue = Math.max(...Array.from(map.values()));
    return maxValue > 0 ? value / maxValue : 0.5;
  }
}

/**
 * 行为模式接口
 */
interface BehaviorPatterns {
  responseLength: string[];
  responseSpeed: string[];
  topics: Map<string, number>;
  formats: Map<string, number>;
  complexityLevels: string[];
  interactionTimes: number[];
  sessionDurations: number[];
  feedbackRatings: number[];
  toolUsage: Map<string, number>;
  languageUsage: Map<string, number>;
}

/**
 * 用户行为接口
 */
export interface UserBehavior {
  timestamp?: number;
  responseLength?: string;
  responseSpeed?: string;
  topics?: string[];
  contentFormat?: string;
  complexityLevel?: string;
  sessionDuration?: number;
  feedbackRating?: number;
  toolsUsed?: string[];
  language?: string;
  metadata?: Record<string, any>;
}
