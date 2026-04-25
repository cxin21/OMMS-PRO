/**
 * 图谱相关类型定义
 *
 * @module types/graph
 */

/**
 * 关系类型
 */
export type RelationshipType =
  | 'knows'
  | 'part_of'
  | 'related_to'
  | 'causes'
  | 'belongs_to'
  | 'depends_on'
  | 'similar_to'
  | 'temporal_before'
  | 'temporal_after';

/**
 * 时间关系
 */
export interface TemporalRelation {
  start: number;
  end: number;
  validFrom?: number;
  validTo?: number;
}

/**
 * 图谱节点
 */
export interface GraphNode {
  id: string;
  name: string;
  type: 'agent' | 'concept' | 'event' | 'entity';
  attributes: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/**
 * 图谱边
 */
export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: RelationshipType;
  strength: number;
  temporal?: TemporalRelation;
  metadata?: Record<string, unknown>;
}

/**
 * 实体快照
 * 用于时间点查询
 */
export interface EntitySnapshot {
  entityId: string;
  timestamp: number;
  name: string;
  type: string;
  attributes: Record<string, unknown>;
}
