import { useState } from 'react'
import { X } from 'lucide-react'
import type { Memory, MemoryType, MemoryScope } from '../api/client'
import { memoryApi } from '../api/client'

const MEMORY_TYPES: { value: MemoryType; label: string }[] = [
  { value: 'fact', label: '事实' },
  { value: 'event', label: '事件' },
  { value: 'decision', label: '决策' },
  { value: 'error', label: '错误' },
  { value: 'learning', label: '学习' },
  { value: 'relation', label: '关系' },
  { value: 'identity', label: '身份' },
  { value: 'preference', label: '偏好' },
  { value: 'persona', label: '人格' },
]

interface MemoryModalProps {
  memory?: Memory | null   // 传入则为编辑模式
  onClose: () => void
  onSuccess: () => void
}

export default function MemoryModal({ memory, onClose, onSuccess }: MemoryModalProps) {
  const isEdit = !!memory

  const [content, setContent] = useState(memory?.content ?? '')
  const [type, setType] = useState<MemoryType>(memory?.type ?? 'event')
  const [importance, setImportance] = useState(memory?.importance ?? 5)
  const [scope, setScope] = useState<MemoryScope>(memory?.scope ?? 'agent')
  const [agentId, setAgentId] = useState(memory?.agentId ?? 'default')
  const [sessionId, setSessionId] = useState<string>('')
  const [tags, setTags] = useState<string[]>(memory?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAddTag = () => {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) {
      setTags(prev => [...prev, t])
    }
    setTagInput('')
  }

  const handleSubmit = async () => {
    if (!content.trim()) {
      setError('内容不能为空')
      return
    }

    setLoading(true)
    setError(null)
    try {
      if (isEdit && memory) {
        await memoryApi.update(memory.uid, { content, importance, scope, tags })
      } else {
        await memoryApi.capture(content, {
          type,
          agentId: agentId || 'default',
          sessionId: sessionId || undefined,
          scores: { importance },
        })
      }
      onSuccess()
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{isEdit ? '编辑记忆' : '新建记忆'}</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="alert alert-error">{error}</div>}

          {/* Content */}
          <div className="form-group">
            <label className="form-label">内容</label>
            <textarea
              className="form-textarea"
              rows={4}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="输入记忆内容..."
            />
          </div>

          {/* Type (only for new) */}
          {!isEdit && (
            <div className="form-group">
              <label className="form-label">类型</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {MEMORY_TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    className={`filter-chip ${type === t.value ? 'active' : ''}`}
                    onClick={() => setType(t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Importance */}
          <div className="form-group">
            <label className="form-label">重要性: {importance}</label>
            <input
              type="range"
              className="form-range"
              min={1} max={10} step={1}
              value={importance}
              onChange={e => setImportance(Number(e.target.value))}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
              <span>1 低</span><span>5 中</span><span>10 高</span>
            </div>
          </div>

          {/* Scope */}
          <div className="form-group">
            <label className="form-label">作用域</label>
            <select className="form-select" value={scope} onChange={e => setScope(e.target.value as MemoryScope)}>
              <option value="session">会话 (session)</option>
              <option value="agent">Agent (agent)</option>
              <option value="global">全局 (global)</option>
            </select>
          </div>

          {/* Agent ID */}
          <div className="form-group">
            <label className="form-label">Agent ID</label>
            <input
              type="text"
              className="form-input"
              value={agentId}
              onChange={e => setAgentId(e.target.value)}
              placeholder="default"
            />
          </div>

          {/* Session ID */}
          <div className="form-group">
            <label className="form-label">会话 ID（可选）</label>
            <input
              type="text"
              className="form-input"
              value={sessionId}
              onChange={e => setSessionId(e.target.value)}
              placeholder="留空则自动生成"
            />
          </div>

          {/* Tags */}
          <div className="form-group">
            <label className="form-label">标签</label>
            <div className="tags-input-wrap" onClick={() => document.getElementById('tag-input')?.focus()}>
              {tags.map(tag => (
                <span key={tag} className="tag-chip">
                  {tag}
                  <button onClick={() => setTags(prev => prev.filter(t => t !== tag))}>
                    <X size={10} />
                  </button>
                </span>
              ))}
              <input
                id="tag-input"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); handleAddTag() }
                }}
                placeholder={tags.length ? '' : '输入标签，回车确认'}
              />
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? '保存中...' : isEdit ? '保存修改' : '创建记忆'}
          </button>
        </div>
      </div>
    </div>
  )
}
