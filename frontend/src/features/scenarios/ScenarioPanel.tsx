import { useState } from 'react'
import { Metric } from '../../components/ui/Metric'
import { Modal } from '../../components/ui/Modal'
import { formatScore } from '../top/scoring'
import { formatTimestamp, isRunStale, rankScenarios } from './runner'
import type { Scenario, ScenarioRun } from './types'

interface ScenarioPanelProps {
  scenarios: Scenario[]
  runs: Record<string, ScenarioRun>
  activeScenarioId?: string
  defaultName: string
  owner: string
  error?: string
  onSave: (name: string) => void
  onLoad: (scenarioId: string) => void
  onUpdate: (scenarioId: string) => void
  onDuplicate: (scenarioId: string) => void
  onDelete: (scenarioId: string) => void
  onRun: (scenarioId: string) => void
  onRunAll: () => void
}

/** Bloque compacto del planificador para crear y comparar escenarios. */
export function ScenarioPanel({
  scenarios,
  runs,
  activeScenarioId,
  defaultName,
  owner,
  error,
  onSave,
  onLoad,
  onUpdate,
  onDuplicate,
  onDelete,
  onRun,
  onRunAll,
}: ScenarioPanelProps) {
  const [name, setName] = useState('')
  const [isListOpen, setListOpen] = useState(false)
  const ranked = rankScenarios(scenarios, runs)
  const leader = ranked.find((row) => row.run)
  const staleCount = scenarios.filter((scenario) => isRunStale(scenario, runs[scenario.id])).length

  function save() {
    onSave(name.trim() || defaultName)
    setName('')
  }

  return (
    <section className="panel-section scenario-panel">
      <h2>Escenarios</h2>
      <label>
        Nombre
        <input
          value={name}
          placeholder={defaultName}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save()
          }}
        />
      </label>
      <button type="button" className="primary-action" onClick={save}>Guardar escenario actual</button>
      {error && <p className="scenario-error" role="alert">{error}</p>}

      <div className="scenario-metrics">
        <Metric label="Guardados" value={String(scenarios.length)} />
        <Metric label="Pendientes" value={String(staleCount)} />
      </div>
      <Metric label="Lider" value={leader?.run ? `${leader.scenario.name} · ${formatScore(leader.run.score.value)}` : '-'} />

      <div className="scenario-actions">
        <button type="button" className="secondary-action" onClick={() => setListOpen(true)}>Abrir escenarios</button>
        <button type="button" className="secondary-action" onClick={onRunAll} disabled={scenarios.length === 0}>
          Relanzar todos
        </button>
      </div>

      {isListOpen && (
        <Modal
          titleId="scenario-list-title"
          title="Escenarios guardados"
          subtitle="Cada escenario congela plano, demanda, mezcla clinica y matriz de adyacencia."
          className="scenario-modal"
          onClose={() => setListOpen(false)}
        >
          {scenarios.length === 0 ? (
            <p className="modal-empty">Guarda el plano actual para empezar a comparar escenarios.</p>
          ) : (
            <div className="scenario-list">
              {ranked.map((row, index) => {
                const stale = isRunStale(row.scenario, runs[row.scenario.id])
                return (
                  <article
                    key={row.scenario.id}
                    className={`scenario-row ${row.scenario.id === activeScenarioId ? 'is-active' : ''}`}
                  >
                    <header>
                      <span className="scenario-rank">#{index + 1}</span>
                      <div>
                        <h4>{row.scenario.name}</h4>
                        <p>
                          {row.scenario.owner} · {row.scenario.plan.rooms.length} estancias
                          {row.scenario.caseMixSource ? ` · casos ${row.scenario.caseMixSource}` : ''}
                        </p>
                      </div>
                      <strong>{row.run ? formatScore(row.run.score.value) : '-'}</strong>
                    </header>
                    <div className="scenario-chips">
                      {stale || !row.run ? (
                        <span className="scenario-chip is-stale">Sin relanzar</span>
                      ) : (
                        <span className="scenario-chip">{formatTimestamp(row.run.ranAt)}</span>
                      )}
                      {row.run && <span className="scenario-chip">ED {row.run.edP90}m</span>}
                      {row.run && <span className="scenario-chip">{row.run.blocked} bloqueados</span>}
                      {row.run && <span className="scenario-chip">{row.run.casesApplied} casos</span>}
                      {row.run && <span className="scenario-chip">{row.run.ruleIssues + row.run.adjacencyIssues} reglas</span>}
                    </div>
                    <div className="scenario-row-actions">
                      <button type="button" onClick={() => onRun(row.scenario.id)}>Relanzar</button>
                      <button type="button" onClick={() => onLoad(row.scenario.id)}>Cargar</button>
                      <button
                        type="button"
                        title="Reescribe este escenario con el plano y los parametros que hay ahora en el editor"
                        onClick={() => onUpdate(row.scenario.id)}
                      >
                        Actualizar
                      </button>
                      <button type="button" onClick={() => onDuplicate(row.scenario.id)}>Duplicar</button>
                      <button type="button" className="danger-action" onClick={() => onDelete(row.scenario.id)}>Borrar</button>
                    </div>
                    {row.scenario.notes && <p className="scenario-notes">{row.scenario.notes}</p>}
                  </article>
                )
              })}
            </div>
          )}
          <p className="scenario-hint">
            Autor actual: <strong>{owner}</strong>. El ranking del Top usa el ultimo resultado de cada escenario.
          </p>
        </Modal>
      )}
    </section>
  )
}
