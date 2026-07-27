import { describe, it, expect } from 'vitest'
import { createClinicPdfDesignInstitutes, createClinicPdfDesignVertical } from './presets'
import { CLINIC_SPACE_PROGRAM } from './clinicSpaceProgram'
import { DEFAULT_SIMULATION_SETTINGS, runHospitalSimulation } from '../engine/simulation'
import { disconnectedPatientRooms } from '../engine/circulation'
import { evaluateArchitectureRules } from '../engine/architectureRules'
import { DEFAULT_ADJACENCY_RULES, adjacencyComplies, evaluateAdjacencyRules } from '../engine/adjacencyMatrix'
import { scoreArchitecture } from '../features/top/scoring'

const programIds = new Set(CLINIC_SPACE_PROGRAM.map((entry) => entry.id))

const DESIGNS = [
  ['torre asistencial', createClinicPdfDesignVertical],
  ['institutos distribuidos', createClinicPdfDesignInstitutes],
] as const

describe('disenos PDF (Pla d Espais)', () => {
  for (const [name, build] of DESIGNS) {
    it(`${name}: las estancias con programa salen de bloques PDF`, () => {
      const plan = build()
      const tagged = plan.rooms.filter((room) => room.spaceProgramEntryId)
      expect(tagged.length).toBeGreaterThan(0)
      for (const room of tagged) {
        expect(programIds.has(room.spaceProgramEntryId as string)).toBe(true)
      }
    })

    it(`${name}: es simulable (pacientes completados y presion)`, () => {
      const plan = build()
      const result = runHospitalSimulation(plan, DEFAULT_SIMULATION_SETTINGS)
      expect(disconnectedPatientRooms(plan.rooms).length).toBeLessThanOrEqual(2)
      expect(result.kpis.completed).toBeGreaterThan(0)
      expect(Object.keys(result.roomPressure).length).toBeGreaterThan(0)
    })
  }

  it('demo: quitar un triaje concentra la cola en el que queda', () => {
    const plan = createClinicPdfDesignVertical()
    const triages = plan.rooms.filter((room) => room.simulationNode === 'triage')
    expect(triages.length).toBeGreaterThanOrEqual(2)
    const [keep, remove] = triages
    const base = runHospitalSimulation(plan, DEFAULT_SIMULATION_SETTINGS)
    const reduced = { ...plan, rooms: plan.rooms.filter((room) => room.id !== remove.id) }
    const after = runHospitalSimulation(reduced, DEFAULT_SIMULATION_SETTINGS)
    // Al eliminar un triaje, todo el flujo se concentra en el que queda: su presion sube.
    expect(after.roomPressure[keep.id] ?? 0).toBeGreaterThan(base.roomPressure[keep.id] ?? 0)
  })

  it('las dos arquitecturas puntúan distinto y por encima de 0', () => {
    const scoreOf = (plan: ReturnType<typeof createClinicPdfDesignVertical>) => {
      const result = runHospitalSimulation(plan, DEFAULT_SIMULATION_SETTINGS)
      const rules = evaluateArchitectureRules(plan)
      const adj = evaluateAdjacencyRules(plan, DEFAULT_ADJACENCY_RULES)
      const totalArea = plan.rooms.reduce((sum, room) => sum + room.areaSqm, 0)
      const noComplies = adj.filter((r) => !adjacencyComplies(r.status)).length
      return scoreArchitecture(plan, result, rules, totalArea, { total: adj.length, noComplies }).value
    }
    const compact = createClinicPdfDesignVertical()
    const spread = createClinicPdfDesignInstitutes()
    const scoreCompact = scoreOf(compact)
    const scoreSpread = scoreOf(spread)
    expect(scoreCompact).toBeGreaterThan(0)
    expect(scoreSpread).toBeGreaterThan(0)
    expect(Math.abs(scoreCompact - scoreSpread)).toBeGreaterThan(3)
    // Son dos disenos claramente distintos (distinto numero de plantas).
    expect(compact.floors.length).not.toBe(spread.floors.length)
  })
})
