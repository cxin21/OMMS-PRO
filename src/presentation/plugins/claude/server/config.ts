/**
 * Server Configuration - 共享配置
 */

export const OMMS_API_URL = process.env['OMMS_API_URL'] || `http://localhost:${process.env['OMMS_API_PORT'] || '3000'}/api/v1`;
export const AGENT_ID = process.env['OMMS_AGENT_ID'] || 'claude-code';
export const SESSION_ID = process.env['OMMS_SESSION_ID'] || `session-${Date.now()}`;
export const PROJECT_DIR = process.env['CLAUDE_PROJECT_DIR'] || '/tmp';

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
    sessionId: (params?.['sessionId'] as string) || process.env['OMMS_SESSION_ID'] || `session-${Date.now()}`,
    agentId: (params?.['agentId'] as string) || process.env['OMMS_AGENT_ID'] || 'claude-code',
    projectDir: (params?.['projectDir'] as string) || process.env['CLAUDE_PROJECT_DIR'] || '/tmp',
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

  try {
    const response = await fetch(`${OMMS_API_URL}${endpoint}`, {
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
