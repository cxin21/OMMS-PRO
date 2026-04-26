/**
 * 敏感数据脱敏工具
 * 自动识别和脱敏日志中的敏感字段
 *
 * @module logging/sanitizer
 */
/**
 * 对数据对象进行敏感字段脱敏
 *
 * @param data - 要脱敏的数据对象
 * @returns 脱敏后的新对象（不修改原对象）
 *
 * @example
 * ```typescript
 * const data = { apiKey: 'sk-abc123456789', name: 'test' };
 * const sanitized = sanitizeData(data);
 * // { apiKey: 'sk-a***', name: 'test' }
 * ```
 */
export declare function sanitizeData(data: Record<string, unknown>): Record<string, unknown>;
/**
 * 检查字符串是否包含敏感信息（如 API Key 格式）
 */
export declare function containsSensitiveData(text: string): boolean;
