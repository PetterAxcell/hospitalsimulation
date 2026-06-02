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
  | 'circulation'
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
  doors?: RoomDoor[]
  connectionIds?: string[]
  verticalGroupId?: string
  servesFloors?: number[]
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

export type AgentRole = 'patient' | 'doctor' | 'nurse' | 'porter' | 'technician'
export type PatientStream = 'ed_ambulance' | 'ed_walkin' | 'outpatient' | 'elective'
export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type PatientCaseId =
  | 'trauma_major'
  | 'stroke_code'
  | 'chest_pain'
  | 'minor_ed'
  | 'ed_observation'
  | 'outpatient_consult'
  | 'scheduled_surgery'
export type PatientCaseFilter = PatientCaseId | 'all'

export type DoorSide = 'top' | 'right' | 'bottom' | 'left'

export interface RoomDoor {
  id: string
  side: DoorSide
  offset: number
}

export interface RouteStop {
  roomId: string
  at: number
  phase?: string
}

export interface SimAgent {
  id: string
  role: AgentRole
  stream?: PatientStream
  severity?: Severity
  caseId?: PatientCaseId
  caseName?: string
  caseCode?: string
  route: RouteStop[]
  color: string
}

export interface PatientCaseStat {
  id: PatientCaseId
  label: string
  color: string
  attempted: number
  completed: number
  blocked: number
  samplePath: string[]
}

export interface SimulationResult {
  agents: SimAgent[]
  durationMinutes: number
  roomPressure: Record<string, number>
  caseStats: PatientCaseStat[]
  kpis: {
    completed: number
    edP90Minutes: number
    averageTravelMinutes: number
    verticalMoves: number
    blockedPatients: number
    hottestRoomName: string
    safetyWarnings: number
  }
}
