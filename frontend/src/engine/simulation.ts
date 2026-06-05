import { buildAccessiblePatientRoute, isPassage } from './circulation'
import { distance, roomByNode } from './geometry'
import { addStaffAgents, createStaffStats } from './staffSimulation'
import {
  DEFAULT_PATIENT_CASES,
  createCaseStats,
  weightedPatientCase,
  type PatientCaseDefinition,
  type PatientCaseStep,
} from './clinicalCases'
import type {
  HospitalPlan,
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

const SEVERITY_WEIGHT: Record<Severity, number> = {
  low: 0.7,
  medium: 1,
  high: 1.35,
  critical: 1.8,
}

export interface SimulationSettings {
  seed: number
  arrivalsPerHour: number
  durationHours: number
  horizonYears: number
  speed: number
}

export const DEFAULT_SIMULATION_SETTINGS: SimulationSettings = {
  seed: 31,
  arrivalsPerHour: 9,
  durationHours: 24,
  horizonYears: 10,
  speed: 10,
}

export function runHospitalSimulation(plan: HospitalPlan, settings: SimulationSettings, patientCases: PatientCaseDefinition[] = DEFAULT_PATIENT_CASES): SimulationResult {
  const activeCases = patientCases.length > 0 ? patientCases : DEFAULT_PATIENT_CASES
  const rng = mulberry32(settings.seed)
  const motionCycleMinutes = settings.durationHours * 60
  const durationMinutes = Math.max(1, settings.horizonYears) * 365 * 24 * 60
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
    const start = Math.floor((i / totalArrivals) * motionCycleMinutes + rng() * 18)
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
    const route = buildTimedRoute(routeRooms, start, patientCase.severity, rng, serviceStops)
    for (const room of serviceRooms) {
      roomPressure[room.id] = (roomPressure[room.id] ?? 0) + 1
    }
    completed += 1
    if (caseStat) {
      caseStat.completed += 1
      if (caseStat.samplePath.length === 0) caseStat.samplePath = samplePath(serviceStops)
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

  addStaffAgents(plan, agents, motionCycleMinutes, rng)
  const staffStats = createStaffStats(agents)

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
    motionCycleMinutes,
    roomPressure,
    caseStats: [...caseStats.values()],
    staffStats,
    kpis: {
      completed,
      staffOnShift: agents.filter((agent) => agent.role !== 'patient').length,
      staffInMotion: staffStats.reduce((sum, stat) => sum + stat.moving, 0),
      edP90Minutes: estimateEdP90(plan.rooms, roomPressure),
      averageTravelMinutes: completed ? Math.round((travelSum / completed) * 10) / 10 : 0,
      verticalMoves,
      blockedPatients,
      hottestRoomName: hottest?.room?.name ?? '-',
      safetyWarnings: safetyWarnings(plan.rooms),
    },
  }
}

export function positionAt(agent: SimAgent, rooms: PlacedRoom[], minute: number): { room: PlacedRoom; x: number; y: number; moving: boolean; phase?: string } | null {
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
      if (current.roomId === next.roomId) return { ...jitterInRoom(currentRoom, agent.id, false), phase: current.phase }
      const followingRoom = rooms.find((room) => room.id === agent.route[i + 2]?.roomId)
      const segmentDuration = Math.max(1, next.at - current.at)
      const currentIsPassage = isPassage(currentRoom)
      const travelWindow = currentIsPassage
        ? segmentDuration
        : Math.min(segmentDuration, Math.min(22, Math.max(7, segmentDuration * 0.22)))
      const stayUntil = currentIsPassage ? current.at : next.at - travelWindow
      if (!currentIsPassage && minute <= stayUntil) {
        return { ...jitterInRoom(currentRoom, agent.id, false), phase: current.phase }
      }
      const progress = Math.max(0, Math.min(1, (minute - stayUntil) / Math.max(1, next.at - stayUntil)))
      const point = movementPointForSegment(currentRoom, nextRoom, followingRoom, agent.id, progress)
      return {
        room: displayRoomForSegment(currentRoom, nextRoom, progress),
        x: point.x,
        y: point.y,
        moving: true,
        phase: current.phase,
      }
    }
  }
  const last = agent.route[agent.route.length - 1]
  const room = rooms.find((item) => item.id === last.roomId)
  return room ? { ...jitterInRoom(room, agent.id, false), phase: last.phase } : null
}

function movementPointForSegment(
  currentRoom: PlacedRoom,
  nextRoom: PlacedRoom,
  followingRoom: PlacedRoom | undefined,
  id: string,
  progress: number,
): MovementPoint {
  const path = movementPathForSegment(currentRoom, nextRoom, followingRoom, id)
  const point = interpolatePath(path, smooth(progress))
  const passage = passageRoomForSegment(currentRoom, nextRoom, progress)
  return passage ? addPassageWander(point, passage, id, progress) : point
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
  serviceStops: Array<{ room: PlacedRoom; phase: string }>,
): RouteStop[] {
  const stops: RouteStop[] = []
  let at = start
  let serviceIndex = 0
  routeRooms.forEach((room, index) => {
    if (index > 0) {
      const previous = routeRooms[index - 1]
      at += 3 + distance(previous, room) * 0.16
    }
    const serviceStop = serviceStops[serviceIndex]
    const phase = serviceStop?.room.id === room.id
      ? serviceStop.phase
      : isPassage(room) ? 'Traslado' : room.name
    if (serviceStop?.room.id === room.id) serviceIndex += 1
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

function routeTravel(routeRooms: PlacedRoom[]): number {
  let total = 0
  for (let i = 0; i < routeRooms.length - 1; i += 1) total += distance(routeRooms[i], routeRooms[i + 1]) * 0.16
  return total
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

function samplePath(serviceStops: Array<{ room: PlacedRoom; phase: string }>): string[] {
  return serviceStops
    .map((stop) => stop.phase)
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
  const lane = stableLane(id, room.id)
  const horizontalRoom = room.kind === 'circulation' && room.w > room.h * 1.4
  const verticalRoom = room.kind === 'circulation' && room.h > room.w * 1.4

  if (horizontalRoom) y = clamp(room.y + room.h / 2 + lane * Math.max(0, room.h / 2 - margin), minY, maxY)
  if (verticalRoom) x = clamp(room.x + room.w / 2 + lane * Math.max(0, room.w / 2 - margin), minX, maxX)
  if (!horizontalRoom && !verticalRoom && isPassage(room)) {
    x = clamp(x + lane * Math.max(0, room.w / 5), minX, maxX)
    y = clamp(y - lane * Math.max(0, room.h / 5), minY, maxY)
  }

  return { x, y }
}

function passageRoomForSegment(currentRoom: PlacedRoom, nextRoom: PlacedRoom, progress: number): PlacedRoom | undefined {
  if (isPassage(currentRoom) && isPassage(nextRoom)) return progress < 0.5 ? currentRoom : nextRoom
  if (isPassage(currentRoom)) return currentRoom
  if (isPassage(nextRoom)) return nextRoom
  return undefined
}

function addPassageWander(point: MovementPoint, room: PlacedRoom, id: string, progress: number): MovementPoint {
  const margin = 0.55
  const phase = stableHash(`${id}:${room.id}:walk`) * Math.PI * 2
  const wave = Math.sin(progress * Math.PI * 2 + phase)
  const horizontalRoom = room.kind === 'circulation' && room.w > room.h * 1.4
  const verticalRoom = room.kind === 'circulation' && room.h > room.w * 1.4
  const lateralX = Math.max(0, room.w / 2 - margin)
  const lateralY = Math.max(0, room.h / 2 - margin)

  if (horizontalRoom) {
    return {
      x: clamp(point.x, room.x + margin, room.x + room.w - margin),
      y: clamp(point.y + wave * lateralY * 0.28, room.y + margin, room.y + room.h - margin),
    }
  }
  if (verticalRoom) {
    return {
      x: clamp(point.x + wave * lateralX * 0.28, room.x + margin, room.x + room.w - margin),
      y: clamp(point.y, room.y + margin, room.y + room.h - margin),
    }
  }
  return {
    x: clamp(point.x + wave * lateralX * 0.18, room.x + margin, room.x + room.w - margin),
    y: clamp(point.y - wave * lateralY * 0.18, room.y + margin, room.y + room.h - margin),
  }
}

function stableLane(id: string, roomId: string): number {
  return stableHash(`${id}:${roomId}`) * 2 - 1
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 10000) / 10000
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
