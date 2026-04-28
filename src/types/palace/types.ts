/**
 * Palace Types - 记忆宫殿类型
 *
 * @module types/palace
 */

import { MemoryType } from '../memory/core';

/**
 * Hall 类型枚举
 */
export enum HallType {
  FACTS = 'facts',
  EVENTS = 'events',
  DECISIONS = 'decisions',
  ERRORS = 'errors',
  LEARNINGS = 'learnings',
  RELATIONS = 'relations',
}

/**
 * Wing 类型枚举
 */
export enum WingType {
  SESSION = 'session',
  AGENT = 'agent',
  GLOBAL = 'global',
}

/**
 * Hall 到 MemoryType 的映射
 */
export const HALL_TO_MEMORY_TYPE_MAP: Record<HallType, MemoryType> = {
  [HallType.FACTS]: MemoryType.FACT,
  [HallType.EVENTS]: MemoryType.EVENT,
  [HallType.DECISIONS]: MemoryType.DECISION,
  [HallType.ERRORS]: MemoryType.ERROR,
  [HallType.LEARNINGS]: MemoryType.LEARNING,
  [HallType.RELATIONS]: MemoryType.RELATION,
};

/**
 * MemoryType 到 Hall 的映射
 */
export const MEMORY_TO_HALL_TYPE_MAP: Record<MemoryType, HallType> = {
  [MemoryType.FACT]: HallType.FACTS,
  [MemoryType.EVENT]: HallType.EVENTS,
  [MemoryType.DECISION]: HallType.DECISIONS,
  [MemoryType.ERROR]: HallType.ERRORS,
  [MemoryType.LEARNING]: HallType.LEARNINGS,
  [MemoryType.RELATION]: HallType.RELATIONS,
  [MemoryType.IDENTITY]: HallType.FACTS,
  [MemoryType.PREFERENCE]: HallType.FACTS,
  [MemoryType.PERSONA]: HallType.FACTS,
};