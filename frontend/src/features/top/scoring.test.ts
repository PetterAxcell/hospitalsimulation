import { describe, it, expect } from 'vitest'
import { scoreArchitecture } from './scoring'
import type { HospitalPlan } from '../../types'

function makePlan(): HospitalPlan {
  return { id: 'p', name: 'test', targetAreaSqm: 1000, siteAreaSqm: 2000, floors: [0], rooms: [] }
}

const metrics = {
  completed: 100,
  blocked: 0,
  edP90: 100,
  averageTravel: 5,
  verticalMoves: 0,
  hottestRoomName: '-',
}

describe('scoreArchitecture: factor de adyacencia', () => {
  it('no penaliza cuando todas las reglas cumplen', () => {
    const plan = makePlan()
    const score = scoreArchitecture(plan, metrics, [], plan.targetAreaSqm, { total: 6, noComplies: 0 })
    expect(score.adjacencyPenalty).toBe(0)
  })

  it('penaliza y baja el score cuando hay reglas de adyacencia incumplidas', () => {
    const plan = makePlan()
    const clean = scoreArchitecture(plan, metrics, [], plan.targetAreaSqm, { total: 6, noComplies: 0 })
    const withBreaks = scoreArchitecture(plan, metrics, [], plan.targetAreaSqm, { total: 6, noComplies: 3 })
    expect(withBreaks.adjacencyPenalty).toBeGreaterThan(0)
    expect(withBreaks.value).toBeLessThan(clean.value)
  })

  it('limita la penalizacion de adyacencia', () => {
    const plan = makePlan()
    const many = scoreArchitecture(plan, metrics, [], plan.targetAreaSqm, { total: 40, noComplies: 40 })
    expect(many.adjacencyPenalty).toBeLessThanOrEqual(24)
  })
})
