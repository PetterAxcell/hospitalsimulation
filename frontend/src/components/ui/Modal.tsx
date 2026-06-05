import type { ReactNode } from 'react'

export function Modal({
  titleId,
  title,
  subtitle,
  children,
  className = '',
  onClose,
}: {
  titleId: string
  title: string
  subtitle?: string
  children: ReactNode
  className?: string
  onClose: () => void
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className={`app-modal ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="script-modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </header>
        {children}
      </section>
    </div>
  )
}
