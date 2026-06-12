import { Suspense, lazy, useMemo, useState, type ReactNode } from 'react'
import './App.css'
import { AppHeader } from './components/AppHeader'
import { HospitalCanvas } from './components/HospitalCanvas'
import { WorkspaceTabs, type WorkspaceTab } from './components/WorkspaceTabs'
import { Metric } from './components/ui/Metric'
import { Modal } from './components/ui/Modal'
import { KIND_LABELS, ROOM_TEMPLATES, templateById } from './data/catalog'
import { CLINIC_SPACE_PROGRAM, clinicSpaceProgramById, componentsForSpaceProgramEntry } from './data/clinicSpaceProgram'
import { createHospitalClinicCampusPlan } from './data/presets'
import { evaluateArchitectureRules, type ArchitectureRuleResult } from './engine/architectureRules'
import {
  defaultDoorForRoom,
  disconnectedPassages,
  disconnectedPatientRooms,
  doorWorldPosition,
  hasPassageAccess,
  requiresCorridorAccess,
  snapDoorToRoom,
  type DoorPoint,
} from './engine/circulation'
import {
  areaSqmForDimensions,
  clampRoom,
  overlapScore,
} from './engine/geometry'
import { compilePlanningScript, DEFAULT_PLANNING_SCRIPT, type PlanningLanguageResult } from './engine/planningLanguage'
import {
  DEFAULT_CLINICAL_CASES_YAML,
  DEFAULT_PATIENT_CASES,
  clinicalCaseYamlFromSource,
  compileClinicalCases,
  replaceClinicalCaseInYaml,
  type ClinicalCaseCompileResult,
  type PatientCaseDefinition,
} from './engine/clinicalCases'
import { DEFAULT_SIMULATION_SETTINGS, runHospitalSimulation, type SimulationSettings } from './engine/simulation'
import { TopControls, TopPanel } from './features/top/TopDashboard'
import { RoomInspector } from './features/planning/RoomInspector'
import { SaturationPanel } from './features/saturation/SaturationPanel'
import { ClinicSpaceProgramPanel } from './features/services/ClinicSpaceProgramPanel'
import { SimulationCaseSelector } from './features/simulation/SimulationCaseSelector'
import { SimulationControlsPanel } from './features/simulation/SimulationControlsPanel'
import {
  architectureProposalFromCurrentPlan,
  demoArchitectureProposals,
  formatScore,
  rankArchitectureProposals,
  scoreArchitecture,
} from './features/top/scoring'
import type { ArchitectureProposal, ProposalOwner } from './features/top/types'
import type { DoorSide, HospitalPlan, PatientCaseFilter, PlacedRoom, RoomComponent, RoomDoor, SimulationAgentLayer, SimulationResult } from './types'
import { floorLabel, formatNumber } from './utils/format'

const INITIAL_PLAN = createHospitalClinicCampusPlan()
const DOOR_MAGNET_DISTANCE = 6
type ComponentSourceMode = 'clinic' | 'default'
const SimulationCanvas = lazy(() =>
  import('./components/SimulationCanvas').then((module) => ({ default: module.SimulationCanvas })),
)

function App() {
  const [plan, setPlan] = useState<HospitalPlan>(INITIAL_PLAN)
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('top')
  const [selectedFloor, setSelectedFloor] = useState(0)
  const [selectedRoomId, setSelectedRoomId] = useState<string | undefined>(plan.rooms[0]?.id)
  const [doorToolRoomId, setDoorToolRoomId] = useState<string | undefined>()
  const [elementToAdd, setElementToAdd] = useState('template:edBoxes')
  const [componentSourceMode, setComponentSourceMode] = useState<ComponentSourceMode>('clinic')
  const [simulationSettings, setSimulationSettings] = useState<SimulationSettings>(DEFAULT_SIMULATION_SETTINGS)
  const [patientCases, setPatientCases] = useState<PatientCaseDefinition[]>(DEFAULT_PATIENT_CASES)
  const [clinicalCaseLibrarySource, setClinicalCaseLibrarySource] = useState(DEFAULT_CLINICAL_CASES_YAML)
  const [clinicalCaseSource, setClinicalCaseSource] = useState(DEFAULT_CLINICAL_CASES_YAML)
  const [clinicalCaseResult, setClinicalCaseResult] = useState<ClinicalCaseCompileResult | null>(null)
  const [clinicalCaseFileName, setClinicalCaseFileName] = useState('casos-clinicos.yaml')
  const [editingClinicalCaseId, setEditingClinicalCaseId] = useState<PatientCaseFilter>('all')
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
  const [isLeftPanelHidden, setLeftPanelHidden] = useState(false)
  const [isRightPanelHidden, setRightPanelHidden] = useState(false)
  const [sectionModalTab, setSectionModalTab] = useState<WorkspaceTab | null>(null)

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
  const panelToggleAvailable = activeTab === 'plan' || activeTab === 'simulation'
  const simulationWorkspace = activeTab === 'simulation'
  const showLeftPanel = panelToggleAvailable && !isLeftPanelHidden
  const showRightPanel = panelToggleAvailable && !isRightPanelHidden

  function updateRoom(nextRoom: PlacedRoom) {
    setPlan((current) => ({
      ...current,
      rooms: current.rooms.map((room) => (room.id === nextRoom.id ? clampRoom(nextRoom) : room)),
    }))
  }

  function addRoom() {
    if (elementToAdd.startsWith('program:')) {
      addRoomFromSpaceProgram(elementToAdd.replace('program:', ''))
      return
    }
    addRoomFromTemplate(elementToAdd.replace('template:', ''))
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
      spaceProgramEntryId: componentSourceMode === 'clinic' ? clinicEntryForTemplate(template.id)?.id : undefined,
      components: componentsForTemplate(nextId, template.id, componentSourceMode),
    }
    setPlan((current) => {
      const door = defaultDoorForRoom(nextRoom, current.rooms)
      const roomWithDoor = clampRoom({ ...nextRoom, doors: door ? [door] : [] })
      const rooms = [...current.rooms, roomWithDoor]
      return { ...current, rooms }
    })
    setSelectedRoomId(nextRoom.id)
  }

  function addRoomFromSpaceProgram(entryId: string) {
    const entry = clinicSpaceProgramById(entryId)
    if (!entry) return
    const template = templateById(entry.templateIds[0] ?? 'ward')
    const nextId = `program-${entry.id}-${Date.now()}`
    const targetArea = entry.usefulAreaSqm ? Math.round(entry.usefulAreaSqm * entry.grossingFactor) : template.defaultAreaSqm
    const dimensions = dimensionsForTargetArea(targetArea, template.kind)
    const nextRoom: PlacedRoom = {
      id: nextId,
      templateId: template.id,
      name: entry.label,
      kind: template.kind,
      floor: selectedFloor,
      x: 8,
      y: 8,
      w: dimensions.w,
      h: dimensions.h,
      capacity: entry.expectedCapacity ?? template.defaultCapacity,
      areaSqm: areaSqmForDimensions(dimensions.w, dimensions.h),
      equipment: template.equipment,
      staffModel: template.staffModel,
      simulationNode: template.simulationNode,
      verticalGroupId: template.kind === 'vertical' ? `${template.id}-${selectedFloor}` : undefined,
      servesFloors: template.kind === 'vertical' ? [selectedFloor] : undefined,
      spaceProgramEntryId: componentSourceMode === 'clinic' ? entry.id : undefined,
      components: componentSourceMode === 'clinic'
        ? componentsForSpaceProgramEntry(entry).map((component) => ({ ...component, id: `${nextId}-${component.id}` }))
        : defaultComponentsForTemplate(nextId, template.id),
    }
    setPlan((current) => {
      const door = defaultDoorForRoom(nextRoom, current.rooms)
      const roomWithDoor = clampRoom({ ...nextRoom, doors: door ? [door] : [] })
      return { ...current, rooms: [...current.rooms, roomWithDoor] }
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
      components: selectedRoom.components?.map((component, index) => ({ ...component, id: `${copyId}-component-${index + 1}` })),
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
    setEditingClinicalCaseId('all')
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

  function openClinicalCaseLibrary() {
    setEditingClinicalCaseId('all')
    setClinicalCaseSource(clinicalCaseLibrarySource)
    setClinicalCaseFileName('casos-clinicos.yaml')
    setClinicalCaseResult(null)
    setClinicalCaseModalOpen(true)
  }

  function openClinicalCaseEditor(caseId: PatientCaseFilter) {
    if (caseId === 'all') {
      openClinicalCaseLibrary()
      return
    }
    setSelectedCaseId(caseId)
    setEditingClinicalCaseId(caseId)
    setClinicalCaseSource(clinicalCaseYamlFromSource(clinicalCaseLibrarySource, caseId, patientCases))
    setClinicalCaseFileName(`${caseId}.yaml`)
    setClinicalCaseResult(null)
    setClinicalCaseModalOpen(true)
  }

  function closeClinicalCaseModal() {
    setClinicalCaseModalOpen(false)
    if (editingClinicalCaseId !== 'all') {
      setEditingClinicalCaseId('all')
      setClinicalCaseSource(clinicalCaseLibrarySource)
      setClinicalCaseFileName('casos-clinicos.yaml')
      setClinicalCaseResult(null)
    }
  }

  function resetClinicalCaseDraft() {
    if (editingClinicalCaseId === 'all') {
      setClinicalCaseSource(DEFAULT_CLINICAL_CASES_YAML)
      setClinicalCaseFileName('casos-clinicos.yaml')
      setClinicalCaseResult(null)
      return
    }
    setClinicalCaseSource(clinicalCaseYamlFromSource(clinicalCaseLibrarySource, editingClinicalCaseId, patientCases))
    setClinicalCaseFileName(`${editingClinicalCaseId}.yaml`)
    setClinicalCaseResult(null)
  }

  function saveClinicalCases() {
    if (editingClinicalCaseId === 'all') {
      const result = compileClinicalCases(clinicalCaseSource)
      setClinicalCaseResult(result)
      if (result.diagnostics.some((diagnostic) => diagnostic.level === 'error')) return
      setPatientCases(result.cases)
      setClinicalCaseLibrarySource(clinicalCaseSource)
      setSelectedCaseId('all')
      setClinicalCaseModalOpen(false)
      return
    }

    const singleResult = compileClinicalCases(clinicalCaseSource)
    if (singleResult.diagnostics.some((diagnostic) => diagnostic.level === 'error') || singleResult.cases.length !== 1) {
      setClinicalCaseResult({
        ...singleResult,
        diagnostics: singleResult.diagnostics.length > 0
          ? singleResult.diagnostics
          : [{ level: 'error', line: 1, message: 'Este editor debe guardar un único caso clínico.' }],
      })
      return
    }

    try {
      const nextLibrarySource = replaceClinicalCaseInYaml(clinicalCaseLibrarySource, clinicalCaseSource, editingClinicalCaseId)
      const libraryResult = compileClinicalCases(nextLibrarySource)
      setClinicalCaseResult(libraryResult)
      if (libraryResult.diagnostics.some((diagnostic) => diagnostic.level === 'error')) return
      const nextCaseId = singleResult.cases[0].id
      setClinicalCaseLibrarySource(nextLibrarySource)
      setClinicalCaseSource(nextLibrarySource)
      setPatientCases(libraryResult.cases)
      setSelectedCaseId(nextCaseId)
      setEditingClinicalCaseId('all')
      setClinicalCaseFileName('casos-clinicos.yaml')
      setClinicalCaseModalOpen(false)
    } catch (error) {
      setClinicalCaseResult({
        cases: patientCases,
        diagnostics: [{
          level: 'error',
          line: 1,
          message: error instanceof Error ? error.message : String(error),
        }],
        appliedCases: 0,
      })
    }
  }

  function resetClinicalCases() {
    setPatientCases(DEFAULT_PATIENT_CASES)
    setClinicalCaseLibrarySource(DEFAULT_CLINICAL_CASES_YAML)
    setClinicalCaseSource(DEFAULT_CLINICAL_CASES_YAML)
    setClinicalCaseFileName('casos-clinicos.yaml')
    setClinicalCaseResult(null)
    setEditingClinicalCaseId('all')
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

  function renderFloorPicker() {
    return (
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
    )
  }

  function renderPlannerTools() {
    return (
      <section className="panel-section">
        <h2>Construir</h2>
        <label>
          Elemento
          <select value={elementToAdd} onChange={(event) => setElementToAdd(event.target.value)}>
            <optgroup label="Catálogo base">
              {ROOM_TEMPLATES.map((template) => (
                <option key={template.id} value={`template:${template.id}`}>
                  {template.shortName} · {KIND_LABELS[template.kind]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Pla d'Espais Nou Clínic">
              {CLINIC_SPACE_PROGRAM.map((entry) => (
                <option key={entry.id} value={`program:${entry.id}`}>
                  PDF p.{entry.sourcePages.join('/')} · {entry.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>
          Componentes
          <select value={componentSourceMode} onChange={(event) => setComponentSourceMode(event.target.value as ComponentSourceMode)}>
            <option value="clinic">Nou Clínic</option>
            <option value="default">Por defecto</option>
          </select>
        </label>
        <button type="button" className="primary-action" onClick={addRoom}>Añadir a planta {floorLabel(selectedFloor)}</button>
        <button type="button" className="secondary-action" onClick={autoConnectFloorToCorridors}>Auto-conectar planta</button>
        <button type="button" className="secondary-action" onClick={() => setScriptModalOpen(true)}>Programar plan</button>
      </section>
    )
  }

  function renderPlanSummary() {
    return (
      <section className="panel-section">
        <h2>Planta activa</h2>
        <Metric label="m2 planta" value={formatNumber(floorArea)} />
        <Metric label="Bloques" value={String(activeFloorRooms.length)} />
        <Metric label="Solapes" value={String(overlapScore(plan.rooms, selectedFloor))} />
      </section>
    )
  }

  function renderPlannerInspector() {
    return (
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
    )
  }

  function renderSimulationCases() {
    return (
      <SimulationCaseSelector
        result={simulationResult}
        selectedCaseId={selectedCaseId}
        agentLayer={simulationAgentLayer}
        diagnostics={clinicalCaseResult?.diagnostics ?? []}
        onEditCases={openClinicalCaseLibrary}
        onEditCase={openClinicalCaseEditor}
        onUploadCases={loadClinicalCaseTemplate}
        onResetCases={resetClinicalCases}
        onSelectCase={setSelectedCaseId}
        onChangeAgentLayer={setSimulationAgentLayer}
      />
    )
  }

  function renderSimulationParameters() {
    return (
      <SimulationControlsPanel
        settings={simulationSettings}
        onChange={setSimulationSettings}
        result={simulationResult}
        rules={rules}
      />
    )
  }

  function renderTopTools() {
    return (
      <TopControls
        owner={proposalOwner}
        proposals={topProposals}
        currentScore={currentScore}
        onChangeOwner={setProposalOwner}
        onSubmit={submitCurrentArchitecture}
      />
    )
  }

  function renderSectionModalContent(tab: WorkspaceTab): ReactNode {
    if (tab === 'top') {
      return (
        <div className="section-modal-grid">
          <div className="section-modal-stack">
            {renderTopTools()}
          </div>
          <section className="section-modal-card">
            <h3>Score actual</h3>
            <div className="section-metric-grid">
              <Metric label="Score" value={formatScore(currentScore.value)} />
              <Metric label="Bloqueos" value={`-${formatScore(currentScore.blockedPenalty)}`} />
              <Metric label="Espera ED" value={`-${formatScore(currentScore.waitPenalty)}`} />
              <Metric label="Reglas" value={`-${formatScore(currentScore.rulePenalty)}`} />
            </div>
          </section>
        </div>
      )
    }

    if (tab === 'plan') {
      return (
        <div className="section-modal-grid section-modal-grid-wide">
          <div className="section-modal-stack">
            {renderFloorPicker()}
            {renderPlannerTools()}
            {renderPlanSummary()}
            <AccessAlerts plan={plan} selectedFloor={selectedFloor} />
          </div>
          <div className="section-modal-stack">
            {renderPlannerInspector()}
          </div>
        </div>
      )
    }

    if (tab === 'simulation') {
      return (
        <div className="section-modal-grid section-modal-grid-wide">
          <div className="section-modal-stack">
            {renderFloorPicker()}
            {renderSimulationCases()}
          </div>
          <div className="section-modal-stack">
            {renderSimulationParameters()}
          </div>
        </div>
      )
    }

    if (tab === 'analysis') {
      return <AnalysisModalContent result={simulationResult} rules={rules} />
    }

    return <ServicesModalContent plan={plan} />
  }

  return (
    <main className="app-shell">
      <AppHeader
        planName={plan.name}
        targetAreaSqm={plan.targetAreaSqm}
        modeledAreaSqm={totalArea}
        floorCount={plan.floors.length}
        roomCount={plan.rooms.length}
      />

      <WorkspaceTabs
        active={activeTab}
        onChange={setActiveTab}
        actions={(
          <WorkspaceSectionActions
            activeTab={activeTab}
            panelToggleAvailable={panelToggleAvailable}
            leftVisible={showLeftPanel}
            rightVisible={showRightPanel}
            onOpenSection={() => setSectionModalTab(activeTab)}
            onToggleLeft={() => setLeftPanelHidden((current) => !current)}
            onToggleRight={() => setRightPanelHidden((current) => !current)}
          />
        )}
      />

      <section className={`workbench ${activeTab === 'simulation' ? 'is-simulation-workspace' : ''} ${showLeftPanel ? 'has-left-panel' : 'without-left-panel'} ${showRightPanel ? 'has-right-panel' : 'without-right-panel'}`}>
        {showLeftPanel && (
          <aside className="left-panel">
            {renderFloorPicker()}

            {simulationWorkspace ? (
              renderSimulationCases()
            ) : (
              <>
                {renderPlannerTools()}
                {renderPlanSummary()}
                <AccessAlerts plan={plan} selectedFloor={selectedFloor} />
              </>
            )}
          </aside>
        )}

        <section className={`main-panel ${activeTab === 'simulation' ? 'is-simulation-main' : ''}`}>
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
                onChangeSpeed={(speed) => setSimulationSettings((settings) => ({ ...settings, speed }))}
              />
            </Suspense>
          )}

          {activeTab === 'top' && <TopPanel proposals={topProposals} />}
          {activeTab === 'services' && <ServicesDashboard plan={plan} />}
          {activeTab === 'analysis' && <SaturationPanel plan={plan} result={simulationResult} selectedCaseId="all" />}
        </section>

        {showRightPanel && (
          <aside className="right-panel">
            {simulationWorkspace ? (
              renderSimulationParameters()
            ) : (
              renderPlannerInspector()
            )}
          </aside>
        )}
      </section>

      {sectionModalTab && (
        <Modal
          titleId="section-context-title"
          title={sectionModalTitle(sectionModalTab)}
          subtitle={sectionModalSubtitle(sectionModalTab)}
          className="section-modal"
          onClose={() => setSectionModalTab(null)}
        >
          <div className="section-modal-body">
            {renderSectionModalContent(sectionModalTab)}
          </div>
        </Modal>
      )}

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
          editingCaseId={editingClinicalCaseId}
          helpOpen={isClinicalCaseHelpOpen}
          onChange={setClinicalCaseSource}
          onSave={saveClinicalCases}
          onReset={resetClinicalCaseDraft}
          onUpload={loadClinicalCaseTemplate}
          onToggleHelp={() => setClinicalCaseHelpOpen((current) => !current)}
          onClose={closeClinicalCaseModal}
        />
      )}
    </main>
  )
}

function WorkspaceSectionActions({
  activeTab,
  panelToggleAvailable,
  leftVisible,
  rightVisible,
  onOpenSection,
  onToggleLeft,
  onToggleRight,
}: {
  activeTab: WorkspaceTab
  panelToggleAvailable: boolean
  leftVisible: boolean
  rightVisible: boolean
  onOpenSection: () => void
  onToggleLeft: () => void
  onToggleRight: () => void
}) {
  const showSectionModalTrigger = !panelToggleAvailable
  return (
    <div className="section-action-controls">
      {showSectionModalTrigger && (
        <button type="button" className="section-modal-trigger" onClick={onOpenSection} aria-haspopup="dialog">
          {sectionActionLabel(activeTab)}
        </button>
      )}
      {panelToggleAvailable && (
        <button type="button" className="section-modal-trigger mobile-section-trigger" onClick={onOpenSection} aria-haspopup="dialog">
          {sectionActionLabel(activeTab)}
        </button>
      )}
      {panelToggleAvailable && (
        <PanelVisibilityControls
          leftVisible={leftVisible}
          rightVisible={rightVisible}
          onToggleLeft={onToggleLeft}
          onToggleRight={onToggleRight}
        />
      )}
    </div>
  )
}

function PanelVisibilityControls({
  leftVisible,
  rightVisible,
  onToggleLeft,
  onToggleRight,
}: {
  leftVisible: boolean
  rightVisible: boolean
  onToggleLeft: () => void
  onToggleRight: () => void
}) {
  return (
    <div className="panel-visibility-controls" aria-label="Paneles laterales">
      <button type="button" aria-pressed={leftVisible} onClick={onToggleLeft}>
        {leftVisible ? 'Ocultar izq.' : 'Mostrar izq.'}
      </button>
      <button type="button" aria-pressed={rightVisible} onClick={onToggleRight}>
        {rightVisible ? 'Ocultar der.' : 'Mostrar der.'}
      </button>
    </div>
  )
}

function sectionActionLabel(tab: WorkspaceTab) {
  if (tab === 'top') return 'Registrar'
  if (tab === 'plan') return 'Herramientas'
  if (tab === 'simulation') return 'Herramientas'
  if (tab === 'analysis') return 'Lectura'
  return 'Resumen'
}

function sectionModalTitle(tab: WorkspaceTab) {
  if (tab === 'top') return 'Top de arquitecturas'
  if (tab === 'plan') return 'Herramientas del planificador'
  if (tab === 'simulation') return 'Herramientas de simulación'
  if (tab === 'analysis') return 'Lectura de análisis'
  return 'Resumen de servicios'
}

function sectionModalSubtitle(tab: WorkspaceTab) {
  if (tab === 'top') return 'Guardar la arquitectura actual y entender cómo puntúa.'
  if (tab === 'plan') return 'Plantas, construcción, accesos y edición del bloque seleccionado.'
  if (tab === 'simulation') return 'Casos clínicos, personal, parámetros y resultado del replay.'
  if (tab === 'analysis') return 'KPIs y reglas abiertas para leer cuellos de botella sin paneles laterales.'
  return 'Distribución funcional por tipo de servicio, m2 y capacidad.'
}

function AnalysisModalContent({
  result,
  rules,
}: {
  result: SimulationResult | null
  rules: ArchitectureRuleResult[]
}) {
  const warnCount = rules.filter((rule) => rule.status === 'warn').length
  const failCount = rules.filter((rule) => rule.status === 'fail').length
  const openRules = rules.filter((rule) => rule.status !== 'ok')

  return (
    <div className="section-modal-grid section-modal-grid-wide">
      <section className="section-modal-card">
        <h3>Resultado operativo</h3>
        <div className="section-metric-grid">
          <Metric label="Pacientes" value={String(result?.kpis.completed ?? 0)} />
          <Metric label="Bloqueados" value={String(result?.kpis.blockedPatients ?? 0)} />
          <Metric label="ED P90" value={`${result?.kpis.edP90Minutes ?? 0} min`} />
          <Metric label="Traslado medio" value={`${result?.kpis.averageTravelMinutes ?? 0} min`} />
        </div>
      </section>

      <section className="section-modal-card">
        <h3>Reglas abiertas</h3>
        <div className="section-metric-grid">
          <Metric label="Avisos" value={String(warnCount)} />
          <Metric label="Críticas" value={String(failCount)} />
          <Metric label="Zona cargada" value={result?.kpis.hottestRoomName ?? '-'} />
          <Metric label="Cambios planta" value={String(result?.kpis.verticalMoves ?? 0)} />
        </div>
        <div className="rule-list compact">
          {openRules.length > 0 ? (
            openRules.slice(0, 8).map((rule) => (
              <article key={rule.id} className={`rule-item ${rule.status}`}>
                <strong>{rule.label}</strong>
                <span>{rule.evidence}</span>
              </article>
            ))
          ) : (
            <article className="rule-item ok">
              <strong>Sin reglas abiertas</strong>
              <span>El plan actual no genera avisos arquitectónicos.</span>
            </article>
          )}
        </div>
      </section>
    </div>
  )
}

function ServicesModalContent({ plan }: { plan: HospitalPlan }) {
  const rows = serviceRowsForPlan(plan)
  const totalArea = rows.reduce((sum, row) => sum + row.area, 0)
  const totalCapacity = rows.reduce((sum, row) => sum + row.capacity, 0)

  return (
    <div className="section-modal-grid">
      <section className="section-modal-card">
        <h3>Programa funcional</h3>
        <div className="section-metric-grid">
          <Metric label="Familias" value={String(rows.length)} />
          <Metric label="Bloques" value={String(plan.rooms.length)} />
          <Metric label="m2" value={formatNumber(totalArea)} />
          <Metric label="Capacidad" value={String(totalCapacity)} />
        </div>
      </section>

      <section className="section-modal-card">
        <h3>Mayores bolsas de superficie modelada</h3>
        <div className="rule-list compact">
          {rows.slice(0, 6).map((row) => (
            <article key={row.label} className="rule-item ok">
              <strong>{row.label}</strong>
              <span>{row.count} bloques · {formatNumber(row.area)} m2 · capacidad {row.capacity}</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function ServicesDashboard({ plan }: { plan: HospitalPlan }) {
  return (
    <div className="services-dashboard">
      <ClinicSpaceProgramPanel plan={plan} />
      <ServiceMatrix plan={plan} />
    </div>
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
                Línea {diagnostic.line}: {diagnostic.message}
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
            <p>Lee el plan como una receta: primero contexto, luego piezas espaciales y al final las relaciones que hacen funcionar la simulación.</p>
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
              <li><strong>`corridors`</strong> crea pasillos públicos, clínicos o logísticos.</li>
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
                <div className="script-connection-preview" aria-label="Vista gráfica de boxes-pb conectado a clinical-pb">
                  <div className="script-connection-room">
                    <strong>boxes-pb</strong>
                    <span>Boxes ED</span>
                  </div>
                  <div className="script-connection-line" />
                  <div className="script-connection-corridor">
                    <strong>clinical-pb</strong>
                    <span>Pasillo clínico</span>
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
              <li>Alias útiles: `hall`, `waiting`, `boxes`, `triage`, `icu`, `ward`, `public`, `clinical`, `logistics`, `core`, `stair`.</li>
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
                <span>{floorLabel(room.floor)} sin puerta física a pasillo.</span>
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
            <span>Todos los bloques operativos y elementos de circulación están conectados.</span>
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
  editingCaseId,
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
  editingCaseId: PatientCaseFilter
  helpOpen: boolean
  onChange: (value: string) => void
  onSave: () => void
  onReset: () => void
  onUpload: (file: File | undefined) => void
  onToggleHelp: () => void
  onClose: () => void
}) {
  const hasErrors = result?.diagnostics.some((diagnostic) => diagnostic.level === 'error') ?? false
  const editingSingleCase = editingCaseId !== 'all'

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="script-modal" role="dialog" aria-modal="true" aria-labelledby="clinical-cases-modal-title">
        <header className="script-modal-header">
          <div>
            <h2 id="clinical-cases-modal-title">{editingSingleCase ? 'Programar caso clínico' : 'Programar casos clínicos'}</h2>
            <p>{editingSingleCase ? `${fileName} · recorrido editable` : fileName}</p>
          </div>
          <div className="script-modal-actions">
            <button type="button" className="info-action" onClick={onToggleHelp} aria-haspopup="dialog" aria-expanded={helpOpen}>Info</button>
            <button type="button" onClick={onClose}>Cerrar</button>
          </div>
        </header>

        <div className="script-toolbar">
          {!editingSingleCase && (
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
          )}
          {result && <span>{hasErrors ? 'No aplicado' : `${result.appliedCases} casos aplicados`}</span>}
          {editingSingleCase && <span>Edita `steps`, `chance` y `choose` para cambiar el recorrido.</span>}
        </div>

        <textarea
          aria-label="Plantilla de casos clínicos"
          wrap="off"
          spellCheck={false}
          value={source}
          onChange={(event) => onChange(event.target.value)}
        />

        <footer className="script-diagnostics">
          {result?.diagnostics.length ? (
            result.diagnostics.map((diagnostic) => (
              <p key={`${diagnostic.line}-${diagnostic.message}`} className={diagnostic.level}>
                Línea {diagnostic.line}: {diagnostic.message}
              </p>
            ))
          ) : (
            <p className="muted">{result ? `OK · ${result.appliedCases} casos listos` : 'Sin ejecutar.'}</p>
          )}
        </footer>

        <div className="script-modal-footer">
          <button type="button" onClick={onReset}>{editingSingleCase ? 'Restaurar caso' : 'Restaurar ejemplo'}</button>
          <div className="script-footer-actions">
            <button type="button" onClick={onClose}>Cancelar</button>
            <button type="button" className="primary-action" onClick={onSave}>{editingSingleCase ? 'Guardar caso' : 'Guardar casos'}</button>
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
            <h2 id="clinical-cases-info-title">Casos para la simulación</h2>
            <p>Define perfiles clínicos, su peso de llegada y la secuencia de nodos hospitalarios que recorren los pacientes.</p>
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
              <li><strong>`id`</strong> debe ser único y no puede ser `all`.</li>
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

function ServiceMatrix({ plan }: { plan: HospitalPlan }) {
  const rows = serviceRowsForPlan(plan)
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
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.count}</td>
              <td>{formatNumber(row.area)}</td>
              <td>{row.capacity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface ServiceRow {
  label: string
  count: number
  area: number
  capacity: number
}

function serviceRowsForPlan(plan: HospitalPlan): ServiceRow[] {
  return Object.entries(
    plan.rooms.reduce<Record<string, Omit<ServiceRow, 'label'>>>((acc, room) => {
      const label = KIND_LABELS[room.kind]
      acc[label] ??= { count: 0, area: 0, capacity: 0 }
      acc[label].count += 1
      acc[label].area += room.areaSqm
      acc[label].capacity += room.capacity
      return acc
    }, {}),
  )
    .map(([label, value]) => ({ label, ...value }))
    .sort((a, b) => b.area - a.area)
}

function componentsForTemplate(roomId: string, templateId: string, source: ComponentSourceMode): RoomComponent[] {
  if (source === 'clinic') {
    const entry = clinicEntryForTemplate(templateId)
    if (entry) {
      return componentsForSpaceProgramEntry(entry).map((component) => ({ ...component, id: `${roomId}-${component.id}` }))
    }
  }
  return defaultComponentsForTemplate(roomId, templateId)
}

function clinicEntryForTemplate(templateId: string) {
  return CLINIC_SPACE_PROGRAM.find((entry) => entry.templateIds.includes(templateId))
}

function defaultComponentsForTemplate(roomId: string, templateId: string): RoomComponent[] {
  const template = templateById(templateId)
  return template.equipment.map((equipment, index) => ({
    id: `${roomId}-default-component-${index + 1}`,
    name: equipment,
    quantity: 1,
    category: 'equipamiento por defecto',
    source: 'catalogo base',
  }))
}

function dimensionsForTargetArea(areaSqm: number, kind: PlacedRoom['kind']): { w: number; h: number } {
  const worldArea = Math.max(36, areaSqm / 9)
  const aspect = kind === 'public' || kind === 'waiting'
    ? 1.6
    : kind === 'surgery' || kind === 'critical'
      ? 1.25
      : kind === 'logistics' || kind === 'technical'
        ? 1.45
        : 1.35
  let w = Math.sqrt(worldArea * aspect)
  let h = worldArea / w
  if (w > 42) {
    w = 42
    h = worldArea / w
  }
  if (h > 26) {
    h = 26
    w = worldArea / h
  }
  return {
    w: Math.max(8, Math.min(42, Math.round(w * 10) / 10)),
    h: Math.max(7, Math.min(26, Math.round(h * 10) / 10)),
  }
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
