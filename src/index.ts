/**
 * OMMS-PRO - 融合记忆宫殿架构的记忆管理系统
 *
 * 主入口文件，整合所有模块，提供统一的对外接口
 *
 * @module omms-pro
 * @since 0.1.0
 */

// ========== 导入模块（用于内部类）==========
import { ConfigManager, config } from './shared/config';
import { ProfileManager } from './services/profile/profile-manager';
import { MemoryService } from './services/memory/index';
import { createLogger } from './shared/logging/context';
import type { ILogger } from './shared/logging/types';
import type { OMMSConfig } from './core/types/config';
import { CryptoUtils } from './shared/utils';
import { EmbeddingService } from './shared/embedding/embedding-service';
import { DreamingManager } from './services/dreaming/dreaming-manager';
import { createLLMExtractor } from './services/memory/llm/llm-extractor';
import { MemoryCaptureService } from './services/memory/capture/memory-capture-service';
import type { MemoryCaptureConfig } from './core/types/memory';

// Agent 系统
import { AgentContextProvider } from './shared/agents';

// 新存储模块
import { CacheManager } from './infrastructure/storage/stores/cache-manager';
import { VectorStore } from './infrastructure/storage/stores/vector-store';
import { SQLiteMetaStore } from './infrastructure/storage/stores/sqlite-meta-store';
import { PalaceStore } from './infrastructure/storage/stores/palace-store';
import { GraphStore } from './infrastructure/storage/stores/graph-store';

// ========== 导出配置模块 ==========
export { ConfigManager, ConfigLoader, ConfigValidator } from './shared/config';
export type { ConfigSource, ValidationResult } from './shared/config';

// ========== 导出日志模块 ==========
export { createLogger, Logger } from './shared/logging';
export type { ILogger, LogLevel, LogContext, ILogTransport } from './shared/logging';

// ========== 导出工具模块 ==========
export {
  IDGenerator,
  TimeUtils,
  StringUtils,
  ObjectUtils,
  ArrayUtils,
  MathUtils,
  CryptoUtils,
  FileUtils,
  RetryUtils,
  BatchUtils,
  JsonParser,
  configure,
} from './shared/utils';
export type {
  IDStrategy,
  IDGeneratorConfig,
} from './shared/utils';

// ========== 导出类型定义 ==========
export type {
  MemoryType,
  MemoryScope,
  MemoryBlock,
  Memory,
  MemoryInput,
  RecallResult,
  RecallOptions,
} from './core/types/memory';

// Export types from config
export type {
  OMMSConfig,
  LoggingConfig,
  EmbeddingConfig,
  MemoryServiceConfig,
  APIConfig,
} from './core/types/config';

// From graph
export type {
  GraphNodeRecord,
  GraphEdgeRecord,
  VectorSearchResult,
} from './infrastructure/storage/core/types';

// ========== 导出核心服务 ==========
export { MemoryService, MemoryCore } from './services/memory';
export { ProfileManager } from './services/profile';
export { DreamingManager } from './services/dreaming/dreaming-manager';

// ========== 导出新存储模块 ==========
export { CacheManager } from './infrastructure/storage/stores/cache-manager';
export { VectorStore } from './infrastructure/storage/stores/vector-store';
export { SQLiteMetaStore } from './infrastructure/storage/stores/sqlite-meta-store';
export { PalaceStore } from './infrastructure/storage/stores/palace-store';
export { GraphStore } from './infrastructure/storage/stores/graph-store';

// ========== 导出端口层 (Ports) ==========
export type {
  ICacheManager,
  IVectorStore,
  IMetaStore,
  IPalaceStore,
  IGraphStore,
  IEpisodeStore,
} from './core/ports/storage';
export type {
  IMemoryRepository,
  IMemoryRecallService,
  IMemoryVersionService,
  IMemoryConsolidationService,
} from './core/ports/memory';
export type {
  IDreamingService,
  DreamOptions,
  DreamReport,
  ConsolidationGroup,
  MemoryConsolidationResult,
} from './core/ports/dreaming';

// Re-export storage port types for convenience
export type {
  EpisodeRecord,
  EpisodeTimelineItem,
  VectorMetadata,
} from './core/ports/storage';

// ========== 导出API模块 ==========
export { RESTAPIServer, createRESTAPIServer } from './api';
import { createRESTAPIServer } from './api/server';

/**
 * OMMS 配置选项
 */
export interface OMMSOptions {
  configPath?: string;
  agentId?: string;
}

/**
 * OMMS 主类
 *
 * 注意：DreamingEngine 已接入，定时整理功能可用
 */
export class OMMS {
  public configManager!: ConfigManager;
  public memoryService!: MemoryService;
  public profileManager!: ProfileManager;
  public dreamingManager!: DreamingManager;
  public captureService: MemoryCaptureService | undefined;

  // 新存储模块实例
  public cacheManager!: CacheManager;
  public vectorStore!: VectorStore;
  public metaStore!: SQLiteMetaStore;
  public palaceStore!: PalaceStore;
  public graphStore!: GraphStore;

  // DreamingEngine 已在 DreamingManager 中完整实现
  // DreamingManager 是 DreamingEngine v2.0.0 的核心入口

  private logger: ILogger;
  private initialized: boolean = false;
  private embeddingService!: EmbeddingService;
  private embeddingConfig!: { model: string; dimensions: number; baseURL?: string; apiKey?: string; batchSize?: number; timeout?: number };

  constructor(options?: OMMSOptions) {
    this.logger = createLogger('OMMS', { module: 'main' });

    // 仅获取 ConfigManager 单例引用，不在构造函数中创建任何依赖 ConfigManager 的服务
    // 所有服务的创建延迟到 initialize() 中，确保 ConfigManager 已完成初始化
    this.configManager = ConfigManager.getInstance();

    this.logger.info('OMMS 实例创建完成（服务将在 initialize() 中初始化）');
  }

  /**
   * 初始化系统
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.warn('OMMS 已经初始化');
      return;
    }

    this.logger.info('开始初始化 OMMS 系统');

    // 1. 配置加载（必须最先执行，后续所有服务依赖配置）
    await this.configManager.initialize();

    // 2. 创建 EmbeddingService（ConfigManager 已初始化，可以安全读取配置）
    this.embeddingService = new EmbeddingService();
    this.embeddingConfig = this.embeddingService.getConfig();
    this.logger.info('[OMMS] Embedding service created', { model: this.embeddingConfig.model, dimensions: this.embeddingConfig.dimensions });

    // 3. 创建并初始化存储模块
    const cacheConfig = this.configManager.getConfig('memoryService.cache') as { maxSize?: number; ttl?: number } | undefined;
    this.cacheManager = new CacheManager({ maxSize: cacheConfig?.maxSize ?? 1000, ttl: cacheConfig?.ttl ?? 3600000 });
    this.vectorStore = new VectorStore();
    this.metaStore = new SQLiteMetaStore();
    this.palaceStore = new PalaceStore();
    this.graphStore = new GraphStore();

    await this.vectorStore.initialize();
    await this.metaStore.initialize();
    await this.palaceStore.initialize();
    await this.graphStore.initialize();
    this.logger.info('[OMMS] Storage modules initialized');

    // 3.5 创建 embedder 函数
    const embedder = async (text: string): Promise<number[]> => {
      try {
        return await this.embeddingService.embed(text);
      } catch (error) {
        this.logger.warn('Embedding failed, using fallback hash embedder', { error: String(error) });
        const hash = CryptoUtils.hash(text);
        return new Array(this.embeddingConfig.dimensions).fill(0).map((_, i) => hash.charCodeAt(i % hash.length) / 255);
      }
    };

    // 4. 创建记忆服务核心
    this.memoryService = new MemoryService(
      {
        cache: this.cacheManager,
        vectorStore: this.vectorStore,
        metaStore: this.metaStore,
        palaceStore: this.palaceStore,
        graphStore: this.graphStore,
      },
      embedder,
      undefined,
      {
        enableCache: true,
        enableVector: true,
        enableGraph: true,
        enableAccessControl: false,
      }
    );

    // 5. 创建用户画像管理器
    this.profileManager = new ProfileManager({ memoryService: this.memoryService });

    // 6. 创建 DreamingManager
    this.dreamingManager = new DreamingManager(
      this.memoryService,
      this.graphStore,
      this.palaceStore,
      this.metaStore,
      this.vectorStore
    );

    // 7. 初始化 Agent 系统（用于 LLM 上下文注入）
    // 从配置读取 agentsDir，如果未配置则使用默认值 './agents'
    const agentConfig = this.configManager.getConfig('agents') as { agentsDir?: string } | undefined;
    const agentContextProvider = new AgentContextProvider({
      agentsDir: agentConfig?.agentsDir ?? './agents',
      enabled: true,
      preload: true,
      logger: this.logger,
    });
    await agentContextProvider.preloadAgents();
    this.logger.info('[OMMS] Agent system initialized', { agentCount: agentContextProvider.getRegistry().getAgentCount() });

    // 8. 初始化 LLM Extractor（用于生成摘要和评分）
    try {
      const llmConfig = this.configManager.getConfig('memoryService.capture') as Partial<MemoryCaptureConfig> | undefined;
      if (llmConfig && llmConfig.llmProvider) {
        const extractor = createLLMExtractor({
          maxMemoriesPerCapture: llmConfig.maxMemoriesPerCapture ?? 5,
          similarityThreshold: llmConfig.similarityThreshold ?? 0.9,
          confidenceThreshold: llmConfig.confidenceThreshold ?? 0.5,
          enableLLMSummarization: llmConfig.enableLLMSummarization ?? true,
          llmProvider: llmConfig.llmProvider as 'anthropic' | 'openai' | 'custom',
          llmApiKey: llmConfig.llmApiKey,
          llmEndpoint: llmConfig.llmEndpoint,
          llmModel: llmConfig.llmModel,
        });

        // 设置 Agent 上下文提供器
        extractor.setAgentContextProvider(agentContextProvider);

        this.memoryService.setLLMExtractor(extractor);
        this.dreamingManager.setLLMExtractor(extractor);
        this.profileManager.setLLMExtractor(extractor);
        this.logger.info('[OMMS] LLM Extractor initialized', { provider: llmConfig.llmProvider });
      } else {
        this.logger.warn('[OMMS] No LLM provider configured, summary generation will use fallback truncation');
      }
    } catch (error) {
      this.logger.warn('[OMMS] Failed to initialize LLM Extractor, using fallback', { error: String(error) });
    }

    // 8.1 创建 MemoryCaptureService（用于 LLM 智能提取对话记忆）
    try {
      const versionManager = this.memoryService.getStoreManager().getVersionManager();
      const storeManager = this.memoryService.getStoreManager();
      const llmConfig = this.configManager.getConfig('memoryService.capture') as Partial<MemoryCaptureConfig> | undefined;

      this.captureService = new MemoryCaptureService(
        versionManager,
        storeManager,
        this.memoryService.getStoreManager().getLLMExtractor()!,
        llmConfig
      );

      // 设置 ProfileManager 用于自动用户画像分析
      if (this.profileManager) {
        this.captureService.setProfileManager(this.profileManager);
      }

      this.logger.info('[OMMS] MemoryCaptureService initialized');
    } catch (error) {
      this.logger.warn('[OMMS] Failed to initialize MemoryCaptureService', { error: String(error) });
    }

    // 9. 记忆服务初始化
    // 9.1 启动遗忘定时器（默认每24小时检查一次）
    this.memoryService.startDegradationTimer();
    this.logger.debug('MemoryService ready with degradation timer');

    // 10. 初始化 DreamingManager
    await this.dreamingManager.initialize();
    this.logger.debug('DreamingManager ready');

    this.initialized = true;
    this.logger.info('OMMS 系统初始化完成');
  }

  /**
   * 关闭系统
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger.info('开始关闭 OMMS 系统');

    // 先停止定时器
    this.dreamingManager.stopScheduler();
    this.memoryService.stopDegradationTimer();

    // MemoryService 不需要显式关闭
    await this.vectorStore.close();
    await this.metaStore.close();
    await this.palaceStore.close();
    await this.graphStore.close();

    this.initialized = false;
    this.logger.info('OMMS 系统已关闭');
  }

  /**
   * 检查系统是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// 导出默认值
export default OMMS;

// ========== 开发模式启动 ==========
// 当直接运行 src/index.ts 时，启动完整的 OMMS 系统
async function startServer(): Promise<void> {
  const logger = createLogger('OMMS', { module: 'main' });
  logger.info('Starting OMMS-PRO server...');

  // 创建 Express app 并挂载到 /api（与 UnifiedServer 保持一致）
  const express = await import('express');
  const app = express.default();

  // 创建存储实例（从配置读取，若配置未初始化则使用默认值）
  let cacheMaxSize = 1000;
  let cacheTtl = 3600000;
  try {
    const configMgr = ConfigManager.getInstance();
    if (configMgr.isInitialized()) {
      const cacheConfig = configMgr.getConfig('memoryService.cache') as { maxSize?: number; ttl?: number } | undefined;
      if (cacheConfig) {
        cacheMaxSize = cacheConfig.maxSize ?? cacheMaxSize;
        cacheTtl = cacheConfig.ttl ?? cacheTtl;
      }
    }
  } catch { }
  const cacheManager = new CacheManager({ maxSize: cacheMaxSize, ttl: cacheTtl });
  const metaStore = new SQLiteMetaStore();
  const palaceStore = new PalaceStore();
  const graphStore = new GraphStore();

  // 配置加载（必须在 VectorStore 初始化之前，确保 dimensions 正确）
  const configManager = ConfigManager.getInstance();
  await configManager.initialize();

  // Embedding 服务配置
  const embeddingService = new EmbeddingService();
  embeddingService.updateConfig({});
  const embeddingConfig = embeddingService.getConfig();

  // VectorStore 使用 embedding 配置的维度
  const vectorStore = new VectorStore({ dimensions: embeddingConfig.dimensions });
  await vectorStore.initialize();
  await metaStore.initialize();
  await palaceStore.initialize();
  await graphStore.initialize();

  // Embedding 服务
  const embedder = async (text: string): Promise<number[]> => {
    try {
      return await embeddingService.embed(text);
    } catch (error) {
      logger.warn('Embedding failed, using fallback', { error: String(error) });
      const hash = CryptoUtils.hash(text);
      return new Array(embeddingConfig.dimensions).fill(0).map((_, i) => hash.charCodeAt(i % hash.length) / 255);
    }
  };

  // 初始化 Agent 系统（用于 LLM 上下文注入）
  // 从配置读取 agentsDir，如果未配置则使用默认值 './agents'
  const agentConfig = config.getConfig('agents') as { agentsDir?: string } | undefined;
  const agentContextProvider = new AgentContextProvider({
    agentsDir: agentConfig?.agentsDir ?? './agents',
    enabled: true,
    preload: true,
    logger,
  });
  await agentContextProvider.preloadAgents();
  logger.info('Agent system initialized', { agentCount: agentContextProvider.getRegistry().getAgentCount() });

  // 记忆服务
  const memoryService = new MemoryService(
    { cache: cacheManager, vectorStore, metaStore, palaceStore, graphStore },
    embedder,
    undefined,
    { enableCache: true, enableVector: true, enableGraph: true }
  );

  // 画像管理器（注入 MemoryService 用于存储 PERSONA/PREFERENCE 记忆）
  const profileManager = new ProfileManager({ memoryService });

  // Dreaming 管理器
  const dreamingManager = new DreamingManager(memoryService, graphStore, palaceStore, metaStore, vectorStore);
  await dreamingManager.initialize();

  // LLM Extractor - 使用 llmExtraction 配置
  try {
    const llmConfig = configManager.getConfig('llmExtraction') as {
      provider?: string;
      model?: string;
      apiKey?: string;
      baseURL?: string;
    } | undefined;

    if (llmConfig?.provider && llmConfig?.apiKey && llmConfig?.baseURL) {
      const provider = llmConfig.provider === 'openai-compatible' ? 'custom' : llmConfig.provider as 'anthropic' | 'openai' | 'custom';
      logger.debug('About to call createLLMExtractor', { provider });
      const extractor = createLLMExtractor({
        maxMemoriesPerCapture: 5,
        similarityThreshold: 0.9,
        confidenceThreshold: 0.5,
        enableLLMSummarization: true,
        llmProvider: provider,
        llmApiKey: llmConfig.apiKey,
        llmEndpoint: llmConfig.baseURL,
        llmModel: llmConfig.model,
      });
      // 设置 Agent 上下文提供器
      extractor.setAgentContextProvider(agentContextProvider);
      logger.debug('LLM Extractor created, calling setLLMExtractor');
      try {
        memoryService.setLLMExtractor(extractor);
        dreamingManager.setLLMExtractor(extractor);
        profileManager.setLLMExtractor(extractor);
        logger.debug('setLLMExtractor completed');
        logger.info('LLM Extractor initialized', { provider: llmConfig.provider, model: llmConfig.model });
      } catch (e) {
        logger.error('setLLMExtractor failed', e instanceof Error ? e : new Error(String(e)));
      }
    } else {
      logger.debug('LLM not configured', { provider: llmConfig?.provider, hasApiKey: !!llmConfig?.apiKey, hasBaseURL: !!llmConfig?.baseURL });
      logger.warn('LLM Extractor not configured - missing provider, apiKey or baseURL');
    }
  } catch (error) {
    logger.error('Failed to initialize LLM Extractor', error instanceof Error ? error : new Error(String(error)));
    logger.warn('Failed to initialize LLM Extractor', { error: String(error) });
  }

  // MemoryCaptureService - 用于 LLM 智能提取对话记忆
  let captureService: MemoryCaptureService | undefined;
  try {
    const storeManager = memoryService.getStoreManager();
    const versionManager = storeManager.getVersionManager();
    const llmExtractor = storeManager.getLLMExtractor();
    const captureConfig = configManager.getConfig('memoryService.capture') as Partial<MemoryCaptureConfig> | undefined;

    if (llmExtractor) {
      captureService = new MemoryCaptureService(
        versionManager,
        storeManager,
        llmExtractor,
        captureConfig
      );
      // 设置 ProfileManager 用于自动用户画像分析
      captureService.setProfileManager(profileManager);
      logger.info('[startServer] MemoryCaptureService initialized');
    } else {
      logger.warn('[startServer] LLM Extractor not available for MemoryCaptureService');
    }
  } catch (error) {
    logger.error('Failed to initialize MemoryCaptureService', error instanceof Error ? error : new Error(String(error)));
    logger.warn('[startServer] Failed to initialize MemoryCaptureService', { error: String(error) });
  }

  // 创建并启动 API 服务器（挂载到 /api，与 UnifiedServer 保持一致）
  const apiServer = createRESTAPIServer({
    deps: {
      memoryService,
      captureService,
      profileManager,
      dreamingManager,
      graphStore,
    },
  });

  // 使用 Express app 挂载 API（与 UnifiedServer 一致）
  app.use('/api', apiServer.getApp());

  // 提供 Web UI 静态文件
  const pathModule = await import('path');
  const webUIPath = pathModule.join(process.cwd(), 'dist/web-ui');
  app.use(express.static(webUIPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(pathModule.join(webUIPath, 'index.html'), (err) => {
      if (err) next();
    });
  });

  // 启动 HTTP 服务器
  const http = await import('http');
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(3000, '0.0.0.0', () => {
      logger.info('OMMS-PRO server started successfully');
      logger.info('API available at http://localhost:3000/api/v1');
      resolve();
    });
    server.on('error', reject);
  });
}

// 如果直接运行此文件，则启动服务器
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((error) => {
    console.error('Failed to start OMMS-PRO server:', error);
    process.exit(1);
  });
}
