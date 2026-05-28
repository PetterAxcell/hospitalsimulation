export type RoomKind =
  | 'public'
  | 'waiting'
  | 'emergency'
  | 'diagnostic'
  | 'surgery'
  | 'critical'
  | 'inpatient'
  | 'ambulatory'
  | 'maternalChild'
  | 'oncology'
  | 'pharmacy'
  | 'laboratory'
  | 'logistics'
  | 'research'
  | 'staff'
  | 'technical'
  | 'vertical'
  | 'green'
  | 'future'

export type SimulationNode =
  | 'arrival_public'
  | 'arrival_ambulance'
  | 'triage'
  | 'registration'
  | 'ed_bay'
  | 'resus'
  | 'observation'
  | 'consult'
  | 'imaging'
  | 'lab'
  | 'or'
  | 'hybrid_or'
  | 'pacu'
  | 'icu'
  | 'ward'
  | 'maternity'
  | 'neonatal_icu'
  | 'pharmacy'
  | 'discharge'
  | 'logistics'
  | 'research'
  | 'vertical_core'
  | 'emergency_stair'
  | 'refuge_area'
  | 'fire_sector'
  | 'exit'
  | 'oncologyDay'
  | 'mentalHealthEd'

export type EquipmentKind =
  | 'bed'
  | 'stretcher'
  | 'chair'
  | 'desk'
  | 'monitor'
  | 'sink'
  | 'cleanStorage'
  | 'dirtyUtility'
  | 'shelves'
  | 'labBench'
  | 'imagingGantry'
  | 'orTable'
  | 'sterileTable'
  | 'nurseStation'
  | 'medicationStation'
  | 'elevator'
  | 'stairs'
  | 'emergencyStairs'
  | 'fireDoor'
  | 'smokeControl'
  | 'refugeArea'
  | 'sprinkler'
  | 'generator'
  | 'ambulance'
  | 'garden'

export interface RoomTemplate {
  id: string
  name: string
  shortName: string
  kind: RoomKind
  defaultAreaSqm: number
  defaultCapacity: number
  equipment: EquipmentKind[]
  staffModel: string[]
  simulationNode?: SimulationNode
  adjacencyTargets: string[]
  notes: string
}

export interface PlacedRoom {
  id: string
  templateId: string
  name: string
  kind: RoomKind
  floor: number
  x: number
  y: number
  w: number
  h: number
  capacity: number
  areaSqm: number
  equipment: EquipmentKind[]
  staffModel: string[]
  simulationNode?: SimulationNode
  locked?: boolean
}

export interface HospitalPlan {
  id: string
  name: string
  targetAreaSqm: number
  siteAreaSqm: number
  floors: number[]
  rooms: PlacedRoom[]
}

/* ─── Staff & Specialists ─── */

export type SpecialistType =
  | 'cardiology'
  | 'neurology'
  | 'traumatology'
  | 'psychiatry'
  | 'pediatrics'
  | 'obstetrics'
  | 'intensive_care'
  | 'anesthesiology'
  | 'general_surgery'
  | 'internal_medicine'
  | 'emergency_medicine'
  | 'oncology'
  | 'neonatology'
  | 'infectious_disease'
  | 'nephrology'
  | 'neurosurgery'
  | 'pneumology'
  | 'dermatology'
  | 'ophthalmology'
  | 'otorhinolaryngology'

export interface SpecialistConfig {
  type: string
  isSurgical: boolean
  baseProportion: number
}

export type StaffRole = 'specialist' | 'nurse' | 'technician' | 'security' | 'emergency_team'

export interface StaffProportions {
  specialist: number
  nurse: number
  technician: number
  security: number
  emergency_team: number
}

export interface ResourceConfig {
  id: string
  name: string
  baseCapacity: number
  staffRequired: number
  requiredSpecialistTypes: string[]
  floor: number
  roomKind: RoomKind
  timeMultiplier: number
}

/* ─── Channels ─── */

export interface ChannelConfig {
  id: string
  fromRoomId: string
  toRoomId: string
  baseTravelTime: number
  congestionSlope: number
  maxConcurrent: number
  isBidirectional: boolean
  isVisible: boolean
}

export interface ChannelOccupancy {
  channelId: string
  activeMovements: number
}

/* ─── Disruptors ─── */

export type DisruptorSeverity = 'low' | 'medium' | 'high' | 'critical'
export type DisruptorState = 'created' | 'active' | 'in_progress' | 'resolved' | 'escalated'

export interface DisruptorTemplate {
  id: string
  name: string
  description: string
  icon: string
  severity: DisruptorSeverity
  probability: number
  requiredRoles: StaffRole[]
  requiredSpecialties: string[]
  requiresSecurity: boolean
  requiresEmergencyTeam: boolean
  resolutionTime: number
  escalationTime: number
  canPropagate: boolean
  propagationRadius: number
  blocksRoom: boolean
  effects: string[]
}

export interface DisruptorEvent {
  id: string
  templateId: string
  roomId: string
  startTime: number
  state: DisruptorState
  assignedAgents: string[]
  resolutionStartTime?: number
  resolutionEndTime?: number
  escalatedAt?: number
  responseTime?: number
}

export interface EventResolutionMetrics {
  disruptorType: string
  total: number
  resolved: number
  escalated: number
  avgResolutionTime: number
  maxResolutionTime: number
  avgResponseTime: number
  propagationEvents: number
  roomsBlocked: number
  patientsAffected: number
}

/* ─── Agents ─── */

export type AgentRole = 'patient' | 'inpatient' | 'visitor' | 'specialist' | 'nurse' | 'technician' | 'security' | 'emergency_team'
export type PatientStream = 'ed_ambulance' | 'ed_walkin' | 'outpatient' | 'elective' | 'maternity' | 'oncology' | 'mental_health'
export type Severity = 'low' | 'medium' | 'high' | 'critical'

export interface RouteStop {
  roomId: string
  at: number
}

export interface SimAgent {
  id: string
  role: AgentRole
  stream?: PatientStream
  severity?: Severity
  route: RouteStop[]
  color: string
  specialistType?: string
  isSurgical?: boolean
  assignedRoomId?: string
  isInEmergencyTeam?: boolean
  isAvailable?: boolean
}

/* ─── Simulation ─── */

export interface SimulationSettings {
  seed: number
  arrivalsPerHour: number
  durationHours: number
  speed: number
  totalPatients?: number
  staffProportions: StaffProportions
  specialistConfigs: SpecialistConfig[]
  emergencyTeamRatio: number
  roomTimeMultipliers: Partial<Record<RoomKind, number>>
  disruptorTemplates: DisruptorTemplate[]
  disruptorProbability: number
  disruptorEventsPerHour: number
  channelConfigs: ChannelConfig[]
}

export interface SimulationResult {
  agents: SimAgent[]
  durationMinutes: number
  roomPressure: Record<string, number>
  channelOccupancy: ChannelOccupancy[]
  disruptorEvents: DisruptorEvent[]
  kpis: {
    completed: number
    edP90Minutes: number
    averageTravelMinutes: number
    verticalMoves: number
    hottestRoomName: string
    safetyWarnings: number
    /* Staff & Specialists */
    totalStaff: number
    staffByRole: Partial<Record<StaffRole, number>>
    specialistsByType: Record<string, number>
    /* Disruptors */
    disruptorEvents_total: number
    disruptorEvents_resolved: number
    disruptorEvents_escalated: number
    disruptorEvents_avgResolutionTime: number
    disruptorEvents_maxResolutionTime: number
    disruptorEvents_avgResponseTime: number
    disruptorEvents_propagationCount: number
    disruptorEvents_byType: Record<string, { total: number; resolved: number; escalated: number; avgResolutionTime: number }>
    disruptorEvents_roomsBlocked: number
    disruptorEvents_patientsAffected: number
    disruptorEvents_escalationRate: number
    /* Channels */
    channelCongestionHotspots: number
  }
}
