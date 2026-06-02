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
    verticalGroupId: overrides.verticalGroupId,
    servesFloors: overrides.servesFloors,
    locked: overrides.locked ?? false,
  }
}

function upperVerticalCores(floors: number[]): PlacedRoom[] {
  return floors.map((floor) => room('verticalCore', floor, 50, 20, 8, 8))
}

function safetyBackbone(floors: number[]): PlacedRoom[] {
  return floors.flatMap((floor) => [
    room('emergencyStairCore', floor, 4, 8, 5, 10, { name: `Escalera emergencia oeste ${floor}` }),
    room('emergencyStairCore', floor, 91, 50, 5, 10, { name: `Escalera emergencia este ${floor}` }),
    room('horizontalRefuge', floor, 58, 58, 8, 5, { name: `Refugio horizontal ${floor}` }),
    room('fireCompartment', floor, 58, 4, 8, 5, { name: `Sector PCI ${floor}` }),
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

      room('logisticsDock', -1, 72, 9, 19, 13),
      room('sterileProcessing', -1, 58, 9, 14, 13),
      room('criticalMep', -1, 18, 8, 21, 14),
      room('coreLab', -1, 45, 32, 18, 14),
      room('bloodBank', -1, 63, 32, 10, 10),
      room('verticalCore', -1, 50, 20, 8, 8),

      room('mainHall', 0, 8, 28, 18, 20),
      room('publicWaiting', 0, 26, 42, 20, 12),
      room('ambulanceBay', 0, 74, 15, 15, 11),
      room('triage', 0, 58, 17, 11, 8),
      room('resus', 0, 68, 28, 14, 10),
      room('edBoxes', 0, 47, 27, 21, 16),
      room('edObservation', 0, 47, 45, 19, 11),
      room('mentalHealthEd', 0, 68, 45, 12, 10),
      room('imaging', 0, 42, 14, 16, 11),
      room('pharmacy', 0, 26, 24, 12, 10),
      room('healingCourtyard', 0, 30, 57, 22, 8),
      room('verticalCore', 0, 50, 20, 8, 8),

      room('operatingBlock', 1, 50, 19, 23, 17),
      room('hybridOr', 1, 73, 19, 12, 12),
      room('pacu', 1, 50, 39, 22, 13),
      room('icu', 1, 72, 39, 18, 14),
      room('cathLab', 1, 34, 20, 14, 12),
      room('commandCenter', 1, 16, 24, 14, 10),
      room('verticalCore', 1, 50, 20, 8, 8),

      room('ward', 2, 16, 14, 32, 18, { name: 'Hospitalizacion medicina' }),
      room('ward', 2, 52, 14, 32, 18, { name: 'Hospitalizacion quirurgica' }),
      room('icu', 2, 52, 38, 20, 13, { name: 'Step-down / intermedios', capacity: 48 }),
      room('verticalCore', 2, 50, 20, 8, 8),

      room('maternity', 3, 16, 16, 28, 19),
      room('neonatalIcu', 3, 48, 16, 24, 17),
      room('ward', 3, 16, 40, 30, 14, { name: 'Pediatria y mujer' }),
      room('verticalCore', 3, 50, 20, 8, 8),

      room('oncologyDay', 4, 15, 18, 31, 19),
      room('cartGmp', 4, 50, 20, 20, 13),
      room('researchCampus', 4, 16, 43, 34, 14),
      room('verticalCore', 4, 50, 20, 8, 8),

      room('ward', 5, 16, 15, 32, 18, { name: 'Hospitalizacion alta complejidad' }),
      room('ward', 6, 16, 15, 32, 18, { name: 'Hospitalizacion convencional' }),
      room('ward', 7, 16, 15, 32, 18, { name: 'Hospitalizacion flexible' }),
      room('researchCampus', 8, 18, 18, 36, 18, { name: 'Docencia y simulacion clinica' }),
      room('futureShell', 8, 61, 18, 23, 18),
      ...upperVerticalCores([5, 6, 7, 8]),
    ],
  }
  return { ...plan, rooms: addDefaultDoors(withVerticalConnectorGroups(plan.rooms, floors)) }
}
