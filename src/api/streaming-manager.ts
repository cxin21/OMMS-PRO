/**
 * StreamingManager - 流式响应管理器
 *
 * 管理 SSE (Server-Sent Events) 和流式响应
 * - 流式事件订阅
 * - 进度追踪
 * - 多客户端支持
 *
 * @module api/streaming-manager
 */

import { createLogger } from '../shared/logging';
import type { ILogger } from '../shared/logging';
import { config } from '../shared/config';
import type { StreamingConfig } from '../core/types/config';
import { IDGenerator } from '../shared/utils/id-generator';
import { StreamingDefaults } from '../config';

export type StreamStatus = 'active' | 'paused' | 'completed' | 'cancelled' | 'error';

export interface StreamEvent {
  /** 事件 ID */
  id: string;
  /** 流 ID */
  streamId: string;
  /** 事件类型 */
  type: 'data' | 'progress' | 'error' | 'warning' | 'info';
  /** 数据 */
  data: unknown;
  /** 时间戳 */
  timestamp: number;
  /** 序列号 */
  sequence: number;
}

export interface StreamProgress {
  /** 流 ID */
  streamId: string;
  /** 当前进度 */
  current: number;
  /** 总进度 */
  total: number;
  /** 百分比 */
  percent: number;
  /** 消息 */
  message?: string;
  /** 预计剩余时间 (ms) */
  etaMs?: number;
}

export interface Stream {
  /** 流 ID */
  id: string;
  /** 流名称 */
  name: string;
  /** 创建时间 */
  createdAt: number;
  /** 状态 */
  status: StreamStatus;
  /** 事件类型 */
  eventType: string;
  /** 订阅者数量 */
  subscriberCount: number;
  /** 创建者 */
  createdBy: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

export interface StreamSubscription {
  /** 订阅 ID */
  id: string;
  /** 流 ID */
  streamId: string;
  /** 客户端 ID */
  clientId: string;
  /** 订阅时间 */
  subscribedAt: number;
  /** 最后接收事件 */
  lastEventAt?: number;
  /** 已接收事件数 */
  eventsReceived: number;
}

/**
 * Progress callback for long-running operations
 */
export type ProgressCallback = (progress: StreamProgress) => void;

/**
 * Event callback for stream events
 */
export type StreamEventCallback = (event: StreamEvent) => void;

/**
 * Stream filter for querying streams
 */
export interface StreamFilter {
  status?: StreamStatus;
  eventType?: string;
  createdBy?: string;
  clientId?: string;
}

/**
 * StreamingManager - 流式响应管理器
 *
 * 管理服务端推送事件和多客户端流式响应
 */
export class StreamingManager {
  private logger: ILogger;
  private streams: Map<string, Stream> = new Map();
  private subscriptions: Map<string, StreamSubscription> = new Map();
  private streamEvents: Map<string, StreamEvent[]> = new Map(); // streamId -> events
  private clientStreams: Map<string, Set<string>> = new Map(); // clientId -> streamIds
  private eventCallbacks: Map<string, Set<StreamEventCallback>> = new Map(); // streamId -> callbacks
  private eventIdCounter = 0;

  // Configuration
  private maxEventsPerStream: number;
  private maxStreams: number;
  private maxSubscriptionsPerClient: number;
  private streamRetentionMs: number;

  constructor(userConfig?: {
    maxEventsPerStream?: number;
    maxStreams?: number;
    maxSubscriptionsPerClient?: number;
    streamRetentionMs?: number;
  }) {
    this.logger = createLogger('StreamingManager');

    // 尝试从 ConfigManager 读取 streaming 配置
    let streamingConfig: StreamingConfig | undefined;
    try {
      if (config.isInitialized()) {
        streamingConfig = config.getConfig<StreamingConfig>('streaming');
      }
    } catch {
      // 配置获取失败，使用构造函数参数或默认值
    }

    this.maxEventsPerStream = userConfig?.maxEventsPerStream ?? streamingConfig?.maxEventsPerStream ?? config.getConfig<number>('streaming.maxEventsPerStream') ?? StreamingDefaults.maxEventsPerStream;
    this.maxStreams = userConfig?.maxStreams ?? streamingConfig?.maxStreams ?? config.getConfig<number>('streaming.maxStreams') ?? StreamingDefaults.maxStreams;
    this.maxSubscriptionsPerClient = userConfig?.maxSubscriptionsPerClient ?? streamingConfig?.maxSubscriptionsPerClient ?? config.getConfig<number>('streaming.maxSubscriptionsPerClient') ?? StreamingDefaults.maxSubscriptionsPerClient;
    this.streamRetentionMs = userConfig?.streamRetentionMs ?? streamingConfig?.streamRetentionMs ?? config.getConfig<number>('streaming.streamRetentionMs') ?? StreamingDefaults.streamRetentionMs;
  }

  /**
   * 创建流
   */
  async createStream(options: {
    name: string;
    eventType: string;
    createdBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<Stream> {
    // Check stream limit
    if (this.streams.size >= this.maxStreams) {
      // Remove oldest inactive stream
      const oldest = Array.from(this.streams.values())
        .filter(s => s.status !== 'active')
        .sort((a, b) => a.createdAt - b.createdAt)[0];

      if (oldest) {
        await this.closeStream(oldest.id);
      } else {
        throw new Error('Maximum number of streams reached');
      }
    }

    const stream: Stream = {
      id: `stream_${Date.now()}_${++this.eventIdCounter}`,
      name: options.name,
      createdAt: Date.now(),
      status: 'active',
      eventType: options.eventType,
      subscriberCount: 0,
      createdBy: options.createdBy,
      metadata: options.metadata
    };

    this.streams.set(stream.id, stream);
    this.streamEvents.set(stream.id, []);

    this.logger.info('Stream created', { streamId: stream.id, name: stream.name });

    return stream;
  }

  /**
   * 关闭流
   */
  async closeStream(streamId: string): Promise<boolean> {
    const stream = this.streams.get(streamId);
    if (!stream) return false;

    // Remove all subscriptions
    for (const [subId, sub] of this.subscriptions) {
      if (sub.streamId === streamId) {
        this.subscriptions.delete(subId);
      }
    }

    // Remove callbacks
    this.eventCallbacks.delete(streamId);

    // Remove events
    this.streamEvents.delete(streamId);

    // Update client streams
    for (const [clientId, streamIds] of this.clientStreams) {
      streamIds.delete(streamId);
      if (streamIds.size === 0) {
        this.clientStreams.delete(clientId);
      }
    }

    stream.status = 'completed';
    this.streams.delete(streamId);

    this.logger.info('Stream closed', { streamId });
    return true;
  }

  /**
   * 发送流事件
   */
  async sendEvent(
    streamId: string,
    event: Omit<StreamEvent, 'id' | 'streamId' | 'timestamp' | 'sequence'>
  ): Promise<string> {
    const stream = this.streams.get(streamId);
    if (!stream) {
      throw new Error(`Stream ${streamId} not found`);
    }

    if (stream.status !== 'active') {
      throw new Error(`Stream ${streamId} is not active`);
    }

    const events = this.streamEvents.get(streamId)!;
    const eventId = `evt_${Date.now()}_${++this.eventIdCounter}`;

    const fullEvent: StreamEvent = {
      id: eventId,
      streamId,
      type: event.type,
      data: event.data,
      timestamp: Date.now(),
      sequence: events.length
    };

    events.push(fullEvent);

    // Trim events if too many
    if (events.length > this.maxEventsPerStream) {
      events.splice(0, events.length - this.maxEventsPerStream);
    }

    // Notify callbacks
    const callbacks = this.eventCallbacks.get(streamId);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(fullEvent);
        } catch (error) {
          this.logger.error('Stream event callback error', { error: String(error) });
        }
      }
    }

    // Update subscriber last event time
    for (const sub of this.subscriptions.values()) {
      if (sub.streamId === streamId) {
        sub.lastEventAt = Date.now();
        sub.eventsReceived++;
      }
    }

    this.logger.debug('Stream event sent', { streamId, eventId, type: event.type });

    return eventId;
  }

  /**
   * 发送进度更新
   */
  async sendProgress(
    streamId: string,
    progress: Omit<StreamProgress, 'streamId' | 'percent'>
  ): Promise<string> {
    const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

    return this.sendEvent(streamId, {
      type: 'progress',
      data: {
        streamId,
        current: progress.current,
        total: progress.total,
        percent,
        message: progress.message,
        etaMs: progress.etaMs
      } as StreamProgress
    });
  }

  /**
   * 发送数据
   */
  async sendData(streamId: string, data: unknown): Promise<string> {
    return this.sendEvent(streamId, { type: 'data', data });
  }

  /**
   * 发送错误
   */
  async sendError(streamId: string, error: string | Error): Promise<string> {
    return this.sendEvent(streamId, {
      type: 'error',
      data: { message: String(error) }
    });
  }

  /**
   * 订阅流
   */
  async subscribe(streamId: string, clientId: string): Promise<StreamSubscription> {
    // Check subscription limit
    const clientStreams = this.clientStreams.get(clientId);
    if (clientStreams && clientStreams.size >= this.maxSubscriptionsPerClient) {
      throw new Error('Maximum subscriptions per client reached');
    }

    // Check if already subscribed
    for (const sub of this.subscriptions.values()) {
      if (sub.streamId === streamId && sub.clientId === clientId) {
        return sub;
      }
    }

    const stream = this.streams.get(streamId);
    if (!stream) {
      throw new Error(`Stream ${streamId} not found`);
    }

    const subscription: StreamSubscription = {
      id: IDGenerator.unique('sub'),
      streamId,
      clientId,
      subscribedAt: Date.now(),
      eventsReceived: 0
    };

    this.subscriptions.set(subscription.id, subscription);

    // Update client streams
    if (!this.clientStreams.has(clientId)) {
      this.clientStreams.set(clientId, new Set());
    }
    this.clientStreams.get(clientId)!.add(streamId);

    // Update stream subscriber count
    stream.subscriberCount = Array.from(this.subscriptions.values())
      .filter(s => s.streamId === streamId).length;

    this.logger.debug('Client subscribed to stream', { streamId, clientId });

    return subscription;
  }

  /**
   * 取消订阅
   */
  async unsubscribe(subscriptionId: string): Promise<boolean> {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return false;

    // Update stream subscriber count
    const stream = this.streams.get(sub.streamId);
    if (stream) {
      stream.subscriberCount = Array.from(this.subscriptions.values())
        .filter(s => s.streamId === sub.streamId && s.id !== subscriptionId).length;
    }

    // Remove from client streams
    const clientStreams = this.clientStreams.get(sub.clientId);
    if (clientStreams) {
      clientStreams.delete(sub.streamId);
      if (clientStreams.size === 0) {
        this.clientStreams.delete(sub.clientId);
      }
    }

    this.subscriptions.delete(subscriptionId);

    this.logger.debug('Client unsubscribed from stream', { streamId: sub.streamId, clientId: sub.clientId });

    return true;
  }

  /**
   * 获取流
   */
  async getStream(streamId: string): Promise<Stream | null> {
    return this.streams.get(streamId) || null;
  }

  /**
   * 获取所有流
   */
  async getAllStreams(filter?: StreamFilter): Promise<Stream[]> {
    let streams = Array.from(this.streams.values());

    if (filter) {
      if (filter.status) {
        streams = streams.filter(s => s.status === filter.status);
      }
      if (filter.eventType) {
        streams = streams.filter(s => s.eventType === filter.eventType);
      }
      if (filter.createdBy) {
        streams = streams.filter(s => s.createdBy === filter.createdBy);
      }
    }

    return streams.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 获取订阅
   */
  async getSubscription(subscriptionId: string): Promise<StreamSubscription | null> {
    return this.subscriptions.get(subscriptionId) || null;
  }

  /**
   * 获取客户端订阅
   */
  async getClientSubscriptions(clientId: string): Promise<StreamSubscription[]> {
    return Array.from(this.subscriptions.values())
      .filter(s => s.clientId === clientId);
  }

  /**
   * 获取流事件
   */
  async getStreamEvents(streamId: string, options?: {
    afterSequence?: number;
    limit?: number;
  }): Promise<StreamEvent[]> {
    const events = this.streamEvents.get(streamId);
    if (!events) return [];

    let result = events;

    if (options?.afterSequence !== undefined) {
      result = result.filter(e => e.sequence > options.afterSequence!);
    }

    if (options?.limit) {
      result = result.slice(-options.limit);
    }

    return result;
  }

  /**
   * 注册事件回调
   */
  async onStreamEvent(streamId: string, callback: StreamEventCallback): Promise<string> {
    if (!this.eventCallbacks.has(streamId)) {
      this.eventCallbacks.set(streamId, new Set());
    }

    const callbackId = IDGenerator.unique('cb');

    // Store callback with ID (we'll need to track this)
    // For simplicity, just add to the set
    this.eventCallbacks.get(streamId)!.add(callback);

    return callbackId;
  }

  /**
   * 移除事件回调
   */
  async removeEventCallback(callbackId: string): Promise<boolean> {
    // This is simplified - in production you'd track callback IDs
    return true;
  }

  /**
   * 暂停流
   */
  async pauseStream(streamId: string): Promise<boolean> {
    const stream = this.streams.get(streamId);
    if (!stream) return false;

    if (stream.status !== 'active') return false;

    stream.status = 'paused';
    this.logger.info('Stream paused', { streamId });

    return true;
  }

  /**
   * 恢复流
   */
  async resumeStream(streamId: string): Promise<boolean> {
    const stream = this.streams.get(streamId);
    if (!stream) return false;

    if (stream.status !== 'paused') return false;

    stream.status = 'active';
    this.logger.info('Stream resumed', { streamId });

    return true;
  }

  /**
   * 取消流
   */
  async cancelStream(streamId: string): Promise<boolean> {
    const stream = this.streams.get(streamId);
    if (!stream) return false;

    stream.status = 'cancelled';
    this.logger.info('Stream cancelled', { streamId });

    // Close after a short delay to allow final events
    setTimeout(() => {
      this.closeStream(streamId);
    }, 1000);

    return true;
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    totalStreams: number;
    activeStreams: number;
    pausedStreams: number;
    totalSubscriptions: number;
    totalEvents: number;
    activeClients: number;
  }> {
    const streams = Array.from(this.streams.values());
    const subs = Array.from(this.subscriptions.values());

    return {
      totalStreams: streams.length,
      activeStreams: streams.filter(s => s.status === 'active').length,
      pausedStreams: streams.filter(s => s.status === 'paused').length,
      totalSubscriptions: subs.length,
      totalEvents: Array.from(this.streamEvents.values()).reduce((sum, events) => sum + events.length, 0),
      activeClients: this.clientStreams.size
    };
  }

  /**
   * 清理过期流
   */
  async cleanupExpiredStreams(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [streamId, stream] of this.streams) {
      // Remove streams that have been completed/cancelled for longer than retention period
      if (stream.status === 'completed' || stream.status === 'cancelled' || stream.status === 'error') {
        if (now - stream.createdAt > this.streamRetentionMs) {
          await this.closeStream(streamId);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      this.logger.info('Expired streams cleaned', { count: cleaned });
    }

    return cleaned;
  }

  /**
   * 创建带进度追踪的回调
   */
  createProgressCallback(streamId: string, total: number): ProgressCallback {
    return async (progress: StreamProgress) => {
      await this.sendProgress(streamId, {
        ...progress,
        total
      });
    };
  }
}