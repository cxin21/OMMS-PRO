/**
 * Profile Manager - 用户画像管理器
 *
 * v2.0.0 重构: 深度集成 MemoryService
 * - 使用 MemoryService 存储 IDENTITY/PREFERENCE/PERSONA 记忆
 * - 保留分析组件用于从记忆构建画像
 */

import { createServiceLogger, type ILogger } from '../../shared/logging';
import { config } from '../../shared/config';
import { PersonaBuilder } from './persona/persona-builder';
import type { ConversationTurn } from './persona/persona-builder';
import { PreferenceInferer } from './preference/preference-inferer';
import { InteractionRecorder } from './interaction/interaction-recorder';
import { TagManager } from './interaction/tag-manager';
import { PrivacyManager } from './privacy-manager';
import { ProfileCache } from './profile-cache';
import type { StorageMemoryService } from '../memory/core/storage-memory-service';
import type { ILLMExtractor, LLMScoringResult } from '../memory/llm/llm-extractor';
import { MemoryType, MemoryScope, MemoryBlock } from '../../types/memory';
import type {
  Persona,
  PersonaUpdate,
  UserPreferences,
  UserInteraction,
  UserTag,
  UserStats,
  HistoryOptions,
  ReportOptions,
  UserReport,
  UserDataExport,
  ExportFormat,
  ExportMetadata,
  SensitiveDataType,
  TagCategory,
  TagSource,
  ProfileManagerConfig,
  Identity,
} from './types';

export interface ProfileManagerOptions {
  storagePath?: string;
  config?: Partial<ProfileManagerConfig>;
  memoryService?: StorageMemoryService;  // v2.0.0 可选依赖
  llmExtractor?: ILLMExtractor;  // LLM 提取器，Persona 构建必需
}

/**
 * Profile Manager 主类
 * v2.0.0: 深度集成 MemoryService
 */
export class ProfileManager {
  private logger: ILogger;
  private memoryService?: StorageMemoryService;
  private llmExtractor?: ILLMExtractor;  // v2.0.0: 用于生成动态评分
  private personaBuilder: PersonaBuilder;
  private preferenceInferer: PreferenceInferer;
  private interactionRecorder: InteractionRecorder;
  private tagManager: TagManager;
  private privacyManager: PrivacyManager;
  private cache: ProfileCache;
  private config: Required<ProfileManagerConfig>;

  constructor(options?: ProfileManagerOptions) {
    this.logger = createServiceLogger('ProfileManager');

    // 获取缓存配置（必须从 ConfigManager 获取）
    if (!config.isInitialized()) {
      throw new Error('ConfigManager not initialized. Cannot read memoryService.cache configuration.');
    }

    const memoryServiceConfig = config.getConfigOrThrow<{ maxSize: number; ttl: number }>('memoryService.cache');
    const cacheSize = memoryServiceConfig.maxSize;
    const cacheTtl = memoryServiceConfig.ttl;

    // 配置管理 - 从 ConfigManager 获取存储路径
    const storageConfig = config.getConfigOrThrow<{ profileDbPath: string }>('memoryService.storage');
    const profileDbPath = storageConfig.profileDbPath;

    // 获取默认评分配置
    const profileServiceConfig = config.getConfigOrThrow<{
      defaultScores: {
        personaImportance: number;
        personaScopeScore: number;
        identityImportance: number;
        identityScopeScore: number;
        preferenceImportance: number;
        preferenceScopeScore: number;
      };
    }>('memoryService.profileService');

    const defaultScores = profileServiceConfig.defaultScores;

    this.config = {
      storage: {
        dbPath: options?.storagePath ?? profileDbPath,
        enableCache: true,
        cacheSize,
        cacheTtl,
      },
      persona: {
        autoBuild: true,
        minConversationTurns: 5,
        updateThreshold: 0.3,
        maxVersions: 10,
      },
      preferences: {
        autoInfer: true,
        minInteractions: 10,
        confidenceThreshold: 0.6,
      },
      privacy: {
        enableSensitiveMarking: true,
        autoExpireDays: 365,
        requireExportApproval: false,
      },
      logging: {
        level: 'info',
        enableFileLogging: false,
      },
      defaultScores,
    };

    // 合并用户配置
    if (options?.config) {
      this.mergeConfig(options.config);
    }

    // v2.0.0: MemoryService 和 LLM Extractor 可选注入
    this.memoryService = options?.memoryService;
    this.llmExtractor = options?.llmExtractor;

    // 初始化缓存
    this.cache = new ProfileCache({
      maxSize: this.config.storage.cacheSize,
      ttl: cacheTtl,
    });

    // 初始化子模块
    // 注意：PersonaBuilder 需要 LLM 提取器，如果未提供则会在构造函数中抛出错误
    this.personaBuilder = new PersonaBuilder({
      minConversationTurns: this.config.persona.minConversationTurns,
      updateThreshold: this.config.persona.updateThreshold,
      maxVersions: this.config.persona.maxVersions,
    }, options?.llmExtractor);

    this.preferenceInferer = new PreferenceInferer({
      minInteractions: this.config.preferences.minInteractions,
      confidenceThreshold: this.config.preferences.confidenceThreshold,
    });

    // InteractionRecorder 现在不需要 storage 参数
    this.interactionRecorder = new InteractionRecorder();
    this.tagManager = new TagManager();
    this.privacyManager = new PrivacyManager(undefined, {
      enableSensitiveMarking: this.config.privacy.enableSensitiveMarking,
      autoExpireDays: this.config.privacy.autoExpireDays,
      requireExportApproval: this.config.privacy.requireExportApproval,
    });

    this.logger.info('Profile Manager initialized', {
      hasMemoryService: !!this.memoryService,
    });
  }

  /**
   * 设置 LLM Extractor（用于 Persona 构建和评分）
   */
  setLLMExtractor(extractor: ILLMExtractor): void {
    this.llmExtractor = extractor;
    this.personaBuilder = new PersonaBuilder({
      minConversationTurns: this.config.persona.minConversationTurns,
      updateThreshold: this.config.persona.updateThreshold,
      maxVersions: this.config.persona.maxVersions,
    }, extractor);
    this.logger.info('LLM Extractor configured for ProfileManager');
  }

  /**
   * Persona 管理
   * v2.0.0: 优先从 MemoryService 获取 PERSONA 记忆
   */

  async getPersona(userId: string, version?: number): Promise<Persona | undefined> {
    // 尝试从缓存获取
    const cached = this.cache.getPersona(userId);
    if (cached && !version) {
      return cached;
    }

    // v2.0.0: 从 MemoryService 获取 PERSONA 记忆
    if (this.memoryService) {
      const memories = await this.getMemoriesByType(userId, MemoryType.PERSONA);
      if (memories.length > 0) {
        // 找到最新的 persona 记忆
        const latestMemory = memories.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        try {
          const persona = JSON.parse(latestMemory.content) as Persona;
          if (!version || persona.version === version) {
            this.cache.setPersona(userId, persona);
            return persona;
          }
        } catch (e) {
          this.logger.warn('Failed to parse persona from memory', { memoryId: latestMemory.uid });
        }
      }
    } else {
      this.logger.warn('MemoryService not available for getPersona, profile data unavailable', { userId });
    }

    return undefined;
  }

  /**
   * 从 MemoryService 获取指定类型的记忆
   * v2.0.0: 使用 recall 方法查询记忆
   *
   * 注意：使用 agentId 和 types 过滤，不再依赖语义搜索（query）
   * 这样可以准确找到所有属于指定用户和类型的记忆，而不是依赖语义相似度
   */
  private async getMemoriesByType(userId: string, type: MemoryType): Promise<Array<{ uid: string; content: string; updatedAt: number }>> {
    if (!this.memoryService) {
      this.logger.warn('MemoryService not available for getMemoriesByType', { userId, type });
      return [];
    }

    try {
      // 使用 agentId 和 types 进行精确过滤，不再依赖语义搜索
      // 传入 agentId 让 recall 在存储层过滤，避免语义搜索遗漏
      // 不传 query 可以避免不必要的 LLM 调用和向量搜索，直接按类型和 agentId 过滤
      const result = await this.memoryService.recall({
        agentId: userId,  // 按 agentId 精确过滤
        types: [type],    // 按类型过滤
        limit: 100,
      });

      // 由于已经在存储层按 agentId 过滤，不需要再次过滤
      // 但为安全起见保留（防止存储层过滤失效）
      const filteredMemories = result.memories.filter(m => m.agentId === userId);

      return filteredMemories.map(m => ({
        uid: m.uid,
        content: m.content,
        updatedAt: m.updatedAt,
      }));
    } catch (error) {
      this.logger.warn('Failed to query memories from MemoryService', {
        userId,
        type,
        error: error instanceof Error ? error.message : error,
      });
      return [];
    }
  }

  async updatePersona(
    userId: string,
    update: PersonaUpdate
  ): Promise<Persona> {
    const existing = await this.getPersona(userId);

    if (!existing) {
      throw new Error(`Persona not found for user ${userId}`);
    }

    // 应用更新
    const updatedPersona: Persona = {
      ...existing,
      ...update,
      version: existing.version + 1,
      updatedAt: Date.now(),
      previousVersionId: existing.id,
      changeSummary: update.changeSummary ?? 'Manual update',
    };

    // v2.0.0: 保存到 MemoryService
    await this.savePersonaToMemory(updatedPersona);

    // 更新缓存
    this.cache.setPersona(userId, updatedPersona);

    this.logger.info(`Updated persona for user ${userId} to version ${updatedPersona.version}`);

    return updatedPersona;
  }

  async buildPersonaFromConversation(
    userId: string,
    turns: ConversationTurn[]
  ): Promise<Persona> {
    const existing = await this.getPersona(userId);

    // 构建新 Persona
    const persona = await this.personaBuilder.buildFromConversation(
      userId,
      turns,
      existing
    );

    // v2.0.0: 保存到 MemoryService
    await this.savePersonaToMemory(persona);

    // 更新缓存
    this.cache.setPersona(userId, persona);

    this.logger.info(
      `Built persona v${persona.version} for user ${userId} from ${turns.length} conversation turns`
    );

    return persona;
  }

  /**
   * v2.0.0: 保存 Persona 到 MemoryService 作为 PERSONA 记忆
   * 使用 LLM 动态生成重要性评分（如果 LLM Extractor 可用）
   * 如果 LLM Extractor 不可用，使用配置的默认评分
   */
  private async savePersonaToMemory(persona: Persona): Promise<void> {
    if (!this.memoryService) {
      this.logger.warn('MemoryService not available, persona not saved to memory');
      return;
    }

    // 从配置读取默认评分
    const defaultScores = this.config.defaultScores;

    // 确定 importance 和 scopeScore（优先使用 LLM 评分，否则使用配置默认值）
    let importance: number;
    let scopeScore: number;

    if (this.llmExtractor) {
      try {
        const scores = await this.llmExtractor.generateScores(persona.name + ' ' + JSON.stringify(persona));
        importance = scores.importance;
        scopeScore = scores.scopeScore;
      } catch (error) {
        this.logger.warn('LLM scoring failed, using configured default scores', { error: String(error) });
        importance = defaultScores.personaImportance;
        scopeScore = defaultScores.personaScopeScore;
      }
    } else {
      // LLM Extractor 不可用，使用配置的默认评分
      this.logger.debug('LLM Extractor not available, using configured default scores for persona');
      importance = defaultScores.personaImportance;
      scopeScore = defaultScores.personaScopeScore;
    }

    await this.memoryService.store(
      {
        content: JSON.stringify(persona),
        type: MemoryType.PERSONA,
        metadata: {
          agentId: persona.userId,
          subject: persona.name,
          tags: ['persona', `v${persona.version}`],
        },
      },
      {
        importance,
        scopeScore,
      }
    );
    this.logger.debug('Persona saved to MemoryService', { userId: persona.userId, importance, scopeScore });
  }

  /**
   * 偏好管理
   */

  async getPreferences(userId: string): Promise<UserPreferences | undefined> {
    // 尝试从缓存获取
    const cached = this.cache.getPreferences(userId);
    if (cached) {
      return cached;
    }

    // v2.0.0: 从 MemoryService 获取 PREFERENCE 记忆
    if (this.memoryService) {
      const memories = await this.getMemoriesByType(userId, MemoryType.PREFERENCE);
      if (memories.length > 0) {
        const latestMemory = memories.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        try {
          const preferences = JSON.parse(latestMemory.content) as UserPreferences;
          this.cache.setPreferences(userId, preferences);
          return preferences;
        } catch (e) {
          this.logger.warn('Failed to parse preferences from memory', { memoryId: latestMemory.uid });
        }
      }
    }

    return undefined;
  }

  /**
   * 获取用户身份信息
   * v2.0.0: 从 MemoryService 获取 IDENTITY 记忆
   */
  async getIdentity(userId: string, version?: number): Promise<Identity | undefined> {
    // v2.0.0: 从 MemoryService 获取 IDENTITY 记忆
    if (this.memoryService) {
      const memories = await this.getMemoriesByType(userId, MemoryType.IDENTITY);
      if (memories.length > 0) {
        // 找到最新的 identity 记忆
        const latestMemory = memories.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        try {
          const identity = JSON.parse(latestMemory.content) as Identity;
          if (!version || identity.version === version) {
            return identity;
          }
        } catch (e) {
          this.logger.warn('Failed to parse identity from memory', { memoryId: latestMemory.uid });
        }
      }
    }

    return undefined;
  }

  /**
   * 设置用户身份信息
   * v2.0.0: 保存到 MemoryService 作为 IDENTITY 记忆
   */
  async setIdentity(userId: string, identity: Identity): Promise<void> {
    await this.saveIdentityToMemory(userId, identity);
    this.logger.info('Identity set for user', { userId });
  }

  /**
   * v2.0.0: 保存 Identity 到 MemoryService 作为 IDENTITY 记忆
   * IDENTITY 类型永不遗忘，使用配置的默认评分
   */
  private async saveIdentityToMemory(userId: string, identity: Identity): Promise<void> {
    if (!this.memoryService) {
      this.logger.warn('MemoryService not available, identity not saved to memory');
      return;
    }

    // 从配置读取默认评分
    const defaultScores = this.config.defaultScores;

    // IDENTITY 类型使用配置的默认评分确保永不遗忘
    let importance: number;
    let scopeScore: number;

    if (this.llmExtractor) {
      try {
        const scores = await this.llmExtractor.generateScores(JSON.stringify(identity));
        // IDENTITY 使用配置的默认值，不低于配置的保护值
        importance = Math.max(scores.importance, defaultScores.identityImportance);
        scopeScore = Math.max(scores.scopeScore, defaultScores.identityScopeScore);
      } catch (error) {
        this.logger.warn('LLM scoring failed for identity, using configured protected scores', { error: String(error) });
        importance = defaultScores.identityImportance;
        scopeScore = defaultScores.identityScopeScore;
      }
    } else {
      this.logger.debug('LLM Extractor not available, using configured protected scores for identity');
      importance = defaultScores.identityImportance;
      scopeScore = defaultScores.identityScopeScore;
    }

    await this.memoryService.store(
      {
        content: JSON.stringify(identity),
        type: MemoryType.IDENTITY,
        metadata: {
          agentId: userId,
          subject: identity.name ?? userId,
          tags: ['identity', `v${identity.version}`],
        },
      },
      {
        importance,
        scopeScore,
      }
    );
    this.logger.debug('Identity saved to MemoryService', { userId, importance, scopeScore });
  }

  async setPreference(
    userId: string,
    key: string,
    value: any
  ): Promise<void> {
    const preferences = await this.getPreferences(userId);

    if (!preferences) {
      throw new Error(`Preferences not found for user ${userId}`);
    }

    // 根据 key 更新对应的偏好
    const keys = key.split('.');
    const category = keys[0] as keyof UserPreferences;

    if (category === 'interaction' || category === 'content' ||
        category === 'technical' || category === 'personalization') {
      const subKey = keys[1];
      if (subKey && preferences[category]) {
        (preferences[category] as any)[subKey] = value;
      }
    }

    preferences.updatedAt = Date.now();

    // v2.0.0: 保存到 MemoryService
    await this.savePreferencesToMemory(userId, preferences);

    this.cache.setPreferences(userId, preferences);

    this.logger.debug(`Set preference ${key} for user ${userId}`);
  }

  async inferPreferences(
    userId: string,
    behaviors: any[]
  ): Promise<UserPreferences> {
    const existing = await this.getPreferences(userId);

    // 推断偏好
    const preferences = await this.preferenceInferer.inferFromBehaviors(
      userId,
      behaviors,
      existing
    );

    // v2.0.0: 保存到 MemoryService
    await this.savePreferencesToMemory(userId, preferences);

    this.cache.setPreferences(userId, preferences);

    this.logger.info(
      `Inferred preferences for user ${userId} with confidence ${preferences.confidence}`
    );

    return preferences;
  }

  /**
   * v2.0.0: 保存 Preferences 到 MemoryService 作为 PREFERENCE 记忆
   * 使用 LLM 动态生成重要性评分（如果 LLM Extractor 可用）
   * 如果 LLM Extractor 不可用，使用配置的默认评分
   */
  private async savePreferencesToMemory(userId: string, preferences: UserPreferences): Promise<void> {
    if (!this.memoryService) {
      this.logger.warn('MemoryService not available, preferences not saved to memory');
      return;
    }

    // 从配置读取默认评分
    const defaultScores = this.config.defaultScores;

    // 确定 importance 和 scopeScore（优先使用 LLM 评分，否则使用配置默认值）
    let importance: number;
    let scopeScore: number;

    if (this.llmExtractor) {
      try {
        const scores = await this.llmExtractor.generateScores(JSON.stringify(preferences));
        importance = scores.importance;
        scopeScore = scores.scopeScore;
      } catch (error) {
        this.logger.warn('LLM scoring failed, using configured default scores', { error: String(error) });
        importance = defaultScores.preferenceImportance;
        scopeScore = defaultScores.preferenceScopeScore;
      }
    } else {
      // LLM Extractor 不可用，使用配置的默认评分
      this.logger.debug('LLM Extractor not available, using configured default scores for preferences');
      importance = defaultScores.preferenceImportance;
      scopeScore = defaultScores.preferenceScopeScore;
    }

    await this.memoryService.store(
      {
        content: JSON.stringify(preferences),
        type: MemoryType.PREFERENCE,
        metadata: {
          agentId: userId,
          tags: ['preferences'],
        },
      },
      {
        importance,
        scopeScore,
      }
    );
    this.logger.debug('Preferences saved to MemoryService', { userId, importance, scopeScore });
  }

  /**
   * 交互历史
   */

  async recordInteraction(
    userId: string,
    type: any,
    input?: string,
    output?: string,
    metadata?: any,
    sessionId?: string,
    agentId?: string,
    memoryIds?: string[]
  ): Promise<UserInteraction> {
    const interaction = await this.interactionRecorder.recordInteraction(
      userId,
      type,
      input,
      output,
      metadata,
      sessionId,
      agentId,
      memoryIds
    );

    // 清除统计缓存
    this.cache.invalidateUser(userId);

    return interaction;
  }

  getInteractionHistory(
    userId: string,
    options?: HistoryOptions
  ): UserInteraction[] {
    return this.interactionRecorder.getInteractionHistory(userId, options);
  }

  async getUserStats(userId: string): Promise<UserStats> {
    // 尝试从缓存获取
    const cached = await this.cache.getUserStats(userId);
    if (cached) {
      return cached;
    }

    // 计算统计
    const stats = this.interactionRecorder.getUserStats(userId);

    // 缓存
    this.cache.setUserStats(userId, stats);

    return stats;
  }

  /**
   * 用户标签
   */

  async getTags(userId: string, category?: TagCategory): Promise<UserTag[]> {
    // 尝试从缓存获取
    const cached = await this.cache.getTags(userId);
    if (cached && !category) {
      return cached;
    }

    // 从存储获取
    const tags = this.tagManager.getTags(userId, category);

    if (!category) {
      this.cache.setTags(userId, tags);
    }

    return tags;
  }

  async addTag(
    userId: string,
    name: string,
    category: TagCategory,
    source: TagSource = 'manual',
    confidence?: number,
    weight?: number
  ): Promise<UserTag> {
    const tag = await this.tagManager.addTag(
      userId,
      name,
      category,
      source,
      confidence,
      weight
    );

    // 清除标签缓存
    this.cache.invalidateUser(userId);

    return tag;
  }

  async removeTag(userId: string, tagId: string): Promise<void> {
    await this.tagManager.removeTag(userId, tagId);

    // 清除标签缓存
    this.cache.invalidateUser(userId);
  }

  /**
   * 获取用户画像（设计文档要求的统一入口）
   *
   * 聚合 persona、preferences、stats 和 tags 到一个统一的画像对象
   *
   * @param userId - 用户 ID
   * @returns 完整的用户画像
   */
  async getProfile(userId: string): Promise<{
    userId: string;
    persona: Persona | undefined;
    preferences: UserPreferences | undefined;
    stats: UserStats | undefined;
    tags: UserTag[];
  } | null> {
    try {
      // 并行获取所有数据
      const [persona, preferences, stats, tags] = await Promise.all([
        this.getPersona(userId),
        this.getPreferences(userId),
        Promise.resolve(this.getUserStats(userId)),
        Promise.resolve(this.getTags(userId)),
      ]);

      // 如果没有任何数据，返回 null
      if (!persona && !preferences && !stats && tags.length === 0) {
        return null;
      }

      return {
        userId,
        persona,
        preferences,
        stats,
        tags,
      };
    } catch (error) {
      this.logger.error('Failed to get user profile', { userId, error });
      return null;
    }
  }

  /**
   * 隐私管理
   */

  async markSensitive(
    userId: string,
    dataType: SensitiveDataType,
    dataId: string,
    reason: string
  ): Promise<void> {
    this.privacyManager.markSensitive(
      userId,
      dataType,
      dataId,
      reason
    );
  }

  async exportUserData(
    userId: string,
    format: ExportFormat = 'json',
    options?: {
      includePersona?: boolean;
      includePreferences?: boolean;
      includeInteractions?: boolean;
      includeTags?: boolean;
      includeSensitive?: boolean;
      dateRange?: { start: number; end: number };
    }
  ): Promise<UserDataExport> {
    const now = Date.now();
    const exportData: UserDataExport['data'] = {};

    // 收集要导出的数据
    if (options?.includePersona !== false) {
      const persona = await this.getPersona(userId);
      if (persona) {
        exportData.persona = [persona];
      }
    }

    if (options?.includePreferences !== false) {
      const preferences = await this.getPreferences(userId);
      if (preferences) {
        exportData.preferences = preferences;
      }
    }

    if (options?.includeInteractions !== false) {
      const interactions = this.getInteractionHistory(userId);
      if (interactions.length > 0) {
        exportData.interactions = interactions;
      }
    }

    if (options?.includeTags !== false) {
      const tags = await this.getTags(userId);
      if (tags.length > 0) {
        exportData.tags = tags;
      }
    }

    // 过滤敏感数据
    if (options?.includeSensitive !== true) {
      const sensitiveMarks = this.privacyManager.getSensitiveMarks(userId);
      const sensitiveDataIds = new Set(sensitiveMarks.map(m => m.dataId));

      // 过滤 persona 中的敏感数据
      if (exportData.persona) {
        exportData.persona = exportData.persona.filter(p => !sensitiveDataIds.has(p.id));
      }

      // 过滤 preferences 中的敏感数据
      if (exportData.preferences) {
        // preferences 是单对象，需要过滤其中的敏感字段
      }

      // 过滤 interactions
      if (exportData.interactions) {
        exportData.interactions = exportData.interactions.filter(i => !sensitiveDataIds.has(i.id));
      }

      // 过滤 tags
      if (exportData.tags) {
        exportData.tags = exportData.tags.filter(t => !sensitiveDataIds.has(t.id));
      }
    }

    // 计算统计信息
    const recordCount =
      (exportData.persona?.length ?? 0) +
      (exportData.preferences ? 1 : 0) +
      (exportData.interactions?.length ?? 0) +
      (exportData.tags?.length ?? 0);

    const metadata: ExportMetadata = {
      version: '1.0.0',
      recordCount,
      dateRange: {
        start: options?.dateRange?.start ?? 0,
        end: options?.dateRange?.end ?? now,
      },
    };

    const exportResult: UserDataExport = {
      userId,
      exportedAt: now,
      format,
      data: exportData,
      metadata,
    };

    this.logger.info(`Exported ${recordCount} records for user ${userId}`);

    return exportResult;
  }

  async deleteUserData(
    userId: string,
    confirm: boolean = false
  ): Promise<void> {
    // 隐私标记清理
    this.privacyManager.deleteUserData(userId, { confirm });

    // 删除记忆数据
    if (this.memoryService) {
      await this.memoryService.deleteUserData(userId);
    }

    // 删除交互记录
    await this.interactionRecorder.deleteUserData(userId);

    // 删除标签
    await this.tagManager.deleteUserData(userId);

    // 清除所有缓存
    this.cache.invalidateUser(userId);

    this.logger.info('User data deletion completed', { userId });
  }

  /**
   * 用户报告
   */

  async generateReport(
    userId: string,
    options?: ReportOptions
  ): Promise<UserReport> {
    const now = Date.now();
    
    // 收集数据
    const persona = options?.includePersona !== false 
      ? await this.getPersona(userId) 
      : undefined;
    
    const preferences = options?.includePreferences !== false
      ? await this.getPreferences(userId)
      : undefined;
    
    const stats = options?.includeStats !== false
      ? await this.getUserStats(userId)
      : undefined;

    const tags = options?.includeTags !== false
      ? await this.getTags(userId)
      : undefined;

    // 生成洞察
    const insights = this.generateInsights(userId, { persona, preferences, stats, tags });
    
    // 生成推荐
    const recommendations = this.generateRecommendations(userId, { persona, preferences, stats });

    const report: UserReport = {
      userId,
      generatedAt: now,
      summary: this.generateSummary(userId, stats, persona, tags),
      persona,
      preferences,
      stats,
      tags,
      insights,
      recommendations,
    };

    this.logger.info(`Generated report for user ${userId}`);

    return report;
  }

  /**
   * 生成 L0/L1 Context（Wake-up Context）
   * 
   * 根据设计文档，Profile Manager 的核心职责之一是维护 L0/L1 关键事实
   * L0: Identity（身份层）- Agent 核心身份、系统配置
   * L1: Critical Facts（关键事实层）- Team Map, Projects, Preferences
   */
  async getL0L1Context(userId?: string): Promise<string> {
    this.logger.debug(`Generating L0/L1 context for user ${userId ?? 'system'}`);

    const context: string[] = [];

    // L0 - Identity
    if (userId) {
      const persona = await this.getPersona(userId);
      if (persona) {
        const identity = this.buildIdentityContext(persona);
        context.push('## L0: Identity');
        context.push(identity);
      }
    }

    // L1 - Critical Facts
    if (userId) {
      const preferences = await this.getPreferences(userId);
      const tags = await this.getTags(userId);
      const stats = await this.getUserStats(userId);

      const criticalFacts = this.buildCriticalFactsContext(preferences, tags, stats);
      if (criticalFacts) {
        context.push('## L1: Critical Facts');
        context.push(criticalFacts);
      }
    }

    const fullContext = context.join('\n\n');
    this.logger.debug(`Generated L0/L1 context (${fullContext.length} chars)`);

    return fullContext;
  }

  /**
   * 构建身份上下文
   */
  private buildIdentityContext(persona: Persona): string {
    const lines: string[] = [];

    // 基本信息
    if (persona.name) lines.push(`- Name: ${persona.name}`);
    if (persona.occupation) lines.push(`- Occupation: ${persona.occupation}`);
    if (persona.location) lines.push(`- Location: ${persona.location}`);

    // 性格特征（Top 3）
    if (persona.personalityTraits.length > 0) {
      const topTraits = persona.personalityTraits.slice(0, 3);
      lines.push(`- Personality: ${topTraits.map(t => t.trait).join(', ')}`);
    }

    // 兴趣（Top 5）
    if (persona.interests.length > 0) {
      const topInterests = persona.interests.slice(0, 5);
      lines.push(`- Interests: ${topInterests.map(i => i.name).join(', ')}`);
    }

    // 价值观
    if (persona.values.length > 0) {
      lines.push(`- Values: ${persona.values.slice(0, 5).join(', ')}`);
    }

    return lines.join('\n');
  }

  /**
   * 构建关键事实上下文
   */
  private buildCriticalFactsContext(
    preferences?: UserPreferences,
    tags?: UserTag[],
    stats?: UserStats
  ): string {
    const lines: string[] = [];

    // 偏好设置
    if (preferences) {
      if (preferences.interaction.responseLength) {
        lines.push(`- Response Length: ${preferences.interaction.responseLength}`);
      }
      if (preferences.interaction.activeHours && preferences.interaction.activeHours.length > 0) {
        lines.push(`- Active Hours: ${preferences.interaction.activeHours.map(h => `${h.start}-${h.end}`).join(', ')}`);
      }
    }

    // 用户标签（高权重）
    if (tags && tags.length > 0) {
      const importantTags = tags.filter(t => t.weight >= 1.0).slice(0, 10);
      if (importantTags.length > 0) {
        lines.push(`- Tags: ${importantTags.map(t => t.name).join(', ')}`);
      }
    }

    // 统计信息
    if (stats) {
      lines.push(`- Total Interactions: ${stats.totalInteractions}`);
      lines.push(`- Engagement Level: ${this.calculateEngagementLevel(stats)}`);
      
      if (stats.favoriteTopics.length > 0) {
        lines.push(`- Favorite Topics: ${stats.favoriteTopics.slice(0, 5).join(', ')}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 清理和维护
   */

  cleanup(): void {
    // 清理过期缓存
    const cleaned = this.cache.cleanupExpired();
    
    // 清理过期标签
    // 注意：需要获取所有用户 ID，这里简化处理
    
    this.logger.debug(`Cleaned up ${cleaned} expired cache entries`);
  }

  /**
   * 关闭
   */
  close(): void {
    // v2.0.0: MemoryService 由外部管理生命周期
    this.cache.clear();
    this.logger.info('Profile Manager closed');
  }

  /**
   * 私有方法
   */

  private mergeConfig(userConfig: Partial<ProfileManagerConfig>): void {
    if (userConfig.storage) {
      Object.assign(this.config.storage, userConfig.storage);
    }
    if (userConfig.persona) {
      Object.assign(this.config.persona, userConfig.persona);
    }
    if (userConfig.preferences) {
      Object.assign(this.config.preferences, userConfig.preferences);
    }
    if (userConfig.privacy) {
      Object.assign(this.config.privacy, userConfig.privacy);
    }
    if (userConfig.logging) {
      Object.assign(this.config.logging, userConfig.logging);
    }
    if (userConfig.defaultScores) {
      Object.assign(this.config.defaultScores, userConfig.defaultScores);
    }
  }

  private generateSummary(
    userId: string,
    stats?: UserStats,
    persona?: Persona,
    tags?: UserTag[]
  ): any {
    return {
      totalInteractions: stats?.totalInteractions ?? 0,
      memberSince: stats?.firstInteraction ?? Date.now(),
      lastActive: stats?.lastInteraction ?? Date.now(),
      engagementLevel: this.calculateEngagementLevel(stats),
      topInterests: persona?.interests.slice(0, 5).map(i => i.name) ?? [],
      keyCharacteristics: persona?.personalityTraits.slice(0, 3).map(t => t.trait) ?? [],
    };
  }

  private calculateEngagementLevel(stats?: UserStats): any {
    if (!stats) return 'inactive';
    
    const score = stats.engagementScore;
    if (score >= 8) return 'very-high';
    if (score >= 6) return 'high';
    if (score >= 4) return 'moderate';
    if (score >= 2) return 'low';
    return 'inactive';
  }

  private generateInsights(
    userId: string,
    data: {
      persona?: Persona;
      preferences?: UserPreferences;
      stats?: UserStats;
      tags?: UserTag[];
    }
  ): any[] {
    const insights = [];

    // 基于交互频率的洞察
    if (data.stats && data.stats.totalInteractions > 100) {
      insights.push({
        id: 'insight-1',
        category: 'engagement-trend',
        title: '高度活跃用户',
        description: `您已经有 ${data.stats.totalInteractions} 次交互，显示出很高的参与度`,
        confidence: 0.9,
        evidence: ['interaction_count'],
        createdAt: Date.now(),
      });
    }

    // 基于兴趣的洞察
    if (data.persona && data.persona.interests.length > 5) {
      insights.push({
        id: 'insight-2',
        category: 'interest-evolution',
        title: '兴趣广泛',
        description: `您表现出对 ${data.persona.interests.length} 个领域的兴趣`,
        confidence: 0.8,
        evidence: ['interest_count'],
        createdAt: Date.now(),
      });
    }

    return insights;
  }

  private generateRecommendations(
    userId: string,
    data: {
      persona?: Persona;
      preferences?: UserPreferences;
      stats?: UserStats;
    }
  ): any[] {
    const recommendations = [];

    // 基于活跃度的推荐
    if (data.stats && data.stats.totalInteractions < 10) {
      recommendations.push({
        id: 'rec-1',
        category: 'engagement',
        title: '探索更多功能',
        description: '尝试使用更多功能来提升体验',
        priority: 'medium',
        action: 'explore-features',
      });
    }

    // 基于 Persona 的推荐
    if (data.persona && data.persona.interests.length > 0) {
      recommendations.push({
        id: 'rec-2',
        category: 'content',
        title: '个性化内容推荐',
        description: '基于您的兴趣，我们为您推荐相关内容',
        priority: 'low',
      });
    }

    return recommendations;
  }
}
