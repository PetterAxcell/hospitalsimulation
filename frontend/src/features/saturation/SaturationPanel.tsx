import { useState } from 'react'
import { KIND_LABELS } from '../../data/catalog'
import { isPassage } from '../../engine/circulation'
import { Metric } from '../../components/ui/Metric'
import { Modal } from '../../components/ui/Modal'
import type { HospitalPlan, PatientCaseFilter, PlacedRoom, SimulationResult } from '../../types'

interface BottleneckRow {
  room: PlacedRoom
  count: number
  score: number
}

export function SaturationPanel({
  plan,
  result,
  selectedCaseId,
}: {
  plan: HospitalPlan
  result: SimulationResult | null
  selectedCaseId: PatientCaseFilter
}) {
  const [isReadingOpen, setReadingOpen] = useState(false)

  if (!result) {
    return (
      <div className="saturation-panel">
        <p className="muted">Ejecutando analisis.</p>
      </div>
    )
  }

  const selectedCase = selectedCaseId === 'all'
    ? undefined
    : result.caseStats.find((stat) => stat.id === selectedCaseId)
  const pressure = pressureForCase(plan, result, selectedCaseId)
  const bottlenecks = bottleneckRows(plan, pressure).slice(0, 12)
  const maxScore = Math.max(1, ...bottlenecks.map((row) => row.score))
  const activeCases = result.caseStats.filter((stat) => stat.attempted > 0).sort((a, b) => b.attempted - a.attempted).slice(0, 5)
  const maxCaseLoad = Math.max(1, ...activeCases.map((stat) => stat.attempted))
  const saturated = bottlenecks.filter((row) => row.score >= 1).length
  const warning = bottlenecks.filter((row) => row.score >= 0.6 && row.score < 1).length

  return (
    <div className="saturation-panel">
      <section className="saturation-hero">
        <div className="saturation-hero-main">
          <span>Analisis de cuellos de botella</span>
          <h2>{selectedCase ? selectedCase.label : 'Todos los casos clinicos'}</h2>
          <div className="top-hero-actions">
            <button type="button" className="ghost-action" onClick={() => setReadingOpen(true)}>Lectura operativa</button>
          </div>
        </div>
        <div className="saturation-kpis">
          <Metric label="Bloque critico" value={bottlenecks[0]?.room.name ?? '-'} />
          <Metric label="Saturados" value={String(saturated)} />
          <Metric label="En tension" value={String(warning)} />
          <Metric label="Bloqueados" value={String(result.kpis.blockedPatients)} />
        </div>
      </section>

      <div className="saturation-grid saturation-grid-compact">
        <section className="saturation-block wide">
          <h3>Presion por estancia</h3>
          <div className="chart-list">
            {bottlenecks.length > 0 ? (
              bottlenecks.map((row) => (
                <article key={row.room.id} className="chart-row">
                  <div className="chart-row-head">
                    <strong>{row.room.name}</strong>
                    <span>{floorLabel(row.room.floor)} · {formatDemandRatio(row.score)}</span>
                  </div>
                  <div className="bar-track large" aria-hidden="true">
                    <span
                      className={`bar-fill ${row.score >= 1 ? 'danger' : row.score >= 0.6 ? 'warn' : ''}`}
                      style={{ width: `${Math.max(4, Math.min(100, (row.score / maxScore) * 100))}%` }}
                    />
                  </div>
                  <div className="chart-chips">
                    <span>{row.count} pasos</span>
                    <span>Cap {row.room.capacity}</span>
                    <span>{KIND_LABELS[row.room.kind]}</span>
                  </div>
                </article>
              ))
            ) : (
              <p className="muted">Sin demanda suficiente.</p>
            )}
          </div>
        </section>

        <section className="saturation-block">
          <h3>Casos bloqueados</h3>
          <div className="chart-list">
            {activeCases.map((stat) => (
              <article key={stat.id} className="chart-row compact">
                <div className="chart-row-head">
                  <strong>{stat.label}</strong>
                  <span>{stat.completed}/{stat.attempted}</span>
                </div>
                <div className="bar-track" aria-hidden="true">
                  <span className="bar-fill case" style={{ width: `${Math.max(5, (stat.attempted / maxCaseLoad) * 100)}%`, backgroundColor: stat.color }} />
                </div>
                <div className="chart-chips">
                  <span>{stat.blocked} bloqueados</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="saturation-block saturation-summary">
          <h3>Estado operativo</h3>
          <Metric label="Mayor presion" value={bottlenecks[0] ? formatDemandRatio(bottlenecks[0].score) : '-'} />
          <Metric label="Caso activo" value={selectedCase?.id ?? 'Todos'} />
          <button type="button" className="secondary-action" onClick={() => setReadingOpen(true)}>Abrir lectura</button>
        </section>
      </div>

      {isReadingOpen && (
        <SaturationReadingModal bottlenecks={bottlenecks} onClose={() => setReadingOpen(false)} />
      )}
    </div>
  )
}

function SaturationReadingModal({ bottlenecks, onClose }: { bottlenecks: BottleneckRow[]; onClose: () => void }) {
  return (
    <Modal
      titleId="saturation-reading-title"
      title="Lectura operativa"
      subtitle="Estancias donde la demanda simulada tensiona capacidad, rutas o reglas de flujo."
      onClose={onClose}
    >
      <div className="rule-list modal-rule-list">
        {bottlenecks.slice(0, 8).map((row) => (
          <article key={row.room.id} className={`rule-item ${row.score >= 1 ? 'fail' : row.score >= 0.6 ? 'warn' : 'ok'}`}>
            <strong>{row.room.name}</strong>
            <span>{formatDemandRatio(row.score)} de demanda relativa · {floorLabel(row.room.floor)} · capacidad {row.room.capacity}</span>
          </article>
        ))}
      </div>
    </Modal>
  )
}

function pressureForCase(plan: HospitalPlan, result: SimulationResult, selectedCaseId: PatientCaseFilter): Record<string, number> {
  if (selectedCaseId === 'all') return result.roomPressure

  const serviceRoomIds = new Set(plan.rooms.filter((room) => !isPassage(room) && room.kind !== 'green' && room.kind !== 'future').map((room) => room.id))
  const pressure: Record<string, number> = {}
  result.agents
    .filter((agent) => agent.role === 'patient' && agent.caseId === selectedCaseId)
    .forEach((agent) => {
      const visited = new Set<string>()
      agent.route.forEach((stop) => {
        if (serviceRoomIds.has(stop.roomId)) visited.add(stop.roomId)
      })
      visited.forEach((roomId) => {
        pressure[roomId] = (pressure[roomId] ?? 0) + 1
      })
    })
  return pressure
}

function bottleneckRows(plan: HospitalPlan, pressure: Record<string, number>): BottleneckRow[] {
  return Object.entries(pressure)
    .map(([roomId, count]) => {
      const room = plan.rooms.find((item) => item.id === roomId)
      if (!room) return null
      return {
        room,
        count,
        score: count / Math.max(1, room.capacity),
      }
    })
    .filter((row): row is BottleneckRow => row !== null)
    .sort((a, b) => b.score - a.score)
}

function formatDemandRatio(score: number): string {
  return `${Math.round(score * 100)}%`
}

function floorLabel(floor: number) {
  if (floor < 0) return `S${Math.abs(floor)}`
  if (floor === 0) return 'PB'
  return `P${floor}`
}
