/**
 * Config Defaults - 配置默认值常量
 * 替代散落的 ?? 0.5, ?? 200 等硬编码默认值
 */

/**
 * 通用默认值
 */
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const ONE_HOUR_MS = 60 * 60 * 1000;

export const Defaults = {
  // 通用
  confidence: 0.5,
  importance: 5,
  scopeScore: 5,
  temperature: 0.7,
  maxTokens: 2000,
  timeout: 30000,
  maxRetries: 3,
} as const;

/**
 * Memory Service 默认值
 */
export const MemoryDefaults = {
  // Store
  summaryMaxLength: 200,
  defaultConfidence: 0.5,
  defaultImportance: 5,
  defaultScopeScore: 5,
  chunkThreshold: 500,

  // Capture
  maxMemoriesPerCapture: 5,
  confidenceThreshold: 0.5,
  similarityThreshold: 0.9,
  versionLockTTLMs: 30000,
  versionLockWaitMs: 5000,
  maxVersionLocks: 100,
  contentHashCacheSize: 1000,
  extractionTimeout: 30000,
  conversationThreshold: 500,
  contextExtension: 200,
  inclusionSimilarityThreshold: 0.7,

  // Recall
  recallDefaultLimit: 20,
  recallMaxLimit: 100,
  minScore: 0.5,
  vectorWeight: 0.7,
  keywordWeight: 0.3,

  // Version
  maxVersions: 5,
  enableVersioning: true,

  // Inclusion
  inclusionThreshold: 0.7,
  identicalThreshold: 0.95,

  // Topic
  directSwitchThreshold: 0.5,
  noSwitchThreshold: 0.3,

  // Reinforcement
  lowBoostThreshold: 3,
  mediumBoostThreshold: 6,
  highBoostThreshold: 7,
  lowBoost: 0.5,
  mediumBoost: 0.3,
  highBoost: 0.1,
  defaultBoost: 0.2,
  scopeBoost: 0.5,

  // BM25
  bm25K1: 1.5,
  bm25B: 0.75,

  // Degradation
  decayRate: 0.01,
  deleteThreshold: 1,
  archiveThreshold: 3,
  protectLevel: 7,
  maxLockWaitMs: 60000,
  maxDegradationWaitMs: 60000,

  // Graph
  graphRetryDelayMs: 5000,

  // Dreaming
  dreamingMaxItemsPerPhase: 1000,

  // Distributed Lock
  maxLockCount: 1000,

  // Consolidation
  scheduleHour: 3,
  maxMemoriesPerCycle: 50,
  minRecallCount: 3,
  mergeSimilarityThreshold: 0.85,
  maxGroupSize: 5,

  // Forget
  checkInterval: ONE_DAY_MS,
  maxInactiveDays: 90,

  // Scope Degradation
  sessionToAgentDays: 7,
  agentToGlobalDays: 30,
  globalToAgentDays: 365,

  // Spatial
  dimensions: 3,
  maxNeighbors: 10,
  clusteringThreshold: 0.8,
  defaultRadius: 5,

  // Index Update
  batchSize: 100,
  batchDelayMs: 5000,
  maxPendingTasks: 10000,
  highPriorityThreshold: 0.8,
  scheduledIntervalMs: 60000,

  // Recall Strategy
  timeDecayFactor: 0.5,
  diversityWeight: 0.2,
  contextWeight: 0.3,
  feedbackWeight: 0.2,
  maxResults: 20,
  minDiversityScore: 0.3,
  feedbackDecayMs: ONE_DAY_MS,

  // Webhook
  retryIntervalMs: 5000,
  maxConcurrentDeliveries: 10,
  deliveryQueueSize: 1000,

  // Cache
  cacheMaxSize: 1000,
  cacheTTL: 3600000,

  // Episode
  detectIntervalMinutes: 30,
  mergeThreshold: 0.8,
  maxMemoriesPerEpisode: 50,

  // Room Manager
  roomMergeThreshold: 10,
  roomSplitThreshold: 100,
  maxRecommendations: 5,
  roomSimilarityThreshold: 0.6,

  // Memory Room Mapping
  maxRoomsPerMemory: 5,
  maxMemoriesPerRoom: 1000,

  // Profile Service
  maxTagsPerUser: 50,
  preferenceMinInteractions: 10,
  preferenceConfidenceThreshold: 0.6,
  preferenceDecayFactor: 0.9,
  personaImportance: 8,
  personaScopeScore: 8,
  identityImportance: 9,
  identityScopeScore: 9,
  preferenceImportance: 7,
  preferenceScopeScore: 7,

  // Sentiment
  llmRefineThreshold: 0.6,
} as const;

/**
 * LLM 默认值
 */
export const LLMDefaults = {
  temperature: 0.7,
  maxTokens: 2000,
  timeout: 30000,
} as const;

/**
 * Embedding 默认值
 */
export const EmbeddingDefaults = {
  dimensions: 1536,
  batchSize: 32,
  timeout: 30000,
} as const;

/**
 * Streaming 默认值
 */
export const StreamingDefaults = {
  maxEventsPerStream: 1000,
  maxStreams: 100,
  maxSubscriptionsPerClient: 10,
  streamRetentionMs: 3600000,
} as const;

/**
 * 所有默认值统一导出
 */
export const ConfigDefaults = {
  ...Defaults,
  ...MemoryDefaults,
  ...LLMDefaults,
  ...EmbeddingDefaults,
  ...StreamingDefaults,
} as const;

/**
 * 默认值类型
 */
export type DefaultKey = keyof typeof ConfigDefaults;
