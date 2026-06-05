import { buildAccessiblePatientRoute, isPassage } from './circulation'
import { distance } from './geometry'
import type {
  AgentRole,
  HospitalPlan,
  PlacedRoom,
  RouteStop,
  SimAgent,
  StaffStat,
} from '../types'

type StaffRole = Exclude<AgentRole, 'patient'>

const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  doctor: 'Medicos',
  nurse: 'Enfermeria',
  porter: 'Celadores',
  technician: 'Tecnicos',
}

const STAFF_ROLE_COLORS: Record<StaffRole, string> = {
  doctor: '#ffffff',
  nurse: '#386ba6',
  porter: '#8fb8de',
  technician: '#5d7186',
}

const STAFF_ROLE_ORDER: StaffRole[] = ['doctor', 'nurse', 'porter', 'technician']

export function addStaffAgents(plan: HospitalPlan, agents: SimAgent[], durationMinutes: number, rng: () => number) {
  const staffRooms = plan.rooms.filter((room) =>
    room.staffModel.length > 0
    && !isPassage(room)
    && room.kind !== 'green'
    && room.kind !== 'future',
  ).sort((a, b) => staffRoomPriority(b) - staffRoomPriority(a) || a.floor - b.floor)

  const staffSlots = staffRooms.flatMap((room) => (
    Array.from({ length: staffCountForRoom(room) }, (_, index) => ({ room, index }))
  ))

  staffSlots.slice(0, 64).forEach(({ room, index }, agentIndex) => {
    const role = staffRoleForRoom(room, index)
    const route = buildStaffShiftRoute(plan.rooms, room, role, durationMinutes, rng)
    agents.push({
      id: `s-${agentIndex + 1}`,
      role,
      staffGroup: role,
      staffLabel: staffLabelForRoom(room, index),
      route,
      color: STAFF_ROLE_COLORS[role],
    })
  })
}

export function createStaffStats(agents: SimAgent[]): StaffStat[] {
  const stats = new Map<StaffRole, StaffStat>(STAFF_ROLE_ORDER.map((role) => [
    role,
    {
      role,
      label: STAFF_ROLE_LABELS[role],
      color: STAFF_ROLE_COLORS[role],
      count: 0,
      moving: 0,
      samplePath: [],
    },
  ]))

  agents.filter((agent) => agent.role !== 'patient').forEach((agent) => {
    const role = agent.role as StaffRole
    const stat = stats.get(role)
    if (!stat) return
    stat.count += 1
    const uniqueRooms = agent.route
      .map((stop) => stop.roomId)
      .filter((roomId, index, roomIds) => roomId !== roomIds[index - 1])
    if (new Set(uniqueRooms).size > 1) stat.moving += 1
    if (stat.samplePath.length === 0) {
      stat.samplePath = agent.route
        .map((stop) => stop.phase)
        .filter((phase): phase is string => Boolean(phase))
        .filter((phase, index, phases) => phase !== phases[index - 1])
        .slice(0, 4)
    }
  })

  return STAFF_ROLE_ORDER
    .map((role) => stats.get(role))
    .filter((stat): stat is StaffStat => Boolean(stat && stat.count > 0))
}

function staffCountForRoom(room: PlacedRoom): number {
  if (room.kind === 'emergency' || room.kind === 'critical' || room.kind === 'surgery') return Math.min(3, Math.max(1, room.staffModel.length))
  if (room.kind === 'inpatient' || room.kind === 'maternalChild') return Math.min(2, Math.max(1, room.staffModel.length))
  if (room.kind === 'diagnostic' || room.kind === 'laboratory' || room.kind === 'pharmacy') return Math.min(2, Math.max(1, room.staffModel.length))
  return 1
}

function staffRoomPriority(room: PlacedRoom): number {
  const priority: Partial<Record<string, number>> = {
    emergency: 11,
    critical: 10,
    surgery: 10,
    diagnostic: 9,
    laboratory: 8,
    inpatient: 7,
    maternalChild: 7,
    oncology: 6,
    ambulatory: 6,
    pharmacy: 5,
    logistics: 4,
    public: 3,
    research: 3,
    technical: 2,
    staff: 2,
  }
  return priority[room.kind] ?? 1
}

function staffRoleForRoom(room: PlacedRoom, index: number): StaffRole {
  const label = staffLabelForRoom(room, index).toLowerCase()
  if (/enfermer|matrona|auxiliar|fisioterapia/.test(label)) return 'nurse'
  if (/celador|transporte|logistica|almacen|residuos/.test(label)) return 'porter'
  if (/tecnico|mantenimiento|operaciones|data|bms|soc|noc|electromedicina|energia|limpieza|seguridad|administrativo|informacion/.test(label)) return 'technician'
  return 'doctor'
}

function staffLabelForRoom(room: PlacedRoom, index: number): string {
  return room.staffModel[index % room.staffModel.length] ?? STAFF_ROLE_LABELS.technician
}

function buildStaffShiftRoute(rooms: PlacedRoom[], home: PlacedRoom, role: StaffRole, durationMinutes: number, rng: () => number): RouteStop[] {
  const targets = staffTargetsForRole(rooms, home, role, rng).slice(0, 3)
  const route: RouteStop[] = [{ roomId: home.id, at: 0, phase: `Base ${STAFF_ROLE_LABELS[role]}` }]
  if (targets.length === 0) {
    route.push({ roomId: home.id, at: durationMinutes, phase: 'Turno local' })
    return route
  }

  let current = home
  let at = Math.round(20 + rng() * 70)
  let cycle = 0
  while (at < durationMinutes - 35) {
    const target = targets[cycle % targets.length]
    cycle += 1
    const path = buildAccessiblePatientRoute(rooms, [current, target])
    if (!path) {
      at += 45
      continue
    }

    path.slice(1).forEach((room) => {
      at += Math.max(2, Math.round(2 + distance(current, room) * 0.12))
      if (at < durationMinutes) {
        route.push({
          roomId: room.id,
          at,
          phase: isPassage(room) ? 'Traslado de personal' : staffPhaseForRoom(role, room),
        })
      }
      current = room
    })

    at += staffDwellMinutes(role, target, rng)
  }

  if (route[route.length - 1]?.roomId !== home.id) {
    const returnPath = buildAccessiblePatientRoute(rooms, [current, home])
    returnPath?.slice(1).forEach((room) => {
      at += Math.max(2, Math.round(2 + distance(current, room) * 0.12))
      if (at < durationMinutes) route.push({ roomId: room.id, at, phase: isPassage(room) ? 'Retorno por pasillo' : 'Cierre de turno' })
      current = room
    })
  }

  route.push({ roomId: route[route.length - 1]?.roomId ?? home.id, at: durationMinutes, phase: 'Fin de turno' })
  return route
}

function staffTargetsForRole(rooms: PlacedRoom[], home: PlacedRoom, role: StaffRole, rng: () => number): PlacedRoom[] {
  return rooms
    .filter((room) =>
      room.id !== home.id
      && room.staffModel.length > 0
      && !isPassage(room)
      && room.kind !== 'green'
      && room.kind !== 'future'
      && buildAccessiblePatientRoute(rooms, [home, room]) !== null,
    )
    .map((room) => ({ room, score: staffTargetScore(home, room, role) + rng() * 0.9 }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.room)
}

function staffTargetScore(home: PlacedRoom, room: PlacedRoom, role: StaffRole): number {
  const preferences: Record<StaffRole, string[]> = {
    doctor: ['emergency', 'surgery', 'critical', 'diagnostic', 'inpatient', 'maternalChild', 'oncology', 'ambulatory'],
    nurse: ['emergency', 'critical', 'surgery', 'inpatient', 'maternalChild', 'oncology', 'ambulatory'],
    porter: ['logistics', 'emergency', 'surgery', 'critical', 'inpatient', 'diagnostic', 'laboratory'],
    technician: ['diagnostic', 'laboratory', 'technical', 'pharmacy', 'logistics', 'surgery', 'critical'],
  }
  let score = preferences[role].includes(room.kind) ? 8 : 2
  if (room.floor === home.floor) score += 5
  if (room.kind === home.kind) score += 2
  if (room.simulationNode && home.simulationNode === room.simulationNode) score += 2
  score -= distance(home, room) * 0.025
  return score
}

function staffPhaseForRoom(role: StaffRole, room: PlacedRoom): string {
  if (role === 'doctor') return `Valoracion en ${room.name}`
  if (role === 'nurse') return `Cuidados en ${room.name}`
  if (role === 'porter') return `Traslado / apoyo en ${room.name}`
  return `Soporte tecnico en ${room.name}`
}

function staffDwellMinutes(role: StaffRole, room: PlacedRoom, rng: () => number): number {
  const baseByRole: Record<StaffRole, number> = {
    doctor: 52,
    nurse: 44,
    porter: 26,
    technician: 38,
  }
  const acuity = room.kind === 'critical' || room.kind === 'surgery' || room.kind === 'emergency' ? 1.25 : 1
  return Math.round(baseByRole[role] * acuity * (0.75 + rng() * 0.5))
}
