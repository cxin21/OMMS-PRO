/**
 * ChatMLAdapter - ChatML 格式适配器
 *
 * 将记忆格式化为 ChatML 格式
 * - 系统提示词模板
 * - 记忆上下文注入
 * - 对话历史管理
 *
 * @module api/chatml-adapter
 */

import { createLogger } from '../shared/logging';
import type { ILogger } from '../shared/logging';
import { IDGenerator } from '../shared/utils/id-generator';
import { PromptLoader } from '../shared/prompts';

export interface ChatMLMessage {
  /** 角色 */
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** 内容 */
  content: string;
  /** 名称 (可选) */
  name?: string;
  /** 工具调用 (可选) */
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  /** 工具结果 (可选) */
  tool_call_id?: string;
}

export interface ChatMLPromptOptions {
  /** 系统提示词模板 */
  systemTemplate?: string;
  /** 记忆注入位置 */
  memoryInjectionPosition?: 'system' | 'assistant' | 'both';
  /** 最大记忆数 */
  maxMemories?: number;
  /** 最大记忆 token 数 */
  maxMemoryTokens?: number;
  /** 包含记忆元数据 */
  includeMemoryMetadata?: boolean;
  /** 包含重要性分数 */
  includeImportanceScore?: boolean;
  /** 格式化风格 */
  formatStyle?: 'concise' | 'detailed' | 'structured';
}

export interface MemoryContext {
  uid: string;
  content: string;
  summary?: string;
  type: string;
  scope: string;
  importance: number;
  tags?: string[];
  createdAt?: number;
  agentId?: string;
  sessionId?: string;
  palaceLocation?: {
    wing?: string;
    hall?: string;
    room?: string;
  };
  version?: number;
}

export interface ChatMLTemplate {
  /** 模板 ID */
  id: string;
  /** 模板名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 记忆注入格式 */
  memoryFormat: string;
  /** 创建时间 */
  createdAt: number;
}

/**
 * ChatMLAdapter - ChatML 格式适配器
 *
 * 将记忆转换为 ChatML 格式，支持多种模板和格式化风格
 */
export class ChatMLAdapter {
  private logger: ILogger;
  private promptLoader = PromptLoader.getInstance();

  // Default templates
  private templates: Map<string, ChatMLTemplate> = new Map();

  constructor(
    private config?: {
      defaultTemplate?: string;
      customTemplates?: ChatMLTemplate[];
    }
  ) {
    this.logger = createLogger('ChatMLAdapter');

    // Initialize default templates
    this.initializeDefaultTemplates();

    // Add custom templates
    if (config?.customTemplates) {
      for (const template of config.customTemplates) {
        this.templates.set(template.id, template);
      }
    }
  }

  /**
   * 初始化默认模板
   */
  private initializeDefaultTemplates(): void {
    const defaultTemplates: ChatMLTemplate[] = [
      {
        id: 'default',
        name: 'Default',
        description: 'Default template with basic memory formatting',
        systemPrompt: this.promptLoader.load('prompts/chatml-default.md'),
        memoryFormat: '[{type}] {content}\n- Importance: {importance}/10\n- Scope: {scope}',
        createdAt: Date.now()
      },
      {
        id: 'detailed',
        name: 'Detailed',
        description: 'Detailed template with full metadata',
        systemPrompt: this.promptLoader.load('prompts/chatml-detailed.md'),
        memoryFormat: `## {summary}
Content: {content}
Type: {type} | Scope: {scope} | Importance: {importance}/10
Tags: {tags}
Created: {createdAt}
Version: {version}`,
        createdAt: Date.now()
      },
      {
        id: 'concise',
        name: 'Concise',
        description: 'Concise template for limited context windows',
        systemPrompt: this.promptLoader.load('prompts/chatml-concise.md'),
        memoryFormat: '[{importance}★] {content}',
        createdAt: Date.now()
      },
      {
        id: 'agent',
        name: 'Agent Mode',
        description: 'Template for agent-style interactions',
        systemPrompt: this.promptLoader.load('prompts/chatml-agent.md'),
        memoryFormat: `[{type}:{scope}] {content} ({importance}/10)`,
        createdAt: Date.now()
      },
      {
        id: 'question_answering',
        name: 'Question Answering',
        description: 'Template optimized for question answering',
        systemPrompt: `You are a knowledgeable AI assistant. Use the provided memories to answer questions accurately.

## Relevant Memories
{memories}

## Instructions
- Base your answer primarily on the provided memories
- If memories don't contain enough information, say so
- Cite the memory source when making specific claims`,
        memoryFormat: `Memory: {content}
- Type: {type}, Importance: {importance}/10
Source: {agentId}`,
        createdAt: Date.now()
      }
    ];

    for (const template of defaultTemplates) {
      this.templates.set(template.id, template);
    }
  }

  /**
   * 创建聊天完成消息
   */
  createChatCompletion(messages: ChatMLMessage[]): {
    model: string;
    messages: ChatMLMessage[];
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
  } {
    return {
      model: 'omms-pro',
      messages,
      stream: false
    };
  }

  /**
   * 创建流式聊天完成消息
   */
  createStreamingChatCompletion(messages: ChatMLMessage[]): {
    model: string;
    messages: ChatMLMessage[];
    stream: boolean;
    temperature?: number;
    max_tokens?: number;
  } {
    return {
      model: 'omms-pro',
      messages,
      stream: true
    };
  }

  /**
   * 格式化记忆为 ChatML 消息
   */
  formatMemoryAsMessage(
    memory: MemoryContext,
    options?: {
      role?: 'system' | 'user' | 'assistant';
      templateId?: string;
      formatStyle?: 'concise' | 'detailed' | 'structured';
    }
  ): ChatMLMessage {
    const templateId = options?.templateId || 'default';
    const template = this.templates.get(templateId) || this.templates.get('default')!;
    const formatStyle = options?.formatStyle || 'concise';

    let content: string;

    switch (formatStyle) {
      case 'detailed':
        content = this.formatMemoryDetailed(memory, template.memoryFormat);
        break;
      case 'structured':
        content = this.formatMemoryStructured(memory);
        break;
      case 'concise':
      default:
        content = this.formatMemoryConcise(memory, template.memoryFormat);
        break;
    }

    return {
      role: options?.role || 'system',
      content
    };
  }

  /**
   * 格式化记忆列表
   */
  formatMemories(
    memories: MemoryContext[],
    options?: ChatMLPromptOptions
  ): string {
    const {
      maxMemories = 10,
      maxMemoryTokens = 2000,
      includeMemoryMetadata = true,
      includeImportanceScore = true,
      formatStyle = 'concise'
    } = options || {};

    // Sort by importance (highest first)
    const sortedMemories = [...memories].sort((a, b) => b.importance - a.importance);

    // Apply limits
    const limitedMemories = sortedMemories.slice(0, maxMemories);

    // Format each memory
    const formatted = limitedMemories.map(memory => {
      if (formatStyle === 'structured') {
        return this.formatMemoryStructured(memory);
      } else if (formatStyle === 'detailed') {
        return this.formatMemoryDetailed(memory, '[{type}] {content}\n  Importance: {importance}/10\n  Tags: {tags}');
      } else {
        return `[${memory.type}] ${memory.content}${includeImportanceScore ? ` (${memory.importance}/10)` : ''}`;
      }
    });

    // Calculate total tokens (rough estimate: 4 chars = 1 token)
    let totalChars = formatted.join('\n').length;
    let usedMemories = limitedMemories;

    // Trim if too many tokens
    while (totalChars > maxMemoryTokens * 4 && usedMemories.length > 1) {
      usedMemories = usedMemories.slice(0, -1);
      const trimmed = usedMemories.map(m => {
        if (formatStyle === 'structured') {
          return this.formatMemoryStructured(m);
        } else if (formatStyle === 'detailed') {
          return this.formatMemoryDetailed(m, '[{type}] {content}\n  Importance: {importance}/10\n  Tags: {tags}');
        } else {
          return `[${m.type}] ${m.content}${includeImportanceScore ? ` (${m.importance}/10)` : ''}`;
        }
      });
      totalChars = trimmed.join('\n').length;
    }

    return usedMemories.map((m, i) => {
      if (formatStyle === 'structured') {
        return this.formatMemoryStructured(m);
      } else if (formatStyle === 'detailed') {
        return this.formatMemoryDetailed(m, '[{type}] {content}\n  Importance: {importance}/10\n  Tags: {tags}');
      } else {
        return `[${m.type}] ${m.content}${includeImportanceScore ? ` (${m.importance}/10)` : ''}`;
      }
    }).join('\n');
  }

  /**
   * 构建带记忆的提示词
   */
  buildPromptWithMemories(
    conversation: ChatMLMessage[],
    memories: MemoryContext[],
    options?: ChatMLPromptOptions & {
      prependSystemPrompt?: boolean;
    }
  ): ChatMLMessage[] {
    const {
      systemTemplate,
      prependSystemPrompt = true,
      maxMemories = 10,
      formatStyle = 'concise'
    } = options || {};

    const result: ChatMLMessage[] = [];

    // Add system prompt with memories
    if (prependSystemPrompt) {
      const systemPrompt = systemTemplate || this.templates.get('default')!.systemPrompt;
      const formattedMemories = this.formatMemories(memories, {
        maxMemories,
        formatStyle
      });

      result.push({
        role: 'system',
        content: systemPrompt.replace('{memories}', formattedMemories)
      });
    }

    // Add conversation messages
    result.push(...conversation);

    return result;
  }

  /**
   * 提取消息中的记忆引用
   */
  extractMemoryReferences(message: ChatMLMessage): string[] {
    const references: string[] = [];
    const regex = /\[memory:([a-zA-Z0-9_-]+)\]/g;
    let match;

    while ((match = regex.exec(message.content)) !== null) {
      references.push(match[1]);
    }

    return references;
  }

  /**
   * 添加记忆引用到消息
   */
  addMemoryReference(message: ChatMLMessage, memoryId: string): ChatMLMessage {
    return {
      ...message,
      content: `${message.content} [memory:${memoryId}]`
    };
  }

  /**
   * 创建模板
   */
  async createTemplate(template: Omit<ChatMLTemplate, 'id' | 'createdAt'>): Promise<ChatMLTemplate> {
    const fullTemplate: ChatMLTemplate = {
      ...template,
      id: IDGenerator.unique('template'),
      createdAt: Date.now()
    };

    this.templates.set(fullTemplate.id, fullTemplate);
    this.logger.info('ChatML template created', { templateId: fullTemplate.id });

    return fullTemplate;
  }

  /**
   * 获取模板
   */
  async getTemplate(templateId: string): Promise<ChatMLTemplate | null> {
    return this.templates.get(templateId) || null;
  }

  /**
   * 获取所有模板
   */
  async getAllTemplates(): Promise<ChatMLTemplate[]> {
    return Array.from(this.templates.values());
  }

  /**
   * 更新模板
   */
  async updateTemplate(templateId: string, updates: Partial<ChatMLTemplate>): Promise<boolean> {
    const template = this.templates.get(templateId);
    if (!template) return false;

    Object.assign(template, updates);
    this.logger.debug('ChatML template updated', { templateId });
    return true;
  }

  /**
   * 删除模板
   */
  async deleteTemplate(templateId: string): Promise<boolean> {
    // Prevent deleting default templates
    if (['default', 'detailed', 'concise', 'agent', 'question_answering'].includes(templateId)) {
      this.logger.warn('Cannot delete default template', { templateId });
      return false;
    }

    return this.templates.delete(templateId);
  }

  // Private formatting methods

  private formatMemoryConcise(memory: MemoryContext, format: string): string {
    return format
      .replace('{type}', memory.type)
      .replace('{content}', memory.content)
      .replace('{importance}', String(memory.importance))
      .replace('{scope}', memory.scope)
      .replace('{tags}', memory.tags?.join(', ') || '');
  }

  private formatMemoryDetailed(memory: MemoryContext, format: string): string {
    const createdAt = memory.createdAt
      ? new Date(memory.createdAt).toISOString()
      : 'unknown';

    return format
      .replace('{type}', memory.type)
      .replace('{content}', memory.content)
      .replace('{summary}', memory.summary || memory.content.slice(0, 100))
      .replace('{importance}', String(memory.importance))
      .replace('{scope}', memory.scope)
      .replace('{tags}', memory.tags?.join(', ') || 'none')
      .replace('{createdAt}', createdAt)
      .replace('{version}', String(memory.version || 1))
      .replace('{agentId}', memory.agentId || 'unknown');
  }

  private formatMemoryStructured(memory: MemoryContext): string {
    const parts: string[] = [
      `# Memory: ${memory.summary || memory.content.slice(0, 50)}...`,
      `**UID:** ${memory.uid}`,
      `**Type:** ${memory.type}`,
      `**Scope:** ${memory.scope}`,
      `**Importance:** ${'★'.repeat(Math.round(memory.importance / 2))}${'☆'.repeat(5 - Math.round(memory.importance / 2))} (${memory.importance}/10)`
    ];

    if (memory.tags && memory.tags.length > 0) {
      parts.push(`**Tags:** ${memory.tags.join(', ')}`);
    }

    if (memory.palaceLocation) {
      const { wing, hall, room } = memory.palaceLocation;
      if (wing || hall || room) {
        parts.push(`**Location:** ${[wing, hall, room].filter(Boolean).join(' > ')}`);
      }
    }

    parts.push(`**Content:**\n${memory.content}`);

    return parts.join('\n');
  }
}