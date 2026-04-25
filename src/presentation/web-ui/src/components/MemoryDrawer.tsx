import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { X, GitBranch, Hash, Tag, MapPin, Activity, RefreshCw, Package, RotateCcw, ArrowUpCircle, AlertCircle, Building, GitFork } from 'lucide-react'
import { memoryApi, type Memory } from '../api/client'
import { TypeBadge, ScopeBadge, BlockBadge } from './Badge'

interface MemoryDrawerProps {
  memory: Memory | null
  onClose: () => void
  onUpdate?: () => void
}

const EVENT_ICONS: Record<string, string> = {
  created: '🟢',
  accessed: '👁',
  updated: '✏️',
  reinforced: '⬆️',
  upgraded: '🚀',
  downgraded: '⬇️',
  archived: '📦',
  deleted: '🗑',
}

const formatDate = (ts: number) =>
  new Date(ts).toLocaleString('zh-CN')

const formatDuration = (ts: number) => {
  const d = Date.now() - ts
  if (d < 60000) return '刚刚'
  if (d < 3600000) return `${Math.floor(d / 60000)} 分钟前`
  if (d < 86400000) return `${Math.floor(d / 3600000)} 小时前`
  return `${Math.floor(d / 86400000)} 天前`
}

export default function MemoryDrawer({ memory, onClose, onUpdate }: MemoryDrawerProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const navigate = useNavigate()

  if (!memory) return null

  const handleReinforce = async () => {
    setActionLoading('reinforce')
    setActionError(null)
    setActionSuccess(null)
    try {
      await memoryApi.reinforce(memory.uid)
      setActionSuccess('强化成功')
      onUpdate?.()
    } catch {
      setActionError('强化失败')
    } finally {
      setActionLoading(null)
    }
  }

  const handleArchive = async () => {
    setActionLoading('archive')
    setActionError(null)
    setActionSuccess(null)
    try {
      await memoryApi.archive(memory.uid)
      setActionSuccess('归档成功')
      onUpdate?.()
    } catch {
      setActionError('归档失败')
    } finally {
      setActionLoading(null)
    }
  }

  const handleRestore = async () => {
    setActionLoading('restore')
    setActionError(null)
    setActionSuccess(null)
    try {
      await memoryApi.restore(memory.uid)
      setActionSuccess('恢复成功')
      onUpdate?.()
    } catch {
      setActionError('恢复失败')
    } finally {
      setActionLoading(null)
    }
  }

  const handleUpgradeScope = async () => {
    setActionLoading('upgrade')
    setActionError(null)
    setActionSuccess(null)
    try {
      const res = await memoryApi.upgradeScope(memory.uid)
      if (res.success && res.data.upgraded) {
        setActionSuccess('作用域已升级')
      } else {
        setActionSuccess('作用域无需升级')
      }
      onUpdate?.()
    } catch {
      setActionError('升级失败')
    } finally {
      setActionLoading(null)
    }
  }

  const showArchiveRestore = memory.block === 'archived'
  const showUpgrade = memory.scope !== 'global'

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <div>
            <h3 style={{ marginBottom: 4 }}>记忆详情</h3>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <TypeBadge type={memory.type} />
              <ScopeBadge scope={memory.scope} />
              <BlockBadge block={memory.block} />
            </div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="drawer-body">
          {/* UID */}
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>UID</div>
            <code style={{
              fontSize: '0.75rem', background: 'var(--color-bg)',
              padding: '2px 8px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)', display: 'block',
              wordBreak: 'break-all',
            }}>
              {memory.uid}
            </code>
          </div>

          {/* Content */}
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 8 }}>内容</div>
            <div style={{
              padding: 'var(--space-3)', background: 'var(--color-bg)',
              borderRadius: 'var(--radius)', border: '1px solid var(--color-border)',
              fontSize: '0.875rem', lineHeight: 1.7, color: 'var(--color-text)',
            }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{memory.content}</ReactMarkdown>
            </div>
          </div>

          {/* Summary */}
          {memory.summary && memory.summary !== memory.content && (
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 8 }}>摘要</div>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>{memory.summary}</p>
            </div>
          )}

          {/* Stats grid */}
          <div className="grid grid-3" style={{ gap: 8 }}>
            {[
              { label: '重要性', value: memory.importance != null ? `${memory.importance}/10` : '-' },
              { label: '作用域分', value: memory.scopeScore != null ? `${memory.scopeScore}/10` : '-' },
              { label: '访问次数', value: memory.accessCount != null ? memory.accessCount : (memory.recallCount != null ? memory.recallCount : '-') },
              { label: '版本', value: memory.version != null ? `v${memory.version}` : (memory.versionChain?.length ? `v${memory.versionChain[memory.versionChain.length-1].version}` : 'v1') },
              { label: '创建时间', value: formatDuration(memory.createdAt) },
              { label: '最后访问', value: memory.lastAccessedAt ? formatDuration(memory.lastAccessedAt) : '-' },
            ].map(item => (
              <div key={item.label} style={{
                padding: 'var(--space-2) var(--space-3)',
                background: 'var(--color-bg)',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--color-border)',
              }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>{item.label}</div>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>{item.value}</div>
              </div>
            ))}
          </div>

          {/* Palace location */}
          {(memory.palace?.palaceRef || (memory as any).palaceRef) && (
            <div>
              <div className="section-title" style={{ marginBottom: 8 }}>
                <MapPin size={14} />
                宫殿位置
              </div>
              <div style={{
                padding: 'var(--space-3)', background: 'var(--color-bg)',
                borderRadius: 'var(--radius)', border: '1px solid var(--color-border)',
                fontSize: '0.8rem', color: 'var(--color-text-secondary)',
                fontFamily: 'monospace',
              }}>
                {memory.palace?.palaceRef ?? (memory as any).palaceRef}
              </div>
            </div>
          )}

          {/* Tags */}
          {memory.tags && memory.tags.length > 0 && (
            <div>
              <div className="section-title" style={{ marginBottom: 8 }}>
                <Tag size={14} />
                标签
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {memory.tags.map(tag => (
                  <span key={tag} className="tag-chip">{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Version chain */}
          {memory.versionChain && memory.versionChain.length > 0 && (
            <div>
              <div className="section-title" style={{ marginBottom: 8 }}>
                <GitBranch size={14} />
                版本链 ({memory.versionChain.length} 个版本)
              </div>
              <div className="timeline">
                {[...memory.versionChain].reverse().map((v) => (
                  <div key={v.version} className="timeline-item">
                    <div className="timeline-dot">
                      <GitBranch size={10} />
                    </div>
                    <div className="timeline-content">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          className="badge"
                          style={{ background: v.version === memory.version ? 'var(--color-primary-light)' : 'var(--color-bg)', color: v.version === memory.version ? 'var(--color-primary)' : 'var(--color-text-muted)' }}
                        >
                          v{v.version}
                          {v.version === memory.version && ' (当前)'}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          {v.contentLength} 字
                        </span>
                      </div>
                      <div className="timeline-title" style={{ marginTop: 4 }}>{v.summary}</div>
                      <div className="timeline-time">{formatDate(v.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Lifecycle events */}
          {memory.lifecycle?.events && memory.lifecycle.events.length > 0 && (
            <div>
              <div className="section-title" style={{ marginBottom: 8 }}>
                <Activity size={14} />
                生命周期
              </div>
              <div className="timeline">
                {[...memory.lifecycle.events].slice(-8).reverse().map((e, i) => (
                  <div key={i} className="timeline-item">
                    <div className="timeline-dot" style={{ fontSize: '0.75rem' }}>
                      {EVENT_ICONS[e.type] ?? '•'}
                    </div>
                    <div className="timeline-content">
                      <div className="timeline-title">{e.type}</div>
                      <div className="timeline-time">{formatDate(e.timestamp)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          {memory.metadata && Object.keys(memory.metadata).length > 0 && (
            <div>
              <div className="section-title" style={{ marginBottom: 8 }}>
                <Hash size={14} />
                元数据
              </div>
              <div style={{
                padding: 'var(--space-3)', background: 'var(--color-bg)',
                borderRadius: 'var(--radius)', border: '1px solid var(--color-border)',
                fontSize: '0.75rem', fontFamily: 'monospace',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                maxHeight: 200, overflowY: 'auto',
                color: 'var(--color-text-secondary)',
              }}>
                {JSON.stringify(memory.metadata, null, 2)}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{
            display: 'flex',
            gap: 'var(--space-2)',
            flexWrap: 'wrap',
            paddingTop: 'var(--space-4)',
            borderTop: '1px solid var(--color-border)',
            marginTop: 'var(--space-4)',
          }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleReinforce}
              disabled={actionLoading !== null}
            >
              {actionLoading === 'reinforce' ? <div className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={12} />}
              强化
            </button>

            {showUpgrade && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleUpgradeScope}
                disabled={actionLoading !== null}
              >
                {actionLoading === 'upgrade' ? <div className="spinner" style={{ width: 12, height: 12 }} /> : <ArrowUpCircle size={12} />}
                升级作用域
              </button>
            )}

            {showArchiveRestore ? (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleRestore}
                disabled={actionLoading !== null}
              >
                {actionLoading === 'restore' ? <div className="spinner" style={{ width: 12, height: 12 }} /> : <RotateCcw size={12} />}
                恢复
              </button>
            ) : (
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleArchive}
                disabled={actionLoading !== null}
              >
                {actionLoading === 'archive' ? <div className="spinner" style={{ width: 12, height: 12 }} /> : <Package size={12} />}
                归档
              </button>
            )}

            {/* 跳转记忆宫殿按钮 */}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => navigate(`/palace?highlight=${memory.uid}`)}
            >
              <Building size={12} />
              查看宫殿
            </button>

            {/* 跳转知识图谱按钮 */}
            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate(`/graph?focus=${memory.uid}`)}
            >
              <GitFork size={12} />
              查看图谱
            </button>
          </div>

          {/* Action feedback */}
          {actionError && (
            <div style={{
              marginTop: 'var(--space-3)',
              padding: 'var(--space-2) var(--space-3)',
              background: 'rgba(239, 68, 68, 0.1)',
              borderRadius: 'var(--radius)',
              fontSize: '0.8rem',
              color: 'var(--color-danger)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <AlertCircle size={14} />
              {actionError}
            </div>
          )}
          {actionSuccess && (
            <div style={{
              marginTop: 'var(--space-3)',
              padding: 'var(--space-2) var(--space-3)',
              background: 'rgba(34, 197, 94, 0.1)',
              borderRadius: 'var(--radius)',
              fontSize: '0.8rem',
              color: 'var(--color-success)',
            }}>
              {actionSuccess}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
