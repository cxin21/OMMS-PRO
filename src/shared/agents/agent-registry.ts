/**
 * Agent Registry - Agent 注册与发现
 * @module agents/agent-registry
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentDefinition, AgentType, IAgentRegistry, AgentConfig } from './types';
import { AGENT_TYPE_MAP, AGENT_TO_DIR, DEFAULT_AGENT_CONFIG } from './types';
import { parseAgentMarkdown, getAllAgentDirs, inferAgentType } from './utils';
import { createLogger } from '../logging';
import type { ILogger } from '../logging';

/**
 * Agent 注册器实现
 * 负责加载和管理所有 Agent 定义
 */
export class AgentRegistry implements IAgentRegistry {
  private agents: Map<AgentType, AgentDefinition> = new Map();
  private logger: ILogger;
  private config: Required<AgentConfig>;

  constructor(config: AgentConfig = {}) {
    this.config = {
      ...DEFAULT_AGENT_CONFIG,
      ...config,
    };
    this.logger = this.config.logger || createLogger('agent-registry');
  }

  /**
   * 注册 Agent 定义
   */
  registerAgent(agent: AgentDefinition): void {
    if (this.agents.has(agent.type)) {
      this.logger.warn(`Agent ${agent.type} is already registered, overwriting`);
    }
    this.agents.set(agent.type, agent);
    this.logger.debug(`Registered agent: ${agent.type}`, { name: agent.name });
  }

  /**
   * 获取 Agent 定义
   */
  getAgent(type: AgentType): AgentDefinition | undefined {
    return this.agents.get(type);
  }

  /**
   * 获取所有已注册的 Agent
   */
  getAllAgents(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /**
   * 检查 Agent 是否已注册
   */
  hasAgent(type: AgentType): boolean {
    return this.agents.has(type);
  }

  /**
   * 预加载所有 Agent 定义
   */
  async preloadAgents(): Promise<void> {
    const agentsDir = this.config.agentsDir;

    if (!fs.existsSync(agentsDir)) {
      this.logger.warn(`Agents directory not found: ${agentsDir}`);
      return;
    }

    this.logger.info(`Loading agents from: ${agentsDir}`);

    // 加载共享指南
    const sharedGuidelines = await this.loadSharedGuidelines();

    // 加载各个 Agent 目录
    const agentDirs = getAllAgentDirs(agentsDir);

    for (const dirName of agentDirs) {
      const agentType = inferAgentType(dirName);
      if (!agentType) {
        this.logger.debug(`Skipping non-agent directory: ${dirName}`);
        continue;
      }

      const agentPath = path.join(agentsDir, dirName, 'Agent.md');
      try {
        if (fs.existsSync(agentPath)) {
          const content = fs.readFileSync(agentPath, 'utf-8');
          let definition = parseAgentMarkdown(content, agentType);

          // 注入共享指南
          if (sharedGuidelines && definition.guidelines.length > 0) {
            definition.guidelines = [...sharedGuidelines, ...definition.guidelines];
          }

          this.registerAgent(definition);
          this.logger.debug(`Loaded agent: ${dirName}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to load agent from ${agentPath}`, { error: String(error) });
      }
    }

    this.logger.info(`Loaded ${this.agents.size} agents`);
  }

  /**
   * 加载共享指南
   */
  private async loadSharedGuidelines(): Promise<string[]> {
    const sharedPath = path.join(this.config.agentsDir, '_shared', 'SharedGuidelines.md');

    try {
      if (fs.existsSync(sharedPath)) {
        const content = fs.readFileSync(sharedPath, 'utf-8');
        // 解析共享指南，提取所有列表项
        const lines = content.split('\n');
        const guidelines: string[] = [];

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('- ')) {
            guidelines.push(trimmed.replace(/^-\s*/, ''));
          }
        }

        this.logger.debug(`Loaded ${guidelines.length} shared guidelines`);
        return guidelines;
      }
    } catch (error) {
      this.logger.warn('Failed to load shared guidelines', { error: String(error) });
    }

    return [];
  }

  /**
   * 从文件重新加载特定 Agent
   */
  async reloadAgent(agentType: AgentType): Promise<void> {
    const agentsDir = this.config.agentsDir;
    const agentDir = AGENT_TO_DIR[agentType];
    const agentPath = path.join(agentsDir, agentDir, 'Agent.md');

    if (!fs.existsSync(agentPath)) {
      this.logger.warn(`Agent file not found: ${agentPath}`);
      return;
    }

    try {
      const content = fs.readFileSync(agentPath, 'utf-8');
      const definition = parseAgentMarkdown(content, agentType);
      this.registerAgent(definition);
      this.logger.info(`Reloaded agent: ${agentType}`);
    } catch (error) {
      this.logger.error(`Failed to reload agent ${agentType}`, { error: String(error) });
    }
  }

  /**
   * 获取已注册的 Agent 数量
   */
  getAgentCount(): number {
    return this.agents.size;
  }

  /**
   * 清除所有注册的 Agent
   */
  clear(): void {
    this.agents.clear();
    this.logger.debug('Cleared all registered agents');
  }
}
