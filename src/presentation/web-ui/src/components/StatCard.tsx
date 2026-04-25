import { ReactNode } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface StatCardProps {
  label: string
  value: ReactNode
  icon?: ReactNode
  trend?: { value: number; label?: string }
  color?: string
}

export default function StatCard({ label, value, icon, trend, color = 'var(--color-primary)' }: StatCardProps) {
  return (
    <div className="stat-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
        <div>
          <div className="stat-value">{value}</div>
          <div className="stat-label">{label}</div>
        </div>
        {icon && (
          <div style={{
            width: 36, height: 36, borderRadius: 'var(--radius)',
            background: `${color}18`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color,
          }}>
            {icon}
          </div>
        )}
      </div>
      {trend !== undefined && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: '0.72rem',
          color: trend.value > 0 ? 'var(--color-success)' : trend.value < 0 ? 'var(--color-danger)' : 'var(--color-text-muted)',
        }}>
          {trend.value > 0 ? <TrendingUp size={12} /> : trend.value < 0 ? <TrendingDown size={12} /> : <Minus size={12} />}
          {trend.label ?? `${Math.abs(trend.value)}%`}
        </div>
      )}
    </div>
  )
}
