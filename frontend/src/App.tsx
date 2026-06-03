import { Suspense, lazy, useMemo, useState } from 'react'
import './App.css'
import { HospitalCanvas } from './components/HospitalCanvas'
import { KIND_LABELS, ROOM_TEMPLATES, templateById } from './data/catalog'
import { createTertiaryHospitalPlan } from './data/presets'
import { evaluateArchitectureRules, type ArchitectureRuleResult } from './engine/architectureRules'
import {
  defaultDoorForRoom,
  disconnectedPassages,
  disconnectedPatientRooms,
  doorConnectsToCorridor,
  doorWorldPosition,
  hasPassageAccess,
  isPassage,
  requiresCorridorAccess,
  snapDoorToRoom,
  type DoorPoint,
} from './engine/circulation'
import {
  areaSqmForDimensions,
  clampRoom,
  distance,
  metersToWorldUnits,
  overlapScore,
  roomByNode,
  worldUnitsToMeters,
} from './engine/geometry'
import { compilePlanningScript, DEFAULT_PLANNING_SCRIPT, type PlanningLanguageResult } from './engine/planningLanguage'
import {
  DEFAULT_CLINICAL_CASES_YAML,
  DEFAULT_PATIENT_CASES,
  DEFAULT_SIMULATION_SETTINGS,
  compileClinicalCases,
  runHospitalSimulation,
  type ClinicalCaseCompileResult,
  type ClinicalCaseDiagnostic,
  type PatientCaseDefinition,
  type SimulationSettings,
} from './engine/simulation'
import type { DoorSide, HospitalPlan, PatientCaseFilter, PlacedRoom, RoomDoor, SimulationAgentLayer, SimulationResult } from './types'

type WorkspaceTab = 'plan' | 'simulation' | 'saturation' | 'top' | 'services' | 'analysis'
type SimulationPanelTab = 'cases' | 'staff'
type ProposalOwner = string

interface ArchitectureScore {
  value: number
  blockedPenalty: number
  waitPenalty: number
  travelPenalty: number
  verticalPenalty: number
  rulePenalty: number
  areaPenalty: number
}

interface ArchitectureProposal {
  id: string
  owner: ProposalOwner
  title: string
  score: ArchitectureScore
  completed: number
  blocked: number
  edP90: number
  averageTravel: number
  verticalMoves: number
  ruleIssues: number
  modeledArea: number
  roomCount: number
  hottestRoomName: string
  createdAt: string
  source: 'demo' | 'submitted'
}

const INITIAL_PLAN = createTertiaryHospitalPlan()
const DOOR_MAGNET_DISTANCE = 6
const SimulationCanvas = lazy(() =>
  import('./components/SimulationCanvas').then((module) => ({ default: module.SimulationCanvas })),
)

function App() {
  const [plan, setPlan] = useState<HospitalPlan>(INITIAL_PLAN)
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('top')
  const [selectedFloor, setSelectedFloor] = useState(0)
  const [selectedRoomId, setSelectedRoomId] = useState<string | undefined>(plan.rooms[0]?.id)
  const [doorToolRoomId, setDoorToolRoomId] = useState<string | undefined>()
  const [templateToAdd, setTemplateToAdd] = useState('edBoxes')
  const [simulationSettings, setSimulationSettings] = useState<SimulationSettings>(DEFAULT_SIMULATION_SETTINGS)
  const [patientCases, setPatientCases] = useState<PatientCaseDefinition[]>(DEFAULT_PATIENT_CASES)
  const [clinicalCaseSource, setClinicalCaseSource] = useState(DEFAULT_CLINICAL_CASES_YAML)
  const [clinicalCaseResult, setClinicalCaseResult] = useState<ClinicalCaseCompileResult | null>(null)
  const [clinicalCaseFileName, setClinicalCaseFileName] = useState('casos-clinicos.yaml')
  const [selectedCaseId, setSelectedCaseId] = useState<PatientCaseFilter>('all')
  const [simulationAgentLayer, setSimulationAgentLayer] = useState<SimulationAgentLayer>('all')
  const [scriptSource, setScriptSource] = useState(DEFAULT_PLANNING_SCRIPT)
  const [scriptResult, setScriptResult] = useState<PlanningLanguageResult | null>(null)
  const [scriptFileName, setScriptFileName] = useState('plantilla.yaml')
  const [isScriptModalOpen, setScriptModalOpen] = useState(false)
  const [isScriptHelpOpen, setScriptHelpOpen] = useState(false)
  const [isClinicalCaseModalOpen, setClinicalCaseModalOpen] = useState(false)
  const [isClinicalCaseHelpOpen, setClinicalCaseHelpOpen] = useState(false)
  const [proposalOwner, setProposalOwner] = useState<ProposalOwner>('Equipo de diseno')
  const [submittedProposals, setSubmittedProposals] = useState<ArchitectureProposal[]>([])

  const selectedRoom = plan.rooms.find((room) => room.id === selectedRoomId)
  const activeFloorRooms = plan.rooms.filter((room) => room.floor === selectedFloor)
  const floorArea = activeFloorRooms.reduce((sum, room) => sum + room.areaSqm, 0)
  const totalArea = plan.rooms.reduce((sum, room) => sum + room.areaSqm, 0)
  const rules = useMemo(() => evaluateArchitectureRules(plan), [plan])
  const simulationResult = useMemo(() => runHospitalSimulation(plan, simulationSettings, patientCases), [patientCases, plan, simulationSettings])
  const topProposals = useMemo(
    () => rankArchitectureProposals([
      ...submittedProposals,
      ...demoArchitectureProposals(plan, simulationResult, rules, totalArea),
    ]),
    [plan, rules, simulationResult, submittedProposals, totalArea],
  )
  const currentScore = useMemo(() => scoreArchitecture(plan, simulationResult, rules, totalArea), [plan, rules, simulationResult, totalArea])
  const simulationWorkspace = activeTab === 'simulation' || activeTab === 'saturation'
  const showLeftPanel = activeTab === 'plan' || simulationWorkspace
  const showRightPanel = activeTab === 'plan' || simulationWorkspace || activeTab === 'top'

  function updateRoom(nextRoom: PlacedRoom) {
    setPlan((current) => ({
      ...current,
      rooms: current.rooms.map((room) => (room.id === nextRoom.id ? clampRoom(nextRoom) : room)),
    }))
  }

  function addRoom() {
    addRoomFromTemplate(templateToAdd)
  }

  function addRoomFromTemplate(templateId: string) {
    const nextId = `${templateId}-${Date.now()}`
    const template = templateById(templateId)
    const w = template.kind === 'circulation' ? 22 : Math.max(8, Math.min(22, Math.sqrt(template.defaultAreaSqm) / 4))
    const h = template.kind === 'circulation' ? 5 : Math.max(7, Math.min(16, Math.sqrt(template.defaultAreaSqm) / 5))
    const nextRoom: PlacedRoom = {
      id: nextId,
      templateId: template.id,
      name: template.name,
      kind: template.kind,
      floor: selectedFloor,
      x: 8,
      y: 8,
      w,
      h,
      capacity: template.defaultCapacity,
      areaSqm: areaSqmForDimensions(w, h),
      equipment: template.equipment,
      staffModel: template.staffModel,
      simulationNode: template.simulationNode,
      verticalGroupId: template.kind === 'vertical' ? `${template.id}-${selectedFloor}` : undefined,
      servesFloors: template.kind === 'vertical' ? [selectedFloor] : undefined,
    }
    setPlan((current) => {
      const door = defaultDoorForRoom(nextRoom, current.rooms)
      const roomWithDoor = clampRoom({ ...nextRoom, doors: door ? [door] : [] })
      const rooms = [...current.rooms, roomWithDoor]
      return { ...current, rooms }
    })
    setSelectedRoomId(nextRoom.id)
  }

  function autoConnectSelectedToCorridor() {
    if (!selectedRoom) return
    setPlan((current) => {
      const target = current.rooms.find((room) => room.id === selectedRoom.id)
      if (!target || !requiresCorridorAccess(target)) return current
      const nextRooms = connectRoomToNearestCorridor(current.rooms, target)
      return nextRooms ? { ...current, rooms: nextRooms.map(clampRoom) } : current
    })
  }

  function autoConnectFloorToCorridors() {
    setPlan((current) => {
      let rooms = current.rooms.map(clampRoom)
      const floorTargets = rooms.filter((room) => room.floor === selectedFloor && requiresCorridorAccess(room))
      floorTargets.forEach((target) => {
        const freshTarget = rooms.find((room) => room.id === target.id)
        if (!freshTarget || hasPassageAccess(rooms, freshTarget)) return
        const nextRooms = connectRoomToNearestCorridor(rooms, freshTarget)
        if (nextRooms) rooms = nextRooms.map(clampRoom)
      })
      return { ...current, rooms }
    })
  }

  function duplicateSelected() {
    if (!selectedRoom) return
    const copyId = `${selectedRoom.templateId}-${Date.now()}`
    const copy = clampRoom({
      ...selectedRoom,
      id: copyId,
      name: `${selectedRoom.name} copia`,
      x: selectedRoom.x + 4,
      y: selectedRoom.y + 4,
      doors: selectedRoom.doors?.map((door, index) => ({ ...door, id: `${copyId}-door-${index + 1}` })) ?? [],
      locked: false,
    })
    setPlan((current) => ({ ...current, rooms: [...current.rooms, copy] }))
    setSelectedRoomId(copy.id)
  }

  function removeSelected() {
    if (!selectedRoom) return
    setPlan((current) => ({ ...current, rooms: current.rooms.filter((room) => room.id !== selectedRoom.id) }))
    setSelectedRoomId(plan.rooms.find((room) => room.id !== selectedRoom.id)?.id)
    if (doorToolRoomId === selectedRoom.id) setDoorToolRoomId(undefined)
  }

  function addDoorAtPoint(roomId: string, point: DoorPoint) {
    setPlan((current) => {
      const target = current.rooms.find((room) => room.id === roomId)
      if (!target) return current
      const snap = snapDoorToCorridor(target, current.rooms, point, `${target.id}-door-${Date.now()}`)
      const door = snap.door
      const updatedRoom = clampRoom({ ...target, doors: [...(target.doors ?? []), door] })
      const roomsWithDoor = current.rooms.map((room) => (room.id === roomId ? updatedRoom : room))
      return {
        ...current,
        rooms: roomsWithDoor.map(clampRoom),
      }
    })
    setDoorToolRoomId(undefined)
  }

  function moveDoor(roomId: string, doorId: string, point: DoorPoint) {
    setPlan((current) => {
      const target = current.rooms.find((room) => room.id === roomId)
      if (!target) return current
      const snap = snapDoorToCorridor(target, current.rooms, point, doorId)
      const door = snap.door
      const updatedRoom = clampRoom({ ...target, doors: (target.doors ?? []).map((item) => (item.id === doorId ? door : item)) })
      const roomsWithDoor = current.rooms.map((room) => (room.id === roomId ? updatedRoom : room))
      return {
        ...current,
        rooms: roomsWithDoor.map(clampRoom),
      }
    })
  }

  function removeDoor(roomId: string, doorId: string) {
    setPlan((current) => ({
      ...current,
      rooms: current.rooms.map((room) => (
        room.id === roomId ? clampRoom({ ...room, doors: (room.doors ?? []).filter((door) => door.id !== doorId) }) : room
      )),
    }))
  }

  function savePlanningScript() {
    const result = compilePlanningScript(scriptSource, plan)
    setScriptResult(result)
    if (result.diagnostics.some((diagnostic) => diagnostic.level === 'error')) return
    setPlan(result.plan)
    setSelectedFloor(result.plan.floors.includes(selectedFloor) ? selectedFloor : result.plan.floors[0] ?? 0)
    setSelectedRoomId(result.plan.rooms[0]?.id)
    setDoorToolRoomId(undefined)
    setScriptModalOpen(false)
  }

  async function loadPlanningTemplate(file: File | undefined) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.yaml')) {
      setScriptFileName(file.name)
      setScriptResult({
        plan,
        diagnostics: [{
          level: 'error',
          line: 1,
          message: 'Solo se pueden subir archivos .yaml.',
        }],
        appliedLines: 0,
      })
      setScriptModalOpen(true)
      return
    }
    const nextSource = await file.text()
    setScriptSource(nextSource)
    setScriptFileName(file.name)
    setScriptResult(null)
    setScriptModalOpen(true)
  }

  async function loadClinicalCaseTemplate(file: File | undefined) {
    if (!file) return
    setClinicalCaseFileName(file.name)
    if (!file.name.toLowerCase().endsWith('.yaml')) {
      setClinicalCaseResult({
        cases: patientCases,
        diagnostics: [{
          level: 'error',
          line: 1,
          message: 'Solo se pueden subir archivos .yaml.',
        }],
        appliedCases: 0,
      })
      setClinicalCaseModalOpen(true)
      return
    }
    const source = await file.text()
    setClinicalCaseSource(source)
    setClinicalCaseResult(null)
    setClinicalCaseModalOpen(true)
  }

  function saveClinicalCases() {
    const result = compileClinicalCases(clinicalCaseSource)
    setClinicalCaseResult(result)
    if (result.diagnostics.some((diagnostic) => diagnostic.level === 'error')) return
    setPatientCases(result.cases)
    setSelectedCaseId('all')
    setClinicalCaseModalOpen(false)
  }

  function resetClinicalCases() {
    setPatientCases(DEFAULT_PATIENT_CASES)
    setClinicalCaseSource(DEFAULT_CLINICAL_CASES_YAML)
    setClinicalCaseFileName('casos-clinicos.yaml')
    setClinicalCaseResult(null)
    setSelectedCaseId('all')
  }

  function submitCurrentArchitecture() {
    const nextProposal = architectureProposalFromCurrentPlan({
      owner: proposalOwner.trim() || 'Autor sin nombre',
      plan,
      result: simulationResult,
      rules,
      totalArea,
      index: submittedProposals.length + 1,
    })
    setSubmittedProposals((current) => [nextProposal, ...current])
    setActiveTab('top')
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
        <TabButton id="top" active={activeTab} onClick={setActiveTab}>Top</TabButton>
        <TabButton id="plan" active={activeTab} onClick={setActiveTab}>Planificador</TabButton>
        <TabButton id="simulation" active={activeTab} onClick={setActiveTab}>Simulacion</TabButton>
        <TabButton id="saturation" active={activeTab} onClick={setActiveTab}>Saturacion</TabButton>
        <TabButton id="services" active={activeTab} onClick={setActiveTab}>Servicios</TabButton>
        <TabButton id="analysis" active={activeTab} onClick={setActiveTab}>Analisis</TabButton>
      </nav>

      <section className={`workbench ${showLeftPanel ? 'has-left-panel' : 'without-left-panel'} ${showRightPanel ? 'has-right-panel' : 'without-right-panel'}`}>
        {showLeftPanel && (
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
                    {floorLabel(floor)}
                  </button>
                ))}
              </div>
            </section>

            {simulationWorkspace ? (
              <SimulationCaseSelector
                result={simulationResult}
                selectedCaseId={selectedCaseId}
                agentLayer={simulationAgentLayer}
                fileName={clinicalCaseFileName}
                diagnostics={clinicalCaseResult?.diagnostics ?? []}
                onEditCases={() => setClinicalCaseModalOpen(true)}
                onUploadCases={loadClinicalCaseTemplate}
                onResetCases={resetClinicalCases}
                onSelectCase={setSelectedCaseId}
                onChangeAgentLayer={setSimulationAgentLayer}
              />
            ) : (
              <>
                <section className="panel-section">
                  <h2>Construir</h2>
                  <label>
                    Elemento
                    <select value={templateToAdd} onChange={(event) => setTemplateToAdd(event.target.value)}>
                      {ROOM_TEMPLATES.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.shortName} · {KIND_LABELS[template.kind]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="primary-action" onClick={addRoom}>Anadir a planta {floorLabel(selectedFloor)}</button>
                  <button type="button" className="secondary-action" onClick={autoConnectFloorToCorridors}>Auto-conectar planta</button>
                  <button type="button" className="secondary-action" onClick={() => setScriptModalOpen(true)}>Programar plan</button>
                </section>

                <section className="panel-section">
                  <h2>Planta activa</h2>
                  <Metric label="m2 planta" value={formatNumber(floorArea)} />
                  <Metric label="Bloques" value={String(activeFloorRooms.length)} />
                  <Metric label="Solapes" value={String(overlapScore(plan.rooms, selectedFloor))} />
                </section>

                <AccessAlerts plan={plan} selectedFloor={selectedFloor} />
              </>
            )}
          </aside>
        )}

        <section className="main-panel">
          {activeTab === 'plan' && (
            <HospitalCanvas
              plan={plan}
              selectedFloor={selectedFloor}
              selectedRoomId={selectedRoomId}
              doorToolRoomId={doorToolRoomId}
              onSelectRoom={setSelectedRoomId}
              onChangeRoom={updateRoom}
              onAddDoorAtPoint={addDoorAtPoint}
              onMoveDoor={moveDoor}
            />
          )}

          {activeTab === 'simulation' && (
            <Suspense fallback={<div className="simulation-loading">Cargando motor 2D...</div>}>
              <SimulationCanvas
                plan={plan}
                selectedFloor={selectedFloor}
                settings={simulationSettings}
                patientCases={patientCases}
                selectedCaseId={selectedCaseId}
                agentLayer={simulationAgentLayer}
                onSelectCase={setSelectedCaseId}
                onChangeAgentLayer={setSimulationAgentLayer}
              />
            </Suspense>
          )}

          {activeTab === 'top' && <TopPanel proposals={topProposals} />}
          {activeTab === 'services' && <ServiceMatrix plan={plan} />}
          {activeTab === 'saturation' && <SaturationPanel plan={plan} result={simulationResult} selectedCaseId={selectedCaseId} />}
          {activeTab === 'analysis' && <AnalysisPanel plan={plan} result={simulationResult} rules={rules} />}
        </section>

        {showRightPanel && (
          <aside className="right-panel">
            {simulationWorkspace ? (
              <SimulationControls
                settings={simulationSettings}
                onChange={setSimulationSettings}
                result={simulationResult}
                rules={rules}
              />
            ) : activeTab === 'top' ? (
              <TopControls
                owner={proposalOwner}
                proposals={topProposals}
                currentScore={currentScore}
                onChangeOwner={setProposalOwner}
                onSubmit={submitCurrentArchitecture}
              />
            ) : (
              <RoomInspector
                room={selectedRoom}
                allRooms={plan.rooms}
                floors={plan.floors}
                onChange={updateRoom}
                onDuplicate={duplicateSelected}
                onRemove={removeSelected}
                doorToolActive={doorToolRoomId === selectedRoom?.id}
                onStartDoorTool={() => selectedRoom && setDoorToolRoomId(doorToolRoomId === selectedRoom.id ? undefined : selectedRoom.id)}
                onRemoveDoor={removeDoor}
                onAutoConnect={autoConnectSelectedToCorridor}
              />
            )}
          </aside>
        )}
      </section>

      {isScriptModalOpen && (
        <PlanningScriptModal
          source={scriptSource}
          result={scriptResult}
          fileName={scriptFileName}
          helpOpen={isScriptHelpOpen}
          onChange={setScriptSource}
          onSave={savePlanningScript}
          onReset={() => {
            setScriptSource(DEFAULT_PLANNING_SCRIPT)
            setScriptFileName('plantilla.yaml')
            setScriptResult(null)
          }}
          onUpload={loadPlanningTemplate}
          onToggleHelp={() => setScriptHelpOpen((current) => !current)}
          onClose={() => setScriptModalOpen(false)}
        />
      )}

      {isClinicalCaseModalOpen && (
        <ClinicalCasesModal
          source={clinicalCaseSource}
          result={clinicalCaseResult}
          fileName={clinicalCaseFileName}
          helpOpen={isClinicalCaseHelpOpen}
          onChange={setClinicalCaseSource}
          onSave={saveClinicalCases}
          onReset={() => {
            setClinicalCaseSource(DEFAULT_CLINICAL_CASES_YAML)
            setClinicalCaseFileName('casos-clinicos.yaml')
            setClinicalCaseResult(null)
          }}
          onUpload={loadClinicalCaseTemplate}
          onToggleHelp={() => setClinicalCaseHelpOpen((current) => !current)}
          onClose={() => setClinicalCaseModalOpen(false)}
        />
      )}
    </main>
  )
}

function PlanningScriptModal({
  source,
  result,
  fileName,
  helpOpen,
  onChange,
  onSave,
  onReset,
  onUpload,
  onToggleHelp,
  onClose,
}: {
  source: string
  result: PlanningLanguageResult | null
  fileName: string
  helpOpen: boolean
  onChange: (value: string) => void
  onSave: () => void
  onReset: () => void
  onUpload: (file: File | undefined) => void
  onToggleHelp: () => void
  onClose: () => void
}) {
  const hasErrors = result?.diagnostics.some((diagnostic) => diagnostic.level === 'error') ?? false
  const modeledArea = result?.plan.rooms.reduce((sum, room) => sum + room.areaSqm, 0) ?? 0

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="script-modal" role="dialog" aria-modal="true" aria-labelledby="script-modal-title">
        <header className="script-modal-header">
          <div>
            <h2 id="script-modal-title">Programar plan</h2>
            <p>{fileName}</p>
          </div>
          <div className="script-modal-actions">
            <button type="button" className="info-action" onClick={onToggleHelp} aria-haspopup="dialog" aria-expanded={helpOpen}>Info</button>
            <button type="button" onClick={onClose}>Cerrar</button>
          </div>
        </header>

        <div className="script-toolbar">
          <label className="file-action">
            Subir .yaml
            <input
              type="file"
              accept=".yaml,text/yaml,application/yaml,application/x-yaml"
              onChange={(event) => {
                void onUpload(event.currentTarget.files?.[0])
                event.currentTarget.value = ''
              }}
            />
          </label>
          {result && <span>{hasErrors ? 'No aplicado' : `${result.appliedLines} instrucciones aplicadas`}</span>}
        </div>

        <textarea
          aria-label="Plantilla de planificacion"
          wrap="off"
          spellCheck={false}
          value={source}
          onChange={(event) => onChange(event.target.value)}
        />

        <footer className="script-diagnostics">
          {result?.diagnostics.length ? (
            result.diagnostics.map((diagnostic) => (
              <p key={`${diagnostic.line}-${diagnostic.message}`} className={diagnostic.level}>
                Linea {diagnostic.line}: {diagnostic.message}
              </p>
            ))
          ) : (
            <p className="muted">{result ? `OK · ${formatNumber(modeledArea)} m2 modelados` : 'Sin ejecutar.'}</p>
          )}
        </footer>

        <div className="script-modal-footer">
          <button type="button" onClick={onReset}>Restaurar ejemplo</button>
          <div className="script-footer-actions">
            <button type="button" onClick={onClose}>Cancelar</button>
            <button type="button" className="primary-action" onClick={onSave}>Guardar plan</button>
          </div>
        </div>
      </section>
      {helpOpen && <PlanningScriptHelpModal onClose={onToggleHelp} />}
    </div>
  )
}

function PlanningScriptHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="script-info-backdrop" role="presentation">
      <section className="script-info-modal" role="dialog" aria-modal="true" aria-labelledby="script-info-title">
        <header className="script-info-header">
          <div>
            <span>Manual YAML</span>
            <h2 id="script-info-title">Aprender la estructura del plan</h2>
            <p>Lee el plan como una receta: primero contexto, luego piezas espaciales y al final las relaciones que hacen funcionar la simulacion.</p>
          </div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </header>

        <div className="script-info-body">
          <section className="script-info-card">
            <h3>Mapa mental</h3>
            <ol>
              <li><strong>`plan`</strong> define nombre, m2 objetivo, parcela y plantas.</li>
              <li><strong>`clear`</strong> decide si el YAML reemplaza el plano actual.</li>
              <li><strong>`generics`</strong> guarda pasillos, nucleos y piezas repetidas en varias plantas.</li>
              <li><strong>`levels`</strong> agrupa `rooms`, `corridors` y `connections` por planta.</li>
              <li><strong>`corridors`</strong> crea pasillos publicos, clinicos o logisticos.</li>
              <li><strong>`rooms`</strong> crea servicios hospitalarios desde el catalogo.</li>
              <li><strong>`verticals`</strong> replica nucleos por planta y los agrupa.</li>
              <li><strong>`connections`</strong> declara accesos logicos entre bloques.</li>
            </ol>
          </section>

          <section className="script-info-card">
            <h3>Genericos</h3>
            <p>`generics` separa lo compartido del detalle por planta: pasillos que se repiten, ascensores, escaleras, refugios o sectores PCI.</p>
            <pre>{`generics:
  corridors:
    - template: clinical
      id: clinical
      floors: all
      at: [0, 31]
      size: [100, 7]

  verticals:
    - template: core
      group: asc-core-central
      floors: S1..P8
      at: [56, 23]
      size: [8, 8]

  connections:
    - from: asc-core-central
      to: clinical`}</pre>
          </section>

          <section className="script-info-card">
            <h3>Organizar por plantas</h3>
            <p>`levels` permite que cada planta tenga su propio bloque. Si una sala esta dentro de `PB`, no hace falta escribir `floor: PB` en cada elemento.</p>
            <pre>{`levels:
  PB:
    rooms:
      - template: triage
        id: triage-pb
        at: [68, 16]
        size: [11, 8]

  P1:
    rooms:
      - template: or
        id: or-p1
        at: [64, 14]
        size: [23, 17]`}</pre>
          </section>

          <section className="script-info-card">
            <h3>Una sala, paso a paso</h3>
            <p>El parser toma cada entrada de `rooms`, resuelve el alias de `template`, convierte `floor` o `floors` a plantas y calcula posicion, tamano y area.</p>
            <div className="script-code-pair">
              <div>
                <h4>YAML que escribes</h4>
                <pre>{`rooms:
  - template: boxes
    id: boxes-pb
    floor: PB
    at: [47, 27]
    size: [21, 16]
    capacity: 60`}</pre>
              </div>
              <div>
                <h4>Como se ve en bloque</h4>
                <div className="script-plan-preview" aria-label="Vista grafica de boxes-pb en planta PB">
                  <div className="script-preview-axis">Lienzo 100 x 70</div>
                  <div className="script-preview-room">
                    <strong>boxes-pb</strong>
                    <span>Boxes ED</span>
                    <small>PB · 21 x 16 · 3024 m2</small>
                    <small>capacidad 60</small>
                  </div>
                  <span className="script-preview-marker x">x 47</span>
                  <span className="script-preview-marker y">y 27</span>
                </div>
              </div>
            </div>
          </section>

          <section className="script-info-card">
            <h3>Pasillos y conexiones</h3>
            <p>Un pasillo es una sala de tipo circulacion. Una conexion no dibuja geometria nueva: anade referencias cruzadas para que el motor entienda que hay acceso.</p>
            <div className="script-code-pair">
              <div>
                <h4>YAML que escribes</h4>
                <pre>{`generics:
  corridors:
    - template: clinical
      id: clinical
      floors: S1..P8
      at: [0, 31]
      size: [100, 7]

  connections:
    - from: asc-core-central
      to: clinical`}</pre>
              </div>
              <div>
                <h4>Como se ve conectado</h4>
                <div className="script-connection-preview" aria-label="Vista grafica de boxes-pb conectado a clinical-pb">
                  <div className="script-connection-room">
                    <strong>boxes-pb</strong>
                    <span>Boxes ED</span>
                  </div>
                  <div className="script-connection-line" />
                  <div className="script-connection-corridor">
                    <strong>clinical-pb</strong>
                    <span>Pasillo clinico</span>
                  </div>
                  <small>La conexion enlaza bloques que ya estan en contacto fisico, sin dibujar otro pasillo.</small>
                </div>
              </div>
            </div>
          </section>

          <section className="script-info-card">
            <h3>Verticales por grupo</h3>
            <p>`verticals` crea una copia por planta. `group` es la llave humana para conectar todo el nucleo sin escribir cada id generado.</p>
            <div className="script-code-pair">
              <div>
                <h4>YAML que escribes</h4>
                <pre>{`generics:
  verticals:
    - template: core
      group: asc-core-central
      floors: S1..P2
      at: [50, 20]
      size: [8, 8]`}</pre>
              </div>
              <div>
                <h4>Como se ve por plantas</h4>
                <div className="script-vertical-preview" aria-label="Vista grafica del grupo asc-core-central por plantas">
                  {['P2', 'P1', 'PB', 'S1'].map((floor) => (
                    <div className="script-vertical-floor" key={floor}>
                      <span>{floor}</span>
                      <div>
                        <strong>core</strong>
                        <small>asc-core-central</small>
                      </div>
                    </div>
                  ))}
                  <p>El mismo grupo aparece alineado en cada planta para formar un nucleo continuo.</p>
                </div>
              </div>
            </div>
          </section>

          <section className="script-info-card">
            <h3>Reglas para escribir sin perderse</h3>
            <ul>
              <li>Usa `id` estables si luego vas a conectar bloques.</li>
              <li>Usa `floor: PB` para una planta o `floors: S1..P8` / `floors: all` para repetir una pieza.</li>
              <li>Usa `PB`, `P1`, `P2`, `S1` o numeros para plantas.</li>
              <li>Usa `at: [x, y]` y `size: [w, h]`; el lienzo es de 100 x 70 unidades.</li>
              <li>Usa listas con guion dentro de `generics` o dentro de cada planta en `levels`.</li>
              <li>Alias utiles: `hall`, `waiting`, `boxes`, `triage`, `icu`, `ward`, `public`, `clinical`, `logistics`, `core`, `stair`.</li>
            </ul>
          </section>
        </div>
      </section>
    </div>
  )
}

function AccessAlerts({ plan, selectedFloor }: { plan: HospitalPlan; selectedFloor: number }) {
  const disconnectedBlocks = disconnectedPatientRooms(plan.rooms)
  const disconnectedCirculation = disconnectedPassages(plan.rooms)
  const floorOverlap = overlapScore(plan.rooms, selectedFloor)
  const hasIssues = disconnectedBlocks.length > 0 || disconnectedCirculation.length > 0 || floorOverlap > 0

  return (
    <section className="panel-section">
      <h2>Alertas accesos</h2>
      <div className="rule-list compact">
        {hasIssues ? (
          <>
            {disconnectedBlocks.slice(0, 4).map((room) => (
              <article key={`block-${room.id}`} className="rule-item fail">
                <strong>{room.name}</strong>
                <span>{floorLabel(room.floor)} sin puerta fisica a pasillo.</span>
              </article>
            ))}
            {disconnectedCirculation.slice(0, 4).map((room) => (
              <article key={`passage-${room.id}`} className="rule-item fail">
                <strong>{room.name}</strong>
                <span>{floorLabel(room.floor)} fuera de la red principal de circulacion.</span>
              </article>
            ))}
            {floorOverlap > 0 && (
              <article className="rule-item fail">
                <strong>Solapes en {floorLabel(selectedFloor)}</strong>
                <span>{floorOverlap} unidades de superficie solapada.</span>
              </article>
            )}
          </>
        ) : (
          <article className="rule-item ok">
            <strong>Red accesible</strong>
            <span>Todos los bloques operativos y elementos de circulacion estan conectados.</span>
          </article>
        )}
      </div>
    </section>
  )
}

function ClinicalCasesModal({
  source,
  result,
  fileName,
  helpOpen,
  onChange,
  onSave,
  onReset,
  onUpload,
  onToggleHelp,
  onClose,
}: {
  source: string
  result: ClinicalCaseCompileResult | null
  fileName: string
  helpOpen: boolean
  onChange: (value: string) => void
  onSave: () => void
  onReset: () => void
  onUpload: (file: File | undefined) => void
  onToggleHelp: () => void
  onClose: () => void
}) {
  const hasErrors = result?.diagnostics.some((diagnostic) => diagnostic.level === 'error') ?? false

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="script-modal" role="dialog" aria-modal="true" aria-labelledby="clinical-cases-modal-title">
        <header className="script-modal-header">
          <div>
            <h2 id="clinical-cases-modal-title">Programar casos clinicos</h2>
            <p>{fileName}</p>
          </div>
          <div className="script-modal-actions">
            <button type="button" className="info-action" onClick={onToggleHelp} aria-haspopup="dialog" aria-expanded={helpOpen}>Info</button>
            <button type="button" onClick={onClose}>Cerrar</button>
          </div>
        </header>

        <div className="script-toolbar">
          <label className="file-action">
            Subir .yaml
            <input
              type="file"
              accept=".yaml"
              onChange={(event) => {
                void onUpload(event.currentTarget.files?.[0])
                event.currentTarget.value = ''
              }}
            />
          </label>
          {result && <span>{hasErrors ? 'No aplicado' : `${result.appliedCases} casos aplicados`}</span>}
        </div>

        <textarea
          aria-label="Plantilla de casos clinicos"
          wrap="off"
          spellCheck={false}
          value={source}
          onChange={(event) => onChange(event.target.value)}
        />

        <footer className="script-diagnostics">
          {result?.diagnostics.length ? (
            result.diagnostics.map((diagnostic) => (
              <p key={`${diagnostic.line}-${diagnostic.message}`} className={diagnostic.level}>
                Linea {diagnostic.line}: {diagnostic.message}
              </p>
            ))
          ) : (
            <p className="muted">{result ? `OK · ${result.appliedCases} casos listos` : 'Sin ejecutar.'}</p>
          )}
        </footer>

        <div className="script-modal-footer">
          <button type="button" onClick={onReset}>Restaurar ejemplo</button>
          <div className="script-footer-actions">
            <button type="button" onClick={onClose}>Cancelar</button>
            <button type="button" className="primary-action" onClick={onSave}>Guardar casos</button>
          </div>
        </div>
      </section>
      {helpOpen && <ClinicalCasesHelpModal onClose={onToggleHelp} />}
    </div>
  )
}

function ClinicalCasesHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="script-info-backdrop" role="presentation">
      <section className="script-info-modal" role="dialog" aria-modal="true" aria-labelledby="clinical-cases-info-title">
        <header className="script-info-header">
          <div>
            <span>Manual YAML</span>
            <h2 id="clinical-cases-info-title">Casos para la simulacion</h2>
            <p>Define perfiles clinicos, su peso de llegada y la secuencia de nodos hospitalarios que recorren los pacientes.</p>
          </div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </header>

        <div className="script-info-body">
          <section className="script-info-card">
            <h3>Estructura minima</h3>
            <pre>{`cases:
  - id: sepsis_grave
    label: Sepsis grave
    code: SEP
    stream: ed_walkin
    severity: critical
    color: "#b45309"
    weight: 8
    steps:
      - node: registration
        phase: Admision
      - node: triage
        phase: Triaje sepsis
      - node: resus
        phase: Antibiotico y fluidos
      - choose:
          - weight: 0.55
            node: icu
            phase: Ingreso UCI
          - weight: 0.45
            node: ward
            phase: Ingreso planta`}</pre>
          </section>

          <section className="script-info-card">
            <h3>Campos</h3>
            <ul>
              <li><strong>`id`</strong> debe ser unico y no puede ser `all`.</li>
              <li><strong>`stream`</strong>: `ed_ambulance`, `ed_walkin`, `outpatient` o `elective`.</li>
              <li><strong>`severity`</strong>: `low`, `medium`, `high` o `critical`.</li>
              <li><strong>`weight`</strong> aumenta o reduce la frecuencia relativa del caso.</li>
              <li><strong>`steps`</strong> necesita al menos dos pasos para que haya ruta simulable.</li>
            </ul>
          </section>

          <section className="script-info-card">
            <h3>Ramas y probabilidades</h3>
            <ul>
              <li>Usa `chance: 0.35` en un paso para que sea opcional.</li>
              <li>Usa `choose` para escoger una de varias rutas posibles.</li>
              <li>Un bloque `choose` puede apuntar a un `node` directo o a una lista `steps`.</li>
              <li>Nodos utiles: `registration`, `triage`, `ed_bay`, `resus`, `imaging`, `lab`, `or`, `pacu`, `icu`, `ward`, `maternity`, `neonatal_icu`, `consult`, `pharmacy`, `research`.</li>
            </ul>
          </section>
        </div>
      </section>
    </div>
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

function SimulationCaseSelector({
  result,
  selectedCaseId,
  agentLayer,
  fileName,
  diagnostics,
  onEditCases,
  onUploadCases,
  onResetCases,
  onSelectCase,
  onChangeAgentLayer,
}: {
  result: SimulationResult | null
  selectedCaseId: PatientCaseFilter
  agentLayer: SimulationAgentLayer
  fileName: string
  diagnostics: ClinicalCaseDiagnostic[]
  onEditCases: () => void
  onUploadCases: (file: File | undefined) => void
  onResetCases: () => void
  onSelectCase: (caseId: PatientCaseFilter) => void
  onChangeAgentLayer: (layer: SimulationAgentLayer) => void
}) {
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
              style={{ borderLeftColor: '#66736e' }}
              onClick={() => onSelectCase('all')}
            >
              <strong>Todos los casos</strong>
              <span>{result?.kpis.completed ?? 0} pacientes completados</span>
              <small>Vista completa de la actividad simulada.</small>
            </button>
            {caseStats.map((stat) => (
              <button
                key={stat.id}
                type="button"
                className={`case-item ${selectedCaseId === stat.id ? 'is-active' : ''}`}
                style={{ borderLeftColor: stat.color }}
                onClick={() => onSelectCase(stat.id)}
              >
                <strong>{stat.label}</strong>
                <span>{stat.completed}/{stat.attempted} completados · {stat.blocked} bloqueados</span>
                <small>{stat.samplePath.length ? stat.samplePath.join(' -> ') : 'Sin ruta completa'}</small>
              </button>
            ))}
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

function RoomInspector({
  room,
  allRooms,
  floors,
  onChange,
  onDuplicate,
  onRemove,
  doorToolActive,
  onStartDoorTool,
  onRemoveDoor,
  onAutoConnect,
}: {
  room?: PlacedRoom
  allRooms: PlacedRoom[]
  floors: number[]
  onChange: (room: PlacedRoom) => void
  onDuplicate: () => void
  onRemove: () => void
  doorToolActive: boolean
  onStartDoorTool: () => void
  onRemoveDoor: (roomId: string, doorId: string) => void
  onAutoConnect: () => void
}) {
  if (!room) {
    return (
      <section className="panel-section">
        <h2>Elemento</h2>
        <p className="muted">Selecciona un bloque del plano.</p>
      </section>
    )
  }
  const accessRequired = requiresCorridorAccess(room)
  const hasCorridor = hasPassageAccess(allRooms, room)
  const isDisconnectedPassage = isPassage(room) && disconnectedPassages(allRooms).some((item) => item.id === room.id)

  return (
    <>
      <section className="panel-section">
        <h2>Elemento</h2>
        <label>
          Nombre
          <input value={room.name} onChange={(event) => onChange({ ...room, name: event.target.value })} />
        </label>
        <label>
          Planta
          <select value={room.floor} onChange={(event) => onChange(changeRoomFloor(room, Number(event.target.value)))}>
            {floors.map((floor) => (
              <option key={floor} value={floor}>{floorLabel(floor)}</option>
            ))}
          </select>
        </label>
        <label>
          Capacidad
          <input type="number" value={room.capacity} onChange={(event) => onChange({ ...room, capacity: Number(event.target.value) })} />
        </label>
        <div className="dimension-grid">
          <label>
            Ancho (m)
            <input
              type="number"
              min={12}
              step={3}
              value={worldUnitsToMeters(room.w)}
              onChange={(event) => onChange(resizeRoomInMeters(room, 'w', Number(event.target.value)))}
            />
          </label>
          <label>
            Alto (m)
            <input
              type="number"
              min={12}
              step={3}
              value={worldUnitsToMeters(room.h)}
              onChange={(event) => onChange(resizeRoomInMeters(room, 'h', Number(event.target.value)))}
            />
          </label>
        </div>
        <div className="status-metrics">
          <Metric label="m2 calculados" value={formatNumber(room.areaSqm)} />
          <Metric
            label={isPassage(room) ? 'Red circulacion' : 'Acceso pasillo'}
            value={isPassage(room) ? (isDisconnectedPassage ? 'Aislado' : 'Conectado') : accessRequired ? (hasCorridor ? 'Conectado' : 'Sin pasillo') : 'Opcional'}
          />
        </div>
      </section>

      <section className="panel-section">
        <h2>Equipamiento</h2>
        <div className="tag-list">
          {room.equipment.map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>

      {room.kind === 'vertical' && (
        <section className="panel-section">
          <h2>Conexion vertical</h2>
          <label>
            Familia de conector
            <input
              value={room.verticalGroupId ?? ''}
              onChange={(event) => onChange({ ...room, verticalGroupId: event.target.value })}
              placeholder="ascensor-central"
            />
          </label>
          <FloorConnectionSelector room={room} floors={floors} onChange={onChange} />
        </section>
      )}

      <section className="panel-section">
        <h2>Personal</h2>
        <div className="tag-list">
          {room.staffModel.map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>

      <section className="panel-section">
        <h2>Puertas</h2>
        <Metric label="Puertas" value={String(room.doors?.length ?? 0)} />
        <button
          type="button"
          className={doorToolActive ? 'primary-action' : undefined}
          onClick={onStartDoorTool}
          disabled={room.kind === 'circulation' || room.kind === 'future'}
        >
          {doorToolActive ? 'Colocando puerta' : 'Anadir puerta'}
        </button>
        <button
          type="button"
          className="secondary-action"
          onClick={onAutoConnect}
          disabled={!accessRequired || hasCorridor}
        >
          Conectar a pasillo cercano
        </button>
        <div className="tag-list">
          {(room.doors ?? []).map((door, index) => {
            const connected = doorConnectsToCorridor(allRooms, room, door)
            return (
              <button
                key={door.id}
                type="button"
                className={`door-chip ${connected ? 'connected' : 'blocked'}`}
                onClick={() => onRemoveDoor(room.id, door.id)}
                title="Click para eliminar"
              >
                Puerta {index + 1} · {connected ? 'pasillo' : 'sin pasillo'}
              </button>
            )
          })}
        </div>
      </section>

      <div className="button-row">
        <button type="button" onClick={onDuplicate}>Duplicar</button>
        <button type="button" onClick={onRemove}>Eliminar</button>
      </div>
    </>
  )
}

function FloorConnectionSelector({
  room,
  floors,
  onChange,
}: {
  room: PlacedRoom
  floors: number[]
  onChange: (room: PlacedRoom) => void
}) {
  const servedFloors = normalizeServedFloors(room.servesFloors ?? [room.floor], room.floor)

  return (
    <div className="floor-connection-editor">
      <span>Plantas conectadas</span>
      <div className="floor-selector-grid">
        {floors.map((floor) => {
          const isActive = servedFloors.includes(floor)
          return (
            <button
              key={floor}
              type="button"
              className={`${isActive ? 'is-active' : ''} ${floor === room.floor ? 'is-anchor' : ''}`}
              onClick={() => onChange({ ...room, servesFloors: toggleServedFloor(servedFloors, floor, room.floor) })}
            >
              {floorLabel(floor)}
            </button>
          )
        })}
      </div>
      <div className="floor-quick-actions">
        <button type="button" onClick={() => onChange({ ...room, servesFloors: [room.floor] })}>Solo esta</button>
        <button type="button" onClick={() => onChange({ ...room, servesFloors: adjacentFloorRange(floors, room.floor) })}>Tramo +1</button>
        <button type="button" onClick={() => onChange({ ...room, servesFloors: floors })}>Todas</button>
      </div>
    </div>
  )
}

function SimulationControls({
  settings,
  result,
  rules,
  onChange,
}: {
  settings: SimulationSettings
  result: SimulationResult | null
  rules: ArchitectureRuleResult[]
  onChange: (settings: SimulationSettings) => void
}) {
  const failingRules = rules.filter((rule) => rule.status !== 'ok')

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
            min={1}
            max={360}
            step={1}
            value={settings.speed}
            onChange={(event) => onChange({ ...settings, speed: Number(event.target.value) })}
          />
          <output>{settings.speed}x</output>
        </label>
      </section>

      <section className="panel-section">
        <h2>Resultado</h2>
        <Metric label="Pacientes" value={String(result?.kpis.completed ?? 0)} />
        <Metric label="Personal" value={String(result?.kpis.staffOnShift ?? 0)} />
        <Metric label="Personal movil" value={String(result?.kpis.staffInMotion ?? 0)} />
        <Metric label="ED P90" value={`${result?.kpis.edP90Minutes ?? 0} min`} />
        <Metric label="Traslado medio" value={`${result?.kpis.averageTravelMinutes ?? 0} min`} />
        <Metric label="Cambios planta" value={String(result?.kpis.verticalMoves ?? 0)} />
        <Metric label="Bloqueados" value={String(result?.kpis.blockedPatients ?? 0)} />
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

function SaturationPanel({
  plan,
  result,
  selectedCaseId,
}: {
  plan: HospitalPlan
  result: SimulationResult | null
  selectedCaseId: PatientCaseFilter
}) {
  if (!result) {
    return (
      <div className="saturation-panel">
        <p className="muted">Ejecutando simulacion.</p>
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
        <div>
          <span>Saturacion por bloque</span>
          <h2>{selectedCase ? selectedCase.label : 'Todos los casos clinicos'}</h2>
          <p>Demanda acumulada de pacientes frente a capacidad declarada por bloque. Las barras rojas indican zonas por encima de su capacidad funcional.</p>
        </div>
        <div className="saturation-kpis">
          <Metric label="Bloque critico" value={bottlenecks[0]?.room.name ?? '-'} />
          <Metric label="Saturados" value={String(saturated)} />
          <Metric label="En tension" value={String(warning)} />
          <Metric label="Bloqueados" value={String(result.kpis.blockedPatients)} />
        </div>
      </section>

      <div className="saturation-grid">
        <section className="saturation-block wide">
          <h3>Bloques con mayor presion</h3>
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
                  <small>{row.count} pasos clinicos · capacidad {row.room.capacity} · {KIND_LABELS[row.room.kind]}</small>
                </article>
              ))
            ) : (
              <p className="muted">No hay demanda suficiente para detectar saturacion.</p>
            )}
          </div>
        </section>

        <section className="saturation-block">
          <h3>Carga por caso</h3>
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
                <small>{stat.blocked} bloqueados</small>
              </article>
            ))}
          </div>
        </section>

        <section className="saturation-block">
          <h3>Lectura operativa</h3>
          <div className="rule-list compact">
            {bottlenecks.slice(0, 4).map((row) => (
              <article key={row.room.id} className={`rule-item ${row.score >= 1 ? 'fail' : row.score >= 0.6 ? 'warn' : 'ok'}`}>
                <strong>{row.room.name}</strong>
                <span>{formatDemandRatio(row.score)} de demanda relativa en {floorLabel(row.room.floor)}.</span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
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

function bottleneckRows(plan: HospitalPlan, pressure: Record<string, number>) {
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
    .filter((row): row is { room: PlacedRoom; count: number; score: number } => row !== null)
    .sort((a, b) => b.score - a.score)
}

function formatDemandRatio(score: number): string {
  return `${Math.round(score * 100)}%`
}

function TopPanel({ proposals }: { proposals: ArchitectureProposal[] }) {
  const userRows = bestProposalByOwner(proposals)
  const best = proposals[0]

  return (
    <div className="top-panel">
      <section className="top-hero">
        <div>
          <span>Ranking por simulacion</span>
          <h2>{best ? `${best.owner} lidera con ${formatScore(best.score.value)}` : 'Sin propuestas'}</h2>
          <p>El score combina bloqueos, espera en urgencias, traslado medio, cambios de planta, reglas arquitectonicas y desviacion de m2.</p>
        </div>
        <div className="top-kpis">
          <Metric label="Mejor usuario" value={best?.owner ?? '-'} />
          <Metric label="Score ganador" value={best ? formatScore(best.score.value) : '-'} />
          <Metric label="Propuestas" value={String(proposals.length)} />
          <Metric label="Bloqueados mejor" value={String(best?.blocked ?? 0)} />
        </div>
      </section>

      <div className="top-grid">
        <section className="top-block wide">
          <h3>Mejores arquitecturas propuestas</h3>
          <div className="proposal-list">
            {proposals.map((proposal, index) => (
              <article key={proposal.id} className="proposal-card">
                <header>
                  <span>#{index + 1}</span>
                  <div>
                    <h4>{proposal.title}</h4>
                    <p>{proposal.owner} · {proposal.createdAt}</p>
                  </div>
                  <strong>{formatScore(proposal.score.value)}</strong>
                </header>
                <div className="score-track" aria-hidden="true">
                  <span style={{ width: `${proposal.score.value}%` }} />
                </div>
                <div className="proposal-metrics">
                  <Metric label="ED P90" value={`${proposal.edP90} min`} />
                  <Metric label="Traslado" value={`${proposal.averageTravel} min`} />
                  <Metric label="Cambios planta" value={String(proposal.verticalMoves)} />
                  <Metric label="Reglas abiertas" value={String(proposal.ruleIssues)} />
                </div>
                <small>{proposal.completed} completados · {proposal.blocked} bloqueados · zona caliente: {proposal.hottestRoomName}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="top-block">
          <h3>Top usuarios</h3>
          <div className="leaderboard-list">
            {userRows.map((proposal, index) => (
              <article key={proposal.owner} className="leaderboard-row">
                <strong>{index + 1}</strong>
                <div>
                  <h4>{proposal.owner}</h4>
                  <span>{proposal.title}</span>
                </div>
                <b>{formatScore(proposal.score.value)}</b>
              </article>
            ))}
          </div>
        </section>

        <section className="top-block">
          <h3>Lectura del score</h3>
          {best ? (
            <div className="score-breakdown">
              <Metric label="Bloqueos" value={`-${formatScore(best.score.blockedPenalty)}`} />
              <Metric label="Espera" value={`-${formatScore(best.score.waitPenalty)}`} />
              <Metric label="Traslado" value={`-${formatScore(best.score.travelPenalty)}`} />
              <Metric label="Vertical" value={`-${formatScore(best.score.verticalPenalty)}`} />
              <Metric label="Reglas" value={`-${formatScore(best.score.rulePenalty)}`} />
              <Metric label="m2" value={`-${formatScore(best.score.areaPenalty)}`} />
            </div>
          ) : (
            <p className="muted">Registra una propuesta para iniciar el ranking.</p>
          )}
        </section>
      </div>
    </div>
  )
}

function TopControls({
  owner,
  proposals,
  currentScore,
  onChangeOwner,
  onSubmit,
}: {
  owner: ProposalOwner
  proposals: ArchitectureProposal[]
  currentScore: ArchitectureScore
  onChangeOwner: (owner: ProposalOwner) => void
  onSubmit: () => void
}) {
  const submittedCount = proposals.filter((proposal) => proposal.source === 'submitted').length
  return (
    <>
      <section className="panel-section">
        <h2>Registrar propuesta</h2>
        <label>
          Autor
          <input value={owner} onChange={(event) => onChangeOwner(event.target.value)} placeholder="Nombre del autor o equipo" />
        </label>
        <Metric label="Score actual" value={formatScore(currentScore.value)} />
        <button type="button" className="primary-action" onClick={onSubmit}>Guardar arquitectura actual</button>
      </section>

      <section className="panel-section">
        <h2>Ranking</h2>
        <Metric label="Propuestas guardadas" value={String(submittedCount)} />
        <Metric label="Lider actual" value={proposals[0]?.owner ?? '-'} />
        <Metric label="Mejor score" value={proposals[0] ? formatScore(proposals[0].score.value) : '-'} />
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
  const groupedRules = rules.reduce<Record<string, ArchitectureRuleResult[]>>((acc, rule) => {
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
          {Object.entries(groupedRules).map(([category, categoryRules]) => (
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
        <Metric label="Avisos" value={String(rules.filter((rule) => rule.status !== 'ok').length)} />
      </section>
    </div>
  )
}

function demoArchitectureProposals(
  plan: HospitalPlan,
  result: SimulationResult | null,
  rules: ArchitectureRuleResult[],
  totalArea: number,
): ArchitectureProposal[] {
  const baseMetrics = metricsFromSimulation(result)
  const variants: Array<{
    owner: ProposalOwner
    title: string
    createdAt: string
    metrics: ReturnType<typeof metricsFromSimulation>
  }> = [
    {
      owner: 'Equipo A',
      title: 'Urgencias compactas y diagnostico cercano',
      createdAt: 'propuesta demo',
      metrics: adjustArchitectureMetrics(baseMetrics, {
        blockedFactor: 0.9,
        edP90Factor: 0.86,
        travelFactor: 0.92,
        verticalFactor: 0.94,
      }),
    },
    {
      owner: 'Equipo B',
      title: 'Hospitalizacion modular y altas tempranas',
      createdAt: 'propuesta demo',
      metrics: adjustArchitectureMetrics(baseMetrics, {
        blockedFactor: 0.82,
        edP90Factor: 0.92,
        travelFactor: 0.88,
        verticalFactor: 0.96,
      }),
    },
    {
      owner: 'Plano actual',
      title: 'Plano actual colaborativo',
      createdAt: 'simulacion actual',
      metrics: baseMetrics,
    },
  ]

  return variants.map((variant) => architectureProposalFromMetrics({
    id: `demo-${variant.owner}`,
    owner: variant.owner,
    title: variant.title,
    createdAt: variant.createdAt,
    source: 'demo',
    plan,
    rules,
    totalArea,
    metrics: variant.metrics,
  }))
}

function architectureProposalFromCurrentPlan({
  owner,
  plan,
  result,
  rules,
  totalArea,
  index,
}: {
  owner: ProposalOwner
  plan: HospitalPlan
  result: SimulationResult | null
  rules: ArchitectureRuleResult[]
  totalArea: number
  index: number
}): ArchitectureProposal {
  const now = new Date()
  return architectureProposalFromMetrics({
    id: `submitted-${now.getTime()}`,
    owner,
    title: `Arquitectura ${index}`,
    createdAt: new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(now),
    source: 'submitted',
    plan,
    rules,
    totalArea,
    metrics: metricsFromSimulation(result),
  })
}

function architectureProposalFromMetrics({
  id,
  owner,
  title,
  createdAt,
  source,
  plan,
  rules,
  totalArea,
  metrics,
}: {
  id: string
  owner: ProposalOwner
  title: string
  createdAt: string
  source: ArchitectureProposal['source']
  plan: HospitalPlan
  rules: ArchitectureRuleResult[]
  totalArea: number
  metrics: ReturnType<typeof metricsFromSimulation>
}): ArchitectureProposal {
  return {
    id,
    owner,
    title,
    createdAt,
    source,
    score: scoreArchitecture(plan, metrics, rules, totalArea),
    completed: metrics.completed,
    blocked: metrics.blocked,
    edP90: metrics.edP90,
    averageTravel: metrics.averageTravel,
    verticalMoves: metrics.verticalMoves,
    ruleIssues: rules.filter((rule) => rule.status !== 'ok').length,
    modeledArea: totalArea,
    roomCount: plan.rooms.length,
    hottestRoomName: metrics.hottestRoomName,
  }
}

function metricsFromSimulation(result: SimulationResult | null) {
  return {
    completed: result?.kpis.completed ?? 0,
    blocked: result?.kpis.blockedPatients ?? 0,
    edP90: result?.kpis.edP90Minutes ?? 0,
    averageTravel: result?.kpis.averageTravelMinutes ?? 0,
    verticalMoves: result?.kpis.verticalMoves ?? 0,
    hottestRoomName: result?.kpis.hottestRoomName ?? '-',
  }
}

function adjustArchitectureMetrics(
  metrics: ReturnType<typeof metricsFromSimulation>,
  factors: { blockedFactor: number; edP90Factor: number; travelFactor: number; verticalFactor: number },
): ReturnType<typeof metricsFromSimulation> {
  return {
    ...metrics,
    blocked: Math.max(0, Math.round(metrics.blocked * factors.blockedFactor)),
    edP90: Math.max(0, Math.round(metrics.edP90 * factors.edP90Factor)),
    averageTravel: Math.max(0, Math.round(metrics.averageTravel * factors.travelFactor * 10) / 10),
    verticalMoves: Math.max(0, Math.round(metrics.verticalMoves * factors.verticalFactor)),
  }
}

function scoreArchitecture(
  plan: HospitalPlan,
  resultOrMetrics: SimulationResult | ReturnType<typeof metricsFromSimulation> | null,
  rules: ArchitectureRuleResult[],
  totalArea: number,
): ArchitectureScore {
  const metrics = isSimulationResult(resultOrMetrics) ? metricsFromSimulation(resultOrMetrics) : (resultOrMetrics ?? metricsFromSimulation(null))
  const failCount = rules.filter((rule) => rule.status === 'fail').length
  const warnCount = rules.filter((rule) => rule.status === 'warn').length
  const areaDrift = Math.abs(totalArea - plan.targetAreaSqm) / Math.max(1, plan.targetAreaSqm)
  const blockedPenalty = metrics.blocked * 2.4
  const waitPenalty = Math.max(0, metrics.edP90 - 120) * 0.055
  const travelPenalty = metrics.averageTravel * 0.35
  const verticalPenalty = metrics.verticalMoves * 0.012
  const rulePenalty = failCount * 8 + warnCount * 2.5
  const areaPenalty = Math.min(12, areaDrift * 40)
  const value = clampScore(100 - blockedPenalty - waitPenalty - travelPenalty - verticalPenalty - rulePenalty - areaPenalty)

  return {
    value,
    blockedPenalty: roundScore(blockedPenalty),
    waitPenalty: roundScore(waitPenalty),
    travelPenalty: roundScore(travelPenalty),
    verticalPenalty: roundScore(verticalPenalty),
    rulePenalty: roundScore(rulePenalty),
    areaPenalty: roundScore(areaPenalty),
  }
}

function isSimulationResult(value: SimulationResult | ReturnType<typeof metricsFromSimulation> | null): value is SimulationResult {
  return Boolean(value && 'kpis' in value)
}

function rankArchitectureProposals(proposals: ArchitectureProposal[]): ArchitectureProposal[] {
  return [...proposals].sort((a, b) => (
    b.score.value - a.score.value
    || a.blocked - b.blocked
    || a.edP90 - b.edP90
    || a.averageTravel - b.averageTravel
  ))
}

function bestProposalByOwner(proposals: ArchitectureProposal[]): ArchitectureProposal[] {
  const bestByOwner = new Map<ProposalOwner, ArchitectureProposal>()
  proposals.forEach((proposal) => {
    const current = bestByOwner.get(proposal.owner)
    if (!current || proposal.score.value > current.score.value) bestByOwner.set(proposal.owner, proposal)
  })
  return rankArchitectureProposals([...bestByOwner.values()])
}

function clampScore(value: number): number {
  return roundScore(Math.max(0, Math.min(100, value)))
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10
}

function formatScore(value: number): string {
  return value.toFixed(1)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('es-ES').format(Math.round(value))
}

function floorLabel(floor: number) {
  if (floor < 0) return `S${Math.abs(floor)}`
  if (floor === 0) return 'PB'
  return `P${floor}`
}

function resizeRoomInMeters(room: PlacedRoom, dimension: 'w' | 'h', meters: number): PlacedRoom {
  if (!Number.isFinite(meters)) return room
  return clampRoom({ ...room, [dimension]: metersToWorldUnits(meters) })
}

function changeRoomFloor(room: PlacedRoom, floor: number): PlacedRoom {
  if (!Number.isFinite(floor)) return room
  const nextFloor = Math.round(floor)
  return clampRoom({
    ...room,
    floor: nextFloor,
    servesFloors: room.kind === 'vertical' ? normalizeServedFloors(room.servesFloors ?? [room.floor], nextFloor) : room.servesFloors,
  })
}

function normalizeServedFloors(floors: number[], anchorFloor: number): number[] {
  const normalized = new Set(floors.map((floor) => Math.round(floor)).filter((floor) => Number.isFinite(floor)))
  normalized.add(anchorFloor)
  return [...normalized].sort((a, b) => a - b)
}

function toggleServedFloor(floors: number[], floor: number, anchorFloor: number): number[] {
  const next = new Set(floors)
  if (next.has(floor) && floor !== anchorFloor) next.delete(floor)
  else next.add(floor)
  next.add(anchorFloor)
  return [...next].sort((a, b) => a - b)
}

function adjacentFloorRange(floors: number[], anchorFloor: number): number[] {
  const index = floors.indexOf(anchorFloor)
  const adjacent = floors[index + 1] ?? floors[index - 1] ?? anchorFloor
  return normalizeServedFloors([anchorFloor, adjacent], anchorFloor)
}

function connectRoomToNearestCorridor(rooms: PlacedRoom[], target: PlacedRoom): PlacedRoom[] | undefined {
  const point = target.doors?.[0] ? doorWorldPosition(target, target.doors[0]) : { x: target.x + target.w / 2, y: target.y + target.h / 2 }
  const doorId = target.doors?.[0]?.id ?? `${target.id}-door-1`
  const suggestedDoor = snapDoorToCorridor(target, rooms, point, doorId, true).door

  const preservedDoors = (target.doors ?? []).slice(1)
  const primaryDoor: RoomDoor = { ...suggestedDoor, id: doorId }
  const connectedRoom = clampRoom({ ...target, doors: [primaryDoor, ...preservedDoors] })
  return rooms.map((room) => (room.id === target.id ? connectedRoom : room))
}

function snapDoorToCorridor(
  room: PlacedRoom,
  rooms: PlacedRoom[],
  point: DoorPoint,
  id: string,
  force = false,
): { door: RoomDoor; magnetized: boolean } {
  const corridors = corridorCandidatesForDoor(rooms, room)
  if (!corridors.length) return { door: snapDoorToRoom(room, point, id), magnetized: false }

  const candidates = corridors.map((corridor) => {
    const door = doorCandidateForCorridor(room, corridor, point, id)
    const doorPoint = doorWorldPosition(room, door)
    return {
      door,
      distance: pointToRectDistance(doorPoint, corridor),
      corridorDistance: rectangleDistance(room, corridor),
    }
  })

  const best = candidates.sort((a, b) => a.distance - b.distance || a.corridorDistance - b.corridorDistance)[0]
  if (!force && best.distance > DOOR_MAGNET_DISTANCE) return { door: snapDoorToRoom(room, point, id), magnetized: false }
  return { door: best.door, magnetized: true }
}

function doorCandidateForCorridor(room: PlacedRoom, corridor: PlacedRoom, point: DoorPoint, id: string): RoomDoor {
  const side = doorSideFacingCorridor(room, corridor)
  const corridorPoint = closestPointOnRect(point, corridor)
  return {
    id,
    side,
    offset: doorOffsetForSide(room, side, corridorPoint),
  }
}

function corridorCandidatesForDoor(rooms: PlacedRoom[], room: PlacedRoom): PlacedRoom[] {
  return rooms.filter((candidate) =>
    candidate.floor === room.floor
    && candidate.kind === 'circulation'
    && candidate.id !== room.id
  )
}

function doorSideFacingCorridor(room: PlacedRoom, corridor: PlacedRoom): DoorSide {
  const candidates: Array<{ side: DoorSide; distance: number; aligned: boolean }> = [
    {
      side: 'top',
      distance: Math.abs(room.y - (corridor.y + corridor.h)),
      aligned: rangesTouch(room.x, room.x + room.w, corridor.x, corridor.x + corridor.w, 0),
    },
    {
      side: 'right',
      distance: Math.abs(room.x + room.w - corridor.x),
      aligned: rangesTouch(room.y, room.y + room.h, corridor.y, corridor.y + corridor.h, 0),
    },
    {
      side: 'bottom',
      distance: Math.abs(room.y + room.h - corridor.y),
      aligned: rangesTouch(room.x, room.x + room.w, corridor.x, corridor.x + corridor.w, 0),
    },
    {
      side: 'left',
      distance: Math.abs(room.x - (corridor.x + corridor.w)),
      aligned: rangesTouch(room.y, room.y + room.h, corridor.y, corridor.y + corridor.h, 0),
    },
  ]
  return candidates.sort((a, b) => Number(b.aligned) - Number(a.aligned) || a.distance - b.distance)[0].side
}

function doorOffsetForSide(room: PlacedRoom, side: DoorSide, point: DoorPoint): number {
  if (side === 'top' || side === 'bottom') return clampValue((point.x - room.x) / room.w, 0.08, 0.92)
  return clampValue((point.y - room.y) / room.h, 0.08, 0.92)
}

function closestPointOnRect(point: DoorPoint, room: PlacedRoom): DoorPoint {
  return {
    x: clampValue(point.x, room.x, room.x + room.w),
    y: clampValue(point.y, room.y, room.y + room.h),
  }
}

function pointToRectDistance(point: DoorPoint, room: PlacedRoom): number {
  const closest = closestPointOnRect(point, room)
  return Math.hypot(point.x - closest.x, point.y - closest.y)
}

function rectangleDistance(a: PlacedRoom, b: PlacedRoom): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)))
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)))
  return Math.hypot(dx, dy)
}

function rangesTouch(a1: number, a2: number, b1: number, b2: number, tolerance: number): boolean {
  return Math.min(a2, b2) - Math.max(a1, b1) >= -tolerance
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export default App
