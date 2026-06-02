import { buildAccessiblePatientRoute, doorWorldPosition, isPassage } from './circulation'
import { distance, roomByNode } from './geometry'
import type { HospitalPlan, PatientStream, PlacedRoom, RouteStop, Severity, SimAgent, SimulationNode, SimulationResult } from '../types'

interface MovementPoint {
  x: number
  y: number
}

const STREAM_COLORS: Record<PatientStream, string> = {
  ed_ambulance: '#d62828',
  ed_walkin: '#f4a261',
  outpatient: '#2a9d8f',
  elective: '#7c6bb0',
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
  let completed = 0
  let blockedPatients = 0
  let travelSum = 0
  let verticalMoves = 0

  for (let i = 0; i < totalArrivals; i += 1) {
    const stream = weightedStream(rng())
    const severity = weightedSeverity(rng(), stream)
    const start = Math.floor((i / totalArrivals) * durationMinutes + rng() * 18)
    const serviceRooms = routeForPatient(plan.rooms, stream, severity, rng)
    if (serviceRooms.length < 2) {
      blockedPatients += 1
      continue
    }
    const routeRooms = buildAccessiblePatientRoute(plan.rooms, serviceRooms)
    if (!routeRooms) {
      blockedPatients += 1
      continue
    }
    const route = buildTimedRoute(routeRooms, start, severity, rng)
    for (const room of serviceRooms) {
      roomPressure[room.id] = (roomPressure[room.id] ?? 0) + 1
    }
    completed += 1
    travelSum += routeTravel(routeRooms)
    verticalMoves += countVerticalMoves(routeRooms)
    agents.push({
      id: `p-${i + 1}`,
      role: 'patient',
      stream,
      severity,
      route,
      color: STREAM_COLORS[stream],
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

function routeForPatient(rooms: PlacedRoom[], stream: PatientStream, severity: Severity, rng: () => number): PlacedRoom[] {
  const nodes: SimulationNode[] = []
  if (stream === 'ed_ambulance') nodes.push('arrival_ambulance')
  if (stream === 'ed_walkin') nodes.push('registration')
  if (stream === 'outpatient') nodes.push('registration', 'consult')
  if (stream === 'elective') nodes.push('registration', 'or', 'pacu')

  if (stream === 'ed_ambulance' || stream === 'ed_walkin') {
    nodes.push('triage')
    nodes.push(severity === 'critical' ? 'resus' : 'ed_bay')
    if (severity !== 'low' || rng() < 0.45) nodes.push('lab')
    if (severity === 'critical' || severity === 'high' || rng() < 0.35) nodes.push('imaging')
    if (severity === 'critical' && rng() < 0.45) nodes.push('or', 'pacu')
    if (severity === 'critical') nodes.push('icu')
    else if (severity === 'high' || rng() < 0.28) nodes.push('observation', 'ward')
    else nodes.push('pharmacy')
  }

  if (stream === 'outpatient') {
    if (severity === 'high' || rng() < 0.42) nodes.push('lab')
    if (severity === 'high' || rng() < 0.28) nodes.push('imaging')
    if (severity === 'high' && rng() < 0.16) nodes.push('ward')
    else nodes.push('pharmacy')
  }

  if (stream === 'elective') {
    if (severity === 'critical' || rng() < 0.18) nodes.push('icu')
    else nodes.push('ward')
  }

  nodes.push('discharge')
  return nodes.map((node) => roomByNode(rooms, node)).filter(Boolean) as PlacedRoom[]
}

function buildTimedRoute(routeRooms: PlacedRoom[], start: number, severity: Severity, rng: () => number): RouteStop[] {
  const stops: RouteStop[] = []
  let at = start
  routeRooms.forEach((room, index) => {
    if (index > 0) {
      const previous = routeRooms[index - 1]
      at += 3 + distance(previous, room) * 0.16
    }
    stops.push({ roomId: room.id, at: Math.round(at) })
    at += dwellMinutes(room, severity, rng)
  })
  return stops
}

function dwellMinutes(room: PlacedRoom, severity: Severity, rng: () => number): number {
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
  const base = baseByKind[room.kind] ?? 30
  if (base === 0) return 0
  const mean = base * SEVERITY_WEIGHT[severity]
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

function weightedStream(value: number): PatientStream {
  if (value < 0.44) return 'ed_walkin'
  if (value < 0.62) return 'ed_ambulance'
  if (value < 0.86) return 'outpatient'
  return 'elective'
}

function weightedSeverity(value: number, stream: PatientStream): Severity {
  const criticalBoost = stream === 'ed_ambulance' ? 0.1 : 0
  if (value < 0.08 + criticalBoost) return 'critical'
  if (value < 0.28 + criticalBoost) return 'high'
  if (value < 0.68) return 'medium'
  return 'low'
}

function routeTravel(routeRooms: PlacedRoom[]): number {
  let total = 0
  for (let i = 0; i < routeRooms.length - 1; i += 1) total += distance(routeRooms[i], routeRooms[i + 1]) * 0.16
  return total
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
