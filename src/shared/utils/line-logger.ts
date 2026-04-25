/**
 * Line Logger - 逐行日志工具
 *
 * 提供逐行追踪功能的日志工具
 * 每次调用都会记录当前文件名和行号
 */

import { createLogger, type ILogger } from '../logging';
import path from 'path';

/**
 * 创建带行号追踪的日志记录器
 * @param moduleName 模块名称
 * @param filePath 当前文件路径（使用 __filename）
 * @param config 可选的日志配置
 */
export function createLineLogger(
  moduleName: string,
  filePath: string,
  config?: { filePath?: string; level?: string }
): { logger: ILogger; trace: (message: string, data?: Record<string, unknown>) => void } {
  const logConfig = config?.filePath
    ? {
        level: (config.level || 'debug') as any,
        output: 'both' as const,
        filePath: config.filePath,
        enableConsole: false,
        enableFile: true,
        enableRotation: true,
        maxFileSize: '50MB',
        maxFiles: 10,
      }
    : undefined;

  const logger = createLogger(moduleName, logConfig);

  // 获取文件名用于日志
  const fileName = path.basename(filePath);

  /**
   * 追踪日志 - 自动包含文件和行号信息
   */
  const trace = (message: string, data?: Record<string, unknown>) => {
    // 使用 Error 堆栈获取调用者的行号
    const stack = new Error().stack;
    const lineMatch = stack?.split('\n')[3]?.match(/:(\d+):\d+\)?$/);
    const lineNum = lineMatch ? lineMatch[1] : 'unknown';

    logger.debug(`[${fileName}:${lineNum}] ${message}`, {
      __trace: true,
      file: fileName,
      line: lineNum,
      ...data,
    });
  };

  return { logger, trace };
}

/**
 * 创建带行号追踪的日志记录器（异步版本）
 */
export function createAsyncLineLogger(
  moduleName: string,
  filePath: string,
  config?: { filePath?: string; level?: string }
): { logger: ILogger; trace: (message: string, data?: Record<string, unknown>) => Promise<void> } {
  const { logger, trace: syncTrace } = createLineLogger(moduleName, filePath, config);

  const trace = async (message: string, data?: Record<string, unknown>) => {
    syncTrace(message, data);
  };

  return { logger, trace };
}
