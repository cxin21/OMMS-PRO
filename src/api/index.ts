/**
 * REST API - 统一导出
 */

// 服务器
export { RESTAPIServer, createRESTAPIServer } from './server';
export type { ServerOptions } from './server';

// 类型 — 已迁移到 src/types/api
// API 类型现在从 src/types/api 统一导入

// 中间件
export * from './middleware';

// Webhook 管理器
export { WebhookManager } from './webhook-manager';
export type {
  WebhookSubscription,
  WebhookEvent,
  WebhookDelivery,
  WebhookEventType,
  WebhookStatus,
} from './webhook-manager';

// 流式响应管理器
export { StreamingManager } from './streaming-manager';
export type {
  Stream,
  StreamEvent,
  StreamProgress,
  StreamSubscription,
  StreamStatus,
} from './streaming-manager';

// ChatML 适配器
export { ChatMLAdapter } from './chatml-adapter';
export type {
  ChatMLMessage,
  ChatMLPromptOptions,
  MemoryContext,
  ChatMLTemplate,
} from './chatml-adapter';

// 控制器
// 注意：旧版控制器已移除，改用依赖注入模式

// 路由（不直接导出，供内部使用）
// export * from './routes';
