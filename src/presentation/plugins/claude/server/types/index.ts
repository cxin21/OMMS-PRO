/**
 * Shared Types for OMMS-PRO Claude Plugin
 * 统一的类型定义和辅助函数
 */

// ============================================================
// API 响应类型
// ============================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  details?: string;
  statusCode?: number;
}

export interface PaginatedResponse<T> extends ApiResponse<T> {
  total?: number;
  page?: number;
  pageSize?: number;
}

// ============================================================
// Memory 相关类型
// ============================================================

export interface Memory {
  uid: string;
  content: string;
  summary?: string;
  type: MemoryType;
  importance: number;
  scope?: string;
  createdAt: number;
  updatedAt?: number;
  agentId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export type MemoryType = 'fact' | 'event' | 'learning' | 'decision' | 'preference';

export interface MemoryRecallResult {
  memories: Memory[];
  totalFound: number;
  query: string;
}

export interface MemoryCaptureResult {
  uid: string;
  type: MemoryType;
  importance: number;
  summary?: string;
  extractionStatus?: 'pending' | 'completed' | 'failed';
}

// ============================================================
// Tool 结果类型
// ============================================================

export interface ToolResultContent {
  type: 'text';
  text: string;
}

export interface ToolResult {
  content?: ToolResultContent[];
  isError?: boolean;
  task?: {
    taskId: string;
    status: 'working' | 'completed' | 'failed' | 'input_required' | 'cancelled';
    ttl: number | null;
    createdAt: string;
    lastUpdatedAt: string;
    pollInterval?: number;
    statusMessage?: string;
  };
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * 创建成功的 tool result
 */
export function successResult(text: string): ToolResult {
  return {
    content: [{ type: 'text', text }],
    isError: false,
  };
}

/**
 * 创建失败的 tool result
 */
export function errorResult(text: string): ToolResult {
  return {
    content: [{ type: 'text', text }],
    isError: true,
  };
}

/**
 * 从 API 响应创建 tool result
 */
export function fromApiResponse<T>(
  response: ApiResponse<T>,
  successMessage: (data: T) => string,
  errorPrefix = 'Operation failed'
): ToolResult {
  if (response.success) {
    return successResult(successMessage(response.data as T));
  }
  const errorMsg = response.error || response.details || 'Unknown error';
  return errorResult(`${errorPrefix}: ${errorMsg}`);
}

// ============================================================
// Session 和对话类型
// ============================================================

export interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  sessionId: string;
  agentId: string;
  source: string;
}

export interface SessionContext {
  sessionId: string;
  agentId: string;
  projectDir: string;
  conversationLogDir: string;
  apiUrl: string;
}

// ============================================================
// Profile 类型
// ============================================================

export interface UserPersona {
  name?: string;
  occupation?: string;
  location?: string;
  language?: string;
  personalityTraits?: Array<{ trait: string; confidence?: number }>;
  interests?: Array<{ name: string; category?: string }>;
  values?: string[];
  tags?: Array<{ name: string; category?: string }>;
}

export interface UserPreferences {
  interaction?: {
    responseLength?: 'brief' | 'moderate' | 'detailed';
    activeHours?: Array<{ start: string; end: string }>;
  };
  content?: {
    topics?: Array<{ topic: string; frequency?: number }>;
    complexityLevel?: 'simple' | 'moderate' | 'advanced';
  };
  technical?: {
    preferredTools?: string[];
    codeLanguages?: string[];
  };
  confidence?: number;
}

export interface UserProfile {
  persona?: UserPersona;
  preferences?: UserPreferences;
  stats?: {
    totalInteractions?: number;
    engagementScore?: number;
    favoriteTopics?: string[];
  };
  tags?: Array<{ name: string }>;
}

export interface ProfileContext {
  userName?: string;
  l0?: UserPersona;
  l1?: UserPreferences;
  totalInteractions?: number;
  engagementLevel?: string;
}

// ============================================================
// Hook 输入类型
// ============================================================

export interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
}

// ============================================================
// 工具元数据
// ============================================================

export type ToolCategory = 'memory' | 'palace' | 'graph' | 'dreaming' | 'system' | 'scoring' | 'profile';

export interface ToolMetadata {
  category: ToolCategory;
  version: string;
  deprecated?: boolean;
  aliases?: string[];
}

export interface MCPTool {
  tool: {
    name: string;
    description: string;
    inputSchema: {
      type: 'object';
      properties?: Record<string, {
        type: string;
        description?: string;
        enum?: string[];
        default?: unknown;
      }>;
      required?: string[];
    };
    handler: (params: Record<string, unknown>) => Promise<ToolResult>;
  };
  metadata: ToolMetadata;
}