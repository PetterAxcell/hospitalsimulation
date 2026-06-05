import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Metric } from '../../components/ui/Metric'
import type { ArchitectureRuleResult } from '../../engine/architectureRules'
import type { SimulationSettings } from '../../engine/simulation'
import type { SimulationResult } from '../../types'

const SIMULATION_SPEED_PRESETS = [1, 2, 10, 20]

interface SimulationControlsPanelProps {
  settings: SimulationSettings
  result: SimulationResult | null
  rules: ArchitectureRuleResult[]
  onChange: (settings: SimulationSettings) => void
}

export function SimulationControlsPanel({ settings, result, rules, onChange }: SimulationControlsPanelProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const failingRules = rules.filter((rule) => rule.status !== 'ok')
  const warnCount = rules.filter((rule) => rule.status === 'warn').length
  const failCount = rules.filter((rule) => rule.status === 'fail').length

  return (
    <>
      <section className="panel-section">
        <h2>Parametros</h2>
        <label>
          Llegadas/hora
          <input
            type="range"
            min={3}
            max={24}
            value={settings.arrivalsPerHour}
            onChange={(event) => onChange({ ...settings, arrivalsPerHour: Number(event.target.value) })}
          />
          <output>{settings.arrivalsPerHour}</output>
        </label>
        <label>
          Horizonte anos
          <input
            type="range"
            min={1}
            max={10}
            value={settings.horizonYears}
            onChange={(event) => onChange({ ...settings, horizonYears: Number(event.target.value) })}
          />
          <output>{settings.horizonYears}</output>
        </label>
        <label>
          Ciclo visible
          <input
            type="range"
            min={8}
            max={72}
            step={1}
            value={settings.durationHours}
            onChange={(event) => onChange({ ...settings, durationHours: Number(event.target.value) })}
          />
          <output>{settings.durationHours}h</output>
        </label>
        <div className="speed-control-group">
          <span>Velocidad</span>
          <div className="speed-preset-grid">
            {SIMULATION_SPEED_PRESETS.map((speed) => (
              <button
                key={speed}
                type="button"
                className={settings.speed === speed ? 'is-active' : ''}
                onClick={() => onChange({ ...settings, speed })}
              >
                x{speed}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel-section simulation-kpi-panel">
        <div className="compact-section-header">
          <h2>Resultado</h2>
          <button type="button" className="ghost-action" onClick={() => setDetailsOpen(true)}>Detalle</button>
        </div>
        <div className="simulation-kpi-grid">
          <Metric label="Pacientes" value={String(result?.kpis.completed ?? 0)} />
          <Metric label="ED P90" value={`${result?.kpis.edP90Minutes ?? 0} min`} />
          <Metric label="Bloqueados" value={String(result?.kpis.blockedPatients ?? 0)} />
          <Metric label="Avisos" value={String(warnCount + failCount)} />
        </div>
      </section>

      {detailsOpen && (
        <Modal
          titleId="simulation-detail-title"
          title="Detalle de simulacion"
          subtitle="KPIs operativos y reglas arquitectonicas del escenario actual"
          className="simulation-detail-modal"
          onClose={() => setDetailsOpen(false)}
        >
          <div className="simulation-detail-grid">
            <Metric label="Horizonte" value={`${settings.horizonYears} anos`} />
            <Metric label="Personal" value={String(result?.kpis.staffOnShift ?? 0)} />
            <Metric label="Personal movil" value={String(result?.kpis.staffInMotion ?? 0)} />
            <Metric label="Traslado medio" value={`${result?.kpis.averageTravelMinutes ?? 0} min`} />
            <Metric label="Cambios planta" value={String(result?.kpis.verticalMoves ?? 0)} />
            <Metric label="Zona cargada" value={result?.kpis.hottestRoomName ?? '-'} />
            <Metric label="Reglas correctas" value={String(rules.filter((rule) => rule.status === 'ok').length)} />
            <Metric label="Criticas" value={String(failCount)} />
          </div>
          <section className="top-modal-section">
            <h3>Reglas abiertas</h3>
            <div className="modal-rule-list compact">
              {failingRules.length > 0 ? (
                failingRules.map((rule) => (
                  <article key={rule.id} className={`rule-item ${rule.status}`}>
                    <strong>{rule.label}</strong>
                    <span>{rule.evidence}</span>
                  </article>
                ))
              ) : (
                <article className="rule-item ok">
                  <strong>Sin reglas abiertas</strong>
                  <span>El escenario actual no genera avisos arquitectonicos.</span>
                </article>
              )}
            </div>
          </section>
        </Modal>
      )}
    </>
  )
}
