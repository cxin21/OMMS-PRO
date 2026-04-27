/**
 * Server Configuration - Claude Plugin
 *
 * 所有配置必须从配置文件读取，禁止使用环境变量或硬编码默认值
 */

import { config, ConfigManager } from '../../../../shared/config';

/**
 * 获取 API URL
 * 必须从配置文件读取
 */
export function getOmmsApiUrl(): string {
  // 如果 ConfigManager 未初始化，先初始化
  if (!config.isInitialized()) {
    try {
      const configManager = ConfigManager.getInstance();
      if (!configManager.isInitialized()) {
        configManager.initialize().catch(() => {});
      }
    } catch {
      // ConfigManager 不可用，使用环境变量作为后备
    }
  }

  if (!config.isInitialized()) {
    // 作为后备，从环境变量读取
    const host = process.env['OMMS_API_HOST'] || 'localhost';
    const port = process.env['OMMS_API_PORT'] || '3000';
    return `http://${host}:${port}/api/v1`;
  }

  const apiConfig = config.getConfig('api') as { port?: number; enabled?: boolean; host?: string; basePath?: string } | undefined;
  if (!apiConfig?.enabled) {
    throw new Error('API is not enabled in configuration');
  }
  if (!apiConfig?.port) {
    throw new Error('API port is not configured');
  }
  if (!apiConfig?.host) {
    throw new Error('API host is not configured');
  }

  const apiPath = apiConfig.basePath || '/api/v1';
  return `http://${apiConfig.host}:${apiConfig.port}${apiPath}`;
}

/**
 * 获取 Agent ID
 * 必须从配置文件读取
 */
export function getAgentId(): string {
  // 如果 ConfigManager 未初始化，先初始化
  if (!config.isInitialized()) {
    try {
      const configManager = ConfigManager.getInstance();
      if (!configManager.isInitialized()) {
        configManager.initialize().catch(() => {});
      }
    } catch {
      // ConfigManager 不可用
    }
  }

  if (!config.isInitialized()) {
    // 作为后备，从环境变量读取
    return process.env['OMMS_AGENT_ID'] || 'claude-code';
  }

  const agentId = config.getConfig('agentId') as string | undefined;
  if (!agentId) {
    throw new Error('agentId is not configured');
  }
  return agentId;
}

/**
 * 获取会话 ID
 * 从配置读取 sessionId 前缀，生成时间戳会话 ID
 */
export function getSessionId(): string {
  if (!config.isInitialized()) {
    throw new Error('ConfigManager not initialized. Cannot read session configuration.');
  }

  const sessionPrefix = config.getConfig('sessionPrefix') as string | undefined;
  if (!sessionPrefix) {
    throw new Error('sessionPrefix is not configured');
  }
  return `${sessionPrefix}${Date.now()}`;
}

/**
 * 获取项目目录
 * 必须从配置文件读取
 */
export function getProjectDir(): string {
  if (!config.isInitialized()) {
    throw new Error('ConfigManager not initialized. Cannot read project directory configuration.');
  }

  const projectDir = config.getConfig('projectDir') as string | undefined;
  if (!projectDir) {
    throw new Error('projectDir is not configured');
  }
  return projectDir;
}

/**
 * 会话上下文
 */
export interface SessionContext {
  sessionId: string;
  agentId: string;
  projectDir: string;
  conversationLogDir: string;
}

/**
 * 获取会话上下文
 */
export function getSessionContext(params?: Record<string, unknown>): SessionContext {
  const projectDir = (params?.['projectDir'] as string) || getProjectDir();
  return {
    sessionId: (params?.['sessionId'] as string) || getSessionId(),
    agentId: (params?.['agentId'] as string) || getAgentId(),
    projectDir,
    conversationLogDir: getConversationLogDir(projectDir),
  };
}

/**
 * 获取对话日志目录
 * 从配置文件读取 conversationLogDir 配置，如果未配置则使用默认值
 */
function getConversationLogDir(projectDir: string): string {
  if (!config.isInitialized()) {
    throw new Error('ConfigManager not initialized. Cannot read conversation log directory configuration.');
  }

  const conversationConfig = config.getConfig('mcp') as { tools?: { conversationLogDir?: string } } | undefined;
  const logDir = conversationConfig?.tools?.conversationLogDir || '.claude/omms-conversation';
  // 如果是相对路径，基于 projectDir
  if (logDir.startsWith('./') || !logDir.startsWith('/')) {
    return `${projectDir}/${logDir}`;
  }
  return logDir;
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
 * 获取 API 超时配置（毫秒）
 * 必须从配置文件读取
 */
function getApiTimeout(): number {
  if (!config.isInitialized()) {
    throw new Error('ConfigManager not initialized. Cannot read API timeout configuration.');
  }

  const mcpConfig = config.getConfig('mcp') as { tools?: { timeout?: number } } | undefined;
  const timeout = mcpConfig?.tools?.timeout;
  if (!timeout) {
    throw new Error('mcp.tools.timeout is not configured');
  }
  return timeout;
}

/**
 * 带超时的 fetch
 */
export async function apiFetch(
  endpoint: string,
  options: RequestInit = {},
  timeoutMs?: number
): Promise<Response> {
  // 从配置获取超时时间（如果未指定）
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
