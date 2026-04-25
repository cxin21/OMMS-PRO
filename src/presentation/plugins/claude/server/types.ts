/**
 * MCP Server Types for OMMS-PRO Claude Plugin
 */

/**
 * MCP 工具输入模式属性
 */
export interface ToolProperty {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
}

/**
 * MCP 工具输入模式
 */
export interface ToolInputSchema {
  type: 'object';
  properties?: Record<string, ToolProperty>;
  required?: string[];
}

/**
 * MCP 工具结果内容
 */
export interface MCPToolResultContent {
  type: 'text';
  text: string;
}

/**
 * MCP 工具处理器参数
 */
export type ToolHandlerParams = Record<string, unknown>;

/**
 * MCP 工具处理器
 */
export type ToolHandler = (params: ToolHandlerParams) => Promise<MCPToolResult>;

/**
 * MCP 工具定义
 */
export interface MCPTool {
  tool: {
    name: string;
    description: string;
    inputSchema: ToolInputSchema;
    handler: ToolHandler;
  };
  metadata: ToolMetadata;
}

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
 * MCP 工具结果
 */
export interface MCPToolResult {
  content: MCPToolResultContent[];
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
  resource: {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}
