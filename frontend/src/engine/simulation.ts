import { ChannelGraph, distance, roomByNode } from './geometry'
import {
  DEFAULT_CHANNEL_CONFIGS, DEFAULT_DISRUPTOR_TEMPLATES,
  DEFAULT_EMERGENCY_TEAM_RATIO, DEFAULT_RESOURCE_CONFIGS,
  DEFAULT_ROOM_TIME_MULTIPLIERS, DEFAULT_SPECIALIST_CONFIGS,
  DEFAULT_STAFF_PROPORTIONS,
} from '../data/catalog'
import type {
  ChannelOccupancy, DisruptorEvent, DisruptorTemplate,
  HospitalPlan, PatientStream, PlacedRoom, ResourceConfig, RouteStop,
  Severity, SimAgent, SimulationNode, SimulationResult, SimulationSettings,
  StaffRole,
} from '../types'

/* ─── Constants ─── */

const STREAM_COLORS: Record<string, string> = {
  ed_ambulance: '#d62828',
  ed_walkin: '#f4a261',
  outpatient: '#2a9d8f',
  elective: '#7c6bb0',
  maternity: '#e91e63',
  oncology: '#9c27b0',
  mental_health: '#ff9800',
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  low: 0.7,
  medium: 1,
  high: 1.35,
  critical: 1.8,
}

const STAFF_COLORS: Record<StaffRole, string> = {
  specialist: '#f8f9fa',
  nurse: '#4f83cc',
  technician: '#6c757d',
  security: '#1a237e',
  emergency_team: '#d32f2f',
}

const SPECIALIST_COLORS: Record<string, string> = {
  cardiology: '#e53935',
  neurology: '#5e35b1',
  traumatology: '#fb8c00',
  psychiatry: '#43a047',
  pediatrics: '#29b6f6',
  obstetrics: '#ec407a',
  intensive_care: '#00897b',
  anesthesiology: '#6d4c41',
  general_surgery: '#c62828',
  internal_medicine: '#1565c0',
  emergency_medicine: '#ef6c00',
  oncology: '#6a1b9a',
  neonatology: '#26c6da',
  infectious_disease: '#7cb342',
  nephrology: '#1e88e5',
  neurosurgery: '#4e342e',
  pneumology: '#00acc1',
  dermatology: '#f48fb1',
  ophthalmology: '#0d47a1',
  otorhinolaryngology: '#795548',
}

/* ─── Default Settings ─── */

export const DEFAULT_SIMULATION_SETTINGS: SimulationSettings = {
  seed: 31,
  arrivalsPerHour: 9,
  durationHours: 24,
  speed: 90,
  totalPatients: undefined,
  staffProportions: DEFAULT_STAFF_PROPORTIONS,
  specialistConfigs: DEFAULT_SPECIALIST_CONFIGS,
  emergencyTeamRatio: DEFAULT_EMERGENCY_TEAM_RATIO,
  roomTimeMultipliers: DEFAULT_ROOM_TIME_MULTIPLIERS,
  disruptorTemplates: DEFAULT_DISRUPTOR_TEMPLATES,
  disruptorProbability: 0.03,
  disruptorEventsPerHour: 0.5,
  channelConfigs: DEFAULT_CHANNEL_CONFIGS,
}

/* ─── Main Simulation ─── */

export function runHospitalSimulation(
  plan: HospitalPlan,
  settings: SimulationSettings,
): SimulationResult {
  const rng = mulberry32(settings.seed)
  const durationMinutes = settings.durationHours * 60
  const agents: SimAgent[] = []
  const roomPressure: Record<string, number> = {}
  const channelOccupancyMap = new Map<string, number>()
  const channelGraph = new ChannelGraph(settings.channelConfigs, plan.rooms)
  const disruptorEvents: DisruptorEvent[] = []

  // Determine total patients
  const totalPatients = settings.totalPatients ?? Math.max(40, Math.round(settings.arrivalsPerHour * settings.durationHours))

  // Generate staff agents
  const staffAgents = generateStaff(plan, settings, channelGraph)
  agents.push(...staffAgents)

  // Generate inpatients (bed occupancy) and visitors
  let inpatientSeq = 0
  const wardRooms = plan.rooms.filter(r => r.simulationNode === 'ward')
  for (const ward of wardRooms) {
    const occupancyRate = 0.70 + rng() * 0.25 // 70-95% occupancy
    const inpatients = Math.round(ward.capacity * occupancyRate)
    for (let j = 0; j < inpatients; j += 1) {
      inpatientSeq += 1
      const stayEnd = Math.floor(6 * 60 + rng() * 12 * 60) // 6-18h stay
      agents.push({
        id: `in-${inpatientSeq}`,
        role: 'inpatient',
        assignedRoomId: ward.id,
        route: [
          { roomId: ward.id, at: 0 },
          { roomId: ward.id, at: stayEnd },
        ],
        color: '#7fc8a9',
      })
      roomPressure[ward.id] = (roomPressure[ward.id] ?? 0) + 1

      // Visitors for this inpatient (1-3 visits)
      const visitorCount = 1 + Math.floor(rng() * 3)
      for (let v = 0; v < visitorCount; v += 1) {
        const visitStart = Math.floor(rng() * stayEnd * 0.8)
        const visitDuration = 30 + Math.floor(rng() * 90)
        agents.push({
          id: `v-${inpatientSeq}-${v}`,
          role: 'visitor',
          assignedRoomId: ward.id,
          route: [
            { roomId: ward.id, at: visitStart },
            { roomId: ward.id, at: visitStart + visitDuration },
          ],
          color: '#88c7dd',
        })
      }
    }
  }

  // Generate patient agents
  let completed = 0
  let travelSum = 0
  let verticalMoves = 0
  let disruptorSeq = 0
  let patientSeq = 0

  for (let i = 0; i < totalPatients; i += 1) {
    const stream = weightedStream(rng())
    const severity = weightedSeverity(rng(), stream)
    const start = Math.floor((i / totalPatients) * durationMinutes + rng() * 18)
    const routeRooms = routeForPatient(plan.rooms, stream, severity, rng)
    if (routeRooms.length < 2) continue

    const route = buildTimedRoute(routeRooms, start, severity, rng, settings.roomTimeMultipliers)
    for (const room of routeRooms) {
      roomPressure[room.id] = (roomPressure[room.id] ?? 0) + 1
    }
    completed += 1
    travelSum += routeTravel(routeRooms)
    verticalMoves += countVerticalMoves(routeRooms)
    patientSeq += 1
    agents.push({
      id: `p-${patientSeq}`,
      role: 'patient',
      stream,
      severity,
      route,
      color: STREAM_COLORS[stream] ?? '#999',
    })

    // Check for disruptor events triggered by this patient
    if (rng() < settings.disruptorProbability) {
      const template = pickDisruptorTemplate(settings.disruptorTemplates, rng)
      if (template && routeRooms.length > 0) {
        const targetRoom = routeRooms[Math.floor(rng() * routeRooms.length)]
        disruptorSeq += 1
        const event: DisruptorEvent = {
          id: `de-${disruptorSeq}`,
          templateId: template.id,
          roomId: targetRoom.id,
          startTime: start + Math.floor(rng() * 30),
          state: 'created',
          assignedAgents: [],
        }
        disruptorEvents.push(event)
      }
    }
  }

  // Time-based disruptor events
  const timeEvents = Math.floor(settings.disruptorEventsPerHour * settings.durationHours)
  for (let i = 0; i < timeEvents; i += 1) {
    if (rng() > 0.3) continue // 30% chance per slot
    const template = pickDisruptorTemplate(settings.disruptorTemplates, rng)
    if (!template) continue
    const rooms = plan.rooms.filter((r) => r.kind !== 'vertical' && r.kind !== 'green' && r.kind !== 'future')
    if (rooms.length === 0) continue
    const targetRoom = rooms[Math.floor(rng() * rooms.length)]
    disruptorSeq += 1
    const event: DisruptorEvent = {
      id: `de-${disruptorSeq}`,
      templateId: template.id,
      roomId: targetRoom.id,
      startTime: Math.floor((i / timeEvents) * durationMinutes + rng() * 20),
      state: 'created',
      assignedAgents: [],
    }
    disruptorEvents.push(event)
  }

  // Process disruptor events (simplified resolution simulation)
  const disruptorMetrics = processDisruptorEvents(disruptorEvents, settings.disruptorTemplates, agents, plan.rooms, channelGraph, durationMinutes, rng)

  // Calculate channel occupancy from agent routes
  for (const agent of agents) {
    for (let j = 0; j < agent.route.length - 1; j += 1) {
      const fromRoom = plan.rooms.find((r) => r.id === agent.route[j].roomId)
      const toRoom = plan.rooms.find((r) => r.id === agent.route[j + 1].roomId)
      if (!fromRoom || !toRoom) continue
      const path = channelGraph.findStaticRoute(fromRoom.id, toRoom.id)
      if (path) {
        for (const chId of path.channelIds) {
          channelOccupancyMap.set(chId, (channelOccupancyMap.get(chId) ?? 0) + 1)
        }
      }
    }
  }

  const channelOccupancy: ChannelOccupancy[] = Array.from(channelOccupancyMap.entries()).map(
    ([channelId, activeMovements]) => ({ channelId, activeMovements }),
  )

  const congestionHotspots = channelOccupancy.filter(
    (co) => {
      const ch = channelGraph.getChannel(co.channelId)
      return ch && co.activeMovements / ch.maxConcurrent > 0.8
    },
  ).length

  const hottest = Object.entries(roomPressure)
    .map(([roomId, count]) => {
      const room = plan.rooms.find((item) => item.id === roomId)
      return { room, score: room ? count / Math.max(1, room.capacity) : 0 }
    })
    .sort((a, b) => b.score - a.score)[0]

  // Staff stats
  const staffByRole: Record<string, number> = {}
  const specialistsByType: Record<string, number> = {}
  for (const agent of agents) {
    if (agent.role === 'patient') continue
    staffByRole[agent.role] = (staffByRole[agent.role] ?? 0) + 1
    if (agent.specialistType) {
      specialistsByType[agent.specialistType] = (specialistsByType[agent.specialistType] ?? 0) + 1
    }
  }

  return {
    agents,
    durationMinutes,
    roomPressure,
    channelOccupancy,
    disruptorEvents,
    kpis: {
      completed,
      edP90Minutes: estimateEdP90(plan.rooms, roomPressure),
      averageTravelMinutes: completed ? Math.round((travelSum / completed) * 10) / 10 : 0,
      verticalMoves,
      hottestRoomName: hottest?.room?.name ?? '-',
      safetyWarnings: safetyWarnings(plan.rooms),
      totalStaff: agents.filter((a) => a.role !== 'patient').length,
      staffByRole,
      specialistsByType,
      disruptorEvents_total: disruptorMetrics.total,
      disruptorEvents_resolved: disruptorMetrics.resolved,
      disruptorEvents_escalated: disruptorMetrics.escalated,
      disruptorEvents_avgResolutionTime: disruptorMetrics.avgResolutionTime,
      disruptorEvents_maxResolutionTime: disruptorMetrics.maxResolutionTime,
      disruptorEvents_avgResponseTime: disruptorMetrics.avgResponseTime,
      disruptorEvents_propagationCount: disruptorMetrics.propagationCount,
      disruptorEvents_byType: disruptorMetrics.byType,
      disruptorEvents_roomsBlocked: disruptorMetrics.roomsBlocked,
      disruptorEvents_patientsAffected: disruptorMetrics.patientsAffected,
      disruptorEvents_escalationRate: disruptorMetrics.total > 0 ? disruptorMetrics.escalated / disruptorMetrics.total : 0,
      channelCongestionHotspots: congestionHotspots,
    },
  }
}

/* ─── Staff Generation ─── */

export function generateStaff(
  plan: HospitalPlan,
  settings: SimulationSettings,
  _channelGraph: ChannelGraph,
): SimAgent[] {
  const agents: SimAgent[] = []
  const resourceConfigs = DEFAULT_RESOURCE_CONFIGS
  const proportions = settings.staffProportions
  const specialistConfigs = settings.specialistConfigs
  const emergencyRatio = settings.emergencyTeamRatio

  // Calculate total staff needed
  let totalStaffRequired = 0
  for (const rc of resourceConfigs) {
    const room = plan.rooms.find((r) => r.simulationNode === rc.id || r.templateId === rc.id)
    if (room) {
      totalStaffRequired += Math.ceil(rc.staffRequired * Math.ceil(room.capacity / Math.max(1, rc.baseCapacity)))
    }
  }
  totalStaffRequired = Math.max(10, Math.ceil(totalStaffRequired))

  // Distribute by role
  const specialistCount = Math.round(totalStaffRequired * proportions.specialist)
  const nurseCount = Math.round(totalStaffRequired * proportions.nurse)
  const technicianCount = Math.round(totalStaffRequired * proportions.technician)
  const securityCount = Math.round(totalStaffRequired * proportions.security)

  // Normalize specialist proportions
  const totalSpecProp = specialistConfigs.reduce((s, c) => s + c.baseProportion, 0)
  const normalizedSpecs = specialistConfigs.map((c) => ({
    ...c,
    normalizedProportion: c.baseProportion / Math.max(0.001, totalSpecProp),
  }))

  // Assign specialists by type — they make rounds visiting patients
  let specIndex = 0
  for (const spec of normalizedSpecs) {
    const count = Math.max(1, Math.round(specialistCount * spec.normalizedProportion))
    for (let i = 0; i < count; i += 1) {
      specIndex += 1
      const assignedRoom = findRoomForSpecialist(plan.rooms, spec.type, resourceConfigs)
      const isEmergency = specIndex <= Math.max(1, Math.round(count / emergencyRatio))

      // Build a round route: base → visit patients → back to base
      const route: RouteStop[] = []
      if (assignedRoom) {
        route.push({ roomId: assignedRoom.id, at: 0 })
        // Find visitable rooms (patients this specialist should see)
        const visitableRooms = plan.rooms.filter(r => {
          if (r.id === assignedRoom.id) return false
          const rc = resourceConfigs.find(c => c.id === r.simulationNode)
          return rc && rc.requiredSpecialistTypes.includes(spec.type)
        })
        let t = 120 // rounds start at 2h
        const visits = visitableRooms.slice(0, 2 + Math.floor(Math.random() * 4))
        for (const vr of visits) {
          route.push({ roomId: vr.id, at: t })
          t += 15 + Math.floor(Math.random() * 25) // 15-40min per visit
        }
        route.push({ roomId: assignedRoom.id, at: t + 60 }) // back to base
      }

      agents.push({
        id: `spec-${spec.type}-${i + 1}`,
        role: 'specialist',
        specialistType: spec.type,
        isSurgical: spec.isSurgical,
        assignedRoomId: assignedRoom?.id,
        isInEmergencyTeam: isEmergency,
        isAvailable: true,
        route,
        color: SPECIALIST_COLORS[spec.type] ?? STAFF_COLORS.specialist,
      })
    }
  }

  // Nurses
  for (let i = 0; i < nurseCount; i += 1) {
    const room = pickStaffRoom(plan.rooms, i, nurseCount)
    agents.push({
      id: `nurse-${i + 1}`,
      role: 'nurse',
      assignedRoomId: room?.id,
      isInEmergencyTeam: i < Math.max(1, Math.round(nurseCount / emergencyRatio)),
      isAvailable: true,
      route: room ? [{ roomId: room.id, at: 0 }, { roomId: room.id, at: 1440 }] : [],
      color: STAFF_COLORS.nurse,
    })
  }

  // Technicians
  for (let i = 0; i < technicianCount; i += 1) {
    const room = pickStaffRoom(plan.rooms, i, technicianCount)
    agents.push({
      id: `tech-${i + 1}`,
      role: 'technician',
      assignedRoomId: room?.id,
      isInEmergencyTeam: i < Math.max(1, Math.round(technicianCount / emergencyRatio)),
      isAvailable: true,
      route: room ? [{ roomId: room.id, at: 0 }, { roomId: room.id, at: 1440 }] : [],
      color: STAFF_COLORS.technician,
    })
  }

  // Security
  for (let i = 0; i < securityCount; i += 1) {
    const securityRooms = plan.rooms.filter(
      (r) => r.kind === 'public' || r.kind === 'emergency' || r.simulationNode === 'pharmacy',
    )
    const room = securityRooms[i % Math.max(1, securityRooms.length)] ?? plan.rooms[0]
    agents.push({
      id: `sec-${i + 1}`,
      role: 'security',
      assignedRoomId: room.id,
      isInEmergencyTeam: false,
      isAvailable: true,
      route: [{ roomId: room.id, at: 0 }, { roomId: room.id, at: 1440 }],
      color: STAFF_COLORS.security,
    })
  }

  return agents
}

function findRoomForSpecialist(
  rooms: PlacedRoom[],
  specialistType: string,
  resourceConfigs: ResourceConfig[],
): PlacedRoom | undefined {
  const matchingConfig = resourceConfigs.find((rc) => rc.requiredSpecialistTypes.includes(specialistType))
  if (matchingConfig) {
    const room = rooms.find((r) => r.simulationNode === matchingConfig.id)
    if (room) return room
  }
  // Fallback: assign to any room with staffModel
  return rooms.find((r) => r.staffModel.length > 0 && r.kind !== 'public' && r.kind !== 'green')
}

function pickStaffRoom(rooms: PlacedRoom[], index: number, _total: number): PlacedRoom | undefined {
  const candidates = rooms.filter((r) => r.staffModel.length > 0 && r.kind !== 'public' && r.kind !== 'green' && r.kind !== 'future')
  if (candidates.length === 0) return undefined
  return candidates[index % candidates.length]
}

/* ─── Patient Routing ─── */

function routeForPatient(
  rooms: PlacedRoom[],
  stream: PatientStream,
  severity: Severity,
  rng: () => number,
): PlacedRoom[] {
  const nodes: SimulationNode[] = []

  if (stream === 'ed_ambulance') nodes.push('arrival_ambulance')
  if (stream === 'ed_walkin') nodes.push('registration')
  if (stream === 'outpatient') nodes.push('registration', 'consult')
  if (stream === 'elective') nodes.push('registration', 'or', 'pacu')
  if (stream === 'maternity') nodes.push('registration', 'maternity')
  if (stream === 'oncology') nodes.push('registration', 'consult', 'oncologyDay')
  if (stream === 'mental_health') nodes.push('registration', 'mentalHealthEd')

  // ED pathways
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

  // Outpatient pathways
  if (stream === 'outpatient') {
    if (severity === 'high' || rng() < 0.42) nodes.push('lab')
    if (severity === 'high' || rng() < 0.28) nodes.push('imaging')
    if (severity === 'high' && rng() < 0.16) nodes.push('ward')
    else nodes.push('pharmacy')
  }

  // Elective pathways
  if (stream === 'elective') {
    if (rng() < 0.3) nodes.push('lab')
    if (rng() < 0.2) nodes.push('imaging')
    if (severity === 'critical' || rng() < 0.18) nodes.push('icu')
    else nodes.push('ward')
  }

  // Maternity pathway
  if (stream === 'maternity') {
    if (severity === 'critical' || rng() < 0.3) nodes.push('neonatal_icu')
    nodes.push('ward')
  }

  // Oncology pathway
  if (stream === 'oncology') {
    nodes.push('lab')
    if (rng() < 0.5) nodes.push('imaging')
    nodes.push('pharmacy')
  }

  // Mental health pathway
  if (stream === 'mental_health') {
    nodes.push('observation')
    nodes.push('pharmacy')
  }

  // Redirect some ward-bound patients to upper floors (5-7) for more realism
  if (nodes.includes('ward')) {
    const wardFloors = [...new Set(rooms.filter(r => r.simulationNode === 'ward').map(r => r.floor))].sort()
    const upperFloors = wardFloors.filter(f => f >= 5)
    if (upperFloors.length > 0 && rng() < 0.35) {
      // 35% of admitted patients go to upper floors
      const wardIdx = nodes.lastIndexOf('ward')
      // Add vertical_core before ward to represent the elevator trip
      nodes.splice(wardIdx, 0, 'vertical_core')
    }
  }

  nodes.push('discharge')
  return nodes.map((node) => roomByNode(rooms, node)).filter(Boolean) as PlacedRoom[]
}

function buildTimedRoute(
  routeRooms: PlacedRoom[],
  start: number,
  severity: Severity,
  rng: () => number,
  roomTimeMultipliers: Partial<Record<string, number>>,
): RouteStop[] {
  const stops: RouteStop[] = []
  let at = start
  routeRooms.forEach((room, index) => {
    if (index > 0) {
      const previous = routeRooms[index - 1]
      at += 3 + distance(previous, room) * 0.16
    }
    stops.push({ roomId: room.id, at: Math.round(at) })
    const multiplier = roomTimeMultipliers[room.kind] ?? 1.0
    at += dwellMinutes(room, severity, rng) * multiplier
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

/* ─── Disruptor Processing ─── */

interface DisruptorMetricsResult {
  total: number
  resolved: number
  escalated: number
  avgResolutionTime: number
  maxResolutionTime: number
  avgResponseTime: number
  propagationCount: number
  byType: Record<string, { total: number; resolved: number; escalated: number; avgResolutionTime: number }>
  roomsBlocked: number
  patientsAffected: number
}

function processDisruptorEvents(
  events: DisruptorEvent[],
  templates: DisruptorTemplate[],
  agents: SimAgent[],
  rooms: PlacedRoom[],
  _channelGraph: ChannelGraph,
  _durationMinutes: number,
  rng: () => number,
): DisruptorMetricsResult {
  const byType: Record<string, { total: number; resolved: number; escalated: number; avgResolutionTime: number }> = {}
  let resolved = 0
  let escalated = 0
  let totalResolutionTime = 0
  let maxResolutionTime = 0
  let totalResponseTime = 0
  let propagationCount = 0
  const blockedRooms = new Set<string>()

  for (const event of events) {
    const template = templates.find((t) => t.id === event.templateId)
    if (!template) continue

    // Initialize metrics for this type
    if (!byType[template.id]) {
      byType[template.id] = { total: 0, resolved: 0, escalated: 0, avgResolutionTime: 0 }
    }
    byType[template.id].total += 1

    // Find nearest available staff
    const responseTime = simulateStaffResponse(event, agents, rooms, _channelGraph, template, rng)
    totalResponseTime += responseTime

    // Check if escalation happens before or during resolution
    const totalEventTime = responseTime + template.resolutionTime
    if (totalEventTime > template.escalationTime || rng() < 0.15) {
      // Escalated
      escalated += 1
      byType[template.id].escalated += 1
      event.state = 'escalated'
      event.escalatedAt = event.startTime + template.escalationTime

      if (template.canPropagate && template.propagationRadius > 0) {
        propagationCount += 1
        // Propagate to nearby rooms
        const sourceRoom = rooms.find((r) => r.id === event.roomId)
        if (sourceRoom) {
          const nearby = rooms.filter(
            (r) => r.floor === sourceRoom.floor && distance(r, sourceRoom) < template.propagationRadius * 15,
          )
          for (const nr of nearby) {
            blockedRooms.add(nr.id)
          }
        }
      }
    } else {
      // Resolved
      resolved += 1
      byType[template.id].resolved += 1
      event.state = 'resolved'
      event.resolutionStartTime = event.startTime + responseTime
      event.resolutionEndTime = event.resolutionStartTime + template.resolutionTime
      event.responseTime = responseTime
      totalResolutionTime += template.resolutionTime
      maxResolutionTime = Math.max(maxResolutionTime, template.resolutionTime)
      byType[template.id].avgResolutionTime = template.resolutionTime
    }

    if (template.blocksRoom) {
      blockedRooms.add(event.roomId)
    }
  }

  // Calculate patients affected (simplified: count patients that pass through blocked rooms)
  const totalPatientsAffected = blockedRooms.size * 3

  return {
    total: events.length,
    resolved,
    escalated,
    avgResolutionTime: resolved > 0 ? totalResolutionTime / resolved : 0,
    maxResolutionTime,
    avgResponseTime: events.length > 0 ? totalResponseTime / events.length : 0,
    propagationCount,
    byType,
    roomsBlocked: blockedRooms.size,
    patientsAffected: totalPatientsAffected,
  }
}

function simulateStaffResponse(
  event: DisruptorEvent,
  agents: SimAgent[],
  rooms: PlacedRoom[],
  _channelGraph: ChannelGraph,
  template: DisruptorTemplate,
  rng: () => number,
): number {
  // Find closest available agent matching required roles
  const eventRoom = rooms.find((r) => r.id === event.roomId)
  if (!eventRoom) return 5 + rng() * 10

  let bestDistance = Infinity
  for (const agent of agents) {
    if (agent.role === 'patient' || agent.role === 'inpatient' || agent.role === 'visitor') continue
    if (template.requiresSecurity && agent.role !== 'security') continue
    if (template.requiresEmergencyTeam && !agent.isInEmergencyTeam) continue
    if (template.requiredRoles.length > 0 && !template.requiredRoles.includes(agent.role as StaffRole)) continue

    const agentRoom = rooms.find((r) => r.id === agent.assignedRoomId)
    if (!agentRoom) continue

    const dist = distance(agentRoom, eventRoom)
    if (dist < bestDistance) {
      bestDistance = dist
    }
  }

  if (bestDistance === Infinity) {
    // No matching agent found, use default
    return 8 + rng() * 12
  }

  // Response time = distance * 0.16 min per unit + base
  const responseTime = 2 + bestDistance * 0.16 + rng() * 3
  event.assignedAgents = ['auto-assigned']
  event.state = 'active'
  return Math.round(responseTime)
}

function pickDisruptorTemplate(
  templates: DisruptorTemplate[],
  rng: () => number,
): DisruptorTemplate | undefined {
  const totalProb = templates.reduce((s, t) => s + t.probability, 0)
  if (totalProb <= 0) return undefined
  let roll = rng() * totalProb
  for (const template of templates) {
    roll -= template.probability
    if (roll <= 0) return template
  }
  return templates[templates.length - 1]
}

/* ─── Position / Rendering helpers ─── */

export function positionAt(
  agent: SimAgent,
  rooms: PlacedRoom[],
  minute: number,
): { room: PlacedRoom; x: number; y: number; moving: boolean } | null {
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

/* ─── Utility functions ─── */

function weightedStream(value: number): PatientStream {
  if (value < 0.30) return 'ed_walkin'
  if (value < 0.44) return 'ed_ambulance'
  if (value < 0.60) return 'outpatient'
  if (value < 0.72) return 'elective'
  if (value < 0.82) return 'maternity'
  if (value < 0.92) return 'oncology'
  return 'mental_health'
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
