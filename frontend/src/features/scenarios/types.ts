import type { AdjacencyRule } from '../../engine/adjacencyMatrix'
import type { SimulationSettings } from '../../engine/simulation'
import type { HospitalPlan } from '../../types'
import type { ArchitectureScore } from '../top/types'

/**
 * Un escenario congela todo lo que hace comparable una simulacion: el plano,
 * los parametros de demanda, la mezcla clinica (YAML de casos) y las reglas de
 * adyacencia. Asi se puede volver a lanzar y rankear sin depender del estado
 * actual del editor.
 */
export interface Scenario {
  id: string
  name: string
  owner: string
  notes: string
  createdAt: string
  updatedAt: string
  plan: HospitalPlan
  settings: SimulationSettings
  /** YAML de casos clinicos usado en este escenario. */
  caseSource: string
  adjacencyRules: AdjacencyRule[]
  /** Procedencia de la mezcla clinica (por ejemplo `MIMIC-IV-ED 2.2`). */
  caseMixSource?: string
}

/** Resultado de lanzar un escenario. Se guarda para no recalcular en cada render. */
export interface ScenarioRun {
  scenarioId: string
  /** Huella de las entradas: si cambia, el resultado esta obsoleto. */
  signature: string
  ranAt: string
  durationMs: number
  score: ArchitectureScore
  completed: number
  blocked: number
  edP90: number
  averageTravel: number
  verticalMoves: number
  staffOnShift: number
  staffInMotion: number
  safetyWarnings: number
  activeCases: number
  staffRoles: number
  ruleIssues: number
  adjacencyIssues: number
  adjacencyTotal: number
  casesApplied: number
  modeledArea: number
  roomCount: number
  hottestRoomName: string
}

export interface ScenarioLibrary {
  scenarios: Scenario[]
  runs: Record<string, ScenarioRun>
}

export const EMPTY_SCENARIO_LIBRARY: ScenarioLibrary = { scenarios: [], runs: {} }
