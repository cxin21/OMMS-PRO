/**
 * CORS Middleware - CORS 中间件
 * 
 * 处理跨域请求
 */

import { Request, Response, NextFunction } from 'express';

/**
 * 创建 CORS 中间件
 */
export function createCORSMiddleware(allowedOrigins: string[] = ['*']) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin || '*';

    // 检查是否在允许列表中
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    }

    // 设置 CORS 头
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', '86400');

    // 处理 OPTIONS 请求
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    next();
  };
}
