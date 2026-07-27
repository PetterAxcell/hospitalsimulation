import { adjacencyComplies, evaluateAdjacencyRules, type AdjacencyRule } from '../../engine/adjacencyMatrix'
import { evaluateArchitectureRules } from '../../engine/architectureRules'
import { compileClinicalCases } from '../../engine/clinicalCases'
import { runHospitalSimulation, type SimulationSettings } from '../../engine/simulation'
import type { HospitalPlan } from '../../types'
import { scoreArchitecture } from '../top/scoring'
import type { ArchitectureProposal } from '../top/types'
import type { Scenario, ScenarioRun } from './types'

interface ScenarioInput {
  name: string
  owner: string
  notes?: string
  plan: HospitalPlan
  settings: SimulationSettings
  caseSource: string
  adjacencyRules: AdjacencyRule[]
  caseMixSource?: string
}

export function createScenario(input: ScenarioInput): Scenario {
  const now = new Date().toISOString()
  return {
    id: `scn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: input.name.trim() || 'Escenario sin nombre',
    owner: input.owner.trim() || 'Sin autor',
    notes: input.notes?.trim() ?? '',
    createdAt: now,
    updatedAt: now,
    // Copia profunda: el escenario no debe mutar cuando se sigue editando el plano.
    plan: structuredClone(input.plan),
    settings: { ...input.settings },
    caseSource: input.caseSource,
    adjacencyRules: structuredClone(input.adjacencyRules),
    caseMixSource: input.caseMixSource,
  }
}

export function duplicateScenario(scenario: Scenario, name?: string): Scenario {
  const now = new Date().toISOString()
  return {
    ...structuredClone(scenario),
    id: `scn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: name?.trim() || `${scenario.name} copia`,
    createdAt: now,
    updatedAt: now,
  }
}

interface ScenarioSnapshotInput {
  plan: HospitalPlan
  settings: SimulationSettings
  caseSource: string
  adjacencyRules: AdjacencyRule[]
  caseMixSource?: string
}

/**
 * Vuelca las entradas vivas del editor sobre un escenario ya guardado. Se usa
 * para mantener el escenario activo sincronizado con el planificador: al editar
 * el plano, la demanda, la mezcla clinica o las adyacencias, su firma cambia y
 * el resultado guardado queda obsoleto hasta que se vuelve a lanzar.
 */
export function updateScenarioSnapshot(scenario: Scenario, input: ScenarioSnapshotInput): Scenario {
  return {
    ...scenario,
    updatedAt: new Date().toISOString(),
    // Copia profunda: el escenario no comparte referencias con el editor vivo.
    plan: structuredClone(input.plan),
    settings: { ...input.settings },
    caseSource: input.caseSource,
    adjacencyRules: structuredClone(input.adjacencyRules),
    caseMixSource: input.caseMixSource,
  }
}

/**
 * Huella de las entradas del escenario. Solo entra lo que cambia el resultado:
 * la velocidad de reproduccion, por ejemplo, es visual y se ignora.
 */
export function scenarioSignature(scenario: Scenario): string {
  // Un escenario heredado o corrupto puede llegar sin plano, salas o adyacencias:
  // se normaliza a vacio para no lanzar durante el render.
  const rooms = scenario.plan?.rooms ?? []
  const geometry = rooms
    .map((room) => [
      room.id,
      room.kind,
      room.simulationNode ?? '-',
      room.floor,
      room.x,
      room.y,
      room.w,
      room.h,
      room.capacity,
      Math.round(room.areaSqm),
      (room.doors ?? []).map((door) => `${door.side}${Math.round(door.offset * 100)}`).join('+'),
      (room.servesFloors ?? []).join('+'),
    ].join(':'))
    .sort()
    .join('|')
  const settings = [
    scenario.settings.seed,
    scenario.settings.arrivalsPerHour,
    scenario.settings.durationHours,
    scenario.settings.horizonYears,
  ].join(':')
  const adjacency = (scenario.adjacencyRules ?? [])
    .map((rule) => `${rule.aKind}-${rule.bKind}-${rule.desire}-${rule.warn}-${rule.fail}`)
    .sort()
    .join('|')
  return `${hashString(geometry)}.${hashString(settings)}.${hashString(scenario.caseSource ?? '')}.${hashString(adjacency)}.${scenario.plan?.targetAreaSqm}`
}

export function isRunStale(scenario: Scenario, run: ScenarioRun | undefined): boolean {
  if (!run) return true
  return run.signature !== scenarioSignature(scenario)
}

/** Lanza la simulacion de un escenario y devuelve sus KPIs y su score. */
export function runScenario(scenario: Scenario): ScenarioRun {
  const startedAt = performance.now()
  const compiled = compileClinicalCases(scenario.caseSource)
  const result = runHospitalSimulation(scenario.plan, scenario.settings, compiled.cases)
  const architectureRules = evaluateArchitectureRules(scenario.plan)
  const adjacencyResults = evaluateAdjacencyRules(scenario.plan, scenario.adjacencyRules)
  const adjacency = {
    total: adjacencyResults.length,
    noComplies: adjacencyResults.filter((rule) => !adjacencyComplies(rule.status)).length,
  }
  const modeledArea = scenario.plan.rooms.reduce((sum, room) => sum + room.areaSqm, 0)

  return {
    scenarioId: scenario.id,
    signature: scenarioSignature(scenario),
    ranAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt),
    score: scoreArchitecture(scenario.plan, result, architectureRules, modeledArea, adjacency),
    completed: result.kpis.completed,
    blocked: result.kpis.blockedPatients,
    edP90: result.kpis.edP90Minutes,
    averageTravel: result.kpis.averageTravelMinutes,
    verticalMoves: result.kpis.verticalMoves,
    staffOnShift: result.kpis.staffOnShift,
    staffInMotion: result.kpis.staffInMotion,
    safetyWarnings: result.kpis.safetyWarnings,
    activeCases: result.caseStats.filter((stat) => stat.attempted > 0).length,
    staffRoles: result.staffStats.filter((stat) => stat.count > 0).length,
    ruleIssues: architectureRules.filter((rule) => rule.status !== 'ok').length,
    adjacencyIssues: adjacency.noComplies,
    adjacencyTotal: adjacency.total,
    casesApplied: compiled.appliedCases > 0 ? compiled.appliedCases : compiled.cases.length,
    modeledArea,
    roomCount: scenario.plan.rooms.length,
    hottestRoomName: result.kpis.hottestRoomName,
  }
}

/** Adapta un escenario ejecutado al formato del ranking del Top. */
export function proposalFromScenario(scenario: Scenario, run: ScenarioRun): ArchitectureProposal {
  return {
    id: `scenario-${scenario.id}`,
    owner: scenario.owner,
    title: scenario.name,
    createdAt: `escenario · ${formatTimestamp(run.ranAt)}`,
    source: 'scenario',
    score: run.score,
    completed: run.completed,
    blocked: run.blocked,
    edP90: run.edP90,
    averageTravel: run.averageTravel,
    verticalMoves: run.verticalMoves,
    staffOnShift: run.staffOnShift,
    staffInMotion: run.staffInMotion,
    activeCases: run.activeCases,
    staffRoles: run.staffRoles,
    safetyWarnings: run.safetyWarnings,
    ruleIssues: run.ruleIssues + run.adjacencyIssues,
    modeledArea: run.modeledArea,
    roomCount: run.roomCount,
    hottestRoomName: run.hottestRoomName,
    scenario: {
      arrivalsPerHour: scenario.settings.arrivalsPerHour,
      horizonYears: scenario.settings.horizonYears,
      durationHours: scenario.settings.durationHours,
      adjacencyTotal: run.adjacencyTotal,
      adjacencyComplies: Math.max(0, run.adjacencyTotal - run.adjacencyIssues),
    },
    // El snapshot permite restaurar desde el Top igual que una arquitectura sembrada.
    snapshot: {
      plan: scenario.plan,
      settings: scenario.settings,
      adjacencyRules: scenario.adjacencyRules,
    },
  }
}

export function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

export interface RankedScenario {
  scenario: Scenario
  run?: ScenarioRun
}

/** Ordena por score descendente; los escenarios sin lanzar quedan al final. */
export function rankScenarios(scenarios: Scenario[], runs: Record<string, ScenarioRun>): RankedScenario[] {
  return scenarios
    .map((scenario) => ({ scenario, run: runs[scenario.id] }))
    .sort((a, b) => {
      // Un run corrupto sin score se trata como no lanzado para no romper el orden.
      const aValue = a.run?.score?.value
      const bValue = b.run?.score?.value
      if (aValue !== undefined && bValue !== undefined) return bValue - aValue || a.run!.blocked - b.run!.blocked
      if (aValue !== undefined) return -1
      if (bValue !== undefined) return 1
      return a.scenario.name.localeCompare(b.scenario.name)
    })
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
