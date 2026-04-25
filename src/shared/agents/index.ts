/**
 * Agent System - Agent 上下文注入系统
 * @module agents
 *
 * 提供 LLM 调用时的 Agent 上下文注入功能
 *
 * 用法:
 * ```typescript
 * import { AgentContextProvider, AgentType } from './agents';
 *
 * const provider = new AgentContextProvider({ agentsDir: './agents' });
 * await provider.preloadAgents();
 *
 * // 在 LLM 调用时获取上下文
 * const context = await provider.getAgentContext(AgentType.MEMORY_CAPTURE, {
 *   userId: 'user123',
 *   sessionId: 'session456'
 * });
 *
 * // 将 context.systemPrompt 注入到 LLM 调用
 * const response = await llm.call(context.systemPrompt + '\n\n' + userPrompt);
 * ```
 */

export {
  AgentType,
  type AgentRuntimeContext,
  type AgentDefinition,
  type AgentContext,
  type IAgentRegistry,
  type IAgentContextProvider,
  type AgentConfig,
  DEFAULT_AGENT_CONFIG,
  AGENT_TYPE_MAP,
  AGENT_TO_DIR,
} from './types';

export {
  AgentRegistry,
} from './agent-registry';

export {
  AgentContextProvider,
} from './agent-context';

export {
  parseAgentMarkdown,
  buildSystemPrompt,
  loadAgentFile,
  replaceTemplateVariables,
  inferAgentType,
  getAllAgentDirs,
  isValidAgentDefinition,
} from './utils';
