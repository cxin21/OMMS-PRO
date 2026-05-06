/**
 * Config Paths - 配置路径常量
 * 防止散落硬编码字符串，所有配置路径必须通过此处访问
 */

/**
 * 完整配置路径映射
 */
export const ConfigPaths = {
  // Memory Service 子配置路径
  memory: {
    capture: 'memoryService.capture',
    store: 'memoryService.store',
    recall: 'memoryService.recall',
    version: 'memoryService.version',
    degradation: 'memoryService.degradation',
    consolidation: 'memoryService.consolidation',
    topic: 'memoryService.topic',
    inclusion: 'memoryService.inclusion',
    sentiment: 'memoryService.sentiment',
    reinforcement: 'memoryService.reinforcement',
    cache: 'memoryService.cache',
    episode: 'memoryService.episode',
    spatial: 'memoryService.spatial',
    roomManager: 'memoryService.roomManager',
    memoryRoomMapping: 'memoryService.memoryRoomMapping',
    accessControl: 'memoryService.accessControl',
    indexUpdate: 'memoryService.indexUpdate',
    recallStrategy: 'memoryService.recallStrategy',
    webhook: 'memoryService.webhook',
    storage: 'memoryService.storage',
    profileService: 'memoryService.profileService',
    logging: 'memoryService.logging',
    forget: 'memoryService.forget',
    scopeDegradation: 'memoryService.scopeDegradation',
    llmExtractor: 'memoryService.llmExtractor',
  },

  // LLM 相关配置路径
  llm: {
    extraction: 'llmExtraction',
    extractor: 'memoryService.llmExtractor',
  },

  // Embedding 配置路径
  embedding: 'embedding',

  // Agent 系统配置路径
  agentsDir: 'agentsDir',

  // API 配置路径
  api: 'api',

  // MCP 配置路径
  mcp: 'mcp',

  // Logging 配置路径
  logging: 'logging',

  // Streaming 配置路径
  streaming: 'streaming',

  // Dreaming Engine 配置路径
  dreamingEngine: 'dreamingEngine',

} as const;

/**
 * 配置路径类型（用于安全访问）
 */
export type ConfigPath = typeof ConfigPaths[keyof typeof ConfigPaths];
export type MemoryConfigPath = typeof ConfigPaths.memory[keyof typeof ConfigPaths.memory];
