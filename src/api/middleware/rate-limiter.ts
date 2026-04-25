/**
 * Rate Limiter Middleware - 限流中间件
 *
 * 限制请求频率
 */

import { Request, Response, NextFunction } from 'express';
import { APIErrorImpl, ErrorCode } from './error-handler';

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

const requestMap = new Map<string, RateLimitInfo>();
let cleanupTimer: NodeJS.Timeout | null = null;

/**
 * 创建限流中间件
 */
export function createRateLimiterMiddleware(windowMs: number, maxRequests: number) {
  // 定期清理过期数据 - 使用较短间隔避免内存泄漏
  const cleanupIntervalMs = Math.min(windowMs, 60000); // 最多1分钟清理一次
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
  }
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, info] of requestMap.entries()) {
      if (info.resetTime < now) {
        requestMap.delete(key);
      }
    }
  }, cleanupIntervalMs);

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    // 使用原子操作避免 race condition
    const existing = requestMap.get(ip);
    if (!existing || existing.resetTime < now) {
      // 新的时间窗口
      requestMap.set(ip, {
        count: 1,
        resetTime: now + windowMs,
      });
      // 设置限流头
      res.header('X-RateLimit-Limit', maxRequests.toString());
      res.header('X-RateLimit-Remaining', (maxRequests - 1).toString());
      res.header('X-RateLimit-Reset', (now + windowMs).toString());
      next();
      return;
    }

    // 当前时间窗口内 - 使用最新的 resetTime防止过期
    existing.count++;
    existing.resetTime = now + windowMs; // 刷新窗口

    if (existing.count > maxRequests) {
      const retryAfter = Math.ceil((existing.resetTime - now) / 1000);

      // 设置限流头
      res.header('Retry-After', retryAfter.toString());
      res.header('X-RateLimit-Limit', maxRequests.toString());
      res.header('X-RateLimit-Remaining', '0');

      throw new APIErrorImpl(
        ErrorCode.TOO_MANY_REQUESTS,
        'Too many requests, please try again later',
        429
      );
    }

    // 设置限流头
    res.header('X-RateLimit-Limit', maxRequests.toString());
    res.header('X-RateLimit-Remaining', Math.max(0, maxRequests - existing.count).toString());
    res.header('X-RateLimit-Reset', existing.resetTime.toString());

    next();
  };
}
