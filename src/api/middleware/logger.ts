/**
 * Logger Middleware - 日志中间件
 *
 * 记录 HTTP 请求日志，包含详细信息：
 * - 请求方法、路径、查询参数
 * - 请求体（用于 POST/PUT/PATCH）
 * - 响应状态码和返回数据
 * - 请求处理时长
 */

import { Request, Response, NextFunction } from 'express';
import type { ILogger } from '../../shared/logging';
import { IDGenerator } from '../../shared/utils/id-generator';

/**
 * 创建日志中间件
 */
export function createLoggerMiddleware(logger: ILogger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    const { method, path, ip, query, url } = req;
    const requestId = IDGenerator.unique('req');

    // 过滤日志相关的API请求，避免记录日志自己的请求
    if (path.startsWith('/v1/system/logs')) {
      return next();
    }

    // 敏感字段过滤（避免记录密码等敏感信息）
    const SENSITIVE_FIELDS = ['password', 'token', 'apiKey', 'api_key', 'secret', 'authorization'];
    const filterSensitive = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return obj;
      const filtered = { ...obj };
      for (const key of Object.keys(filtered)) {
        if (SENSITIVE_FIELDS.some(f => key.toLowerCase().includes(f.toLowerCase()))) {
          filtered[key] = '[REDACTED]';
        }
      }
      return filtered;
    };

    // 请求日志（方法、路径、查询）
    logger.debug(`[${requestId}] --> ${method} ${url}`, {
      type: 'request',
      requestId,
      method,
      path,
      url,
      query: Object.keys(query || {}).length > 0 ? query : undefined,
      ip,
      userAgent: req.get('user-agent'),
      contentType: req.get('content-type'),
    });

    // 记录请求体（POST/PUT/PATCH）
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && req.body) {
      logger.debug(`[${requestId}] Request body`, {
        type: 'request_body',
        requestId,
        method,
        path,
        body: filterSensitive(req.body),
      });
    }

    // 捕获原始 JSON 响应
    const originalJson = res.json.bind(res);
    let responseBody: any;

    res.json = function(body: any) {
      responseBody = body;
      return originalJson(body);
    };

    // 监听响应完成
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const { statusCode } = res;

      // 记录响应状态和时长
      logger.info(`[${requestId}] <-- ${method} ${path} - ${statusCode} (${duration}ms)`, {
        type: 'response',
        requestId,
        method,
        path,
        statusCode,
        duration,
        ip,
      });

      // 记录响应体（成功响应且有数据）
      if (responseBody && statusCode < 400) {
        // 过滤敏感字段
        const filteredResponse = filterSensitive(responseBody);
        logger.debug(`[${requestId}] Response body`, {
          type: 'response_body',
          requestId,
          method,
          path,
          statusCode,
          body: filteredResponse,
        });
      }

      // 记录错误响应详情
      if (responseBody && statusCode >= 400) {
        logger.warn(`[${requestId}] Error response`, {
          type: 'error_response',
          requestId,
          method,
          path,
          statusCode,
          error: responseBody.error || responseBody.message || responseBody,
          duration,
        });
      }
    });

    next();
  };
}
