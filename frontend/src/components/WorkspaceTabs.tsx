export type WorkspaceTab = 'plan' | 'simulation' | 'saturation' | 'top' | 'services' | 'analysis'

interface WorkspaceTabsProps {
  active: WorkspaceTab
  onChange: (tab: WorkspaceTab) => void
}

const WORKSPACE_TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'top', label: 'Top' },
  { id: 'plan', label: 'Planificador' },
  { id: 'simulation', label: 'Simulacion' },
  { id: 'saturation', label: 'Saturacion' },
  { id: 'services', label: 'Servicios' },
  { id: 'analysis', label: 'Analisis' },
]

export function WorkspaceTabs({ active, onChange }: WorkspaceTabsProps) {
  return (
    <nav className="workspace-tabs" aria-label="Modulos">
      {WORKSPACE_TABS.map((tab) => (
        <button key={tab.id} type="button" className={active === tab.id ? 'is-active' : ''} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
