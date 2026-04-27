/**
 * Server Configuration - Claude Plugin
 *
 * 优先从配置文件读取配置，如果配置系统未初始化则使用环境变量+默认值
 */

import { config } from '../../../../shared/config';

// 默认值（仅在配置系统未初始化时使用）
// 注意：这些默认值仅在 ConfigManager 未初始化时使用，配置系统就绪后必须从配置读取
const DEFAULT_API_PORT = '3000';
const DEFAULT_API_PATH = '/api/v1';
const DEFAULT_SESSION_PREFIX = 'session-';
const DEFAULT_PROJECT_DIR = './data/sessions';

/**
 * 获取 API URL
 * 优先从配置读取，其次环境变量，最后默认
 */
export function getOmmsApiUrl(): string {
  // 尝试从配置读取
  if (config.isInitialized()) {
    try {
      const apiConfig = config.getConfig('api') as { port?: number; enabled?: boolean; host?: string } | undefined;
      if (apiConfig?.enabled !== false && apiConfig?.port) {
        // 使用配置的 host，默认 localhost
        const host = apiConfig.host || 'localhost';
        return `http://${host}:${apiConfig.port}${DEFAULT_API_PATH}`;
      }
    } catch {
      // 配置读取失败，继续使用备用方案
    }
  }

  // 备用：环境变量
  const envUrl = process.env['OMMS_API_URL'];
  if (envUrl) {
    return envUrl;
  }

  // 备用：环境变量端口
  const envPort = process.env['OMMS_API_PORT'];
  if (envPort) {
    return `http://localhost:${envPort}${DEFAULT_API_PATH}`;
  }

  // 最终默认
  return `http://localhost:${DEFAULT_API_PORT}${DEFAULT_API_PATH}`;
}

/**
 * 获取 Agent ID
 * 优先从配置读取，其次环境变量
 */
export function getAgentId(): string {
  if (config.isInitialized()) {
    try {
      const agentId = config.getConfig('agentId') as string | undefined;
      if (agentId) {
        return agentId;
      }
    } catch {
      // 配置读取失败，继续使用环境变量
    }
  }

  const envAgentId = process.env['OMMS_AGENT_ID'];
  if (envAgentId) {
    return envAgentId;
  }

  // 配置不可用时抛出错误，禁止使用硬编码 fallback
  throw new Error('ConfigManager not initialized and no OMMS_AGENT_ID environment variable');
}

/**
 * 获取会话 ID
 * 使用环境变量或生成时间戳会话 ID
 */
export function getSessionId(): string {
  return process.env['OMMS_SESSION_ID'] || `${DEFAULT_SESSION_PREFIX}${Date.now()}`;
}

/**
 * 获取项目目录
 * 优先从环境变量，其次默认（不使用 /tmp）
 */
export function getProjectDir(): string {
  return process.env['CLAUDE_PROJECT_DIR'] || DEFAULT_PROJECT_DIR;
}

// 导出兼容性别名（用于现有代码）
export const OMMS_API_URL = getOmmsApiUrl();
export const AGENT_ID = getAgentId();
export const SESSION_ID = getSessionId();
export const PROJECT_DIR = getProjectDir();

/**
 * 会话上下文
 */
export interface SessionContext {
  sessionId: string;
  agentId: string;
  projectDir: string;
}

/**
 * 获取会话上下文
 */
export function getSessionContext(params?: Record<string, unknown>): SessionContext {
  return {
    sessionId: (params?.['sessionId'] as string) || getSessionId(),
    agentId: (params?.['agentId'] as string) || getAgentId(),
    projectDir: (params?.['projectDir'] as string) || getProjectDir(),
  };
}

/**
 * 解析 API URL
 */
export function parseApiUrl(urlStr: string): { hostname: string; port: number; path: string } {
  const url = new URL(urlStr);
  return {
    hostname: url.hostname,
    port: url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
  };
}

/**
 * 带超时的 fetch
 */
export async function apiFetch(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs: number = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}
