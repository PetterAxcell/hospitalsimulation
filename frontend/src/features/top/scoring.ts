import type { ArchitectureRuleResult } from '../../engine/architectureRules'
import type { HospitalPlan, SimulationResult } from '../../types'
import type { ArchitectureProposal, ArchitectureScore, ProposalOwner } from './types'

type ArchitectureMetrics = ReturnType<typeof metricsFromSimulation>

export function demoArchitectureProposals(
  plan: HospitalPlan,
  result: SimulationResult | null,
  rules: ArchitectureRuleResult[],
  totalArea: number,
): ArchitectureProposal[] {
  const baseMetrics = metricsFromSimulation(result)
  const variants: Array<{
    owner: ProposalOwner
    title: string
    createdAt: string
    metrics: ArchitectureMetrics
  }> = [
    {
      owner: 'Equipo A',
      title: 'Urgencias compactas y diagnostico cercano',
      createdAt: 'propuesta demo',
      metrics: adjustArchitectureMetrics(baseMetrics, {
        blockedFactor: 0.9,
        edP90Factor: 0.86,
        travelFactor: 0.92,
        verticalFactor: 0.94,
      }),
    },
    {
      owner: 'Equipo B',
      title: 'Hospitalizacion modular y altas tempranas',
      createdAt: 'propuesta demo',
      metrics: adjustArchitectureMetrics(baseMetrics, {
        blockedFactor: 0.82,
        edP90Factor: 0.92,
        travelFactor: 0.88,
        verticalFactor: 0.96,
      }),
    },
    {
      owner: 'Plano actual',
      title: 'Plano actual colaborativo',
      createdAt: 'simulacion actual',
      metrics: baseMetrics,
    },
  ]

  return variants.map((variant) => architectureProposalFromMetrics({
    id: `demo-${variant.owner}`,
    owner: variant.owner,
    title: variant.title,
    createdAt: variant.createdAt,
    source: 'demo',
    plan,
    rules,
    totalArea,
    metrics: variant.metrics,
  }))
}

export function architectureProposalFromCurrentPlan({
  owner,
  plan,
  result,
  rules,
  totalArea,
  index,
}: {
  owner: ProposalOwner
  plan: HospitalPlan
  result: SimulationResult | null
  rules: ArchitectureRuleResult[]
  totalArea: number
  index: number
}): ArchitectureProposal {
  const now = new Date()
  return architectureProposalFromMetrics({
    id: `submitted-${now.getTime()}`,
    owner,
    title: `Arquitectura ${index}`,
    createdAt: new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(now),
    source: 'submitted',
    plan,
    rules,
    totalArea,
    metrics: metricsFromSimulation(result),
  })
}

function architectureProposalFromMetrics({
  id,
  owner,
  title,
  createdAt,
  source,
  plan,
  rules,
  totalArea,
  metrics,
}: {
  id: string
  owner: ProposalOwner
  title: string
  createdAt: string
  source: ArchitectureProposal['source']
  plan: HospitalPlan
  rules: ArchitectureRuleResult[]
  totalArea: number
  metrics: ArchitectureMetrics
}): ArchitectureProposal {
  return {
    id,
    owner,
    title,
    createdAt,
    source,
    score: scoreArchitecture(plan, metrics, rules, totalArea),
    completed: metrics.completed,
    blocked: metrics.blocked,
    edP90: metrics.edP90,
    averageTravel: metrics.averageTravel,
    verticalMoves: metrics.verticalMoves,
    ruleIssues: rules.filter((rule) => rule.status !== 'ok').length,
    modeledArea: totalArea,
    roomCount: plan.rooms.length,
    hottestRoomName: metrics.hottestRoomName,
  }
}

function metricsFromSimulation(result: SimulationResult | null) {
  return {
    completed: result?.kpis.completed ?? 0,
    blocked: result?.kpis.blockedPatients ?? 0,
    edP90: result?.kpis.edP90Minutes ?? 0,
    averageTravel: result?.kpis.averageTravelMinutes ?? 0,
    verticalMoves: result?.kpis.verticalMoves ?? 0,
    hottestRoomName: result?.kpis.hottestRoomName ?? '-',
  }
}

function adjustArchitectureMetrics(
  metrics: ArchitectureMetrics,
  factors: { blockedFactor: number; edP90Factor: number; travelFactor: number; verticalFactor: number },
): ArchitectureMetrics {
  return {
    ...metrics,
    blocked: Math.max(0, Math.round(metrics.blocked * factors.blockedFactor)),
    edP90: Math.max(0, Math.round(metrics.edP90 * factors.edP90Factor)),
    averageTravel: Math.max(0, Math.round(metrics.averageTravel * factors.travelFactor * 10) / 10),
    verticalMoves: Math.max(0, Math.round(metrics.verticalMoves * factors.verticalFactor)),
  }
}

export function scoreArchitecture(
  plan: HospitalPlan,
  resultOrMetrics: SimulationResult | ArchitectureMetrics | null,
  rules: ArchitectureRuleResult[],
  totalArea: number,
): ArchitectureScore {
  const metrics = isSimulationResult(resultOrMetrics) ? metricsFromSimulation(resultOrMetrics) : (resultOrMetrics ?? metricsFromSimulation(null))
  const failCount = rules.filter((rule) => rule.status === 'fail').length
  const warnCount = rules.filter((rule) => rule.status === 'warn').length
  const areaDrift = Math.abs(totalArea - plan.targetAreaSqm) / Math.max(1, plan.targetAreaSqm)
  const blockedPenalty = metrics.blocked * 2.4
  const waitPenalty = Math.max(0, metrics.edP90 - 120) * 0.055
  const travelPenalty = metrics.averageTravel * 0.35
  const verticalPenalty = metrics.verticalMoves * 0.012
  const rulePenalty = failCount * 8 + warnCount * 2.5
  const areaPenalty = Math.min(12, areaDrift * 40)
  const value = clampScore(100 - blockedPenalty - waitPenalty - travelPenalty - verticalPenalty - rulePenalty - areaPenalty)

  return {
    value,
    blockedPenalty: roundScore(blockedPenalty),
    waitPenalty: roundScore(waitPenalty),
    travelPenalty: roundScore(travelPenalty),
    verticalPenalty: roundScore(verticalPenalty),
    rulePenalty: roundScore(rulePenalty),
    areaPenalty: roundScore(areaPenalty),
  }
}

function isSimulationResult(value: SimulationResult | ArchitectureMetrics | null): value is SimulationResult {
  return Boolean(value && 'kpis' in value)
}

export function rankArchitectureProposals(proposals: ArchitectureProposal[]): ArchitectureProposal[] {
  return [...proposals].sort((a, b) => (
    b.score.value - a.score.value
    || a.blocked - b.blocked
    || a.edP90 - b.edP90
    || a.averageTravel - b.averageTravel
  ))
}

export function bestProposalByOwner(proposals: ArchitectureProposal[]): ArchitectureProposal[] {
  const bestByOwner = new Map<ProposalOwner, ArchitectureProposal>()
  proposals.forEach((proposal) => {
    const current = bestByOwner.get(proposal.owner)
    if (!current || proposal.score.value > current.score.value) bestByOwner.set(proposal.owner, proposal)
  })
  return rankArchitectureProposals([...bestByOwner.values()])
}

function clampScore(value: number): number {
  return roundScore(Math.max(0, Math.min(100, value)))
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10
}

export function formatScore(value: number): string {
  return value.toFixed(1)
}
