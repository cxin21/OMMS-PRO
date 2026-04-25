import { ReactNode } from 'react'
import type { MemoryType, MemoryScope, MemoryBlock } from '../api/client'

const TYPE_LABELS: Record<MemoryType, string> = {
  fact: '事实',
  event: '事件',
  decision: '决策',
  error: '错误',
  learning: '学习',
  relation: '关系',
  identity: '身份',
  preference: '偏好',
  persona: '人格',
}

const SCOPE_LABELS: Record<MemoryScope, string> = {
  session: '会话',
  agent: 'Agent',
  global: '全局',
}

const BLOCK_LABELS: Record<MemoryBlock, string> = {
  working: '工作区',
  session: '会话区',
  core: '核心区',
  archived: '归档',
  deleted: '已删除',
}

interface BadgeProps {
  children?: ReactNode
  className?: string
}

export function Badge({ children, className = '' }: BadgeProps) {
  return <span className={`badge ${className}`}>{children}</span>
}

export function TypeBadge({ type }: { type: MemoryType | string }) {
  return <span className={`badge badge-${type}`}>{TYPE_LABELS[type as MemoryType] ?? type}</span>
}

export function ScopeBadge({ scope }: { scope: MemoryScope | string }) {
  return <span className={`badge badge-${scope}`}>{SCOPE_LABELS[scope as MemoryScope] ?? scope}</span>
}

export function BlockBadge({ block }: { block: MemoryBlock | string }) {
  return <span className={`badge badge-${block}`}>{BLOCK_LABELS[block as MemoryBlock] ?? block}</span>
}

export function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    completed: 'badge-green',
    running: 'badge-blue',
    failed: 'badge-red',
    healthy: 'badge-green',
    unhealthy: 'badge-red',
  }
  return <span className={`badge ${colorMap[status] ?? 'badge-gray'}`}>{status}</span>
}
