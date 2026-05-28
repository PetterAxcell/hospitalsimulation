import { useMemo, useState } from 'react'
import './App.css'
import { HospitalCanvas } from './components/HospitalCanvas'
import { SimulationCanvas } from './components/SimulationCanvas'
import {
  KIND_LABELS, ROOM_TEMPLATES, templateById,
  DEFAULT_CHANNEL_CONFIGS, DEFAULT_DISRUPTOR_TEMPLATES,
} from './data/catalog'
import { PROGRAM_AREA_SCALE, createTertiaryHospitalPlan } from './data/presets'
import {
  evaluateArchitectureRules, evaluateSpecialistCoverage,
  evaluateChannelDensity, evaluateEmergencyResponse,
  type ArchitectureRuleResult,
} from './engine/architectureRules'
import { clampRoom, distance, overlapScore, roomByNode } from './engine/geometry'
import { DEFAULT_SIMULATION_SETTINGS } from './engine/simulation'
import type { SimulationSettings } from './types'
import type { HospitalPlan, PlacedRoom, SimulationResult } from './types'

type WorkspaceTab = 'plan' | 'simulation' | 'services' | 'analysis'

const INITIAL_PLAN = createTertiaryHospitalPlan()

function App() {
  const [plan, setPlan] = useState<HospitalPlan>(INITIAL_PLAN)
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('plan')
  const [selectedFloor, setSelectedFloor] = useState(0)
  const [selectedRoomId, setSelectedRoomId] = useState<string | undefined>(plan.rooms[0]?.id)
  const [templateToAdd, setTemplateToAdd] = useState('edBoxes')
  const [simulationSettings, setSimulationSettings] = useState<SimulationSettings>(DEFAULT_SIMULATION_SETTINGS)
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null)
  const [showChannels] = useState(true)
  const [manualDisruptor, setManualDisruptor] = useState('')

  const selectedRoom = plan.rooms.find((room) => room.id === selectedRoomId)
  const activeFloorRooms = plan.rooms.filter((room) => room.floor === selectedFloor)
  const floorArea = activeFloorRooms.reduce((sum, room) => sum + room.areaSqm, 0)
  const totalArea = plan.rooms.reduce((sum, room) => sum + room.areaSqm, 0)
  const rules = useMemo(() => evaluateArchitectureRules(plan), [plan])

  function updateRoom(nextRoom: PlacedRoom) {
    setPlan((current) => ({
      ...current,
      rooms: current.rooms.map((room) => (room.id === nextRoom.id ? clampRoom(nextRoom) : room)),
    }))
  }

  function addRoom() {
    const template = templateById(templateToAdd)
    const nextRoom: PlacedRoom = {
      id: `${template.id}-${Date.now()}`,
      templateId: template.id,
      name: template.name,
      kind: template.kind,
      floor: selectedFloor,
      x: 8,
      y: 8,
      w: Math.max(8, Math.min(22, Math.sqrt(template.defaultAreaSqm) / 4)),
      h: Math.max(7, Math.min(16, Math.sqrt(template.defaultAreaSqm) / 5)),
      capacity: template.defaultCapacity,
      areaSqm: Math.round(template.defaultAreaSqm * PROGRAM_AREA_SCALE),
      equipment: template.equipment,
      staffModel: template.staffModel,
      simulationNode: template.simulationNode,
    }
    setPlan((current) => ({ ...current, rooms: [...current.rooms, clampRoom(nextRoom)] }))
    setSelectedRoomId(nextRoom.id)
  }

  function duplicateSelected() {
    if (!selectedRoom) return
    const copy = clampRoom({
      ...selectedRoom,
      id: `${selectedRoom.templateId}-${Date.now()}`,
      name: `${selectedRoom.name} copia`,
      x: selectedRoom.x + 4,
      y: selectedRoom.y + 4,
      locked: false,
    })
    setPlan((current) => ({ ...current, rooms: [...current.rooms, copy] }))
    setSelectedRoomId(copy.id)
  }

  function removeSelected() {
    if (!selectedRoom || selectedRoom.locked) return
    setPlan((current) => ({ ...current, rooms: current.rooms.filter((room) => room.id !== selectedRoom.id) }))
    setSelectedRoomId(plan.rooms.find((room) => room.id !== selectedRoom.id)?.id)
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>{plan.name}</h1>
          <p>Editor y simulador espacial para hospital terciario de alta complejidad</p>
        </div>
        <div className="header-metrics">
          <Metric label="m2 objetivo" value={formatNumber(plan.targetAreaSqm)} />
          <Metric label="m2 modelados" value={formatNumber(totalArea)} />
          <Metric label="Plantas" value={String(plan.floors.length)} />
          <Metric label="Estancias" value={String(plan.rooms.length)} />
        </div>
      </header>

      <nav className="workspace-tabs" aria-label="Modulos">
        <TabButton id="plan" active={activeTab} onClick={setActiveTab}>Planificador</TabButton>
        <TabButton id="simulation" active={activeTab} onClick={setActiveTab}>Simulacion</TabButton>
        <TabButton id="services" active={activeTab} onClick={setActiveTab}>Servicios</TabButton>
        <TabButton id="analysis" active={activeTab} onClick={setActiveTab}>Analisis</TabButton>
      </nav>

      <section className="workbench">
        <aside className="left-panel">
          <section className="panel-section">
            <h2>Plantas</h2>
            <div className="floor-grid">
              {plan.floors.map((floor) => (
                <button
                  key={floor}
                  type="button"
                  className={floor === selectedFloor ? 'is-active' : ''}
                  onClick={() => setSelectedFloor(floor)}
                >
                  {floor}
                </button>
              ))}
            </div>
          </section>

          <section className="panel-section">
            <h2>Construir</h2>
            <label>
              Habitacion
              <select value={templateToAdd} onChange={(event) => setTemplateToAdd(event.target.value)}>
                {ROOM_TEMPLATES.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.shortName} · {KIND_LABELS[template.kind]}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="primary-action" onClick={addRoom}>Anadir a planta {selectedFloor}</button>
          </section>

          <section className="panel-section">
            <h2>Planta activa</h2>
            <Metric label="m2 planta" value={formatNumber(floorArea)} />
            <Metric label="Bloques" value={String(activeFloorRooms.length)} />
            <Metric label="Solapes" value={String(overlapScore(plan.rooms, selectedFloor))} />
          </section>
        </aside>

        <section className="main-panel">
          {activeTab === 'plan' && (
            <HospitalCanvas
              plan={plan}
              selectedFloor={selectedFloor}
              selectedRoomId={selectedRoomId}
              onSelectRoom={setSelectedRoomId}
              onChangeRoom={updateRoom}
              channelConfigs={simulationSettings.channelConfigs}
              showChannels={showChannels}
            />
          )}

          {activeTab === 'simulation' && (
            <SimulationCanvas
              plan={plan}
              selectedFloor={selectedFloor}
              settings={simulationSettings}
              onResult={setSimulationResult}
              channelConfigs={simulationSettings.channelConfigs}
            />
          )}

          {activeTab === 'services' && <ServiceMatrix plan={plan} />}
          {activeTab === 'analysis' && <AnalysisPanel plan={plan} result={simulationResult} rules={rules} />}
        </section>

        <aside className="right-panel">
          {activeTab === 'simulation' ? (
            <SimulationControls
              settings={simulationSettings}
              onChange={setSimulationSettings}
              result={simulationResult}
              rules={rules}
              manualDisruptor={manualDisruptor}
              onManualDisruptorChange={setManualDisruptor}
              selectedRoomName={selectedRoom?.name ?? '(selecciona una sala)'}
            />
          ) : (
            <RoomInspector
              room={selectedRoom}
              onChange={updateRoom}
              onDuplicate={duplicateSelected}
              onRemove={removeSelected}
            />
          )}
        </aside>
      </section>
    </main>
  )
}

interface TabButtonProps {
  id: WorkspaceTab
  active: WorkspaceTab
  children: string
  onClick: (tab: WorkspaceTab) => void
}

function TabButton({ id, active, children, onClick }: TabButtonProps) {
  return (
    <button type="button" className={active === id ? 'is-active' : ''} onClick={() => onClick(id)}>
      {children}
    </button>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function RoomInspector({
  room,
  onChange,
  onDuplicate,
  onRemove,
}: {
  room?: PlacedRoom
  onChange: (room: PlacedRoom) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  if (!room) {
    return (
      <section className="panel-section">
        <h2>Habitacion</h2>
        <p className="muted">Selecciona un bloque del plano.</p>
      </section>
    )
  }
  return (
    <>
      <section className="panel-section">
        <h2>Habitacion</h2>
        <label>
          Nombre
          <input value={room.name} onChange={(event) => onChange({ ...room, name: event.target.value })} />
        </label>
        <label>
          Planta
          <input type="number" value={room.floor} onChange={(event) => onChange({ ...room, floor: Number(event.target.value) })} />
        </label>
        <label>
          Capacidad
          <input type="number" value={room.capacity} onChange={(event) => onChange({ ...room, capacity: Number(event.target.value) })} />
        </label>
        <label>
          m2
          <input type="number" value={room.areaSqm} onChange={(event) => onChange({ ...room, areaSqm: Number(event.target.value) })} />
        </label>
      </section>

      <section className="panel-section">
        <h2>Equipamiento</h2>
        <div className="tag-list">
          {room.equipment.map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>

      <section className="panel-section">
        <h2>Personal</h2>
        <div className="tag-list">
          {room.staffModel.map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>

      <div className="button-row">
        <button type="button" onClick={onDuplicate}>Duplicar</button>
        <button type="button" onClick={onRemove} disabled={room.locked}>Eliminar</button>
      </div>
    </>
  )
}

function SimulationControls({
  settings,
  result,
  rules,
  onChange,
  manualDisruptor,
  onManualDisruptorChange,
  selectedRoomName,
}: {
  settings: SimulationSettings
  result: SimulationResult | null
  rules: ArchitectureRuleResult[]
  onChange: (settings: SimulationSettings) => void
  manualDisruptor: string
  onManualDisruptorChange: (value: string) => void
  selectedRoomName: string
}) {
  const failingRules = rules.filter((rule) => rule.status !== 'ok')

  return (
    <>
      <section className="panel-section">
        <h2>Parametros</h2>
        <label>
          Pacientes totales
          <input
            type="number"
            min={10}
            max={1000}
            value={settings.totalPatients ?? settings.arrivalsPerHour * settings.durationHours}
            onChange={(event) => onChange({ ...settings, totalPatients: Number(event.target.value) })}
          />
        </label>
        <label>
          Duracion horas
          <input
            type="range"
            min={8}
            max={72}
            value={settings.durationHours}
            onChange={(event) => onChange({ ...settings, durationHours: Number(event.target.value) })}
          />
          <output>{settings.durationHours}</output>
        </label>
        <label>
          Velocidad
          <input
            type="range"
            min={20}
            max={360}
            step={10}
            value={settings.speed}
            onChange={(event) => onChange({ ...settings, speed: Number(event.target.value) })}
          />
          <output>{settings.speed}x</output>
        </label>
      </section>

      <section className="panel-section">
        <h2>Staff</h2>
        <label>
          Specialists {Math.round(settings.staffProportions.specialist * 100)}%
          <input
            type="range" min={5} max={40} step={1}
            value={Math.round(settings.staffProportions.specialist * 100)}
            onChange={(event) => onChange({
              ...settings,
              staffProportions: { ...settings.staffProportions, specialist: Number(event.target.value) / 100 },
            })}
          />
        </label>
        <label>
          Nurses {Math.round(settings.staffProportions.nurse * 100)}%
          <input
            type="range" min={20} max={60} step={1}
            value={Math.round(settings.staffProportions.nurse * 100)}
            onChange={(event) => onChange({
              ...settings,
              staffProportions: { ...settings.staffProportions, nurse: Number(event.target.value) / 100 },
            })}
          />
        </label>
        <label>
          Technicians {Math.round(settings.staffProportions.technician * 100)}%
          <input
            type="range" min={10} max={50} step={1}
            value={Math.round(settings.staffProportions.technician * 100)}
            onChange={(event) => onChange({
              ...settings,
              staffProportions: { ...settings.staffProportions, technician: Number(event.target.value) / 100 },
            })}
          />
        </label>
        <label>
          Security {Math.round(settings.staffProportions.security * 100)}%
          <input
            type="range" min={1} max={15} step={1}
            value={Math.round(settings.staffProportions.security * 100)}
            onChange={(event) => onChange({
              ...settings,
              staffProportions: { ...settings.staffProportions, security: Number(event.target.value) / 100 },
            })}
          />
        </label>
        <label>
          Emergency team ratio (1/{settings.emergencyTeamRatio})
          <input
            type="range" min={50} max={500} step={10}
            value={settings.emergencyTeamRatio}
            onChange={(event) => onChange({ ...settings, emergencyTeamRatio: Number(event.target.value) })}
          />
        </label>
      </section>

      <section className="panel-section">
        <h2>Perturbadores</h2>
        <label>
          Probabilidad por paciente
          <input
            type="range" min={0} max={20} step={1}
            value={Math.round(settings.disruptorProbability * 100)}
            onChange={(event) => onChange({ ...settings, disruptorProbability: Number(event.target.value) / 100 })}
          />
          <output>{Math.round(settings.disruptorProbability * 100)}%</output>
        </label>
        <label>
          Eventos por hora
          <input
            type="range" min={0} max={5} step={0.5}
            value={settings.disruptorEventsPerHour}
            onChange={(event) => onChange({ ...settings, disruptorEventsPerHour: Number(event.target.value) })}
          />
          <output>{settings.disruptorEventsPerHour}</output>
        </label>
      </section>

      <section className="panel-section">
        <h2>⚠️ Inyectar perturbación</h2>
        <select value={manualDisruptor} onChange={(e) => {
          const value = e.target.value
          onManualDisruptorChange(value)
          if (value) {
            onChange({ ...settings, seed: settings.seed + 1 })
          }
        }}>
          <option value="">Seleccionar tipo...</option>
          {DEFAULT_DISRUPTOR_TEMPLATES.map(t => (
            <option key={t.id} value={t.id}>{t.icon} {t.name}</option>
          ))}
        </select>
        <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          Sala: {selectedRoomName}
        </p>
      </section>

      <section className="panel-section">
        <h2>Resultado</h2>
        <Metric label="Pacientes" value={String(result?.kpis.completed ?? 0)} />
        <Metric label="ED P90" value={`${result?.kpis.edP90Minutes ?? 0} min`} />
        <Metric label="Traslado medio" value={`${result?.kpis.averageTravelMinutes ?? 0} min`} />
        <Metric label="Staff total" value={String(result?.kpis.totalStaff ?? 0)} />
        {result && result.kpis.disruptorEvents_total > 0 && (
          <>
            <Metric label="Eventos" value={String(result.kpis.disruptorEvents_total)} />
            <Metric label="Resueltos" value={String(result.kpis.disruptorEvents_resolved)} />
            <Metric label="Escalados" value={String(result.kpis.disruptorEvents_escalated)} />
            <Metric label="Tasa escalado" value={`${(result.kpis.disruptorEvents_escalationRate * 100).toFixed(0)}%`} />
            <Metric label="Tiempo respuesta" value={`${result.kpis.disruptorEvents_avgResponseTime.toFixed(1)} min`} />
            <Metric label="Salas bloqueadas" value={String(result.kpis.disruptorEvents_roomsBlocked)} />
          </>
        )}
        <Metric label="Canales saturados" value={String(result?.kpis.channelCongestionHotspots ?? 0)} />
      </section>

      <section className="panel-section">
        <h2>Reglas arquitectura</h2>
        <Metric label="Correctas" value={String(rules.filter((rule) => rule.status === 'ok').length)} />
        <Metric label="Avisos" value={String(rules.filter((rule) => rule.status === 'warn').length)} />
        <Metric label="Criticas" value={String(rules.filter((rule) => rule.status === 'fail').length)} />
        <div className="rule-list compact">
          {failingRules.slice(0, 6).map((rule) => (
            <article key={rule.id} className={`rule-item ${rule.status}`}>
              <strong>{rule.label}</strong>
              <span>{rule.evidence}</span>
            </article>
          ))}
        </div>
      </section>
    </>
  )
}

function ServiceMatrix({ plan }: { plan: HospitalPlan }) {
  const rows = Object.entries(
    plan.rooms.reduce<Record<string, { count: number; area: number; capacity: number }>>((acc, room) => {
      const label = KIND_LABELS[room.kind]
      acc[label] ??= { count: 0, area: 0, capacity: 0 }
      acc[label].count += 1
      acc[label].area += room.areaSqm
      acc[label].capacity += room.capacity
      return acc
    }, {}),
  ).sort((a, b) => b[1].area - a[1].area)

  return (
    <div className="table-panel">
      <table>
        <thead>
          <tr>
            <th>Servicio</th>
            <th>Bloques</th>
            <th>m2</th>
            <th>Capacidad</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([kind, value]) => (
            <tr key={kind}>
              <td>{kind}</td>
              <td>{value.count}</td>
              <td>{formatNumber(value.area)}</td>
              <td>{value.capacity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AnalysisPanel({
  plan,
  result,
  rules,
}: {
  plan: HospitalPlan
  result: SimulationResult | null
  rules: ArchitectureRuleResult[]
}) {
  const ed = roomByNode(plan.rooms, 'ed_bay')
  const imaging = roomByNode(plan.rooms, 'imaging')
  const or = roomByNode(plan.rooms, 'or')
  const icu = roomByNode(plan.rooms, 'icu')
  const ward = roomByNode(plan.rooms, 'ward')
  const routes = [
    ['ED a imagen', ed, imaging],
    ['ED a quirofano', ed, or],
    ['Quirofano a UCI', or, icu],
    ['PACU a ward', roomByNode(plan.rooms, 'pacu'), ward],
  ] as const

  // Combine all rules including new ones
  const allRules = [
    ...rules,
    ...evaluateSpecialistCoverage(plan),
    ...evaluateChannelDensity(plan, DEFAULT_CHANNEL_CONFIGS),
    ...evaluateEmergencyResponse(plan, DEFAULT_CHANNEL_CONFIGS),
  ]

  const groupedAllRules =
    allRules.reduce<Record<string, ArchitectureRuleResult[]>>((acc, rule) => {
      acc[rule.category] ??= []
      acc[rule.category].push(rule)
      return acc
    }, {})

  return (
    <div className="analysis-grid">
      <section className="analysis-block">
        <h2>Recorridos criticos</h2>
        {routes.map(([label, a, b]) => (
          <Metric key={label} label={label} value={a && b ? `${Math.round(distance(a, b))}` : '-'} />
        ))}
      </section>
      <section className="analysis-block">
        <h2>Seguridad funcional</h2>
        <div className="rule-list">
          {Object.entries(groupedAllRules).map(([category, categoryRules]) => (
            <div key={category} className="rule-category">
              <h3>{category}</h3>
              {categoryRules.map((rule) => (
                <article key={rule.id} className={`rule-item ${rule.status}`}>
                  <strong>{rule.label}</strong>
                  <span>{rule.evidence}</span>
                </article>
              ))}
            </div>
          ))}
        </div>
      </section>
      <section className="analysis-block">
        <h2>Simulacion</h2>
        <Metric label="Zona mas cargada" value={result?.kpis.hottestRoomName ?? '-'} />
        <Metric label="Staff total" value={String(result?.kpis.totalStaff ?? 0)} />
        <Metric label="Canales saturados" value={String(result?.kpis.channelCongestionHotspots ?? 0)} />
        {result && result.kpis.disruptorEvents_total > 0 && (
          <>
            <h3>Perturbadores</h3>
            <Metric label="Eventos" value={String(result.kpis.disruptorEvents_total)} />
            <Metric label="Resueltos" value={String(result.kpis.disruptorEvents_resolved)} />
            <Metric label="Escalados" value={String(result.kpis.disruptorEvents_escalated)} />
            <Metric label="Tiempo respuesta" value={`${result.kpis.disruptorEvents_avgResponseTime.toFixed(1)} min`} />
            <Metric label="Tiempo resolucion" value={`${result.kpis.disruptorEvents_avgResolutionTime.toFixed(1)} min`} />
            <Metric label="Propagaciones" value={String(result.kpis.disruptorEvents_propagationCount)} />
            <Metric label="Salas bloqueadas" value={String(result.kpis.disruptorEvents_roomsBlocked)} />
            <Metric label="Pacientes afectados" value={String(result.kpis.disruptorEvents_patientsAffected)} />
          </>
        )}
        <Metric label="Avisos" value={String(allRules.filter((rule) => rule.status !== 'ok').length)} />
      </section>
    </div>
  )
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('es-ES').format(Math.round(value))
}

export default App
