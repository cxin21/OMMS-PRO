/**
 * MCP Server 类型定义
 * 
 * 定义 MCP (Model Context Protocol) 相关的所有类型
 */

/**
 * MCP 工具定义
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handler: (params: any) => Promise<MCPToolResult>;
}

/**
 * MCP 工具结果
 */
export interface MCPToolResult {
  content: MCPContent[];
  isError?: boolean;
}

/**
 * MCP 内容类型
 */
export type MCPContent = MCPTextContent | MCPImageContent | MCPResourceContent;

export interface MCPTextContent {
  type: 'text';
  text: string;
}

export interface MCPImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface MCPResourceContent {
  type: 'resource';
  resource: MCPResource;
}

/**
 * JSON Schema 定义
 */
export interface JSONSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'any';
  description?: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  default?: any;
  enum?: any[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

/**
 * MCP 资源定义
 */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

/**
 * MCP 资源模板
 */
export interface MCPResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * MCP 提示词定义
 */
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
  handler: (args: Record<string, any>) => Promise<MCPPromptResult>;
}

/**
 * MCP 提示词参数
 */
export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
  default?: any;
}

/**
 * MCP 提示词结果
 */
export interface MCPPromptResult {
  description?: string;
  messages: MCPPromptMessage[];
}

/**
 * MCP 提示词消息
 */
export interface MCPPromptMessage {
  role: 'user' | 'assistant';
  content: MCPContent;
}

// ============================================================================
// 从统一配置模块重新导出
// ============================================================================

// 从 core/types/config 重新导出 MCPServerConfig
export type { MCPServerConfig, MCPToolsConfig, MCPPerformanceConfig } from '../../core/types/config';

// 从 ConfigLoader 动态加载默认 MCP 配置
import { ConfigLoader } from '../../shared/config/loader';
const loader = new ConfigLoader();
export const DEFAULT_MCP_CONFIG = loader.loadDefaults().mcp;

/**
 * 工具元数据
 */
export interface ToolMetadata {
  category: 'memory' | 'palace' | 'graph' | 'dreaming' | 'system' | 'scoring' | 'profile';
  version: string;
  deprecated?: boolean;
  aliases?: string[];
}

/**
 * 工具调用上下文
 */
export interface ToolCallContext {
  toolName: string;
  params: any;
  startTime: number;
  requestId: string;
}

/**
 * 工具调用结果
 */
export interface ToolCallResult extends MCPToolResult {
  context: ToolCallContext;
  duration: number;
}

/**
 * 错误响应
 */
export interface MCPError {
  code: number;
  message: string;
  data?: any;
}

/**
 * MCP 错误码
 */
export enum MCPErrorCode {
  // 标准 JSON-RPC 错误
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
  
  // MCP 特定错误
  TOOL_NOT_FOUND = -32001,
  RESOURCE_NOT_FOUND = -32002,
  PROMPT_NOT_FOUND = -32003,
  TOOL_EXECUTION_ERROR = -32004,
  TIMEOUT_ERROR = -32005,
}

/**
 * 能力定义
 */
export interface MCPCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
}

/**
 * 请求类型
 */
export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

/**
 * 响应类型
 */
export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: MCPError;
}

/**
 * 通知类型
 */
export interface MCPNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

/**
 * 工具列表
 */
export interface ToolList {
  tools: MCPTool[];
}

/**
 * 资源列表
 */
export interface ResourceList {
  resources: MCPResource[];
}

/**
 * 提示词列表
 */
export interface PromptList {
  prompts: MCPPrompt[];
}
