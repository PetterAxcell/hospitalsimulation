import { describe, it, expect } from 'vitest'
import { createClinicPdfDesignInstitutes, createClinicPdfDesignVertical } from './presets'
import { CLINIC_SPACE_PROGRAM } from './clinicSpaceProgram'
import { DEFAULT_SIMULATION_SETTINGS, runHospitalSimulation } from '../engine/simulation'
import { disconnectedPatientRooms } from '../engine/circulation'

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
      expect(disconnectedPatientRooms(plan.rooms).length).toBeLessThanOrEqual(4)
      expect(result.kpis.completed).toBeGreaterThan(0)
      expect(Object.keys(result.roomPressure).length).toBeGreaterThan(0)
    })
  }
})
