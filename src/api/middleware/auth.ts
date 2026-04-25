/**
 * Auth Middleware - 认证中间件
 * 
 * 验证 API Key
 */

import { Request, Response, NextFunction } from 'express';
import { APIErrorImpl, ErrorCode } from './error-handler';

/**
 * 创建认证中间件
 */
export function createAuthMiddleware(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // 从 header 获取 API Key
    const requestApiKey = req.headers['x-api-key'] || req.headers['authorization'];

    if (!requestApiKey) {
      throw new APIErrorImpl(
        ErrorCode.UNAUTHORIZED,
        'API Key is required',
        401
      );
    }

    // 清理 Bearer 前缀
    const cleanApiKey = typeof requestApiKey === 'string'
      ? requestApiKey.replace('Bearer ', '')
      : '';

    // 验证 API Key
    if (cleanApiKey !== apiKey) {
      throw new APIErrorImpl(
        ErrorCode.UNAUTHORIZED,
        'Invalid API Key',
        401
      );
    }

    next();
  };
}
