import { useMemo, useState } from 'react'
import { KIND_LABELS } from '../../data/catalog'
import { isPassage } from '../../engine/circulation'
import { adjacencyComplies, summarizeAdjacency, type AdjacencyRuleResult, type AdjacencyStatus } from '../../engine/adjacencyMatrix'
import { METERS_PER_WORLD_UNIT } from '../../engine/geometry'
import { CollapsibleSection } from '../../components/ui/CollapsibleSection'
import { Metric } from '../../components/ui/Metric'
import { Modal } from '../../components/ui/Modal'
import type { HospitalPlan, PatientCaseFilter, PlacedRoom, SimulationResult } from '../../types'

// Longitud media de un paso humano al caminar (m). Se usa para convertir la
// distancia recorrida por el plano (en metros) a numero de pasos fisicos.
const STEP_METERS = 0.75

interface BottleneckRow {
  room: PlacedRoom
  count: number
  score: number
}

interface StepRow {
  id: string
  label: string
  color: string
  avgSteps: number
  patients: number
}

export function SaturationPanel({
  plan,
  result,
  selectedCaseId,
  adjacencyResults = [],
}: {
  plan: HospitalPlan
  result: SimulationResult | null
  selectedCaseId: PatientCaseFilter
  adjacencyResults?: AdjacencyRuleResult[]
}) {
  const [isReadingOpen, setReadingOpen] = useState(false)

  const adjacencySummary = useMemo(() => summarizeAdjacency(adjacencyResults), [adjacencyResults])
  const sortedAdjacency = useMemo(
    () => [...adjacencyResults].sort((a, b) => adjStatusWeight(b.status) - adjStatusWeight(a.status)),
    [adjacencyResults],
  )

  if (!result) {
    return (
      <div className="saturation-panel">
        <p className="muted">Ejecutando análisis.</p>
      </div>
    )
  }

  const selectedCase = selectedCaseId === 'all'
    ? undefined
    : result.caseStats.find((stat) => stat.id === selectedCaseId)
  const pressure = pressureForCase(plan, result, selectedCaseId)
  const bottlenecks = bottleneckRows(plan, pressure).slice(0, 12)
  const maxScore = Math.max(1, ...bottlenecks.map((row) => row.score))
  const stepStats = stepStatsByCase(plan, result)
  const maxSteps = Math.max(1, ...stepStats.rows.map((row) => row.avgSteps))
  const activeCases = result.caseStats.filter((stat) => stat.attempted > 0).sort((a, b) => b.attempted - a.attempted).slice(0, 5)
  const maxCaseLoad = Math.max(1, ...activeCases.map((stat) => stat.attempted))
  const saturated = bottlenecks.filter((row) => row.score >= 1).length

  const cumplen = adjacencySummary.ok + adjacencySummary.warn
  const noCumplen = adjacencySummary.fail + adjacencySummary.missing
  const adjacencyVerdict = adjacencyResults.length === 0
    ? { tone: 'ok' as const, label: 'Sin reglas' }
    : noCumplen > 0
      ? { tone: 'fail' as const, label: 'No cumple' }
      : { tone: 'ok' as const, label: 'Cumple' }

  return (
    <div className="saturation-panel analysis-panel">
      <section className="saturation-hero">
        <div className="saturation-hero-main">
          <span>Análisis de escenario</span>
          <h2>{selectedCase ? selectedCase.label : 'Todos los casos clínicos'}</h2>
          <div className="top-hero-actions">
            <button type="button" className="ghost-action" onClick={() => setReadingOpen(true)}>Lectura operativa</button>
          </div>
        </div>
        <div className="saturation-kpis">
          <Metric label="Adyacencia" value={adjacencyVerdict.label} />
          <Metric label="Pasos/paciente" value={String(stepStats.overallAvg)} />
          <Metric label="Saturados" value={String(saturated)} />
          <Metric label="Bloqueados" value={String(result.kpis.blockedPatients)} />
        </div>
      </section>

      <div className="analysis-sections">
        {/* 1. Cumplimiento de la matriz de adyacencia (arriba) */}
        <CollapsibleSection
          title="Matriz de adyacencia"
          badge={adjacencyResults.length === 0 ? undefined : adjacencyVerdict}
          summary={adjacencyResults.length === 0 ? 'Sin reglas definidas' : `${cumplen}/${adjacencySummary.total} reglas cumplen`}
        >
          <p className="analysis-block-hint">Cada regla de proximidad definida en Escenario cumple o no cumple frente al plano actual.</p>
          <div className="analysis-adjacency-kpis">
            <Metric label="Reglas" value={String(adjacencySummary.total)} />
            <Metric label="Cumplen" value={String(cumplen)} />
            <Metric label="No cumplen" value={String(noCumplen)} />
          </div>
          <div className="rule-list compact">
            {sortedAdjacency.length > 0 ? (
              sortedAdjacency.map((res) => {
                const ok = adjacencyComplies(res.status)
                return (
                  <article key={res.id} className={`rule-item ${ok ? 'ok' : 'fail'}`}>
                    <strong>{res.label} · {ok ? 'Cumple' : 'No cumple'}</strong>
                    <span>{res.evidence}</span>
                  </article>
                )
              })
            ) : (
              <article className="rule-item ok">
                <strong>Sin reglas de adyacencia</strong>
                <span>Define reglas en la matriz del tab Escenario para evaluarlas aquí.</span>
              </article>
            )}
          </div>
        </CollapsibleSection>

        {/* 2. Presión por estancia */}
        <CollapsibleSection
          title="Presión por estancia"
          summary={bottlenecks[0] ? `Máx ${formatDemandRatio(bottlenecks[0].score)} · ${saturated} saturados` : 'Sin demanda'}
        >
          <p className="analysis-block-hint">Pacientes que pasan por cada estancia frente a su capacidad. Añadir más bloques del mismo servicio reparte la carga.</p>
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
                    <span>{row.count} pacientes</span>
                    <span>Cap {row.room.capacity}</span>
                    <span>{KIND_LABELS[row.room.kind]}</span>
                  </div>
                </article>
              ))
            ) : (
              <p className="muted">Sin demanda suficiente.</p>
            )}
          </div>
        </CollapsibleSection>

        {/* 3. Pasos físicos por paciente (media ponderada) */}
        <CollapsibleSection
          title="Pasos por paciente"
          summary={`Media ${stepStats.overallAvg} pasos/paciente`}
        >
          <p className="analysis-block-hint">Media ponderada de pasos físicos que camina un paciente por el hospital (estimado a {STEP_METERS} m/paso; {METERS_PER_WORLD_UNIT} m por unidad de plano). Objetivo a optimizar.</p>
          <div className="chart-list">
            {stepStats.rows.length > 0 ? (
              stepStats.rows.map((row) => (
                <article key={row.id} className="chart-row compact">
                  <div className="chart-row-head">
                    <strong>{row.label}</strong>
                    <span>{row.avgSteps} pasos</span>
                  </div>
                  <div className="bar-track" aria-hidden="true">
                    <span className="bar-fill case" style={{ width: `${Math.max(6, (row.avgSteps / maxSteps) * 100)}%`, backgroundColor: row.color }} />
                  </div>
                  <div className="chart-chips">
                    <span>{row.patients} pacientes</span>
                  </div>
                </article>
              ))
            ) : (
              <p className="muted">Sin recorridos completados.</p>
            )}
          </div>
        </CollapsibleSection>

        {/* 4. Casos bloqueados */}
        <CollapsibleSection
          title="Casos bloqueados"
          summary={`${result.kpis.blockedPatients} pacientes bloqueados`}
        >
          <div className="chart-list">
            {activeCases.length > 0 ? (
              activeCases.map((stat) => (
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
              ))
            ) : (
              <p className="muted">Sin casos activos.</p>
            )}
          </div>
        </CollapsibleSection>
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

// Media ponderada de pasos fisicos por paciente. Para cada paciente se suma la
// distancia horizontal recorrida entre estancias consecutivas de su ruta (incluidos
// pasillos), se pasa a metros y se divide por la longitud de paso. Los cambios de
// planta (ascensores) no suman pasos porque no se caminan.
function stepStatsByCase(plan: HospitalPlan, result: SimulationResult): { rows: StepRow[]; overallAvg: number } {
  const roomById = new Map(plan.rooms.map((room) => [room.id, room]))
  const statById = new Map(result.caseStats.map((stat) => [stat.id, stat]))
  const acc = new Map<string, { steps: number; patients: number }>()
  let totalSteps = 0
  let totalPatients = 0

  for (const agent of result.agents) {
    if (agent.role !== 'patient' || !agent.caseId) continue
    let worldDistance = 0
    for (let i = 1; i < agent.route.length; i += 1) {
      const from = roomById.get(agent.route[i - 1].roomId)
      const to = roomById.get(agent.route[i].roomId)
      if (!from || !to) continue
      const fromX = from.x + from.w / 2
      const fromY = from.y + from.h / 2
      const toX = to.x + to.w / 2
      const toY = to.y + to.h / 2
      worldDistance += Math.hypot(fromX - toX, fromY - toY)
    }
    const steps = (worldDistance * METERS_PER_WORLD_UNIT) / STEP_METERS
    const entry = acc.get(agent.caseId) ?? { steps: 0, patients: 0 }
    entry.steps += steps
    entry.patients += 1
    acc.set(agent.caseId, entry)
    totalSteps += steps
    totalPatients += 1
  }

  const rows: StepRow[] = [...acc.entries()]
    .map(([id, entry]) => {
      const stat = statById.get(id)
      return {
        id,
        label: stat?.label ?? id,
        color: stat?.color ?? '#375171',
        avgSteps: Math.round(entry.steps / Math.max(1, entry.patients)),
        patients: entry.patients,
      }
    })
    .sort((a, b) => b.avgSteps - a.avgSteps)

  const overallAvg = totalPatients ? Math.round(totalSteps / totalPatients) : 0
  return { rows, overallAvg }
}

function adjStatusWeight(status: AdjacencyStatus): number {
  if (status === 'fail' || status === 'missing') return 3
  if (status === 'warn') return 2
  return 1
}

function formatDemandRatio(score: number): string {
  return `${Math.round(score * 100)}%`
}

function floorLabel(floor: number) {
  if (floor < 0) return `S${Math.abs(floor)}`
  if (floor === 0) return 'PB'
  return `P${floor}`
}
