import { describe, it, expect } from 'vitest'
import { createHospitalClinicCampusPlan } from '../data/presets'
import { DEFAULT_SIMULATION_SETTINGS, pickRoomForNode, runHospitalSimulation } from './simulation'
import type { PlacedRoom, SimulationNode } from '../types'

function makeRoom(id: string, capacity: number, node: SimulationNode = 'triage'): PlacedRoom {
  return {
    id,
    templateId: 'triage',
    name: id,
    kind: 'emergency',
    floor: 0,
    x: 0,
    y: 0,
    w: 10,
    h: 8,
    capacity,
    areaSqm: 80,
    equipment: [],
    staffModel: [],
    simulationNode: node,
  }
}

// mulberry32 determinista para tests de distribucion
function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('pickRoomForNode', () => {
  it('devuelve la unica sala cuando solo hay una candidata', () => {
    const rooms = [makeRoom('t1', 8)]
    expect(pickRoomForNode(rooms, 'triage', seededRng(1))?.id).toBe('t1')
  })

  it('devuelve undefined si ninguna sala sirve el nodo', () => {
    const rooms = [makeRoom('t1', 8, 'triage')]
    expect(pickRoomForNode(rooms, 'icu', seededRng(1))).toBeUndefined()
  })

  it('reparte ~50/50 entre dos salas de igual capacidad', () => {
    const rooms = [makeRoom('a', 5), makeRoom('b', 5)]
    const rng = seededRng(42)
    const counts: Record<string, number> = { a: 0, b: 0 }
    for (let i = 0; i < 4000; i += 1) {
      const picked = pickRoomForNode(rooms, 'triage', rng)
      if (picked) counts[picked.id] += 1
    }
    const ratioA = counts.a / 4000
    expect(ratioA).toBeGreaterThan(0.42)
    expect(ratioA).toBeLessThan(0.58)
  })

  it('reparte proporcional a la capacidad (8 vs 2 ~ 80/20)', () => {
    const rooms = [makeRoom('big', 8), makeRoom('small', 2)]
    const rng = seededRng(7)
    const counts: Record<string, number> = { big: 0, small: 0 }
    for (let i = 0; i < 4000; i += 1) {
      const picked = pickRoomForNode(rooms, 'triage', rng)
      if (picked) counts[picked.id] += 1
    }
    const ratioBig = counts.big / 4000
    expect(ratioBig).toBeGreaterThan(0.72)
    expect(ratioBig).toBeLessThan(0.88)
  })
})

describe('runHospitalSimulation: presion por estancia', () => {
  it('el preset genera presion y pacientes completados', () => {
    const plan = createHospitalClinicCampusPlan()
    const result = runHospitalSimulation(plan, DEFAULT_SIMULATION_SETTINGS)
    expect(result.kpis.completed).toBeGreaterThan(0)
    expect(Object.keys(result.roomPressure).length).toBeGreaterThan(0)
  })

  it('anadir un bloque duplicado del servicio mas cargado reparte la carga y baja el pico', () => {
    const plan = createHospitalClinicCampusPlan()
    const base = runHospitalSimulation(plan, DEFAULT_SIMULATION_SETTINGS)

    const busiestEntry = Object.entries(base.roomPressure).sort((a, b) => b[1] - a[1])[0]
    expect(busiestEntry).toBeDefined()
    const [busiestId, busiestCount] = busiestEntry
    const busiest = plan.rooms.find((room) => room.id === busiestId)
    expect(busiest).toBeDefined()
    if (!busiest) return

    // Clon identico (mismas conexiones y puertas) => alcanzable por las mismas rutas.
    const clone: PlacedRoom = { ...busiest, id: `${busiest.id}-clone`, name: `${busiest.name} (2)` }
    const augmented = { ...plan, rooms: [...plan.rooms, clone] }
    const after = runHospitalSimulation(augmented, DEFAULT_SIMULATION_SETTINGS)

    // El clon recibe pacientes (se reparte) y el pico de la sala original baja.
    expect(after.roomPressure[clone.id] ?? 0).toBeGreaterThan(0)
    expect(after.roomPressure[busiest.id] ?? 0).toBeLessThan(busiestCount)
  })
})
