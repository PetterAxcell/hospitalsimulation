import { buildAccessiblePatientRoute, doorWorldPosition, isPassage } from './circulation'
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

interface PatientCaseStep {
  node: SimulationNode
  phase: string
}

interface PatientCaseDefinition {
  id: PatientCaseId
  label: string
  code: string
  stream: PatientStream
  severity: Severity
  color: string
  weight: number
  build: (rng: () => number) => PatientCaseStep[]
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  low: 0.7,
  medium: 1,
  high: 1.35,
  critical: 1.8,
}

const PATIENT_CASES: PatientCaseDefinition[] = [
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

export function runHospitalSimulation(plan: HospitalPlan, settings: SimulationSettings): SimulationResult {
  const rng = mulberry32(settings.seed)
  const durationMinutes = settings.durationHours * 60
  const agents: SimAgent[] = []
  const totalArrivals = Math.max(40, Math.round(settings.arrivalsPerHour * settings.durationHours))
  const roomPressure: Record<string, number> = {}
  const caseStats = createCaseStats()
  let completed = 0
  let blockedPatients = 0
  let travelSum = 0
  let verticalMoves = 0

  for (let i = 0; i < totalArrivals; i += 1) {
    const patientCase = weightedPatientCase(rng)
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
      const path = movementPathForSegment(currentRoom, nextRoom, followingRoom, agent.id)
      const point = interpolatePath(path, smooth(progress))
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

function movementPathForSegment(
  currentRoom: PlacedRoom,
  nextRoom: PlacedRoom,
  followingRoom: PlacedRoom | undefined,
  id: string,
): MovementPoint[] {
  const nextTarget = followingRoom ?? currentRoom
  if (!isPassage(currentRoom) && isPassage(nextRoom)) {
    return [
      doorPointForPassage(currentRoom, nextRoom) ?? edgePointToward(currentRoom, nextRoom),
      travelPoint(nextRoom, nextTarget, id),
    ]
  }
  if (isPassage(currentRoom) && !isPassage(nextRoom)) {
    return [
      travelPoint(currentRoom, nextRoom, id),
      doorPointForPassage(nextRoom, currentRoom) ?? edgePointToward(nextRoom, currentRoom),
      jitterInRoom(nextRoom, id, true),
    ]
  }
  if (isPassage(currentRoom) && isPassage(nextRoom)) {
    const start = travelPoint(currentRoom, nextRoom, id)
    const end = travelPoint(nextRoom, nextTarget, id)
    const joint = passageJointPoint(currentRoom, nextRoom)
    return joint ? [start, joint, end] : [start, end]
  }
  return [jitterInRoom(currentRoom, id, true), jitterInRoom(nextRoom, id, true)]
}

function displayRoomForSegment(currentRoom: PlacedRoom, nextRoom: PlacedRoom, progress: number): PlacedRoom {
  if (currentRoom.floor !== nextRoom.floor) return progress < 0.5 ? currentRoom : nextRoom
  if (!isPassage(currentRoom) && isPassage(nextRoom)) return progress < 0.12 ? currentRoom : nextRoom
  if (isPassage(currentRoom) && !isPassage(nextRoom)) return progress < 0.9 ? currentRoom : nextRoom
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
  const staffRooms = plan.rooms.filter((room) => room.staffModel.length > 0 && room.kind !== 'public' && room.kind !== 'green')
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

function weightedPatientCase(rng: () => number): PatientCaseDefinition {
  const total = PATIENT_CASES.reduce((sum, item) => sum + item.weight, 0)
  let roll = rng() * total
  for (const patientCase of PATIENT_CASES) {
    roll -= patientCase.weight
    if (roll <= 0) return patientCase
  }
  return PATIENT_CASES[PATIENT_CASES.length - 1]
}

function createCaseStats(): Map<PatientCaseId, PatientCaseStat> {
  return new Map(PATIENT_CASES.map((patientCase) => [
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

function doorPointForPassage(room: PlacedRoom, passage: PlacedRoom): MovementPoint | undefined {
  const doors = room.doors ?? []
  if (doors.length === 0) return undefined
  return doors
    .map((door) => {
      const point = doorWorldPosition(room, door)
      return { point, distance: pointToRectDistance(point, passage) }
    })
    .sort((a, b) => a.distance - b.distance)[0]?.point
}

function edgePointToward(room: PlacedRoom, targetRoom: PlacedRoom): MovementPoint {
  const roomCenter = { x: room.x + room.w / 2, y: room.y + room.h / 2 }
  const targetCenter = { x: targetRoom.x + targetRoom.w / 2, y: targetRoom.y + targetRoom.h / 2 }
  const dx = targetCenter.x - roomCenter.x
  const dy = targetCenter.y - roomCenter.y
  if (Math.abs(dx) > Math.abs(dy)) {
    return {
      x: dx >= 0 ? room.x + room.w : room.x,
      y: clamp(targetCenter.y, room.y + room.h * 0.12, room.y + room.h * 0.88),
    }
  }
  return {
    x: clamp(targetCenter.x, room.x + room.w * 0.12, room.x + room.w * 0.88),
    y: dy >= 0 ? room.y + room.h : room.y,
  }
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

function pointToRectDistance(point: MovementPoint, room: PlacedRoom): number {
  const closestX = clamp(point.x, room.x, room.x + room.w)
  const closestY = clamp(point.y, room.y, room.y + room.h)
  return Math.hypot(point.x - closestX, point.y - closestY)
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
