/**
 * Agent System Types - Agent 系统核心类型定义
 * @module agents/types
 */

import type { ILogger } from '../logging';
import { config } from '../config';

/**
 * Agent 类型枚举 - 对应每个 LLM 调用方
 */
export enum AgentType {
  MEMORY_CAPTURE = 'MemoryCapture',
  MEMORY_STORE = 'MemoryStore',
  CONSOLIDATION = 'Consolidation',
  DREAMING = 'Dreaming',
  MEMORY_MERGE = 'MemoryMerge',
  MEMORY_INCLUSION = 'MemoryInclusion',
  PERSONA = 'Persona',
}

/**
 * Agent 运行时上下文 - 动态注入到 Agent 的变量
 */
export interface AgentRuntimeContext {
  userId?: string;
  sessionId?: string;
  agentId?: string;
  preferences?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Agent 定义 - 从 Agent.md 解析而来
 */
export interface AgentDefinition {
  type: AgentType;
  name: string;
  role: string;
  responsibilities: string[];
  guidelines: string[];
  outputFormat: string[];
  contextVariables: string[];
}

/**
 * Agent 上下文 - 用于 LLM 调用的完整上下文
 */
export interface AgentContext {
  type: AgentType;
  systemPrompt: string;
  definition: AgentDefinition;
  runtimeContext: AgentRuntimeContext;
}

/**
 * Agent 注册器接口
 */
export interface IAgentRegistry {
  registerAgent(agent: AgentDefinition): void;
  getAgent(type: AgentType): AgentDefinition | undefined;
  getAllAgents(): AgentDefinition[];
  hasAgent(type: AgentType): boolean;
}

/**
 * Agent 上下文提供器接口
 */
export interface IAgentContextProvider {
  getAgentContext(
    agentType: AgentType,
    runtimeContext?: AgentRuntimeContext
  ): Promise<AgentContext>;

  getAgentDefinition(agentType: AgentType): AgentDefinition | undefined;

  preloadAgents(): Promise<void>;

  invalidateCache(agentType?: AgentType): void;
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  /**
   * Agent 定义文件所在目录
   * 默认为项目根目录下的 agents/
   */
  agentsDir?: string;

  /**
   * 是否启用 Agent 上下文
   * 默认为 true
   */
  enabled?: boolean;

  /**
   * 是否预加载所有 Agent
   * 默认为 true
   */
  preload?: boolean;

  /**
   * 日志记录器
   */
  logger?: ILogger;
}

/**
 * Agent 系统配置
 */
export function getDefaultAgentConfig(): Required<AgentConfig> {
  // 优先从 ConfigManager 读取，否则使用硬编码默认值
  try {
    if (config.isInitialized()) {
      const agentConfig = config.getConfig<{ agentsDir?: string }>('agents');
      if (agentConfig?.agentsDir) {
        return {
          agentsDir: agentConfig.agentsDir,
          enabled: true,
          preload: true,
          logger: undefined as any,
        };
      }
    }
  } catch {
    // ConfigManager 未初始化或配置不存在
  }

  // 使用硬编码默认值（agentsDir 不在 default config 中）
  return {
    agentsDir: './agents',
    enabled: true,
    preload: true,
    logger: undefined as any,
  };
}

// 保留向后兼容的常量，但标记为 deprecated
/**
 * @deprecated Use getDefaultAgentConfig() instead
 */
export const DEFAULT_AGENT_CONFIG: Required<AgentConfig> = {
  agentsDir: './agents',
  enabled: true,
  preload: true,
  logger: undefined as any,
};

/**
 * Agent 目录到类型的映射
 */
export const AGENT_TYPE_MAP: Record<string, AgentType> = {
  'MemoryCapture': AgentType.MEMORY_CAPTURE,
  'MemoryStore': AgentType.MEMORY_STORE,
  'Consolidation': AgentType.CONSOLIDATION,
  'Dreaming': AgentType.DREAMING,
  'MemoryMerge': AgentType.MEMORY_MERGE,
  'MemoryInclusion': AgentType.MEMORY_INCLUSION,
  'Persona': AgentType.PERSONA,
};

/**
 * Agent 到目录的映射
 */
export const AGENT_TO_DIR: Record<AgentType, string> = {
  [AgentType.MEMORY_CAPTURE]: 'MemoryCapture',
  [AgentType.MEMORY_STORE]: 'MemoryStore',
  [AgentType.CONSOLIDATION]: 'Consolidation',
  [AgentType.DREAMING]: 'Dreaming',
  [AgentType.MEMORY_MERGE]: 'MemoryMerge',
  [AgentType.MEMORY_INCLUSION]: 'MemoryInclusion',
  [AgentType.PERSONA]: 'Persona',
};
