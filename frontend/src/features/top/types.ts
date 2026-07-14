import type { HospitalPlan } from '../../types'
import type { SimulationSettings } from '../../engine/simulation'
import type { AdjacencyRule } from '../../engine/adjacencyMatrix'

export type ProposalOwner = string

export interface ArchitectureScore {
  value: number
  blockedPenalty: number
  waitPenalty: number
  travelPenalty: number
  verticalPenalty: number
  rulePenalty: number
  areaPenalty: number
  adjacencyPenalty: number
}

export interface ArchitectureProposal {
  id: string
  owner: ProposalOwner
  title: string
  score: ArchitectureScore
  completed: number
  blocked: number
  edP90: number
  averageTravel: number
  verticalMoves: number
  staffOnShift: number
  staffInMotion: number
  activeCases: number
  staffRoles: number
  safetyWarnings: number
  ruleIssues: number
  modeledArea: number
  roomCount: number
  hottestRoomName: string
  createdAt: string
  source: 'demo' | 'submitted'
  scenario?: ProposalScenario
  snapshot?: ProposalSnapshot
}

export interface ProposalScenario {
  arrivalsPerHour: number
  horizonYears: number
  durationHours: number
  adjacencyTotal: number
  adjacencyComplies: number
}

export interface ProposalSnapshot {
  plan: HospitalPlan
  settings: SimulationSettings
  adjacencyRules: AdjacencyRule[]
}
