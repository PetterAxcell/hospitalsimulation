import type { SimulationSettings } from '../engine/simulation'
import type { PatientCaseFilter, SimulationAgentLayer, SimulationResult } from '../types'

export type SimulationViewMode = 'topDown' | 'isometric'

const SPEED_PRESETS = [1, 2, 10, 20]

interface SimulationControlsBarProps {
  result: SimulationResult
  settings: SimulationSettings
  minute: number
  motionMinute: number
  selectedCaseId: PatientCaseFilter
  agentLayer: SimulationAgentLayer
  viewMode: SimulationViewMode
  playing: boolean
  onTogglePlaying: () => void
  onChangeMinute: (minute: number, motionMinute: number) => void
  onChangeViewMode: (viewMode: SimulationViewMode) => void
  onChangeSpeed: (speed: number) => void
  onChangeAgentLayer: (layer: SimulationAgentLayer) => void
  onSelectCase: (caseId: PatientCaseFilter) => void
}

export function SimulationControlsBar({
  result,
  settings,
  minute,
  motionMinute,
  selectedCaseId,
  agentLayer,
  viewMode,
  playing,
  onTogglePlaying,
  onChangeMinute,
  onChangeViewMode,
  onChangeSpeed,
  onChangeAgentLayer,
  onSelectCase,
}: SimulationControlsBarProps) {
  return (
    <div className="sim-controls">
      <button type="button" onClick={onTogglePlaying}>{playing ? 'Pausa' : 'Play'}</button>
      <input
        type="range"
        min={0}
        max={result.durationMinutes}
        value={minute}
        onChange={(event) => {
          const nextMinute = Number(event.target.value)
          const nextMotionMinute = (nextMinute / Math.max(1, result.durationMinutes)) * result.motionCycleMinutes
          onChangeMinute(nextMinute, nextMotionMinute)
        }}
      />
      <span>{formatHorizonTime(minute, motionMinute, settings.horizonYears)}</span>
      <div className="sim-view-toggle" aria-label="Vista de simulacion">
        <button
          type="button"
          className={viewMode === 'topDown' ? 'is-active' : ''}
          onClick={() => onChangeViewMode('topDown')}
        >
          2D
        </button>
        <button
          type="button"
          className={viewMode === 'isometric' ? 'is-active' : ''}
          onClick={() => onChangeViewMode('isometric')}
        >
          3D
        </button>
      </div>
      <div className="sim-speed-presets" aria-label="Velocidad de simulacion">
        {SPEED_PRESETS.map((speed) => (
          <button
            key={speed}
            type="button"
            className={settings.speed === speed ? 'is-active' : ''}
            onClick={() => onChangeSpeed(speed)}
            data-speed={speed}
          >
            x{speed}
          </button>
        ))}
      </div>
      <select value={agentLayer} onChange={(event) => onChangeAgentLayer(event.target.value as SimulationAgentLayer)} aria-label="Agentes visibles">
        <option value="all">Pacientes + personal</option>
        <option value="patients">Solo casos</option>
        <option value="staff">Solo personal</option>
      </select>
      <select value={selectedCaseId} onChange={(event) => onSelectCase(event.target.value as PatientCaseFilter)} aria-label="Caso clinico visible">
        <option value="all">Todos los casos</option>
        {result.caseStats.map((stat) => (
          <option key={stat.id} value={stat.id}>
            {stat.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function formatHorizonTime(minutes: number, motionMinutes: number, horizonYears: number) {
  const totalDays = Math.max(1, horizonYears) * 365
  const dayIndex = Math.floor(minutes / (24 * 60)) % totalDays
  const year = Math.floor(dayIndex / 365) + 1
  const day = dayIndex % 365 + 1
  const hour = Math.floor(motionMinutes / 60) % 24
  const minute = Math.floor(motionMinutes % 60)
  return `Ano ${year} · dia ${day} · ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
