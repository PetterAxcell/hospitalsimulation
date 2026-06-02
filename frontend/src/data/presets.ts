import { templateById } from './catalog'
import { addDefaultDoors } from '../engine/circulation'
import { areaSqmForDimensions } from '../engine/geometry'
import type { HospitalPlan, PlacedRoom } from '../types'

let sequence = 0

function room(
  templateId: string,
  floor: number,
  x: number,
  y: number,
  w: number,
  h: number,
  overrides: Partial<PlacedRoom> = {},
): PlacedRoom {
  const template = templateById(templateId)
  sequence += 1
  return {
    id: `${templateId}-${sequence}`,
    templateId,
    name: overrides.name ?? template.name,
    kind: template.kind,
    floor,
    x,
    y,
    w,
    h,
    capacity: overrides.capacity ?? template.defaultCapacity,
    areaSqm: overrides.areaSqm ?? areaSqmForDimensions(w, h),
    equipment: overrides.equipment ?? template.equipment,
    staffModel: overrides.staffModel ?? template.staffModel,
    simulationNode: overrides.simulationNode ?? template.simulationNode,
    doors: overrides.doors,
    connectionIds: overrides.connectionIds,
    verticalGroupId: overrides.verticalGroupId,
    servesFloors: overrides.servesFloors,
    locked: overrides.locked ?? false,
  }
}

function upperVerticalCores(floors: number[]): PlacedRoom[] {
  return floors.map((floor) => room('verticalCore', floor, 56, 20, 8, 8))
}

function safetyBackbone(floors: number[]): PlacedRoom[] {
  return floors.flatMap((floor) => [
    room('emergencyStairCore', floor, 4, 8, 5, 10, { name: `Escalera emergencia oeste ${floor}` }),
    room('emergencyStairCore', floor, 94, 42, 5, 10, { name: `Escalera emergencia este ${floor}` }),
    room('horizontalRefuge', floor, 58, 63, 8, 5, { name: `Refugio horizontal ${floor}` }),
    room('fireCompartment', floor, 58, 1, 8, 5, { name: `Sector PCI ${floor}` }),
  ])
}

function circulationBackbone(floors: number[]): PlacedRoom[] {
  const backbone = floors.flatMap((floor) => [
    room('clinicalCorridor', floor, 0, 31, 100, 7, { name: `Pasillo clinico principal ${floor}` }),
    room('publicCorridor', floor, 47, 0, 9, 70, { name: `Pasillo publico vertical ${floor}` }),
    room('logisticsCorridor', floor, 0, 58, 100, 5, { name: `Pasillo logistico ${floor}` }),
  ])
  return [
    ...backbone,
    room('clinicalCorridor', 0, 68, 24, 22, 7, { name: 'Pasillo ambulancias-urgencias' }),
  ]
}

function withVerticalConnectorGroups(rooms: PlacedRoom[], floors: number[]): PlacedRoom[] {
  return rooms.map((item) => {
    if (item.templateId === 'verticalCore') {
      return { ...item, verticalGroupId: 'asc-core-central', servesFloors: floors }
    }
    if (item.templateId === 'emergencyStairCore' && item.name.includes('oeste')) {
      return { ...item, verticalGroupId: 'stair-emergency-west', servesFloors: floors }
    }
    if (item.templateId === 'emergencyStairCore' && item.name.includes('este')) {
      return { ...item, verticalGroupId: 'stair-emergency-east', servesFloors: floors }
    }
    return item
  })
}

function withDefaultAccessConnections(rooms: PlacedRoom[]): PlacedRoom[] {
  const nextRooms = rooms.map((item) => ({ ...item, connectionIds: item.connectionIds ? [...item.connectionIds] : undefined }))
  nextRooms
    .filter((item) => item.kind !== 'circulation' && item.kind !== 'green' && item.kind !== 'future')
    .forEach((item) => {
      const corridor = nearestCorridor(item, nextRooms)
      if (corridor) linkRooms(item, corridor)
    })
  return nextRooms
}

function nearestCorridor(roomToConnect: PlacedRoom, rooms: PlacedRoom[]): PlacedRoom | undefined {
  return rooms
    .filter((candidate) => candidate.floor === roomToConnect.floor && candidate.kind === 'circulation')
    .map((candidate) => ({ candidate, distance: rectDistance(roomToConnect, candidate) }))
    .sort((a, b) => a.distance - b.distance)[0]?.candidate
}

function linkRooms(a: PlacedRoom, b: PlacedRoom) {
  a.connectionIds = [...new Set([...(a.connectionIds ?? []), b.id])]
  b.connectionIds = [...new Set([...(b.connectionIds ?? []), a.id])]
}

function rectDistance(a: PlacedRoom, b: PlacedRoom): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)))
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)))
  return Math.hypot(dx, dy)
}

export function createTertiaryHospitalPlan(): HospitalPlan {
  sequence = 0
  const floors = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8]
  const plan: HospitalPlan = {
    id: 'tertiary-290k',
    name: 'Hospital terciario 290.000 m2',
    targetAreaSqm: 290000,
    siteAreaSqm: 210000,
    floors,
    rooms: [
      ...circulationBackbone(floors),
      ...safetyBackbone(floors),

      room('logisticsDock', -1, 72, 8, 19, 13),
      room('sterileProcessing', -1, 58, 8, 14, 11),
      room('criticalMep', -1, 15, 8, 21, 14),
      room('coreLab', -1, 58, 40, 18, 12),
      room('bloodBank', -1, 78, 42, 10, 10),
      room('verticalCore', -1, 56, 20, 8, 8),

      room('mainHall', 0, 10, 10, 18, 14),
      room('publicWaiting', 0, 8, 40, 22, 13),
      room('ambulanceBay', 0, 80, 11, 15, 10),
      room('triage', 0, 68, 16, 11, 8),
      room('resus', 0, 78, 39, 14, 10),
      room('edBoxes', 0, 56, 39, 22, 14),
      room('edObservation', 0, 56, 53, 22, 5),
      room('mentalHealthEd', 0, 78, 52, 12, 6),
      room('imaging', 0, 58, 7, 16, 9),
      room('pharmacy', 0, 28, 17, 11, 8),
      room('healingCourtyard', 0, 15, 63, 25, 6),
      room('verticalCore', 0, 56, 20, 8, 8),

      room('operatingBlock', 1, 64, 8, 23, 17),
      room('hybridOr', 1, 87, 12, 10, 10),
      room('pacu', 1, 50, 39, 22, 13),
      room('icu', 1, 72, 39, 18, 14),
      room('cathLab', 1, 34, 20, 14, 12),
      room('commandCenter', 1, 16, 24, 14, 10),
      room('verticalCore', 1, 56, 20, 8, 8),

      room('ward', 2, 12, 8, 34, 20, { name: 'Hospitalizacion medicina' }),
      room('ward', 2, 64, 8, 28, 20, { name: 'Hospitalizacion quirurgica' }),
      room('icu', 2, 58, 40, 22, 13, { name: 'Step-down / intermedios', capacity: 48 }),
      room('verticalCore', 2, 56, 20, 8, 8),

      room('maternity', 3, 16, 16, 28, 19),
      room('neonatalIcu', 3, 64, 12, 24, 17),
      room('ward', 3, 16, 40, 30, 14, { name: 'Pediatria y mujer' }),
      room('verticalCore', 3, 56, 20, 8, 8),

      room('oncologyDay', 4, 15, 18, 31, 19),
      room('cartGmp', 4, 64, 18, 20, 13),
      room('researchCampus', 4, 16, 43, 34, 14),
      room('verticalCore', 4, 56, 20, 8, 8),

      room('ward', 5, 16, 15, 32, 18, { name: 'Hospitalizacion alta complejidad' }),
      room('ward', 6, 16, 15, 32, 18, { name: 'Hospitalizacion convencional' }),
      room('ward', 7, 16, 15, 32, 18, { name: 'Hospitalizacion flexible' }),
      room('researchCampus', 8, 18, 18, 36, 18, { name: 'Docencia y simulacion clinica' }),
      room('futureShell', 8, 66, 12, 22, 18),
      ...upperVerticalCores([5, 6, 7, 8]),
    ],
  }
  return { ...plan, rooms: addDefaultDoors(withDefaultAccessConnections(withVerticalConnectorGroups(plan.rooms, floors))) }
}
