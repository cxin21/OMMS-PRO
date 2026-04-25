/**
 * Agent Context - 上下文加载、缓存与注入
 * @module agents/agent-context
 */

import type {
  AgentContext,
  AgentDefinition,
  AgentRuntimeContext,
  IAgentContextProvider,
  AgentConfig,
} from './types';
import { AgentType, DEFAULT_AGENT_CONFIG } from './types';
import { AgentRegistry } from './agent-registry';
import { buildSystemPrompt } from './utils';
import { createLogger } from '../logging';
import type { ILogger } from '../logging';

/**
 * Agent 上下文缓存项
 */
interface CachedAgentContext {
  context: AgentContext;
  cachedAt: number;
}

/**
 * Agent 上下文提供器实现
 * 负责加载 Agent 上下文并提供缓存
 */
export class AgentContextProvider implements IAgentContextProvider {
  private registry: AgentRegistry;
  private cache: Map<AgentType, CachedAgentContext> = new Map();
  private config: Required<AgentConfig>;
  private logger: ILogger;
  private preloaded: boolean = false;

  constructor(config: AgentConfig = {}) {
    this.config = {
      ...DEFAULT_AGENT_CONFIG,
      ...config,
    };
    this.logger = this.config.logger || createLogger('agent-context');
    this.registry = new AgentRegistry(this.config);
  }

  /**
   * 获取 Agent 上下文
   * 如果提供了运行时上下文，会替换模板变量
   */
  async getAgentContext(
    agentType: AgentType,
    runtimeContext?: AgentRuntimeContext
  ): Promise<AgentContext> {
    // 如果 Agent 未启用，直接返回空上下文
    if (!this.config.enabled) {
      return this.createEmptyContext(agentType);
    }

    // 确保 Agent 已预加载
    if (!this.preloaded) {
      await this.preloadAgents();
    }

    // 获取 Agent 定义
    const definition = this.registry.getAgent(agentType);
    if (!definition) {
      this.logger.warn(`Agent not found: ${agentType}, using empty context`);
      return this.createEmptyContext(agentType);
    }

    // 构建系统提示词
    const systemPrompt = buildSystemPrompt(definition, runtimeContext);

    return {
      type: agentType,
      systemPrompt,
      definition,
      runtimeContext: runtimeContext || {},
    };
  }

  /**
   * 获取 Agent 定义（不包含上下文）
   */
  getAgentDefinition(agentType: AgentType): AgentDefinition | undefined {
    return this.registry.getAgent(agentType);
  }

  /**
   * 预加载所有 Agent 定义
   */
  async preloadAgents(): Promise<void> {
    if (this.preloaded) {
      return;
    }

    try {
      await this.registry.preloadAgents();
      this.preloaded = true;
      this.logger.info(`Preloaded ${this.registry.getAgentCount()} agents`);
    } catch (error) {
      this.logger.error('Failed to preload agents', { error: String(error) });
    }
  }

  /**
   * 使缓存失效
   */
  invalidateCache(agentType?: AgentType): void {
    if (agentType) {
      this.cache.delete(agentType);
      this.logger.debug(`Invalidated cache for agent: ${agentType}`);
    } else {
      this.cache.clear();
      this.logger.debug('Invalidated all agent caches');
    }
  }

  /**
   * 获取缓存的上下文（如果有）
   */
  getCachedContext(agentType: AgentType): AgentContext | undefined {
    const cached = this.cache.get(agentType);
    if (cached) {
      return cached.context;
    }
    return undefined;
  }

  /**
   * 创建空上下文（当 Agent 未找到或未启用时使用）
   */
  private createEmptyContext(agentType: AgentType): AgentContext {
    return {
      type: agentType,
      systemPrompt: '',
      definition: {
        type: agentType,
        name: agentType,  // AgentType is the string value itself
        role: '',
        responsibilities: [],
        guidelines: [],
        outputFormat: [],
        contextVariables: [],
      },
      runtimeContext: {},
    };
  }

  /**
   * 获取 Agent Registry（用于直接访问 Agent 定义）
   */
  getRegistry(): AgentRegistry {
    return this.registry;
  }

  /**
   * 检查是否已预加载
   */
  isPreloaded(): boolean {
    return this.preloaded;
  }

  /**
   * 获取已缓存的 Agent 数量
   */
  getCachedCount(): number {
    return this.cache.size;
  }

  /**
   * 设置是否启用 Agent 上下文
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (!enabled) {
      this.cache.clear();
    }
    this.logger.info(`Agent context ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 检查是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}
