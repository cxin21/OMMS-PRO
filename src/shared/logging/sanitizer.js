/**
 * 敏感数据脱敏工具
 * 自动识别和脱敏日志中的敏感字段
 *
 * @module logging/sanitizer
 */
/**
 * 敏感字段关键词列表（小写匹配）
 */
const SENSITIVE_KEY_PATTERNS = [
    'apikey', 'api_key', 'apikey',
    'password', 'passwd', 'pwd',
    'token', 'access_token', 'refresh_token',
    'secret', 'client_secret',
    'authorization', 'auth',
    'credential', 'private_key',
];
/**
 * 脱敏后的掩码
 */
const MASK = '***';
/**
 * 检查字段名是否为敏感字段
 */
function isSensitiveKey(key) {
    const lower = key.toLowerCase();
    return SENSITIVE_KEY_PATTERNS.some(pattern => lower.includes(pattern));
}
/**
 * 脱敏字符串值
 * 保留前 4 个字符 + 掩码
 */
function maskString(value) {
    if (value.length <= 4)
        return MASK;
    return `${value.substring(0, 4)}${MASK}`;
}
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
export function sanitizeData(data) {
    if (!data || typeof data !== 'object') {
        return data;
    }
    const result = {};
    for (const [key, value] of Object.entries(data)) {
        if (isSensitiveKey(key)) {
            result[key] = typeof value === 'string' ? maskString(value) : MASK;
        }
        else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            result[key] = sanitizeData(value);
        }
        else if (Array.isArray(value)) {
            result[key] = value.map(item => typeof item === 'object' && item !== null
                ? sanitizeData(item)
                : item);
        }
        else {
            result[key] = value;
        }
    }
    return result;
}
/**
 * 检查字符串是否包含敏感信息（如 API Key 格式）
 */
export function containsSensitiveData(text) {
    // 检查常见的 API Key 格式
    const patterns = [
        /sk-[a-zA-Z0-9]{20,}/, // OpenAI style
        /xai-[a-zA-Z0-9]{20,}/, // xAI style
        /Bearer\s+[a-zA-Z0-9._-]+/, // Bearer token
    ];
    return patterns.some(p => p.test(text));
}
