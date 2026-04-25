/**
 * WebhookManager - Webhook 事件通知系统
 *
 * 管理 webhook 订阅和事件通知
 * - 事件类型定义
 * - 订阅管理
 * - 事件触发和传递
 * - 重试策略
 *
 * @module api/webhook-manager
 */

import { createLogger } from '../shared/logging';
import type { ILogger } from '../shared/logging';
import { IDGenerator } from '../shared/utils/id-generator';

export type WebhookEventType =
  | 'memory.created'
  | 'memory.updated'
  | 'memory.deleted'
  | 'memory.recalled'
  | 'memory.forgotten'
  | 'agent.registered'
  | 'agent.unregistered'
  | 'agent.heartbeat'
  | 'namespace.created'
  | 'namespace.deleted'
  | 'federation.sync.started'
  | 'federation.sync.completed'
  | 'dreaming.started'
  | 'dreaming.completed'
  | 'error';

export type WebhookStatus = 'pending' | 'delivered' | 'failed' | 'retrying';

export interface WebhookSubscription {
  /** 订阅 ID */
  id: string;
  /** Webhook URL */
  url: string;
  /** 事件类型列表 */
  events: WebhookEventType[];
  /** 订阅的代理/命名空间 (可选) */
  filter?: {
    agentId?: string;
    namespaceId?: string;
    memoryType?: string;
  };
  /** 密钥 (用于签名) */
  secret?: string;
  /** 是否启用 */
  enabled: boolean;
  /** 创建时间 */
  createdAt: number;
  /** 最后触发时间 */
  lastTriggeredAt?: number;
  /** 连续失败次数 */
  consecutiveFailures: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

export interface WebhookEvent {
  /** 事件 ID */
  id: string;
  /** 事件类型 */
  type: WebhookEventType;
  /** 事件数据 */
  data: Record<string, unknown>;
  /** 时间戳 */
  timestamp: number;
  /** 关联的代理 */
  agentId?: string;
  /** 关联的命名空间 */
  namespaceId?: string;
}

export interface WebhookDelivery {
  /** 投递 ID */
  id: string;
  /** 订阅 ID */
  subscriptionId: string;
  /** 事件 ID */
  eventId: string;
  /** 状态 */
  status: WebhookStatus;
  /** HTTP 状态码 */
  statusCode?: number;
  /** 响应体 */
  responseBody?: string;
  /** 错误信息 */
  error?: string;
  /** 投递时间 */
  deliveredAt?: number;
  /** 重试次数 */
  retryCount: number;
  /** 下次重试时间 */
  nextRetryAt?: number;
}

export interface WebhookManagerConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试间隔 (ms) */
  retryIntervalMs: number;
  /** 超时时间 (ms) */
  timeoutMs: number;
  /** 最大并发投递数 */
  maxConcurrentDeliveries: number;
  /** 投递队列大小 */
  deliveryQueueSize: number;
}

interface PendingDelivery {
  subscription: WebhookSubscription;
  event: WebhookEvent;
  delivery: WebhookDelivery;
  resolve: (result: WebhookDelivery) => void;
  reject: (error: Error) => void;
}

/**
 * WebhookManager - Webhook 事件通知管理器
 */
export class WebhookManager {
  private logger: ILogger;
  private subscriptions: Map<string, WebhookSubscription> = new Map();
  private eventQueue: WebhookEvent[] = [];
  private deliveryQueue: PendingDelivery[] = [];
  private activeDeliveries: Map<string, WebhookDelivery> = new Map();
  private deliveryHistory: Map<string, WebhookDelivery> = new Map();

  private isProcessing = false;
  private processingTimer: NodeJS.Timeout | null = null;

  constructor(
    private config: WebhookManagerConfig,
    private httpClient?: (url: string, options: {
        method: string;
        headers: Record<string, string>;
        body: string;
        timeout: number;
      }) => Promise<{ statusCode: number; body: string }>
  ) {
    this.logger = createLogger('WebhookManager');

    // Default HTTP client if not provided
    if (!this.httpClient) {
      this.httpClient = this.defaultHttpClient;
    }

    // Start processing loop
    this.startProcessingLoop();
  }

  /**
   * 订阅 webhook
   */
  async subscribe(subscription: Omit<WebhookSubscription, 'id' | 'createdAt' | 'consecutiveFailures'>): Promise<WebhookSubscription> {
    const sub: WebhookSubscription = {
      ...subscription,
      id: IDGenerator.unique('webhook'),
      createdAt: Date.now(),
      consecutiveFailures: 0
    };

    this.subscriptions.set(sub.id, sub);

    this.logger.info('Webhook subscribed', {
      subscriptionId: sub.id,
      url: sub.url,
      events: sub.events
    });

    return sub;
  }

  /**
   * 取消订阅
   */
  async unsubscribe(subscriptionId: string): Promise<boolean> {
    const deleted = this.subscriptions.delete(subscriptionId);
    if (deleted) {
      this.logger.info('Webhook unsubscribed', { subscriptionId });
    }
    return deleted;
  }

  /**
   * 更新订阅
   */
  async updateSubscription(subscriptionId: string, updates: Partial<WebhookSubscription>): Promise<boolean> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return false;

    Object.assign(sub, updates);
    this.logger.debug('Webhook subscription updated', { subscriptionId });
    return true;
  }

  /**
   * 获取订阅
   */
  async getSubscription(subscriptionId: string): Promise<WebhookSubscription | null> {
    return this.subscriptions.get(subscriptionId) || null;
  }

  /**
   * 获取所有订阅
   */
  async getAllSubscriptions(filters?: {
    enabledOnly?: boolean;
    eventType?: WebhookEventType;
    agentId?: string;
  }): Promise<WebhookSubscription[]> {
    let subs = Array.from(this.subscriptions.values());

    if (filters) {
      if (filters.enabledOnly !== undefined) {
        subs = subs.filter(s => s.enabled === filters.enabledOnly);
      }
      if (filters.eventType) {
        subs = subs.filter(s => s.events.includes(filters.eventType!));
      }
      if (filters.agentId) {
        subs = subs.filter(s => !s.filter?.agentId || s.filter.agentId === filters.agentId);
      }
    }

    return subs;
  }

  /**
   * 触发事件
   */
  async triggerEvent(event: Omit<WebhookEvent, 'id' | 'timestamp'>): Promise<void> {
    const fullEvent: WebhookEvent = {
      ...event,
      id: IDGenerator.unique('event'),
      timestamp: Date.now()
    };

    // Queue event
    this.eventQueue.push(fullEvent);

    this.logger.debug('Webhook event queued', {
      eventId: fullEvent.id,
      type: fullEvent.type
    });

    // Process immediately if not processing
    if (!this.isProcessing) {
      this.processEventQueue();
    }
  }

  /**
   * 触发记忆相关事件
   */
  async triggerMemoryEvent(
    action: 'created' | 'updated' | 'deleted' | 'recalled' | 'forgotten',
    memory: { uid: string; agentId: string; namespaceId?: string; type?: string; importance?: number },
    additionalData?: Record<string, unknown>
  ): Promise<void> {
    await this.triggerEvent({
      type: `memory.${action}` as WebhookEventType,
      data: {
        memoryUid: memory.uid,
        action,
        ...additionalData
      },
      agentId: memory.agentId,
      namespaceId: memory.namespaceId
    });
  }

  /**
   * 触发代理事件
   */
  async triggerAgentEvent(
    action: 'registered' | 'unregistered' | 'heartbeat',
    agent: { agentId: string; name?: string; namespaceId?: string; status?: string }
  ): Promise<void> {
    await this.triggerEvent({
      type: `agent.${action}` as WebhookEventType,
      data: {
        agentId: agent.agentId,
        agentName: agent.name,
        status: agent.status
      },
      agentId: agent.agentId,
      namespaceId: agent.namespaceId
    });
  }

  /**
   * 获取投递状态
   */
  async getDelivery(deliveryId: string): Promise<WebhookDelivery | null> {
    return this.deliveryHistory.get(deliveryId) || this.activeDeliveries.get(deliveryId) || null;
  }

  /**
   * 获取订阅的投递历史
   */
  async getDeliveryHistory(subscriptionId: string, limit?: number): Promise<WebhookDelivery[]> {
    const deliveries = Array.from(this.deliveryHistory.values())
      .filter(d => d.subscriptionId === subscriptionId)
      .sort((a, b) => (b.deliveredAt || 0) - (a.deliveredAt || 0));

    return limit ? deliveries.slice(0, limit) : deliveries;
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    totalSubscriptions: number;
    activeSubscriptions: number;
    pendingEvents: number;
    activeDeliveries: number;
    totalDeliveries: number;
    successfulDeliveries: number;
    failedDeliveries: number;
  }> {
    const deliveries = Array.from(this.deliveryHistory.values());

    return {
      totalSubscriptions: this.subscriptions.size,
      activeSubscriptions: Array.from(this.subscriptions.values()).filter(s => s.enabled).length,
      pendingEvents: this.eventQueue.length,
      activeDeliveries: this.activeDeliveries.size,
      totalDeliveries: deliveries.length,
      successfulDeliveries: deliveries.filter(d => d.status === 'delivered').length,
      failedDeliveries: deliveries.filter(d => d.status === 'failed').length
    };
  }

  /**
   * 启用订阅
   */
  async enableSubscription(subscriptionId: string): Promise<boolean> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return false;

    sub.enabled = true;
    sub.consecutiveFailures = 0;
    this.logger.info('Webhook subscription enabled', { subscriptionId });
    return true;
  }

  /**
   * 禁用订阅
   */
  async disableSubscription(subscriptionId: string): Promise<boolean> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return false;

    sub.enabled = false;
    this.logger.info('Webhook subscription disabled', { subscriptionId });
    return true;
  }

  /**
   * 测试订阅
   */
  async testSubscription(subscriptionId: string): Promise<{ success: boolean; statusCode?: number; error?: string }> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) {
      return { success: false, error: 'Subscription not found' };
    }

    const testEvent: WebhookEvent = {
      id: `test_${Date.now()}`,
      type: 'memory.created',
      data: { test: true, message: 'This is a test webhook event' },
      timestamp: Date.now(),
      agentId: 'test'
    };

    try {
      const result = await this.deliverToSubscription(sub, testEvent);
      return {
        success: result.status === 'delivered',
        statusCode: result.statusCode,
        error: result.error
      };
    } catch (error) {
      return {
        success: false,
        error: String(error)
      };
    }
  }

  /**
   * 关闭管理器
   */
  async close(): Promise<void> {
    // Stop processing
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }

    // Wait for active deliveries to complete (or cancel them)
    // For now, just clear queues
    this.eventQueue = [];
    this.deliveryQueue = [];

    this.logger.info('WebhookManager closed');
  }

  // Private methods

  private startProcessingLoop(): void {
    this.processingTimer = setInterval(() => {
      if (!this.isProcessing) {
        this.processEventQueue();
        this.processDeliveryQueue();
      }
    }, 1000);
  }

  private async processEventQueue(): Promise<void> {
    // 防止并发处理 - 使用原子操作检查
    if (this.eventQueue.length === 0) return;
    if (this.isProcessing) return; // 已经有其他调用在处理

    this.isProcessing = true;

    try {
      while (this.eventQueue.length > 0) {
        const event = this.eventQueue.shift()!;
        await this.dispatchEventToSubscriptions(event);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async dispatchEventToSubscriptions(event: WebhookEvent): Promise<void> {
    // Find matching subscriptions
    const matchingSubs = Array.from(this.subscriptions.values()).filter(sub => {
      if (!sub.enabled) return false;
      if (!sub.events.includes(event.type)) return false;
      if (sub.filter?.agentId && sub.filter.agentId !== event.agentId) return false;
      if (sub.filter?.namespaceId && sub.filter.namespaceId !== event.namespaceId) return false;
      return true;
    });

    // Create deliveries for each subscription
    for (const sub of matchingSubs) {
      const delivery: WebhookDelivery = {
        id: IDGenerator.unique('delivery'),
        subscriptionId: sub.id,
        eventId: event.id,
        status: 'pending',
        retryCount: 0
      };

      this.activeDeliveries.set(delivery.id, delivery);

      // Add to delivery queue
      this.deliveryQueue.push({
        subscription: sub,
        event,
        delivery,
        resolve: () => {},
        reject: () => {}
      });

      // Update subscription
      sub.lastTriggeredAt = Date.now();
    }
  }

  private async processDeliveryQueue(): Promise<void> {
    if (this.deliveryQueue.length === 0) return;
    if (this.activeDeliveries.size >= this.config.maxConcurrentDeliveries) return;

    // Get next delivery
    const pending = this.deliveryQueue.shift();
    if (!pending) return;

    const { subscription, event, delivery } = pending;

    try {
      const result = await this.deliverToSubscription(subscription, event);
      delivery.status = result.status;
      delivery.statusCode = result.statusCode;
      delivery.responseBody = result.responseBody;
      delivery.deliveredAt = Date.now();

      if (result.status === 'failed') {
        delivery.error = result.error;
        subscription.consecutiveFailures++;

        if (subscription.consecutiveFailures >= this.config.maxRetries) {
          subscription.enabled = false;
          this.logger.warn('Webhook subscription disabled due to consecutive failures', {
            subscriptionId: subscription.id,
            failures: subscription.consecutiveFailures
          });
        } else {
          // Schedule retry
          delivery.status = 'retrying';
          delivery.nextRetryAt = Date.now() + this.config.retryIntervalMs;
        }
      } else {
        subscription.consecutiveFailures = 0;
      }
    } catch (error) {
      delivery.status = 'failed';
      delivery.error = String(error);
      subscription.consecutiveFailures++;
    }

    // Move to history
    this.activeDeliveries.delete(delivery.id);
    this.deliveryHistory.set(delivery.id, delivery);

    // Trim history if too large
    if (this.deliveryHistory.size > 10000) {
      const keys = Array.from(this.deliveryHistory.keys()).slice(0, 5000);
      for (const key of keys) {
        this.deliveryHistory.delete(key);
      }
    }
  }

  private async deliverToSubscription(
    subscription: WebhookSubscription,
    event: WebhookEvent
  ): Promise<{ status: WebhookStatus; statusCode?: number; responseBody?: string; error?: string }> {
    const payload = JSON.stringify({
      event,
      subscriptionId: subscription.id
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Event': event.type,
      'X-Webhook-Event-ID': event.id
    };

    // Add signature if secret is configured
    if (subscription.secret) {
      const crypto = await import('crypto');
      const signature = crypto
        .createHmac('sha256', subscription.secret)
        .update(payload)
        .digest('hex');
      headers['X-Webhook-Signature'] = `sha256=${signature}`;
    }

    try {
      const response = await this.httpClient!(subscription.url, {
        method: 'POST',
        headers,
        body: payload,
        timeout: this.config.timeoutMs
      });

      return {
        status: response.statusCode >= 200 && response.statusCode < 300 ? 'delivered' : 'failed',
        statusCode: response.statusCode,
        responseBody: response.body.slice(0, 1000) // Limit stored response
      };
    } catch (error) {
      return {
        status: 'failed',
        error: String(error)
      };
    }
  }

  private async defaultHttpClient(
    url: string,
    options: { method: string; headers: Record<string, string>; body: string; timeout: number }
  ): Promise<{ statusCode: number; body: string }> {
    // This would be replaced with actual HTTP client in production
    // For now, throw an error indicating it needs to be configured
    throw new Error('HTTP client not configured. Provide an httpClient implementation.');
  }
}