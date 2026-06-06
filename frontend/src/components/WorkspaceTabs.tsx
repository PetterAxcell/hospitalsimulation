import type { ReactNode } from 'react'

export type WorkspaceTab = 'plan' | 'simulation' | 'top' | 'services' | 'analysis'

interface WorkspaceTabsProps {
  active: WorkspaceTab
  onChange: (tab: WorkspaceTab) => void
  actions?: ReactNode
}

const WORKSPACE_TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'top', label: 'Top' },
  { id: 'plan', label: 'Planificador' },
  { id: 'simulation', label: 'Simulación' },
  { id: 'analysis', label: 'Análisis' },
  { id: 'services', label: 'Servicios' },
]

export function WorkspaceTabs({ active, onChange, actions }: WorkspaceTabsProps) {
  return (
    <nav className="workspace-tabs" aria-label="Modulos">
      {WORKSPACE_TABS.map((tab) => (
        <button key={tab.id} type="button" className={active === tab.id ? 'is-active' : ''} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
      {actions && <div className="workspace-tab-actions">{actions}</div>}
    </nav>
  )
}
