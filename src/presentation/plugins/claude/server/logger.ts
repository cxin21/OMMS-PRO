/**
 * Logger for Claude Plugin
 * 统一的日志系统，可在 server 和 hooks 间共享
 */

import * as http from 'http';
import * as https from 'https';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  module: string;
  data?: Record<string, unknown>;
  timestamp?: number;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * 从环境变量或配置获取日志级别
 */
function getLogLevel(): LogLevel {
  const envLevel = process.env['OMMS_PLUGIN_LOG_LEVEL'];
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel as LogLevel;
  }
  return (process.env['NODE_ENV'] === 'production' ? 'info' : 'debug') as LogLevel;
}

function shouldLog(level: LogLevel): boolean {
  const currentLevel = getLogLevel();
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

/**
 * 创建日志器
 * @param module 模块名称
 */
export function createLogger(module: string) {
  const apiUrl = process.env['OMMS_API_URL'] || 'http://localhost:3000/api/v1';
  const agentId = process.env['OMMS_AGENT_ID'] || 'claude-code';

  async function sendToApi(level: LogLevel, message: string, data?: Record<string, unknown>): Promise<void> {
    if (!shouldLog(level)) return;

    const payload = JSON.stringify({
      level,
      message,
      module,
      agentId,
      data,
      timestamp: Date.now(),
    });

    try {
      const url = new URL(`${apiUrl}/system/logs/write`);
      const client = url.protocol === 'https:' ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 3000),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 5000,
      };

      return new Promise((resolve) => {
        const req = client.request(options, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve());
        });
        req.on('error', () => resolve());
        req.on('timeout', () => { req.destroy(); resolve(); });
        req.write(payload);
        req.end();
      });
    } catch {
      // silent fail
    }
  }

  function formatConsole(level: LogLevel, message: string, data?: Record<string, unknown>): string {
    const prefix = `[${level.toUpperCase()}] [${module}]`;
    if (data) {
      return `${prefix} ${message} ${JSON.stringify(data)}`;
    }
    return `${prefix} ${message}`;
  }

  return {
    debug(message: string, data?: Record<string, unknown>) {
      if (shouldLog('debug')) {
        console.error(formatConsole('debug', message, data));
      }
      sendToApi('debug', message, data);
    },

    info(message: string, data?: Record<string, unknown>) {
      if (shouldLog('info')) {
        console.error(formatConsole('info', message, data));
      }
      sendToApi('info', message, data);
    },

    warn(message: string, data?: Record<string, unknown>) {
      if (shouldLog('warn')) {
        console.error(formatConsole('warn', message, data));
      }
      sendToApi('warn', message, data);
    },

    error(message: string, data?: Record<string, unknown>) {
      if (shouldLog('error')) {
        console.error(formatConsole('error', message, data));
      }
      sendToApi('error', message, data);
    },

    /**
     * 创建子日志器
     */
    child(subModule: string) {
      return createLogger(`${module}:${subModule}`);
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;