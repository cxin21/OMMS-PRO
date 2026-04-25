/**
 * Plugin Base - 插件基类和接口定义
 *
 * @module presentation/plugins/base
 */

/**
 * 插件生命周期状态
 */
export enum PluginState {
  UNINSTALLED = 'uninstalled',
  INSTALLED = 'installed',
  ENABLED = 'enabled',
  DISABLED = 'disabled',
  ERROR = 'error',
}

/**
 * 插件元信息
 */
export interface PluginManifest {
  /** 插件唯一标识 */
  id: string;
  /** 插件名称 */
  name: string;
  /** 版本号 */
  version: string;
  /** 描述 */
  description: string;
  /** 作者 */
  author?: string;
  /** 插件类型 */
  type: PluginType;
  /** 入口文件 */
  entry?: string;
  /** 依赖插件 */
  dependencies?: string[];
  /** 配置项 */
  configFields?: ConfigField[];
  /** 生命周期钩子 */
  hooks?: HookDefinition[];
  /** MCP 工具 */
  tools?: ToolDefinition[];
}

/**
 * 插件类型
 */
export enum PluginType {
  /** Claude Code 插件 */
  CLAUDE = 'claude',
  /** VS Code 扩展 */
  VSCODE = 'vscode',
  /** 通用插件 */
  GENERIC = 'generic',
}

/**
 * 配置字段定义
 */
export interface ConfigField {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  default?: unknown;
  description?: string;
  required?: boolean;
}

/**
 * 钩子定义
 */
export interface HookDefinition {
  name: string;
  event: HookEvent;
  priority?: number;
}

/**
 * 钩子事件类型
 */
export enum HookEvent {
  SESSION_START = 'SessionStart',
  SESSION_END = 'SessionEnd',
  USER_PROMPT_SUBMIT = 'UserPromptSubmit',
  ASSISTANT_RESPONSE = 'AssistantResponse',
  MEMORY_CAPTURE = 'MemoryCapture',
  MEMORY_RECALL = 'MemoryRecall',
}

/**
 * 工具定义
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: object;
}

/**
 * 插件接口
 */
export interface IPlugin {
  /** 获取插件元信息 */
  getManifest(): PluginManifest;

  /** 获取当前状态 */
  getState(): PluginState;

  /** 初始化插件 */
  initialize(): Promise<void>;

  /** 启用插件 */
  enable(): Promise<void>;

  /** 禁用插件 */
  disable(): Promise<void>;

  /** 卸载插件 */
  uninstall(): Promise<void>;

  /** 获取配置 */
  getConfig(): Record<string, unknown>;

  /** 更新配置 */
  updateConfig(config: Record<string, unknown>): void;
}

/**
 * 插件错误类
 */
export class PluginError extends Error {
  constructor(
    message: string,
    public pluginId?: string,
    public code?: string
  ) {
    super(message);
    this.name = 'PluginError';
  }
}
