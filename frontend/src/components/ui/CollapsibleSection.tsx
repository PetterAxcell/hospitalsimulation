import { useState, type ReactNode } from 'react'

interface CollapsibleSectionProps {
  title: string
  summary?: ReactNode
  badge?: { tone: 'ok' | 'warn' | 'fail'; label: string }
  defaultOpen?: boolean
  children: ReactNode
}

export function CollapsibleSection({ title, summary, badge, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`collapsible-section ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="collapsible-header"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="collapsible-chevron" aria-hidden="true" />
        <span className="collapsible-title">{title}</span>
        {badge && <span className={`analysis-verdict ${badge.tone}`}>{badge.label}</span>}
        {summary && <span className="collapsible-summary">{summary}</span>}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </section>
  )
}
