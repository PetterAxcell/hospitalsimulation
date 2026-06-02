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
    room('emergencyStairCore', floor, 4, 21, 5, 10, { name: `Escalera emergencia oeste ${floor}` }),
    room('emergencyStairCore', floor, 94, 38, 5, 10, { name: `Escalera emergencia este ${floor}` }),
    room('horizontalRefuge', floor, 56, 63, 8, 5, { name: `Refugio horizontal ${floor}` }),
    room('fireCompartment', floor, 56, 1, 8, 5, { name: `Sector PCI ${floor}` }),
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

      room('logisticsDock', -1, 72, 18, 19, 13),
      room('sterileProcessing', -1, 56, 8, 14, 11),
      room('criticalMep', -1, 15, 17, 21, 14),
      room('coreLab', -1, 58, 46, 18, 12),
      room('bloodBank', -1, 78, 48, 10, 10),
      room('verticalCore', -1, 56, 20, 8, 8),

      room('mainHall', 0, 29, 17, 18, 14),
      room('publicWaiting', 0, 8, 38, 22, 13),
      room('ambulanceBay', 0, 80, 14, 15, 10),
      room('triage', 0, 68, 16, 11, 8),
      room('resus', 0, 78, 38, 14, 10),
      room('edBoxes', 0, 56, 39, 22, 14),
      room('edObservation', 0, 56, 53, 22, 5),
      room('mentalHealthEd', 0, 78, 52, 12, 6),
      room('imaging', 0, 56, 7, 16, 9),
      room('pharmacy', 0, 31, 38, 11, 8),
      room('healingCourtyard', 0, 15, 63, 25, 6),
      room('verticalCore', 0, 56, 20, 8, 8),

      room('operatingBlock', 1, 64, 14, 23, 17),
      room('hybridOr', 1, 87, 21, 10, 10),
      room('pacu', 1, 56, 38, 22, 13),
      room('icu', 1, 78, 38, 16, 14),
      room('cathLab', 1, 33, 19, 14, 12),
      room('commandCenter', 1, 16, 21, 14, 10),
      room('verticalCore', 1, 56, 20, 8, 8),

      room('ward', 2, 13, 8, 34, 20, { name: 'Hospitalizacion medicina' }),
      room('ward', 2, 64, 11, 28, 20, { name: 'Hospitalizacion quirurgica' }),
      room('icu', 2, 58, 38, 22, 13, { name: 'Step-down / intermedios', capacity: 48 }),
      room('verticalCore', 2, 56, 20, 8, 8),

      room('maternity', 3, 16, 12, 28, 19),
      room('neonatalIcu', 3, 64, 14, 24, 17),
      room('ward', 3, 17, 40, 30, 14, { name: 'Pediatria y mujer' }),
      room('verticalCore', 3, 56, 20, 8, 8),

      room('oncologyDay', 4, 15, 12, 31, 19),
      room('cartGmp', 4, 64, 18, 20, 13),
      room('researchCampus', 4, 13, 43, 34, 14),
      room('verticalCore', 4, 56, 20, 8, 8),

      room('ward', 5, 15, 13, 32, 18, { name: 'Hospitalizacion alta complejidad' }),
      room('ward', 6, 15, 13, 32, 18, { name: 'Hospitalizacion convencional' }),
      room('ward', 7, 15, 13, 32, 18, { name: 'Hospitalizacion flexible' }),
      room('researchCampus', 8, 18, 13, 29, 18, { name: 'Docencia y simulacion clinica' }),
      room('futureShell', 8, 66, 12, 22, 18),
      ...upperVerticalCores([5, 6, 7, 8]),
    ],
  }
  return { ...plan, rooms: addDefaultDoors(withVerticalConnectorGroups(plan.rooms, floors)) }
}
