import { parse as parseYaml } from 'yaml'
import { buildAccessiblePatientRoute, isPassage } from './circulation'
import { distance, roomByNode } from './geometry'
import type {
  HospitalPlan,
  PatientCaseId,
  PatientCaseStat,
  PatientStream,
  PlacedRoom,
  RouteStop,
  Severity,
  SimAgent,
  SimulationNode,
  SimulationResult,
} from '../types'

interface MovementPoint {
  x: number
  y: number
}

export interface PatientCaseStep {
  node: SimulationNode
  phase: string
}

export interface PatientCaseDefinition {
  id: PatientCaseId
  label: string
  code: string
  stream: PatientStream
  severity: Severity
  color: string
  weight: number
  build: (rng: () => number) => PatientCaseStep[]
}

export interface ClinicalCaseDiagnostic {
  level: 'error' | 'warning'
  line: number
  message: string
}

export interface ClinicalCaseCompileResult {
  cases: PatientCaseDefinition[]
  diagnostics: ClinicalCaseDiagnostic[]
  appliedCases: number
}

interface CaseStepSpec {
  chance: number
  build: (rng: () => number) => PatientCaseStep[]
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  low: 0.7,
  medium: 1,
  high: 1.35,
  critical: 1.8,
}

export const DEFAULT_PATIENT_CASES: PatientCaseDefinition[] = [
  {
    id: 'trauma_major',
    label: 'Trauma mayor',
    code: 'TRA',
    stream: 'ed_ambulance',
    severity: 'critical',
    color: '#d62828',
    weight: 9,
    build: (rng) => {
      const surgical = rng() < 0.62
      const needsIcu = rng() < 0.78
      return [
        caseStep('arrival_ambulance', 'Entrada ambulancia'),
        caseStep('resus', 'ABCDE y estabilizacion'),
        caseStep('imaging', 'TAC urgente'),
        ...(surgical ? [caseStep('or', 'Quirofano trauma'), caseStep('pacu', 'Reanimacion postoperatoria')] : []),
        caseStep(needsIcu ? 'icu' : 'ward', needsIcu ? 'Ingreso UCI' : 'Ingreso planta'),
      ]
    },
  },
  {
    id: 'stroke_code',
    label: 'Codigo ictus',
    code: 'ICT',
    stream: 'ed_ambulance',
    severity: 'high',
    color: '#7c3aed',
    weight: 7,
    build: (rng) => {
      const needsResus = rng() < 0.34
      const criticalUnit = rng() < 0.58
      return [
        caseStep('arrival_ambulance', 'Preaviso SEM'),
        caseStep('triage', 'Triaje avanzado'),
        caseStep('imaging', 'TC craneal'),
        ...(needsResus ? [caseStep('resus', 'Estabilizacion neuro')] : []),
        caseStep(criticalUnit ? 'icu' : 'ward', criticalUnit ? 'Unidad critica' : 'Ingreso neurologia'),
      ]
    },
  },
  {
    id: 'chest_pain',
    label: 'Dolor toracico',
    code: 'DT',
    stream: 'ed_walkin',
    severity: 'high',
    color: '#ef4444',
    weight: 11,
    build: (rng) => {
      const needsImaging = rng() < 0.42
      const observation = rng() < 0.46
      return [
        caseStep('registration', 'Admision rapida'),
        caseStep('triage', 'Triaje prioridad alta'),
        caseStep('ed_bay', 'Box monitorizado'),
        caseStep('lab', 'Troponinas seriadas'),
        ...(needsImaging ? [caseStep('imaging', 'Prueba cardiologia')] : []),
        caseStep(observation ? 'observation' : 'pharmacy', observation ? 'Observacion ED' : 'Alta con tratamiento'),
      ]
    },
  },
  {
    id: 'minor_ed',
    label: 'Urgencia leve',
    code: 'UL',
    stream: 'ed_walkin',
    severity: 'low',
    color: '#f4a261',
    weight: 24,
    build: (rng) => [
      caseStep('registration', 'Admision'),
      caseStep('triage', 'Triaje'),
      caseStep('ed_bay', rng() < 0.5 ? 'Cura / analgesia' : 'Valoracion medica'),
      caseStep('pharmacy', 'Receta y alta'),
    ],
  },
  {
    id: 'ed_observation',
    label: 'Urgencia con observacion',
    code: 'OBS',
    stream: 'ed_walkin',
    severity: 'medium',
    color: '#2a9d8f',
    weight: 17,
    build: (rng) => {
      const needsLab = rng() < 0.64
      const needsImaging = rng() < 0.38
      const admission = rng() < 0.32
      return [
        caseStep('registration', 'Admision'),
        caseStep('triage', 'Triaje'),
        caseStep('ed_bay', 'Box diagnostico'),
        ...(needsLab ? [caseStep('lab', 'Analitica')] : []),
        ...(needsImaging ? [caseStep('imaging', 'Imagen')] : []),
        caseStep('observation', 'Observacion y decision'),
        caseStep(admission ? 'ward' : 'pharmacy', admission ? 'Ingreso planta' : 'Alta'),
      ]
    },
  },
  {
    id: 'outpatient_consult',
    label: 'Consulta externa',
    code: 'CEX',
    stream: 'outpatient',
    severity: 'medium',
    color: '#2563eb',
    weight: 22,
    build: (rng) => {
      const needsLab = rng() < 0.36
      const needsImaging = rng() < 0.24
      return [
        caseStep('registration', 'Check-in'),
        caseStep('consult', 'Consulta / hospital de dia'),
        ...(needsLab ? [caseStep('lab', 'Extraccion')] : []),
        ...(needsImaging ? [caseStep('imaging', 'Prueba imagen')] : []),
        caseStep('pharmacy', 'Farmacia / salida'),
      ]
    },
  },
  {
    id: 'scheduled_surgery',
    label: 'Cirugia programada',
    code: 'QX',
    stream: 'elective',
    severity: 'medium',
    color: '#7c6bb0',
    weight: 9,
    build: (rng) => {
      const needsIcu = rng() < 0.18
      return [
        caseStep('registration', 'Ingreso quirurgico'),
        caseStep('or', 'Quirofano'),
        caseStep('pacu', 'PACU'),
        caseStep(needsIcu ? 'icu' : 'ward', needsIcu ? 'UCI postoperatoria' : 'Planta postoperatoria'),
      ]
    },
  },
]

const VALID_STREAMS: PatientStream[] = ['ed_ambulance', 'ed_walkin', 'outpatient', 'elective']
const VALID_SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical']
const VALID_SIMULATION_NODES: SimulationNode[] = [
  'arrival_public',
  'arrival_ambulance',
  'triage',
  'registration',
  'ed_bay',
  'resus',
  'observation',
  'consult',
  'imaging',
  'lab',
  'or',
  'hybrid_or',
  'pacu',
  'icu',
  'ward',
  'maternity',
  'neonatal_icu',
  'pharmacy',
  'discharge',
  'logistics',
  'research',
  'vertical_core',
  'emergency_stair',
  'refuge_area',
  'fire_sector',
  'exit',
]

const NODE_ALIASES: Record<string, SimulationNode> = {
  admision: 'registration',
  admission: 'registration',
  ambulance: 'arrival_ambulance',
  ambulancia: 'arrival_ambulance',
  boxes: 'ed_bay',
  box: 'ed_bay',
  consulta: 'consult',
  consultorio: 'consult',
  diagnostico: 'imaging',
  emergency: 'ed_bay',
  farmacia: 'pharmacy',
  hospitalizacion: 'ward',
  imagen: 'imaging',
  laboratorio: 'lab',
  quirofano: 'or',
  reanimacion: 'resus',
  shock: 'resus',
  urgencias: 'ed_bay',
  uci: 'icu',
}

export const DEFAULT_CLINICAL_CASES_YAML = `cases:
  - id: trauma_major
    label: Trauma mayor
    code: TRA
    stream: ed_ambulance
    severity: critical
    color: "#d62828"
    weight: 9
    steps:
      - node: arrival_ambulance
        phase: Entrada ambulancia
      - node: resus
        phase: ABCDE y estabilizacion
      - node: imaging
        phase: TAC urgente
      - chance: 0.62
        steps:
          - node: or
            phase: Quirofano trauma
          - node: pacu
            phase: Reanimacion postoperatoria
      - choose:
          - weight: 0.78
            node: icu
            phase: Ingreso UCI
          - weight: 0.22
            node: ward
            phase: Ingreso planta

  - id: stroke_code
    label: Codigo ictus
    code: ICT
    stream: ed_ambulance
    severity: high
    color: "#7c3aed"
    weight: 7
    steps:
      - node: arrival_ambulance
        phase: Preaviso SEM
      - node: triage
        phase: Triaje avanzado
      - node: imaging
        phase: TC craneal
      - chance: 0.34
        node: resus
        phase: Estabilizacion neuro
      - choose:
          - weight: 0.58
            node: icu
            phase: Unidad critica
          - weight: 0.42
            node: ward
            phase: Ingreso neurologia

  - id: chest_pain
    label: Dolor toracico
    code: DT
    stream: ed_walkin
    severity: high
    color: "#ef4444"
    weight: 11
    steps:
      - node: registration
        phase: Admision rapida
      - node: triage
        phase: Triaje prioridad alta
      - node: ed_bay
        phase: Box monitorizado
      - node: lab
        phase: Troponinas seriadas
      - chance: 0.42
        node: imaging
        phase: Prueba cardiologia
      - choose:
          - weight: 0.46
            node: observation
            phase: Observacion ED
          - weight: 0.54
            node: pharmacy
            phase: Alta con tratamiento

  - id: minor_ed
    label: Urgencia leve
    code: UL
    stream: ed_walkin
    severity: low
    color: "#f4a261"
    weight: 24
    steps:
      - node: registration
        phase: Admision
      - node: triage
        phase: Triaje
      - choose:
          - weight: 0.5
            node: ed_bay
            phase: Cura / analgesia
          - weight: 0.5
            node: ed_bay
            phase: Valoracion medica
      - node: pharmacy
        phase: Receta y alta

  - id: ed_observation
    label: Urgencia con observacion
    code: OBS
    stream: ed_walkin
    severity: medium
    color: "#2a9d8f"
    weight: 17
    steps:
      - node: registration
        phase: Admision
      - node: triage
        phase: Triaje
      - node: ed_bay
        phase: Box diagnostico
      - chance: 0.64
        node: lab
        phase: Analitica
      - chance: 0.38
        node: imaging
        phase: Imagen
      - node: observation
        phase: Observacion y decision
      - choose:
          - weight: 0.32
            node: ward
            phase: Ingreso planta
          - weight: 0.68
            node: pharmacy
            phase: Alta

  - id: outpatient_consult
    label: Consulta externa
    code: CEX
    stream: outpatient
    severity: medium
    color: "#2563eb"
    weight: 22
    steps:
      - node: registration
        phase: Check-in
      - node: consult
        phase: Consulta / hospital de dia
      - chance: 0.36
        node: lab
        phase: Extraccion
      - chance: 0.24
        node: imaging
        phase: Prueba imagen
      - node: pharmacy
        phase: Farmacia / salida

  - id: scheduled_surgery
    label: Cirugia programada
    code: QX
    stream: elective
    severity: medium
    color: "#7c6bb0"
    weight: 9
    steps:
      - node: registration
        phase: Ingreso quirurgico
      - node: or
        phase: Quirofano
      - node: pacu
        phase: PACU
      - choose:
          - weight: 0.18
            node: icu
            phase: UCI postoperatoria
          - weight: 0.82
            node: ward
            phase: Planta postoperatoria`

export interface SimulationSettings {
  seed: number
  arrivalsPerHour: number
  durationHours: number
  speed: number
}

export const DEFAULT_SIMULATION_SETTINGS: SimulationSettings = {
  seed: 31,
  arrivalsPerHour: 9,
  durationHours: 24,
  speed: 90,
}

export function compileClinicalCases(source: string): ClinicalCaseCompileResult {
  let document: unknown
  try {
    document = parseYaml(source)
  } catch (error) {
    return {
      cases: DEFAULT_PATIENT_CASES,
      diagnostics: [{
        level: 'error',
        line: 1,
        message: error instanceof Error ? error.message : String(error),
      }],
      appliedCases: 0,
    }
  }

  try {
    const root = requireRecord(document, 'El YAML de casos debe ser un objeto con la clave cases.')
    const cases = listFromValue(root.cases).map(caseFromYamlEntry)
    if (cases.length === 0) {
      throw new Error('Define al menos un caso en cases.')
    }
    const duplicatedId = firstDuplicate(cases.map((item) => item.id))
    if (duplicatedId) throw new Error(`El caso "${duplicatedId}" esta duplicado.`)
    return {
      cases,
      diagnostics: [],
      appliedCases: cases.length,
    }
  } catch (error) {
    return {
      cases: DEFAULT_PATIENT_CASES,
      diagnostics: [{
        level: 'error',
        line: 1,
        message: error instanceof Error ? error.message : String(error),
      }],
      appliedCases: 0,
    }
  }
}

export function runHospitalSimulation(plan: HospitalPlan, settings: SimulationSettings, patientCases: PatientCaseDefinition[] = DEFAULT_PATIENT_CASES): SimulationResult {
  const activeCases = patientCases.length > 0 ? patientCases : DEFAULT_PATIENT_CASES
  const rng = mulberry32(settings.seed)
  const durationMinutes = settings.durationHours * 60
  const agents: SimAgent[] = []
  const totalArrivals = Math.max(40, Math.round(settings.arrivalsPerHour * settings.durationHours))
  const roomPressure: Record<string, number> = {}
  const caseStats = createCaseStats(activeCases)
  let completed = 0
  let blockedPatients = 0
  let travelSum = 0
  let verticalMoves = 0

  for (let i = 0; i < totalArrivals; i += 1) {
    const patientCase = weightedPatientCase(rng, activeCases)
    const caseStat = caseStats.get(patientCase.id)
    if (caseStat) caseStat.attempted += 1
    const caseSteps = patientCase.build(rng)
    const start = Math.floor((i / totalArrivals) * durationMinutes + rng() * 18)
    const serviceStops = resolveCaseStops(plan.rooms, caseSteps)
    const serviceRooms = serviceStops.map((stop) => stop.room)
    if (serviceRooms.length < 2) {
      blockedPatients += 1
      if (caseStat) caseStat.blocked += 1
      continue
    }
    const routeRooms = buildAccessiblePatientRoute(plan.rooms, serviceRooms)
    if (!routeRooms) {
      blockedPatients += 1
      if (caseStat) caseStat.blocked += 1
      continue
    }
    const phaseByRoomId = new Map(serviceStops.map((stop) => [stop.room.id, stop.phase]))
    const route = buildTimedRoute(routeRooms, start, patientCase.severity, rng, phaseByRoomId)
    for (const room of serviceRooms) {
      roomPressure[room.id] = (roomPressure[room.id] ?? 0) + 1
    }
    completed += 1
    if (caseStat) {
      caseStat.completed += 1
      if (caseStat.samplePath.length === 0) caseStat.samplePath = samplePath(routeRooms, phaseByRoomId)
    }
    travelSum += routeTravel(routeRooms)
    verticalMoves += countVerticalMoves(routeRooms)
    agents.push({
      id: `p-${i + 1}`,
      role: 'patient',
      stream: patientCase.stream,
      severity: patientCase.severity,
      caseId: patientCase.id,
      caseName: patientCase.label,
      caseCode: patientCase.code,
      route,
      color: patientCase.color,
    })
  }

  addStaffAgents(plan, agents)

  const hottest = Object.entries(roomPressure)
    .map(([roomId, count]) => {
      const room = plan.rooms.find((item) => item.id === roomId)
      return {
        room,
        score: room ? count / Math.max(1, room.capacity) : 0,
      }
    })
    .sort((a, b) => b.score - a.score)[0]

  return {
    agents,
    durationMinutes,
    roomPressure,
    caseStats: [...caseStats.values()],
    kpis: {
      completed,
      edP90Minutes: estimateEdP90(plan.rooms, roomPressure),
      averageTravelMinutes: completed ? Math.round((travelSum / completed) * 10) / 10 : 0,
      verticalMoves,
      blockedPatients,
      hottestRoomName: hottest?.room?.name ?? '-',
      safetyWarnings: safetyWarnings(plan.rooms),
    },
  }
}

export function positionAt(agent: SimAgent, rooms: PlacedRoom[], minute: number): { room: PlacedRoom; x: number; y: number; moving: boolean } | null {
  if (agent.route.length === 0 || minute < agent.route[0].at || minute > agent.route[agent.route.length - 1].at + 60) {
    return null
  }
  for (let i = 0; i < agent.route.length - 1; i += 1) {
    const current = agent.route[i]
    const next = agent.route[i + 1]
    if (minute >= current.at && minute <= next.at) {
      const currentRoom = rooms.find((room) => room.id === current.roomId)
      const nextRoom = rooms.find((room) => room.id === next.roomId)
      if (!currentRoom || !nextRoom) return null
      if (current.roomId === next.roomId) return jitterInRoom(currentRoom, agent.id, false)
      const followingRoom = rooms.find((room) => room.id === agent.route[i + 2]?.roomId)
      const segmentDuration = Math.max(1, next.at - current.at)
      const currentIsPassage = isPassage(currentRoom)
      const travelWindow = currentIsPassage
        ? segmentDuration
        : Math.min(segmentDuration, Math.min(22, Math.max(7, segmentDuration * 0.22)))
      const stayUntil = currentIsPassage ? current.at : next.at - travelWindow
      if (!currentIsPassage && minute <= stayUntil) {
        return jitterInRoom(currentRoom, agent.id, false)
      }
      const progress = Math.max(0, Math.min(1, (minute - stayUntil) / Math.max(1, next.at - stayUntil)))
      const point = movementPointForSegment(currentRoom, nextRoom, followingRoom, agent.id, progress)
      return {
        room: displayRoomForSegment(currentRoom, nextRoom, progress),
        x: point.x,
        y: point.y,
        moving: true,
      }
    }
  }
  const last = agent.route[agent.route.length - 1]
  const room = rooms.find((item) => item.id === last.roomId)
  return room ? jitterInRoom(room, agent.id, false) : null
}

function movementPointForSegment(
  currentRoom: PlacedRoom,
  nextRoom: PlacedRoom,
  followingRoom: PlacedRoom | undefined,
  id: string,
  progress: number,
): MovementPoint {
  if (isPassage(currentRoom) && isPassage(nextRoom)) {
    const nextTarget = followingRoom ?? currentRoom
    const start = travelPoint(currentRoom, nextRoom, id)
    const end = travelPoint(nextRoom, nextTarget, id)
    const joint = passageJointPoint(currentRoom, nextRoom)
    if (!joint) return progress < 0.5 ? start : end
  }

  const path = movementPathForSegment(currentRoom, nextRoom, followingRoom, id)
  return interpolatePath(path, smooth(progress))
}

function movementPathForSegment(
  currentRoom: PlacedRoom,
  nextRoom: PlacedRoom,
  followingRoom: PlacedRoom | undefined,
  id: string,
): MovementPoint[] {
  const nextTarget = followingRoom ?? currentRoom
  if (!isPassage(currentRoom) && isPassage(nextRoom)) {
    return [
      travelPoint(nextRoom, currentRoom, id),
      travelPoint(nextRoom, nextTarget, id),
    ]
  }
  if (isPassage(currentRoom) && !isPassage(nextRoom)) {
    return [
      travelPoint(currentRoom, nextRoom, id),
    ]
  }
  if (isPassage(currentRoom) && isPassage(nextRoom)) {
    const start = travelPoint(currentRoom, nextRoom, id)
    const end = travelPoint(nextRoom, nextTarget, id)
    const joint = passageJointPoint(currentRoom, nextRoom)
    return joint ? [start, joint, end] : [start, end]
  }
  return [jitterInRoom(currentRoom, id, true)]
}

function displayRoomForSegment(currentRoom: PlacedRoom, nextRoom: PlacedRoom, progress: number): PlacedRoom {
  if (currentRoom.floor !== nextRoom.floor) return progress < 0.5 ? currentRoom : nextRoom
  if (!isPassage(currentRoom) && isPassage(nextRoom)) return nextRoom
  if (isPassage(currentRoom) && !isPassage(nextRoom)) return progress < 0.98 ? currentRoom : nextRoom
  if (!isPassage(currentRoom) && !isPassage(nextRoom)) return progress < 0.98 ? currentRoom : nextRoom
  return progress < 0.5 ? currentRoom : nextRoom
}

function buildTimedRoute(
  routeRooms: PlacedRoom[],
  start: number,
  severity: Severity,
  rng: () => number,
  phaseByRoomId: Map<string, string>,
): RouteStop[] {
  const stops: RouteStop[] = []
  let at = start
  routeRooms.forEach((room, index) => {
    if (index > 0) {
      const previous = routeRooms[index - 1]
      at += 3 + distance(previous, room) * 0.16
    }
    const phase = phaseByRoomId.get(room.id) ?? (isPassage(room) ? 'Traslado' : room.name)
    stops.push({ roomId: room.id, at: Math.round(at), phase })
    at += dwellMinutes(room, severity, rng)
  })
  return stops
}

function dwellMinutes(room: PlacedRoom, severity: Severity, rng: () => number): number {
  const baseByNode: Partial<Record<SimulationNode, number>> = {
    arrival_ambulance: 4,
    registration: 8,
    triage: 10,
    resus: 36,
    ed_bay: 44,
    observation: 150,
    imaging: 28,
    lab: 18,
    or: 125,
    hybrid_or: 150,
    pacu: 72,
    icu: 230,
    ward: 360,
    maternity: 95,
    neonatal_icu: 210,
    consult: 32,
    pharmacy: 10,
    logistics: 12,
    research: 36,
  }
  const baseByKind: Record<string, number> = {
    public: 9,
    waiting: 18,
    emergency: 38,
    diagnostic: 46,
    laboratory: 36,
    surgery: 115,
    critical: 190,
    inpatient: 360,
    ambulatory: 32,
    maternalChild: 180,
    oncology: 95,
    pharmacy: 12,
    logistics: 18,
    research: 35,
    technical: 10,
    vertical: 5,
    circulation: 0,
    staff: 20,
    green: 12,
    future: 0,
  }
  const base = room.simulationNode ? baseByNode[room.simulationNode] ?? baseByKind[room.kind] ?? 30 : baseByKind[room.kind] ?? 30
  if (base === 0) return 0
  const fixedPaceNodes: SimulationNode[] = ['arrival_ambulance', 'registration', 'triage', 'pharmacy']
  const multiplier = room.simulationNode && fixedPaceNodes.includes(room.simulationNode) ? 1 : SEVERITY_WEIGHT[severity]
  const mean = base * multiplier
  return Math.max(4, Math.round(mean * (0.72 + rng() * 0.56)))
}

function addStaffAgents(plan: HospitalPlan, agents: SimAgent[]) {
  const staffRooms = plan.rooms.filter((room) =>
    room.staffModel.length > 0
    && !isPassage(room)
    && room.kind !== 'public'
    && room.kind !== 'green'
    && room.kind !== 'future',
  )
  staffRooms.slice(0, 28).forEach((room, index) => {
    agents.push({
      id: `s-${index + 1}`,
      role: index % 3 === 0 ? 'doctor' : index % 3 === 1 ? 'nurse' : 'technician',
      route: [
        { roomId: room.id, at: 0 },
        { roomId: room.id, at: 1440 },
      ],
      color: index % 3 === 0 ? '#f8f9fa' : index % 3 === 1 ? '#4f83cc' : '#6c757d',
    })
  })
}

function routeTravel(routeRooms: PlacedRoom[]): number {
  let total = 0
  for (let i = 0; i < routeRooms.length - 1; i += 1) total += distance(routeRooms[i], routeRooms[i + 1]) * 0.16
  return total
}

function caseStep(node: SimulationNode, phase: string): PatientCaseStep {
  return { node, phase }
}

function weightedPatientCase(rng: () => number, patientCases: PatientCaseDefinition[]): PatientCaseDefinition {
  const total = patientCases.reduce((sum, item) => sum + item.weight, 0)
  let roll = rng() * total
  for (const patientCase of patientCases) {
    roll -= patientCase.weight
    if (roll <= 0) return patientCase
  }
  return patientCases[patientCases.length - 1]
}

function createCaseStats(patientCases: PatientCaseDefinition[]): Map<PatientCaseId, PatientCaseStat> {
  return new Map(patientCases.map((patientCase) => [
    patientCase.id,
    {
      id: patientCase.id,
      label: patientCase.label,
      color: patientCase.color,
      attempted: 0,
      completed: 0,
      blocked: 0,
      samplePath: [],
    },
  ]))
}

function caseFromYamlEntry(value: unknown): PatientCaseDefinition {
  const item = requireRecord(value, 'Cada caso debe ser un objeto.')
  const id = requiredString(item.id, 'case.id')
  if (id === 'all') throw new Error('El id "all" esta reservado.')
  const label = requiredString(item.label ?? item.name, `case ${id}.label`)
  const code = optionalString(item.code) ?? id.slice(0, 3).toUpperCase()
  const stream = streamFromValue(item.stream ?? 'ed_walkin', id)
  const severity = severityFromValue(item.severity ?? 'medium', id)
  const color = optionalString(item.color) ?? '#2a9d8f'
  const weight = optionalNumber(item.weight) ?? 1
  const specs = specsFromValue(item.steps, `case ${id}.steps`)
  if (specs.length < 2) throw new Error(`case ${id}.steps necesita al menos 2 pasos.`)
  return {
    id,
    label,
    code,
    stream,
    severity,
    color,
    weight: Math.max(0.01, weight),
    build: (rng) => expandStepSpecs(specs, rng),
  }
}

function specsFromValue(value: unknown, path: string): CaseStepSpec[] {
  return listFromValue(value).flatMap((entry, index) => specFromValue(entry, `${path}[${index}]`))
}

function specFromValue(value: unknown, path: string): CaseStepSpec[] {
  if (typeof value === 'string') {
    const node = simulationNodeFromValue(value, path)
    return [stepSpec(node, titleFromNode(node), 1)]
  }
  const item = requireRecord(value, `${path} debe ser un nodo, un paso o una rama.`)

  if (Array.isArray(item.choose) || Array.isArray(item.oneOf)) {
    const choices = listFromValue(item.choose ?? item.oneOf).map((choice, index) => choiceFromValue(choice, `${path}.choose[${index}]`))
    if (choices.length === 0) throw new Error(`${path}.choose necesita opciones.`)
    const chance = chanceFromValue(item.chance ?? item.probability ?? item.optional)
    return [{
      chance,
      build: (rng) => {
        const total = choices.reduce((sum, choice) => sum + choice.weight, 0)
        let roll = rng() * total
        for (const choice of choices) {
          roll -= choice.weight
          if (roll <= 0) return expandStepSpecs(choice.steps, rng)
        }
        return expandStepSpecs(choices[choices.length - 1].steps, rng)
      },
    }]
  }

  if (Array.isArray(item.steps)) {
    const chance = chanceFromValue(item.chance ?? item.probability ?? item.optional)
    const steps = specsFromValue(item.steps, `${path}.steps`)
    return [{
      chance,
      build: (rng) => expandStepSpecs(steps, rng),
    }]
  }

  const node = simulationNodeFromValue(item.node ?? item.to, `${path}.node`)
  const phase = optionalString(item.phase ?? item.name) ?? titleFromNode(node)
  const chance = chanceFromValue(item.chance ?? item.probability ?? item.optional)
  return [stepSpec(node, phase, chance)]
}

function choiceFromValue(value: unknown, path: string): { weight: number; steps: CaseStepSpec[] } {
  if (typeof value === 'string') {
    const node = simulationNodeFromValue(value, path)
    return { weight: 1, steps: [stepSpec(node, titleFromNode(node), 1)] }
  }
  const item = requireRecord(value, `${path} debe ser una opcion de rama.`)
  const weight = Math.max(0.01, optionalNumber(item.weight ?? item.chance ?? item.probability) ?? 1)
  if (Array.isArray(item.steps)) return { weight, steps: specsFromValue(item.steps, `${path}.steps`) }
  const node = simulationNodeFromValue(item.node ?? item.to, `${path}.node`)
  const phase = optionalString(item.phase ?? item.name) ?? titleFromNode(node)
  return { weight, steps: [stepSpec(node, phase, 1)] }
}

function stepSpec(node: SimulationNode, phase: string, chance: number): CaseStepSpec {
  return {
    chance,
    build: () => [caseStep(node, phase)],
  }
}

function expandStepSpecs(specs: CaseStepSpec[], rng: () => number): PatientCaseStep[] {
  const steps = specs.flatMap((spec) => (rng() <= spec.chance ? spec.build(rng) : []))
  return steps.filter((step, index) => step.node !== steps[index - 1]?.node)
}

function chanceFromValue(value: unknown): number {
  if (value === undefined) return 1
  if (typeof value === 'boolean') return value ? 1 : 0
  const number = optionalNumber(value)
  if (number === undefined) return 1
  return clamp(number, 0, 1)
}

function streamFromValue(value: unknown, id: string): PatientStream {
  const stream = requiredString(value, `case ${id}.stream`) as PatientStream
  if (!VALID_STREAMS.includes(stream)) throw new Error(`case ${id}.stream debe ser ${VALID_STREAMS.join(', ')}.`)
  return stream
}

function severityFromValue(value: unknown, id: string): Severity {
  const severity = requiredString(value, `case ${id}.severity`) as Severity
  if (!VALID_SEVERITIES.includes(severity)) throw new Error(`case ${id}.severity debe ser ${VALID_SEVERITIES.join(', ')}.`)
  return severity
}

function simulationNodeFromValue(value: unknown, path: string): SimulationNode {
  const raw = requiredString(value, path)
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, '_')
  const node = NODE_ALIASES[normalized] ?? normalized
  if (!VALID_SIMULATION_NODES.includes(node as SimulationNode)) {
    throw new Error(`${path} usa un nodo desconocido "${raw}".`)
  }
  return node as SimulationNode
}

function titleFromNode(node: SimulationNode): string {
  return node.split('_').map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ')
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function listFromValue(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} debe ser texto.`)
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const number = Number(value)
    return Number.isFinite(number) ? number : undefined
  }
  return undefined
}

function firstDuplicate(values: string[]): string | undefined {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return undefined
}

function resolveCaseStops(rooms: PlacedRoom[], steps: PatientCaseStep[]): Array<{ room: PlacedRoom; phase: string }> {
  const stops: Array<{ room: PlacedRoom; phase: string }> = []
  steps.forEach((step) => {
    const room = roomByNode(rooms, step.node)
    if (!room) return
    if (stops[stops.length - 1]?.room.id === room.id) return
    stops.push({ room, phase: step.phase })
  })
  return stops
}

function samplePath(routeRooms: PlacedRoom[], phaseByRoomId: Map<string, string>): string[] {
  return routeRooms
    .filter((room) => !isPassage(room))
    .map((room) => phaseByRoomId.get(room.id) ?? room.name)
    .filter((phase, index, phases) => phase !== phases[index - 1])
    .slice(0, 7)
}

function countVerticalMoves(routeRooms: PlacedRoom[]): number {
  let count = 0
  for (let i = 0; i < routeRooms.length - 1; i += 1) {
    if (routeRooms[i].floor !== routeRooms[i + 1].floor) count += 1
  }
  return count
}

function estimateEdP90(rooms: PlacedRoom[], pressure: Record<string, number>): number {
  const edRooms = rooms.filter((room) => room.kind === 'emergency')
  const pressureScore = edRooms.reduce((sum, room) => sum + (pressure[room.id] ?? 0) / Math.max(1, room.capacity), 0)
  return Math.round(95 + pressureScore * 28)
}

function safetyWarnings(rooms: PlacedRoom[]): number {
  const hasAmbulance = rooms.some((room) => room.simulationNode === 'arrival_ambulance')
  const hasResus = rooms.some((room) => room.simulationNode === 'resus')
  const hasIcu = rooms.some((room) => room.simulationNode === 'icu')
  const hasVertical = rooms.some((room) => room.simulationNode === 'vertical_core')
  return [hasAmbulance, hasResus, hasIcu, hasVertical].filter((item) => !item).length
}

function jitterInRoom(room: PlacedRoom, id: string, moving: boolean) {
  const number = Number(id.replace(/\D/g, '')) || 1
  const angle = ((number * 137.5) % 360) * (Math.PI / 180)
  const radius = moving ? 0.04 : 0.12 + ((number * 17) % 100) / 700
  return {
    room,
    x: room.x + room.w * (0.5 + Math.cos(angle) * radius),
    y: room.y + room.h * (0.5 + Math.sin(angle) * radius),
    moving,
  }
}

function travelPoint(room: PlacedRoom, targetRoom: PlacedRoom, id: string): MovementPoint {
  if (!isPassage(room)) return jitterInRoom(room, id, true)
  const target = {
    x: targetRoom.x + targetRoom.w / 2,
    y: targetRoom.y + targetRoom.h / 2,
  }
  const margin = 0.6
  const minX = room.x + margin
  const maxX = room.x + room.w - margin
  const minY = room.y + margin
  const maxY = room.y + room.h - margin
  let x = clamp(target.x, minX, maxX)
  let y = clamp(target.y, minY, maxY)

  if (room.kind === 'circulation' && room.w > room.h * 1.4) y = room.y + room.h / 2
  if (room.kind === 'circulation' && room.h > room.w * 1.4) x = room.x + room.w / 2

  return { x, y }
}

function passageJointPoint(a: PlacedRoom, b: PlacedRoom): MovementPoint | undefined {
  if (a.floor !== b.floor) return undefined
  if (!rangesTouch(a.x, a.x + a.w, b.x, b.x + b.w, 0.9) || !rangesTouch(a.y, a.y + a.h, b.y, b.y + b.h, 0.9)) {
    return undefined
  }
  return {
    x: contactAxisCenter(a.x, a.x + a.w, b.x, b.x + b.w),
    y: contactAxisCenter(a.y, a.y + a.h, b.y, b.y + b.h),
  }
}

function interpolatePath(points: MovementPoint[], progress: number): MovementPoint {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y))
  const totalLength = lengths.reduce((sum, length) => sum + length, 0)
  if (totalLength <= 0.0001) return points[points.length - 1]
  let remaining = totalLength * progress
  for (let index = 0; index < lengths.length; index += 1) {
    const segmentLength = lengths[index]
    if (remaining <= segmentLength || index === lengths.length - 1) {
      const local = segmentLength <= 0.0001 ? 1 : remaining / segmentLength
      const from = points[index]
      const to = points[index + 1]
      return {
        x: from.x + (to.x - from.x) * local,
        y: from.y + (to.y - from.y) * local,
      }
    }
    remaining -= segmentLength
  }
  return points[points.length - 1]
}

function rangesTouch(a1: number, a2: number, b1: number, b2: number, tolerance: number): boolean {
  return Math.min(a2, b2) - Math.max(a1, b1) >= -tolerance
}

function contactAxisCenter(a1: number, a2: number, b1: number, b2: number): number {
  const overlapStart = Math.max(a1, b1)
  const overlapEnd = Math.min(a2, b2)
  if (overlapStart <= overlapEnd) return (overlapStart + overlapEnd) / 2
  return a2 < b1 ? (a2 + b1) / 2 : (b2 + a1) / 2
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2
  return Math.max(min, Math.min(max, value))
}

function smooth(value: number): number {
  return value * value * (3 - 2 * value)
}

function mulberry32(seed: number) {
  return function random() {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
