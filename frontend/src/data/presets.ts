import { templateById } from './catalog'
import { HOSPITAL_CLINIC_FACTS } from './hospitalClinicModel'
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

interface CirculationBackboneOptions {
  clinicalWidth?: number
  publicWidth?: number
  logisticsWidth?: number
}

function circulationBackbone(floors: number[], options: CirculationBackboneOptions = {}): PlacedRoom[] {
  const clinicalWidth = options.clinicalWidth ?? 7
  const publicWidth = options.publicWidth ?? 9
  const logisticsWidth = options.logisticsWidth ?? 5
  const backbone = floors.flatMap((floor) => [
    room('clinicalCorridor', floor, 0, 31, 100, clinicalWidth, { name: `Pasillo clinico principal ${floor}` }),
    room('publicCorridor', floor, 47, 0, publicWidth, 70, { name: `Pasillo publico vertical ${floor}` }),
    room('logisticsCorridor', floor, 0, 58, 100, logisticsWidth, { name: `Pasillo logistico ${floor}` }),
  ])
  return [
    ...backbone,
    room('clinicalCorridor', 0, 68, 24, 22, clinicalWidth, { name: 'Pasillo ambulancias-urgencias' }),
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

export function createHospitalClinicCampusPlan(): HospitalPlan {
  sequence = 0
  const floors = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  const plan: HospitalPlan = {
    id: 'hospital-clinic-new-campus-0-1',
    name: 'Nou Campus de Salut Clinic-UB - modelo funcional 0.1',
    targetAreaSqm: HOSPITAL_CLINIC_FACTS.newCampus.targetAreaSqm,
    siteAreaSqm: HOSPITAL_CLINIC_FACTS.newCampus.targetAreaSqm,
    floors,
    rooms: [
      ...circulationBackbone(floors, { clinicalWidth: 5, publicWidth: 7, logisticsWidth: 4 }),
      ...safetyBackbone(floors),

      room('logisticsDock', -2, 72, 18, 19, 13, { name: 'Muelle logistico campus y residuos' }),
      room('criticalMep', -2, 14, 16, 24, 16, { name: 'MEP critica campus / energia N+1' }),
      room('futureShell', -2, 16, 43, 23, 10, { name: 'Reserva tecnica subterranea' }),
      room('sterileProcessing', -1, 56, 8, 15, 12, { name: 'CSSD quirurgica campus' }),
      room('coreLab', -1, 57, 45, 18, 12, { name: 'Core lab / diagnostico biomedico' }),
      room('bloodBank', -1, 78, 48, 10, 10, { name: 'Banco de sangre, tejidos y terapias celulares' }),
      room('pharmacy', -1, 32, 40, 13, 10, { name: 'Farmacia, medicamento y ensayos clinicos' }),

      room('mainHall', 0, 28, 15, 20, 15, { name: 'Agora publica campus / admision central' }),
      room('publicWaiting', 0, 8, 38, 22, 13, { name: 'Espera publica y orientacion pacientes' }),
      room('healingCourtyard', 0, 15, 63, 25, 6, { name: 'Patio clinico y orientacion ciudadana' }),
      room('ambulanceBay', 0, 80, 14, 15, 10, { name: 'Acceso ambulancias y catastrofes' }),
      room('triage', 0, 68, 16, 11, 8, { name: 'Triaje urgencias adultos' }),
      room('resus', 0, 78, 38, 14, 10, { name: 'Criticos tiempo-dependientes ED' }),
      room('edBoxes', 0, 56, 39, 22, 14, { name: 'Boxes urgencias alta complejidad' }),
      room('edObservation', 0, 56, 53, 22, 5, { name: 'Observacion y decision de ingreso' }),
      room('mentalHealthEd', 0, 78, 52, 12, 6, { name: 'Urgencia salud mental segura' }),
      room('imaging', 0, 55, 7, 17, 9, { name: 'Imagen urgente / TC-RM-intervencionismo' }),

      room('operatingBlock', 1, 63, 13, 24, 18, { name: 'Plataforma quirurgica alta complejidad' }),
      room('hybridOr', 1, 87, 21, 10, 10, { name: 'Quirofanos hibridos y robotica' }),
      room('pacu', 1, 56, 38, 22, 13, { name: 'Reanimacion postquirurgica / PACU' }),
      room('icu', 1, 78, 38, 16, 14, { name: 'UCI quirurgica y criticos inmediatos' }),
      room('cathLab', 1, 33, 19, 14, 12, { name: 'Hemodinamica, vascular y neurointervencion' }),

      room('ward', 2, 13, 8, 34, 20, { name: 'Institutos medico-quirurgicos / camas complejas' }),
      room('ward', 2, 64, 11, 28, 20, { name: 'Hospitalizacion quirurgica y trasplante' }),
      room('icu', 2, 58, 38, 22, 13, { name: 'Cuidados intermedios y step-down', capacity: 48 }),
      room('ward', 3, 13, 10, 34, 18, { name: 'Cardio-respiratorio y neurociencias' }),
      room('imaging', 3, 64, 13, 22, 13, { name: 'Diagnostico avanzado programado' }),

      room('oncologyDay', 4, 14, 12, 31, 19, { name: 'Hospital de dia onco-hematologico' }),
      room('cartGmp', 4, 64, 18, 20, 13, { name: 'Terapias avanzadas CAR-T / GMP' }),
      room('ward', 4, 16, 42, 31, 14, { name: 'Onco-hematologia y ensayos clinicos' }),

      room('maternity', 5, 16, 12, 28, 19, { name: 'Maternidad y salud reproductiva' }),
      room('neonatalIcu', 5, 64, 14, 24, 17, { name: 'Neonatal / pediatria critica' }),
      room('ward', 5, 17, 40, 30, 14, { name: 'Mujer, perinatal y apoyo familiar' }),

      room('oncologyDay', 6, 14, 12, 30, 18, { name: 'Consultas externas y hospital de dia' }),
      room('publicWaiting', 6, 47, 12, 15, 16, { name: 'Esperas ambulatorias distribuidas' }),
      room('imaging', 6, 64, 14, 24, 16, { name: 'Pruebas programadas y diagnostico rapido' }),

      room('researchCampus', 7, 13, 12, 34, 19, { name: 'IDIBAPS / investigacion traslacional' }),
      room('researchCampus', 7, 64, 14, 25, 17, { name: 'ISGlobal / salud global y datos' }),
      room('researchCampus', 8, 13, 14, 34, 18, { name: 'Facultad UB, docencia y simulacion clinica' }),
      room('commandCenter', 8, 64, 20, 18, 12, { name: 'Command center, camas y gemelo operacional' }),

      room('futureShell', 9, 12, 12, 32, 18, { name: 'Reserva de crecimiento clinico' }),
      room('futureShell', 9, 65, 12, 23, 18, { name: 'Reserva de tecnologia y nuevos modelos' }),
      ...upperVerticalCores(floors),
    ],
  }
  return { ...plan, rooms: addDefaultDoors(withVerticalConnectorGroups(plan.rooms, floors)) }
}
