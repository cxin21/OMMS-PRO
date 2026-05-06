/**
 * Server Configuration - Claude Plugin
 *
 * 配置优先级：ConfigManager（运行时覆盖） > 环境变量 OMMS_API_HOST/PORT（启动时） > 默认值
 * 插件作为独立进程运行，在 ConfigManager 不可用时回退到环境变量以便 MCP 传输
 */

import { config, ConfigManager } from '../../../../shared/config';
import type { SessionContext } from './types';

/**
 * 统一的配置初始化
 * 确保 ConfigManager 已初始化，所有配置访问应先调用此函数
 */
function ensureInitialized(): void {
  if (config.isInitialized()) {
    return;
  }

  try {
    const configManager = ConfigManager.getInstance();
    if (!configManager.isInitialized()) {
      configManager.initialize().catch(() => {});
    }
  } catch {
    // ConfigManager 不可用
  }
}

/**
 * 安全获取配置值
 * @param key 配置键
 * @param fallback 后备值（当配置未初始化时使用）
 */
function getConfig<T>(key: string, fallback: T): T {
  ensureInitialized();

  if (!config.isInitialized()) {
    return fallback;
  }

  const value = config.getConfig(key);
  return (value as T) ?? fallback;
}

// ============================================================
// API 配置
// ============================================================

export function getOmmsApiUrl(): string {
  ensureInitialized();

  if (!config.isInitialized()) {
    const host = process.env['OMMS_API_HOST'] || 'localhost';
    const port = process.env['OMMS_API_PORT'] || '3000';
    return `http://${host}:${port}/api/v1`;
  }

  const apiConfig = config.getConfig('api') as { port?: number; enabled?: boolean; host?: string; basePath?: string } | undefined;
  if (!apiConfig?.enabled) {
    throw new Error('API is not enabled in configuration');
  }

  const host = apiConfig?.host || 'localhost';
  const port = apiConfig?.port || 3000;
  const basePath = apiConfig?.basePath || '/api/v1';

  return `http://${host}:${port}${basePath}`;
}

export function getApiTimeout(): number {
  return getConfig<number>('mcp.tools.timeout', 30000);
}

export function getApiHost(): string {
  return getConfig<string>('api.host', 'localhost');
}

export function getApiPort(): number {
  return getConfig<number>('api.port', 3000);
}

// ============================================================
// Agent 配置
// ============================================================

export function getAgentId(): string {
  return getConfig<string>('agentId', 'claude-code');
}

// ============================================================
// Session 配置
// ============================================================

export function getSessionPrefix(): string {
  return getConfig<string>('sessionPrefix', 'session-');
}

export function getSessionId(): string {
  ensureInitialized();

  const prefix = getSessionPrefix();
  if (!prefix) {
    throw new Error('sessionPrefix is not configured');
  }
  return `${prefix}${Date.now()}`;
}

// ============================================================
// 项目配置
// ============================================================

export function getProjectDir(): string {
  return getConfig<string>('projectDir', process.cwd());
}

// ============================================================
// 对话日志配置
// ============================================================

export function getConversationLogDir(projectDir?: string): string {
  const baseDir = projectDir || getProjectDir();
  const relativePath = getConfig<string>('mcp.tools.conversationLogDir', '.claude/omms-conversation');

  // 如果是绝对路径，直接返回
  if (relativePath.startsWith('/')) {
    return relativePath;
  }

  // 否则基于项目目录
  return `${baseDir}/${relativePath}`;
}

// ============================================================
// Session 上下文
// ============================================================

export function getSessionContext(params?: Record<string, unknown>): SessionContext {
  const projectDir = (params?.['projectDir'] as string) || getProjectDir();
  const sessionId = (params?.['sessionId'] as string) || getSessionId();
  const agentId = (params?.['agentId'] as string) || getAgentId();

  return {
    sessionId,
    agentId,
    projectDir,
    conversationLogDir: getConversationLogDir(projectDir),
    apiUrl: getOmmsApiUrl(),
  };
}

// ============================================================
// API 请求辅助
// ============================================================

export interface ParsedUrl {
  hostname: string;
  port: number;
  path: string;
  isHttps: boolean;
}

export function parseApiUrl(urlStr: string): ParsedUrl {
  const url = new URL(urlStr);
  return {
    hostname: url.hostname,
    port: url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    isHttps: url.protocol === 'https:',
  };
}

/**
 * 带超时的 fetch
 */
export async function apiFetch(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs?: number
): Promise<Response> {
  const timeout = timeoutMs ?? getApiTimeout();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const apiUrl = getOmmsApiUrl();

  try {
    const response = await fetch(`${apiUrl}${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

/**
 * 发送 JSON POST 请求并解析响应
 */
export async function apiPost<T = unknown>(
  endpoint: string,
  body: unknown,
  timeoutMs?: number
): Promise<{ success: boolean; data?: T; error?: string; details?: string; statusCode?: number }> {
  const response = await apiFetch(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
  }, timeoutMs);

  const text = await response.text();

  if (!text || !text.trim()) {
    return { success: false, error: 'server_empty_response', statusCode: response.status };
  }

  try {
    const json = JSON.parse(text);
    return json;
  } catch {
    return { success: false, error: 'invalid_response', details: text.substring(0, 200), statusCode: response.status };
  }
}