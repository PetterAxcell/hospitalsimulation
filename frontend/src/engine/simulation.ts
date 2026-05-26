import { distance, roomByNode } from './geometry'
import type { HospitalPlan, PatientStream, PlacedRoom, RouteStop, Severity, SimAgent, SimulationNode, SimulationResult } from '../types'

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
  let travelSum = 0
  let verticalMoves = 0

  for (let i = 0; i < totalArrivals; i += 1) {
    const stream = weightedStream(rng())
    const severity = weightedSeverity(rng(), stream)
    const start = Math.floor((i / totalArrivals) * durationMinutes + rng() * 18)
    const routeRooms = routeForPatient(plan.rooms, stream, severity, rng)
    if (routeRooms.length < 2) {
      continue
    }
    const route = buildTimedRoute(routeRooms, start, severity, rng)
    for (const room of routeRooms) {
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
      const stayUntil = next.at - Math.min(22, Math.max(7, (next.at - current.at) * 0.22))
      if (minute <= stayUntil) {
        return jitterInRoom(currentRoom, agent.id, false)
      }
      const progress = Math.max(0, Math.min(1, (minute - stayUntil) / Math.max(1, next.at - stayUntil)))
      const a = jitterInRoom(currentRoom, agent.id, true)
      const b = jitterInRoom(nextRoom, agent.id, true)
      return {
        room: progress < 0.5 ? currentRoom : nextRoom,
        x: a.x + (b.x - a.x) * smooth(progress),
        y: a.y + (b.y - a.y) * smooth(progress),
        moving: true,
      }
    }
  }
  const last = agent.route[agent.route.length - 1]
  const room = rooms.find((item) => item.id === last.roomId)
  return room ? jitterInRoom(room, agent.id, false) : null
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
    staff: 20,
    green: 12,
    future: 0,
  }
  const mean = (baseByKind[room.kind] ?? 30) * SEVERITY_WEIGHT[severity]
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
