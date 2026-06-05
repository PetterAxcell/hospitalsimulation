import { useState } from 'react'
import { Metric } from '../../components/ui/Metric'
import type { ClinicalCaseDiagnostic } from '../../engine/clinicalCases'
import type { PatientCaseFilter, SimulationAgentLayer, SimulationResult } from '../../types'

type SimulationPanelTab = 'cases' | 'staff'

interface SimulationCaseSelectorProps {
  result: SimulationResult | null
  selectedCaseId: PatientCaseFilter
  agentLayer: SimulationAgentLayer
  fileName: string
  diagnostics: ClinicalCaseDiagnostic[]
  onEditCases: () => void
  onEditCase: (caseId: PatientCaseFilter) => void
  onUploadCases: (file: File | undefined) => void
  onResetCases: () => void
  onSelectCase: (caseId: PatientCaseFilter) => void
  onChangeAgentLayer: (layer: SimulationAgentLayer) => void
}

export function SimulationCaseSelector({
  result,
  selectedCaseId,
  agentLayer,
  fileName,
  diagnostics,
  onEditCases,
  onEditCase,
  onUploadCases,
  onResetCases,
  onSelectCase,
  onChangeAgentLayer,
}: SimulationCaseSelectorProps) {
  const [activePanel, setActivePanel] = useState<SimulationPanelTab>('cases')
  const caseStats = (result?.caseStats ?? [])
    .filter((stat) => stat.attempted > 0)
    .sort((a, b) => b.completed - a.completed)
  const staffStats = result?.staffStats ?? []
  const staffOnShift = result?.kpis.staffOnShift ?? staffStats.reduce((sum, stat) => sum + stat.count, 0)
  const completedCases = result?.kpis.completed ?? 0

  function selectPanel(panel: SimulationPanelTab) {
    setActivePanel(panel)
    if (panel === 'cases' && agentLayer === 'staff') onChangeAgentLayer('patients')
    if (panel === 'staff' && agentLayer !== 'staff') onChangeAgentLayer('staff')
  }

  function selectLayer(layer: SimulationAgentLayer) {
    onChangeAgentLayer(layer)
    if (layer === 'patients') setActivePanel('cases')
    if (layer === 'staff') setActivePanel('staff')
  }

  return (
    <section className="panel-section simulation-hub">
      <div className="simulation-hub-header">
        <h2>Simulacion</h2>
        <p className="case-yaml-file">{fileName}</p>
      </div>

      <div className="simulation-hub-summary">
        <Metric label="Casos" value={String(caseStats.length)} />
        <Metric label="Personal" value={String(staffOnShift)} />
      </div>

      <div className="case-yaml-actions" aria-label="Herramientas de casos clinicos">
        <ToolIconButton icon="edit" label="Editar YAML" onClick={onEditCases} />
        <label className="file-action icon-action" aria-label="Subir YAML" title="Subir YAML">
          <ToolIcon icon="upload" />
          <span className="visually-hidden">Subir YAML</span>
          <input
            type="file"
            accept=".yaml"
            onChange={(event) => {
              onUploadCases(event.target.files?.[0])
              event.currentTarget.value = ''
            }}
          />
        </label>
        <ToolIconButton icon="reset" label="Restaurar casos" onClick={onResetCases} />
      </div>

      {diagnostics.length > 0 && (
        <div className="case-yaml-diagnostics">
          {diagnostics.map((diagnostic, index) => (
            <p key={`${diagnostic.line}-${index}`} className={diagnostic.level}>{diagnostic.message}</p>
          ))}
        </div>
      )}

      <div className="agent-layer-grid" aria-label="Capa visible de simulacion">
        <button type="button" className={agentLayer === 'all' ? 'is-active' : ''} onClick={() => selectLayer('all')}>Todo</button>
        <button type="button" className={agentLayer === 'patients' ? 'is-active' : ''} onClick={() => selectLayer('patients')}>Casos</button>
        <button type="button" className={agentLayer === 'staff' ? 'is-active' : ''} onClick={() => selectLayer('staff')}>Personal</button>
      </div>

      <div className="simulation-panel-tabs" aria-label="Grupo de simulacion">
        <button type="button" className={activePanel === 'cases' ? 'is-active' : ''} onClick={() => selectPanel('cases')}>
          <span>Casos</span>
          <strong>{completedCases}</strong>
        </button>
        <button type="button" className={activePanel === 'staff' ? 'is-active' : ''} onClick={() => selectPanel('staff')}>
          <span>Personal</span>
          <strong>{staffOnShift}</strong>
        </button>
      </div>

      {activePanel === 'cases' ? (
        caseStats.length > 0 ? (
          <div className="case-list simulation-hub-list">
            <button
              type="button"
              className={`case-item ${selectedCaseId === 'all' ? 'is-active' : ''}`}
              style={{ borderLeftColor: '#375171' }}
              onClick={() => onSelectCase('all')}
            >
              <strong>Todos los casos</strong>
              <span>{result?.kpis.completed ?? 0} pacientes completados</span>
              <small>Vista completa de la actividad simulada.</small>
            </button>
            {caseStats.map((stat) => {
              const route = stat.samplePath.length ? stat.samplePath.join(' -> ') : 'Sin ruta completa'
              return (
                <article
                  key={stat.id}
                  className={`case-item case-item-with-action ${selectedCaseId === stat.id ? 'is-active' : ''}`}
                  style={{ borderLeftColor: stat.color }}
                >
                  <button
                    type="button"
                    className="case-select-action"
                    title={route}
                    onClick={() => onSelectCase(stat.id)}
                  >
                    <strong>{stat.label}</strong>
                    <span>{stat.completed}/{stat.attempted} completados · {stat.blocked} bloqueados</span>
                  </button>
                  <button
                    type="button"
                    className="case-edit-action"
                    aria-label={`Editar YAML de ${stat.label}`}
                    title="Editar YAML"
                    onClick={() => onEditCase(stat.id)}
                  >
                    <ToolIcon icon="edit" />
                  </button>
                </article>
              )
            })}
          </div>
        ) : (
          <p className="muted">Ejecutando mezcla clinica.</p>
        )
      ) : (
        <div className="case-list simulation-hub-list">
          {staffStats.length > 0 ? (
            staffStats.map((stat) => (
              <article key={stat.role} className="case-item staff-item" style={{ borderLeftColor: stat.color }}>
                <strong>{stat.label}</strong>
                <span>{stat.count} en turno · {stat.moving} con ruta</span>
                <small>{stat.samplePath.length ? stat.samplePath.join(' -> ') : 'Turno local'}</small>
              </article>
            ))
          ) : (
            <p className="muted">Sin personal asignado a la planta activa.</p>
          )}
        </div>
      )}
    </section>
  )
}

function ToolIconButton({
  icon,
  label,
  onClick,
}: {
  icon: 'edit' | 'upload' | 'reset'
  label: string
  onClick?: () => void
}) {
  return (
    <button type="button" className="icon-action" aria-label={label} title={label} onClick={onClick}>
      <ToolIcon icon={icon} />
      <span className="visually-hidden">{label}</span>
    </button>
  )
}

function ToolIcon({ icon }: { icon: 'edit' | 'upload' | 'reset' }) {
  if (icon === 'edit') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 20h4l10.5-10.5-4-4L4 16v4Z" />
        <path d="m13.5 6.5 4 4" />
      </svg>
    )
  }
  if (icon === 'upload') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M5 20h14" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7v5h5" />
      <path d="M5.5 12A7 7 0 1 0 8 6.7L4 11" />
    </svg>
  )
}
