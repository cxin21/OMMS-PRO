/**
 * Error Handler Middleware - 错误处理中间件
 * 
 * 统一处理 API 错误
 */

import { Request, Response, NextFunction } from 'express';
import { createLogger, type ILogger } from '../../shared/logging';
import { APIError, ErrorCode } from '../types';
export { ErrorCode } from '../types';

/**
 * API 错误类
 */
export class APIErrorImpl extends Error {
  code: ErrorCode;
  status: number;
  details?: any;

  constructor(
    code: ErrorCode,
    message: string,
    status: number = 500,
    details?: any
  ) {
    super(message);
    this.name = 'APIError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * 创建错误处理中间件
 */
export function createErrorMiddleware(logger: ILogger) {
  return (err: Error, req: Request, res: Response, next: NextFunction): void => {
    const error = err as APIErrorImpl;

    // 记录错误日志
    logger.error(`API error: ${error.message}`, {
      code: error.code,
      status: error.status,
      path: req.path,
      method: req.method,
      stack: error.stack,
    });

    // 构建错误响应
    const apiError: APIError = {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message || 'Internal server error',
    };

    if (error.details) {
      apiError.details = error.details;
    }

    if (process.env['NODE_ENV'] === 'development') {
      apiError.stack = error.stack;
    }

    // 发送错误响应
    res.status(error.status || 500).json({
      success: false,
      error: apiError,
      timestamp: Date.now(),
      version: 'v1',
    });
  };
}

/**
 * 创建错误中间件（简化版，用于 router）
 */
export function createErrorMiddlewareSimple(logger: ILogger) {
  return createErrorMiddleware(logger);
}
