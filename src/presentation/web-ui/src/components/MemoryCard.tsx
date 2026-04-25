import { useState } from 'react'
import {
  Eye, Edit2, Trash2, GitBranch,
  Hash, Tag, Clock,
  BookOpen, Calendar, Lightbulb, AlertCircle,
  GraduationCap, Network, Fingerprint, Heart, User,
  Star, UserCircle,
} from 'lucide-react'
import type { Memory, MemoryType } from '../api/client'
import { TypeBadge, ScopeBadge, BlockBadge } from './Badge'

interface MemoryCardProps {
  memory: Memory
  onView: (memory: Memory) => void
  onEdit: (memory: Memory) => void
  onDelete: (uid: string) => void
}

const TYPE_ICONS: Record<MemoryType, React.ReactNode> = {
  fact:       <BookOpen size={14} />,
  event:      <Calendar size={14} />,
  decision:   <Lightbulb size={14} />,
  error:      <AlertCircle size={14} />,
  learning:   <GraduationCap size={14} />,
  relation:   <Network size={14} />,
  identity:   <Fingerprint size={14} />,
  preference: <Heart size={14} />,
  persona:    <User size={14} />,
}

const CONTENT_PREVIEW_LEN = 140

const formatDate = (ts: number) =>
  new Date(ts).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function MemoryCard({ memory, onView, onEdit, onDelete }: MemoryCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [tagsExpanded, setTagsExpanded] = useState(false)

  const displayText = expanded
    ? memory.content
    : (memory.summary || memory.content.slice(0, CONTENT_PREVIEW_LEN))

  const canExpand = !expanded && memory.content.length > CONTENT_PREVIEW_LEN

  const handleDelete = () => {
    setShowDeleteConfirm(false)
    onDelete(memory.uid)
  }

  return (
    <div className="memory-card" data-type={memory.type}>
      <div className="memory-card-content">
        {/* Header */}
        <div className="memory-card-header">
          <div className={`memory-card-type-icon type-${memory.type}`}>
            {TYPE_ICONS[memory.type]}
          </div>
          <div className="memory-card-header-main">
            <div className="memory-card-badges">
              <TypeBadge type={memory.type} />
              <ScopeBadge scope={memory.scope} />
              <BlockBadge block={memory.block} />
              {memory.version > 1 && (
                <span className="badge badge-purple version-badge">
                  <GitBranch size={10} />v{memory.version}
                </span>
              )}
            </div>
          </div>
          <div className="memory-card-actions">
            <button className="btn btn-ghost btn-sm btn-icon" title="查看详情" onClick={() => onView(memory)}>
              <Eye size={14} />
            </button>
            <button className="btn btn-ghost btn-sm btn-icon" title="编辑" onClick={() => onEdit(memory)}>
              <Edit2 size={14} />
            </button>
            {showDeleteConfirm ? (
              <div className="delete-confirm">
                <button className="btn btn-danger btn-sm" onClick={handleDelete}>确认</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowDeleteConfirm(false)}>取消</button>
              </div>
            ) : (
              <button
                className="btn btn-ghost btn-sm btn-icon btn-danger-hover"
                title="删除"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="memory-card-content-text">
          {displayText}
          {canExpand && (
            <button className="expand-btn" onClick={() => setExpanded(true)}>展开</button>
          )}
          {expanded && (
            <button className="expand-btn" onClick={() => setExpanded(false)}>收起</button>
          )}
        </div>

        {/* Meta */}
        <div className="memory-card-meta">
          {memory.tags && memory.tags.length > 0 && (
            <div className="memory-card-tags">
              {(tagsExpanded ? memory.tags : memory.tags.slice(0, 4)).map(tag => (
                <span key={tag} className="tag-chip">
                  <Tag size={9} />
                  {tag}
                </span>
              ))}
              {memory.tags.length > 4 && (
                <button
                  className="tag-chip"
                  style={{ cursor: 'pointer', border: 'none', background: 'none', padding: 0 }}
                  onClick={() => setTagsExpanded(!tagsExpanded)}
                >
                  {tagsExpanded ? '收起' : `+${memory.tags.length - 4}`}
                </button>
              )}
            </div>
          )}
          <div className="memory-card-meta-right">
            <div className="meta-row" title={`重要性: ${memory.importance}/10`}>
              <Star size={11} style={{ color: memory.importance >= 7 ? 'var(--color-warning)' : 'inherit' }} />
              {memory.importance.toFixed(1)}
            </div>
            <div className="meta-row" title={`Agent: ${memory.agentId}`}>
              <UserCircle size={11} />
              {memory.agentId}
            </div>
            {memory.metadata?.sessionId && (
              <div className="meta-row" title={`会话: ${String(memory.metadata.sessionId)}`}>
                <Hash size={11} />
                {String(memory.metadata.sessionId).substring(0, 12)}...
              </div>
            )}
            <div className="meta-row">
              <Clock size={11} />
              {formatDate(memory.createdAt)}
            </div>
            <div className="meta-row">
              <Hash size={11} />
              {memory.accessCount} 次访问
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
