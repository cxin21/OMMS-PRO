
/**
 * 核心配置类型定义
 * 
 * @module types/config
 */

import type { MemoryType, MemoryScope } from '@core/types/memory/index';

export type MemoryBlock = 'working' | 'session' | 'core' | 'archived' | 'deleted';

export type HallType = 'facts' | 'events' | 'decisions' | 'errors' | 'learnings' | 'relations';

// ============================================================================
// 日志配置
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggingConfig {
  level: LogLevel;
  output: 'console' | 'file' | 'both';
  filePath?: string;
  maxSize?: number;
  maxFiles?: number;
  /** 日志刷新间隔（毫秒），默认 1000 */
  flushIntervalMs?: number;
}

// ============================================================================
// LLM 配置
// ============================================================================

export type LLMProvider = 'openai' | 'anthropic' | 'ollama' | 'mock' | 'openai-compatible';

/**
 * 统一AI配置基类
 * LLM 和 Embedding 共享的基础配置
 */
export interface BaseAIConfig {
  /** API 密钥 */
  apiKey?: string;
  /** API 基础 URL */
  baseURL?: string;
  /** 请求超时时间（毫秒） */
  timeout?: number;
  /** 连接池大小 */
  connectionPoolSize?: number;
  /** 重试次数 */
  maxRetries?: number;
}

/**
 * LLM 配置
 * 继承自 BaseAIConfig，添加 LLM 特定配置
 */
export interface LLMConfig extends BaseAIConfig {
  /** LLM 提供商 */
  provider: LLMProvider;
  /** 模型名称 */
  model: string;
  /** 生成温度（0-1） */
  temperature?: number;
  /** 最大生成 token 数 */
  maxTokens?: number;
}

// ============================================================================
// 记忆捕获配置
// ============================================================================

export interface CaptureConfig {
  confidenceThreshold: number;
  maxVersions: number;
  enableAutoExtraction: boolean;
  extractionTimeout: number;
}

// ============================================================================
// API 配置
// ============================================================================

export interface APIAuthConfig {
  enabled: boolean;
  apiKey?: string;
}

export interface APIRateLimitConfig {
  enabled: boolean;
  windowMs?: number;
  maxRequests?: number;
}

export interface APICorsConfig {
  enabled: boolean;
  origin: string | string[];
}

export interface APIServerConfig {
  timeout: number;
}

export interface APILoggingConfig {
  level: LogLevel;
  enableRequestLogging: boolean;
  enableResponseLogging: boolean;
  enableFileLogging: boolean;
  logFilePath?: string;
}

export interface APISecurityConfig {
  enableAuth: boolean;
  apiKey?: string;
  rateLimit: APIRateLimitConfig;
}

export interface APIPerformanceConfig {
  enableCompression: boolean;
  maxRequestBodySize: string;
}

export interface APIConfig {
  enabled: boolean;
  port: number;
  host: string;
  server: APIServerConfig;
  cors: APICorsConfig;
  logging: APILoggingConfig;
  auth: APIAuthConfig;
  security: APISecurityConfig;
  performance: APIPerformanceConfig;
}

// ============================================================================
// MCP Server 配置
// ============================================================================

export interface MCPToolsConfig {
  enableLogging: boolean;
  timeout: number;
  maxResults: number;
}

export interface MCPPerformanceConfig {
  enableCache: boolean;
  cacheTTL: number;
  maxConcurrentTools: number;
}

export interface MCPServerConfig {
  server: {
    transport: 'stdio' | 'sse' | 'websocket';
    port?: number;
    host?: string;
    /** SSE transport port (default: 3100) */
    ssePort?: number;
    /** WebSocket transport port (default: 3200) */
    wsPort?: number;
  };
  tools: MCPToolsConfig;
  logging: {
    level: LogLevel;
  };
  performance: MCPPerformanceConfig;
}

// ============================================================================
// 记忆服务存储配置
// ============================================================================

export interface MemoryStoreConfig {
  autoExtract: boolean;
  autoChunk: boolean;
  autoEnrich: boolean;
  chunkThreshold: number;
  defaultType: MemoryType;
  /** 摘要最大长度 */
  summaryMaxLength: number;
  /** 作用域升级阈值配置 */
  scopeUpgradeThresholds: {
    /** SESSION→AGENT: importance >= 此值时升级，默认 5 */
    sessionToAgentImportance: number;
    /** AGENT→GLOBAL: scopeScore >= 此值时升级，默认 6 */
    agentToGlobalScopeScore: number;
    /** AGENT→GLOBAL: importance >= 此值时升级，默认 7 */
    agentToGlobalImportance: number;
  };
  /** 存储区块判定阈值配置 */
  blockThresholds: {
    /** importance >= 此值时为 CORE block，默认 7 */
    coreMinImportance: number;
    /** importance >= 此值时为 SESSION block，默认 4 */
    sessionMinImportance: number;
    /** importance >= 此值时为 WORKING block，默认 2 */
    workingMinImportance: number;
    /** importance >= 此值时为 ARCHIVED block，默认 1 */
    archivedMinImportance: number;
  };
}

// ============================================================================
// 记忆服务召回配置
// ============================================================================

export interface MemoryRecallConfig {
  defaultLimit: number;
  maxLimit: number;
  minScore: number;
  enableVectorSearch: boolean;
  enableKeywordSearch: boolean;
  vectorWeight: number;
  keywordWeight: number;
}

// ============================================================================
// 记忆服务遗忘配置
// ============================================================================

export interface MemoryForgetConfig {
  enabled: boolean;
  checkInterval: number;
  archiveThreshold: number;
  deleteThreshold: number;
  maxInactiveDays: number;
  /** 保护等级：importance >= 此值时不受遗忘影响，默认 7 */
  protectLevel: number;
  scoringWeights: {
    importanceWeight: number;
    accessCountWeight: number;
    recencyWeight: number;
    accessCountNormalizer: number;
  };
}

// ============================================================================
// 记忆服务强化配置
// ============================================================================

export interface MemoryReinforceConfig {
  enabled: boolean;
  accessWeight: number;
  recencyWeight: number;
  upgradeThreshold: number;
  scoringConfig: {
    accessCountNormalizer: number;
    recencyNormalizer: number;
    maxBoostScore: number;
  };
  scopeUpgrade: {
    globalImportanceThreshold: number;
    agentImportanceThreshold: number;
  };
  /** 强化幅度阈值配置 */
  boostThresholds: {
    /** importance < 3 时的强化幅度，默认 0.5 */
    boostForLow: number;
    /** 3 <= importance < 6 时的强化幅度，默认 0.3 */
    boostForMedium: number;
    /** 6 <= importance < 7 时的强化幅度，默认 0.1 */
    boostForHigh: number;
    /** importance >= 7 时的强化幅度，默认 0.2 */
    boostForVeryHigh: number;
  };
}

// ============================================================================
// 记忆服务缓存配置
// ============================================================================

export interface MemoryCacheConfig {
  enabled: boolean;
  maxSize: number;
  ttl: number;
}

// ============================================================================
// 记忆服务日志配置
// ============================================================================

export interface MemoryLoggingConfig {
  enabled: boolean;
  level: LogLevel;
  directory?: string;
}

// ============================================================================
// 记忆服务情景记忆配置
// ============================================================================

export interface MemoryEpisodeConfig {
  enabled: boolean;
  autoDetect: boolean;
  detectIntervalMinutes: number;
  mergeThreshold: number;
  maxMemoriesPerEpisode: number;
}

// ============================================================================
// 记忆服务话题检测配置
// ============================================================================

export interface MemoryTopicConfig {
  enabled: boolean;
  directSwitchThreshold: number;
  noSwitchThreshold: number;
  useLLM: boolean;
}

// ============================================================================
// 记忆服务情感分析配置
// ============================================================================

export interface MemorySentimentConfig {
  enabled: boolean;
  useModel: boolean;
  useLLMRefine: boolean;
  llmRefineThreshold: number;
}

// ============================================================================
// 记忆服务巩固配置
// ============================================================================

export interface MemoryConsolidationConfig {
  enabled: boolean;
  scheduleHour: number;                    // 执行小时 (0-23)
  maxMemoriesPerCycle: number;            // 每周期最大处理量
  minRecallCount: number;                  // 最小召回次数阈值
  actions: {
    compress: boolean;
    link: boolean;
    snapshot: boolean;
    merge: boolean;
  };
  llmCompression: {
    enabled: boolean;
    temperature: number;
    maxTokens: number;
  };
  merge: {
    similarityThreshold: number;
    maxGroupSize: number;
  };
}

// ============================================================================
// 记忆服务空间索引配置
// ============================================================================

export interface MemorySpatialConfig {
  enabled: boolean;
  dimensions: number;                      // 2D 或 3D
  maxNeighbors: number;                   // 最大空间邻居数
  clusteringThreshold: number;             // 聚类阈值
  autoLayout: boolean;                    // 是否自动布局
  layoutRefreshThreshold: number;         // 触发重新布局的新记忆数量
  defaultRadius: number;                 // 默认搜索半径
  enableSpatialRecall: boolean;           // 是否启用空间召回
}

// ============================================================================
// 梦境引擎调度配置
// ============================================================================

export interface DreamingSchedulerConfig {
  autoOrganize: boolean;
  organizeInterval: number;
  memoryThreshold: number;
  fragmentationThreshold: number;
  stalenessDays: number;
  maxMemoriesPerCycle: number;
  maxRelationsPerCycle: number;
}

// ============================================================================
// 梦境引擎合并配置
// ============================================================================

export interface DreamingConsolidationConfig {
  similarityThreshold: number;
  maxGroupSize: number;
  preserveNewest: boolean;
  createNewVersion: boolean;
  topicSimilarityThreshold?: number;
  semanticCheckThreshold?: number;
  vectorSearchLimit?: number;
  candidateThreshold?: number;
}

// ============================================================================
// 梦境引擎图谱重构配置
// ============================================================================

export interface DreamingReorganizationConfig {
  minEdgeWeight: number;
  densityTarget: number;
  orphanThreshold: number;
  maxNewRelationsPerCycle: number;
}

// ============================================================================
// 梦境引擎归档配置
// ============================================================================

export interface DreamingArchivalConfig {
  importanceThreshold: number;
  stalenessDays: number;
  archiveBlock: string;
  retentionDays: number;
}

// ============================================================================
// 梦境引擎碎片整理配置
// ============================================================================

export interface DreamingDefragmentationConfig {
  fragmentationThreshold: number;
  enableCompression: boolean;
}

// ============================================================================
// 梦境引擎主题提取配置
// ============================================================================

export interface DreamingThemeExtractionConfig {
  minThemeStrength: number;
  maxThemes: number;
  useLLMEnhancement: boolean;
}

// ============================================================================
// 梦境引擎主动学习配置
// ============================================================================

export interface DreamingActiveLearningConfig {
  enabled: boolean;
  maxPatterns: number;
  maxWeakAreas: number;
  patternConfidenceThreshold: number;
  weakAreaThresholds: {
    minScopeMemoryCount: number;
    lowImportanceRatioThreshold: number;
  };
  highValueImportanceThreshold: number;
  lowValueImportanceThreshold: number;
}

// ============================================================================
// 梦境引擎配置
// ============================================================================

export interface DreamingEngineConfig {
  scheduler: DreamingSchedulerConfig;
  consolidation: DreamingConsolidationConfig;
  reorganization: DreamingReorganizationConfig;
  archival: DreamingArchivalConfig;
  defragmentation: DreamingDefragmentationConfig;
  themeExtraction: DreamingThemeExtractionConfig;
  activeLearning?: DreamingActiveLearningConfig;
}

// ============================================================================
// 记忆服务工作记忆配置
// ============================================================================

export interface WorkingMemoryFocusConfig {
  windowMinutes: number;           // 时间窗口，默认 120
  decayToZeroMinutes: number;     // 衰减到接近0的时间，默认 120
  initialBonus: number;            // 新记忆初始加成，默认 0.1
  weights: {
    recency: number;              // recency 权重，默认 0.5
    frequency: number;           // frequency 权重，默认 0.35
    bonus: number;               // bonus 权重，默认 0.15
  };
  baseByType: {
    identity: number;             // IDENTITY 类型基础值，默认 0.9
    persona: number;              // PERSONA 类型基础值，默认 0.8
    preference: number;           // PREFERENCE 类型基础值，默认 0.7
    decision: number;            // DECISION 类型基础值，默认 0.6
    error: number;               // ERROR 类型基础值，默认 0.6
    learning: number;            // LEARNING 类型基础值，默认 0.55
    fact: number;                // FACT 类型基础值，默认 0.5
    event: number;               // EVENT 类型基础值，默认 0.5
    relation: number;            // RELATION 类型基础值，默认 0.5
  };
}

export interface WorkingMemoryDrainConfig {
  idleTimeoutMinutes: number;     // 空闲超时触发下沉，默认 5
  idleCheckIntervalMs?: number;    // 空闲检测间隔（毫秒），默认 60000
  onTopicSwitch: boolean;         // 话题切换时触发下沉，默认 true
  onSessionEnd: boolean;          // 会话结束时触发下沉，默认 true
}

export interface MemoryVersionConfig {
  similarityThreshold: number;  // 余弦相似度阈值
  maxVersions: number;         // 最多保留版本数
  enableVersioning: boolean;     // 是否启用版本管理
}

export interface WorkingMemoryConfig {
  enabled: boolean;
  capacity: number;               // 容量上限，默认 7
  minCapacity: number;             // 最小容量，默认 4
  maxCapacity: number;            // 最大容量，默认 9
  focus: WorkingMemoryFocusConfig;
  drain: WorkingMemoryDrainConfig;
}

export interface MemoryServiceConfig {
  enabled: boolean;
  agentId: string;
  store: MemoryStoreConfig;
  recall: MemoryRecallConfig;
  forget: MemoryForgetConfig;
  reinforce: MemoryReinforceConfig;
  cache: MemoryCacheConfig;
  episode: MemoryEpisodeConfig;
  topic: MemoryTopicConfig;
  sentiment: MemorySentimentConfig;
  consolidation: MemoryConsolidationConfig;
  spatial: MemorySpatialConfig;
  logging: MemoryLoggingConfig;
  /** 版本管理配置 */
  version?: MemoryVersionConfig;
  /** 降级管理配置 */
  degradation?: MemoryDegradationConfig;
  /** 作用域降级配置 */
  scopeDegradation?: ScopeDegradationConfig;
  /** 强化配置 */
  reinforcement?: ReinforcementConfig;
  /** 存储层配置 */
  storage?: {
    /** SQLiteMetaStore 数据库路径 */
    metaStoreDbPath?: string;
    /** PalaceStore 存储路径 */
    palaceStorePath?: string;
    /** GraphStore 数据库路径 */
    graphStoreDbPath?: string;
    /** VectorStore 数据库路径 */
    vectorStoreDbPath?: string;
    /** EpisodeStore 存储路径 */
    episodeStorePath?: string;
    /** Graph 基础数据路径（retry queue, DLQ 等） */
    graphBasePath?: string;
    /** Profile 数据库路径 */
    profileDbPath?: string;
    /** Dream Reports 数据库路径 */
    dreamReportsDbPath?: string;
    /** Graph 处理器间隔（毫秒） */
    graphProcessorIntervalMs?: number;
  };
  /** 捕获配置 */
  capture?: {
    maxMemoriesPerCapture?: number;
    similarityThreshold?: number;
    confidenceThreshold?: number;
    enableLLMSummarization?: boolean;
    llmProvider?: string;
    llmApiKey?: string;
    llmEndpoint?: string;
    llmModel?: string;
  };
  /** 动态 Room 管理配置 */
  roomManager?: {
    mergeThreshold?: number;
    splitThreshold?: number;
    maxRecommendations?: number;
    similarityThreshold?: number;
    autoManage?: boolean;
  };
  /** 记忆-Room 映射配置 */
  memoryRoomMapping?: {
    maxRoomsPerMemory?: number;
    maxMemoriesPerRoom?: number;
    autoCleanupOrphaned?: boolean;
  };
  /** 访问控制配置 */
  accessControl?: {
    defaultAccessLevel?: string;
    auditEnabled?: boolean;
    policyCacheSize?: number;
    systemAgentId?: string;
  };
  /** 索引更新策略配置 */
  indexUpdate?: {
    mode?: 'immediate' | 'batch' | 'scheduled';
    batchSize?: number;
    batchDelayMs?: number;
    maxPendingTasks?: number;
    highPriorityThreshold?: number;
    scheduledIntervalMs?: number;
    maxRetries?: number;
  };
  /** 召回策略配置 */
  recallStrategy?: {
    timeDecayFactor?: number;
    diversityWeight?: number;
    contextWeight?: number;
    feedbackWeight?: number;
    maxResults?: number;
    minDiversityScore?: number;
    feedbackDecayMs?: number;
  };
  /** Webhook 管理配置 */
  webhook?: {
    maxRetries?: number;
    retryIntervalMs?: number;
    timeoutMs?: number;
    maxConcurrentDeliveries?: number;
    deliveryQueueSize?: number;
  };
}

// ============================================================================
// Embedding 配置
// ============================================================================

/**
 * Embedding 配置
 * 继承自 BaseAIConfig，添加 Embedding 特定配置
 */
export interface EmbeddingConfig extends BaseAIConfig {
  /** 嵌入模型名称 */
  model: string;
  /** 向量维度 */
  dimensions: number;
  /** 批处理大小 */
  batchSize?: number;
}

// ============================================================================
// Streaming 配置
// ============================================================================

export interface StreamingConfig {
  /** 每个流的最大事件数 */
  maxEventsPerStream: number;
  /** 最大流数量 */
  maxStreams: number;
  /** 每个客户端最大订阅数 */
  maxSubscriptionsPerClient: number;
  /** 流保留时间（毫秒） */
  streamRetentionMs: number;
}

// ============================================================================
// Multi-Agent 配置
// ============================================================================

export interface MultiAgentAgentsConfig {
  /** 心跳超时时间（毫秒） */
  heartbeatTimeoutMs: number;
  /** 心跳间隔（毫秒） */
  heartbeatIntervalMs: number;
  /** 最大丢失心跳次数 */
  maxMissedHeartbeats: number;
  /** 清理间隔（毫秒） */
  cleanupIntervalMs: number;
}

export interface MultiAgentConfig {
  enabled: boolean;
  agents: MultiAgentAgentsConfig;
}

// ============================================================================
// Memory Degradation 配置
// ============================================================================

export interface MemoryDegradationConfig {
  enabled: boolean;
  /** 降级检查间隔（毫秒） */
  checkInterval: number;
  /** 每日衰减率 */
  decayRate: number;
  /** 重要性权重 */
  importanceWeight: number;
  /** 作用域权重 */
  scopeWeight: number;
  /** 删除阈值 */
  deleteThreshold: number;
  /** 归档阈值 */
  archiveThreshold: number;
  /** 保护等级 */
  protectLevel: number;
}

export interface ScopeDegradationConfig {
  enabled: boolean;
  sessionToAgentDays: number;
  agentToGlobalDays: number;
  sessionUpgradeRecallThreshold: number;
  agentUpgradeRecallThreshold: number;
  upgradeScopeScoreMax: number;
}

export interface ReinforcementConfig {
  enabled: boolean;
  lowBoostThreshold: number;
  mediumBoostThreshold: number;
  highBoostThreshold: number;
  lowBoost: number;
  mediumBoost: number;
  highBoost: number;
  defaultBoost: number;
  maxImportance: number;
  scopeBoost: number;
  cooldownMs: number;
}

// ============================================================================
// 主配置
// ============================================================================

export interface OMMSConfig {
  agentId: string;

  api: APIConfig;
  mcp: MCPServerConfig;
  logging: LoggingConfig;
  memoryService: MemoryServiceConfig;
  embedding: EmbeddingConfig;
  dreamingEngine: DreamingEngineConfig;
  capture: CaptureConfig;
  llmExtraction: LLMConfig;
  streaming?: StreamingConfig;
  multiAgent?: MultiAgentConfig;
}

// ============================================================================
// 默认配置
// 所有默认配置通过 ConfigManager 从 config.default.json 动态加载
// 代码中禁止硬编码任何默认配置值
// ============================================================================
