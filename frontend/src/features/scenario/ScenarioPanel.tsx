import { Metric } from '../../components/ui/Metric'
import { DEFAULT_SIMULATION_SETTINGS, type SimulationSettings } from '../../engine/simulation'
import type { AdjacencyRule, AdjacencyRuleResult } from '../../engine/adjacencyMatrix'
import type { RoomKind, SimulationResult } from '../../types'
import { AdjacencyMatrixPanel } from './AdjacencyMatrixPanel'

const SIMULATION_SPEED_PRESETS = [1, 2, 10, 20]

interface ScenarioPanelProps {
  settings: SimulationSettings
  result: SimulationResult | null
  adjacencyRules: AdjacencyRule[]
  adjacencyResults: AdjacencyRuleResult[]
  onChangeSettings: (settings: SimulationSettings) => void
  onCycleAdjacency: (a: RoomKind, b: RoomKind) => void
  onResetAdjacency: () => void
  onClearAdjacency: () => void
  onSaveToTop: () => void
}

export function ScenarioPanel({
  settings,
  result,
  adjacencyRules,
  adjacencyResults,
  onChangeSettings,
  onCycleAdjacency,
  onResetAdjacency,
  onClearAdjacency,
  onSaveToTop,
}: ScenarioPanelProps) {
  const arrivalsPerDay = settings.arrivalsPerHour * 24
  const isDefaultSettings =
    settings.arrivalsPerHour === DEFAULT_SIMULATION_SETTINGS.arrivalsPerHour &&
    settings.horizonYears === DEFAULT_SIMULATION_SETTINGS.horizonYears &&
    settings.durationHours === DEFAULT_SIMULATION_SETTINGS.durationHours &&
    settings.speed === DEFAULT_SIMULATION_SETTINGS.speed &&
    settings.seed === DEFAULT_SIMULATION_SETTINGS.seed

  const update = (patch: Partial<SimulationSettings>) => onChangeSettings({ ...settings, ...patch })

  return (
    <div className="scenario-dashboard">
      <section className="scenario-hero">
        <div className="scenario-hero-intro">
          <span>Escenario de simulación</span>
          <h2>Demanda, horizonte y relaciones espaciales</h2>
          <p>
            Configura los supuestos de la simulación y las adyacencias objetivo entre servicios. Los cambios se
            aplican al instante al resto de módulos (Simulación y Análisis).
          </p>
          <div className="scenario-hero-actions">
            <button type="button" className="primary-action scenario-save" onClick={onSaveToTop}>Guardar en Top</button>
          </div>
        </div>
        <div className="scenario-hero-kpis">
          <Metric label="Llegadas/día" value={String(arrivalsPerDay)} />
          <Metric label="Pacientes atendidos" value={String(result?.kpis.completed ?? 0)} />
          <Metric label="Bloqueos" value={String(result?.kpis.blockedPatients ?? 0)} />
          <Metric label="P90 Urgencias" value={`${result?.kpis.edP90Minutes ?? 0} min`} />
        </div>
      </section>

      <section className="scenario-params-card">
        <div className="scenario-card-head">
          <div>
            <h3>Parámetros de simulación</h3>
            <p>Demanda de pacientes, horizonte temporal, ciclo visible del replay y semilla reproducible.</p>
          </div>
          <button
            type="button"
            className="secondary-action scenario-reset"
            onClick={() => onChangeSettings(DEFAULT_SIMULATION_SETTINGS)}
            disabled={isDefaultSettings}
          >
            Restablecer
          </button>
        </div>

        <div className="scenario-params-grid">
          <label className="scenario-field">
            <span className="scenario-field-label">
              Llegadas por hora <b>{settings.arrivalsPerHour}</b>
            </span>
            <input
              type="range"
              min={3}
              max={24}
              value={settings.arrivalsPerHour}
              onChange={(event) => update({ arrivalsPerHour: Number(event.target.value) })}
            />
            <span className="scenario-field-hint">Pacientes que llegan cada hora ({arrivalsPerDay}/día aprox.).</span>
          </label>

          <label className="scenario-field">
            <span className="scenario-field-label">
              Años a simular <b>{settings.horizonYears}</b>
            </span>
            <input
              type="range"
              min={1}
              max={10}
              value={settings.horizonYears}
              onChange={(event) => update({ horizonYears: Number(event.target.value) })}
            />
            <span className="scenario-field-hint">Horizonte temporal del escenario, en años.</span>
          </label>

          <label className="scenario-field">
            <span className="scenario-field-label">
              Ciclo visible <b>{settings.durationHours} h</b>
            </span>
            <input
              type="range"
              min={8}
              max={72}
              step={1}
              value={settings.durationHours}
              onChange={(event) => update({ durationHours: Number(event.target.value) })}
            />
            <span className="scenario-field-hint">Ventana horaria que se anima en el replay 2D.</span>
          </label>

          <div className="scenario-field">
            <span className="scenario-field-label">
              Semilla <b>{settings.seed}</b>
            </span>
            <div className="scenario-seed-row">
              <input
                type="number"
                min={0}
                value={settings.seed}
                onChange={(event) => update({ seed: Math.max(0, Math.round(Number(event.target.value) || 0)) })}
              />
              <button
                type="button"
                className="ghost-action"
                onClick={() => update({ seed: Math.floor(Math.random() * 100000) })}
              >
                Aleatoria
              </button>
            </div>
            <span className="scenario-field-hint">Fija la aleatoriedad para reproducir el mismo escenario.</span>
          </div>

          <div className="scenario-field scenario-field-speed">
            <span className="scenario-field-label">Velocidad de replay</span>
            <div className="speed-preset-grid">
              {SIMULATION_SPEED_PRESETS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  className={settings.speed === speed ? 'is-active' : ''}
                  onClick={() => update({ speed })}
                >
                  x{speed}
                </button>
              ))}
            </div>
            <span className="scenario-field-hint">Multiplicador de tiempo en la animación de la simulación.</span>
          </div>
        </div>
      </section>

      <AdjacencyMatrixPanel
        rules={adjacencyRules}
        results={adjacencyResults}
        onCycle={onCycleAdjacency}
        onReset={onResetAdjacency}
        onClear={onClearAdjacency}
      />
    </div>
  )
}
