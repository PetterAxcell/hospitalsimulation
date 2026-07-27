import { AGENT_LEGEND, KEYBOARD_SHORTCUTS, PRESSURE_LEGEND, ambientForHour, formatClock, hourOfDay, shiftForHour } from './simulationVisuals'

export interface StageProbe {
  /** Posicion en px relativa al contenedor del canvas. */
  x: number
  y: number
  title: string
  subtitle?: string
  lines: string[]
  accent: string
}

interface SimulationStageOverlayProps {
  motionMinute: number
  floorLabel: string
  probe: StageProbe | null
  legendOpen: boolean
  onToggleLegend: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onFitView: () => void
}

export function SimulationStageOverlay({
  motionMinute,
  floorLabel,
  probe,
  legendOpen,
  onToggleLegend,
  onZoomIn,
  onZoomOut,
  onFitView,
}: SimulationStageOverlayProps) {
  const hour = hourOfDay(motionMinute)
  const ambient = ambientForHour(hour)
  const shift = shiftForHour(hour)

  return (
    <>
      <div className="stage-hud" data-phase={ambient.id}>
        <div className="stage-hud-clock">
          <span className="stage-hud-icon" aria-hidden="true">{ambient.interiorLight > 0.5 ? '☾' : '☀'}</span>
          <strong>{formatClock(motionMinute)}</strong>
        </div>
        <div className="stage-hud-meta">
          <span>{ambient.label}</span>
          <span>{shift.label}</span>
          <span>{floorLabel}</span>
        </div>
      </div>

      <div className="stage-camera-controls">
        <button type="button" onClick={onZoomIn} aria-label="Acercar cámara" title="Acercar (rueda arriba)">+</button>
        <button type="button" onClick={onZoomOut} aria-label="Alejar cámara" title="Alejar (rueda abajo)">−</button>
        <button
          type="button"
          onClick={onFitView}
          aria-label="Encajar vista"
          title="Encajar vista (F o doble clic)"
        >
          ⤢
        </button>
        <button
          type="button"
          className={legendOpen ? 'is-active' : ''}
          onClick={onToggleLegend}
          aria-label="Mostrar leyenda"
          aria-pressed={legendOpen}
          title="Leyenda y atajos (L)"
        >
          ?
        </button>
      </div>

      {legendOpen ? (
        <div className="stage-legend" role="dialog" aria-label="Leyenda de la simulación">
          <div className="stage-legend-block">
            <h4>Agentes</h4>
            <ul>
              {AGENT_LEGEND.map((entry) => (
                <li key={entry.label}>
                  <span className="stage-legend-dot" style={{ background: entry.color }} aria-hidden="true" />
                  <span>{entry.label}</span>
                  {entry.note ? <em>{entry.note}</em> : null}
                </li>
              ))}
            </ul>
          </div>
          <div className="stage-legend-block">
            <h4>Presión por estancia</h4>
            <ul>
              {PRESSURE_LEGEND.map((entry) => (
                <li key={entry.label}>
                  <span className="stage-legend-dot" style={{ background: entry.color }} aria-hidden="true" />
                  <span>{entry.label}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="stage-legend-block">
            <h4>Atajos</h4>
            <ul className="stage-legend-keys">
              {KEYBOARD_SHORTCUTS.map((shortcut) => (
                <li key={shortcut.keys}>
                  <kbd>{shortcut.keys}</kbd>
                  <span>{shortcut.action}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {probe ? (
        <div
          className="stage-tooltip"
          style={{ left: probe.x, top: probe.y, borderTopColor: probe.accent }}
          role="status"
        >
          <strong>{probe.title}</strong>
          {probe.subtitle ? <span className="stage-tooltip-subtitle">{probe.subtitle}</span> : null}
          <ul>
            {probe.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  )
}
