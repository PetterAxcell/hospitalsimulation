import { templateById } from './catalog'
import { clinicSpaceProgramById, componentsForSpaceProgramEntry } from './clinicSpaceProgram'
import { HOSPITAL_CLINIC_FACTS } from './hospitalClinicModel'
import { addDefaultDoors } from '../engine/circulation'
import { areaSqmForDimensions } from '../engine/geometry'
import type { HospitalPlan, PlacedRoom, RoomKind } from '../types'

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
    spaceProgramEntryId: overrides.spaceProgramEntryId,
    components: overrides.components,
    locked: overrides.locked ?? false,
  }
}

function upperVerticalCores(floors: number[]): PlacedRoom[] {
  return floors.map((floor) => room('verticalCore', floor, 54, 20, 8, 8))
}

function safetyBackbone(floors: number[]): PlacedRoom[] {
  return floors.flatMap((floor) => [
    room('emergencyStairCore', floor, 4, 21, 5, 10, { name: `Escalera emergencia oeste ${floor}` }),
    room('emergencyStairCore', floor, 94, 36, 5, 10, { name: `Escalera emergencia este ${floor}` }),
    room('horizontalRefuge', floor, 54, 63, 8, 5, { name: `Refugio horizontal ${floor}` }),
    room('fireCompartment', floor, 54, 1, 8, 5, { name: `Sector PCI ${floor}` }),
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
    room('clinicalCorridor', floor, 0, 31, 100, clinicalWidth, { name: `Pasillo clínico principal ${floor}` }),
    room('publicCorridor', floor, 47, 0, publicWidth, 70, { name: `Pasillo público vertical ${floor}` }),
    room('logisticsCorridor', floor, 0, 58, 100, logisticsWidth, { name: `Pasillo logístico ${floor}` }),
  ])
  return [
    ...backbone,
    room('clinicalCorridor', 0, 68, 24, 22, clinicalWidth + 2, { name: 'Pasillo ambulancias-urgencias' }),
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
      room('verticalCore', -1, 54, 20, 8, 8),

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
      room('verticalCore', 0, 54, 20, 8, 8),

      room('operatingBlock', 1, 64, 14, 23, 17),
      room('hybridOr', 1, 87, 21, 10, 10),
      room('pacu', 1, 56, 38, 22, 13),
      room('icu', 1, 78, 38, 16, 14),
      room('cathLab', 1, 33, 19, 14, 12),
      room('commandCenter', 1, 16, 21, 14, 10),
      room('verticalCore', 1, 54, 20, 8, 8),

      room('ward', 2, 13, 8, 34, 20, { name: 'Hospitalizacion medicina' }),
      room('ward', 2, 64, 11, 28, 20, { name: 'Hospitalización quirúrgica' }),
      room('icu', 2, 58, 38, 22, 13, { name: 'Step-down / intermedios', capacity: 48 }),
      room('verticalCore', 2, 54, 20, 8, 8),

      room('maternity', 3, 16, 12, 28, 19),
      room('neonatalIcu', 3, 64, 14, 24, 17),
      room('ward', 3, 17, 40, 30, 14, { name: 'Pediatría y mujer' }),
      room('verticalCore', 3, 54, 20, 8, 8),

      room('oncologyDay', 4, 15, 12, 31, 19),
      room('cartGmp', 4, 64, 18, 20, 13),
      room('researchCampus', 4, 13, 43, 34, 14),
      room('verticalCore', 4, 54, 20, 8, 8),

      room('ward', 5, 15, 13, 32, 18, { name: 'Hospitalizacion alta complejidad' }),
      room('ward', 6, 15, 13, 32, 18, { name: 'Hospitalizacion convencional' }),
      room('ward', 7, 15, 13, 32, 18, { name: 'Hospitalizacion flexible' }),
      room('researchCampus', 8, 18, 13, 29, 18, { name: 'Docencia y simulación clínica' }),
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

      room('logisticsDock', -2, 72, 18, 19, 13, { name: 'Muelle logístico campus y residuos' }),
      room('criticalMep', -2, 14, 16, 24, 16, { name: 'MEP crítica campus / energía N+1' }),
      room('futureShell', -2, 16, 43, 23, 10, { name: 'Reserva técnica subterránea' }),
      room('sterileProcessing', -1, 54, 8, 15, 12, { name: 'CSSD quirúrgica campus' }),
      room('coreLab', -1, 54, 45, 18, 12, { name: 'Core lab / diagnóstico biomédico' }),
      room('bloodBank', -1, 78, 48, 10, 10, { name: 'Banco de sangre, tejidos y terapias celulares' }),
      room('pharmacy', -1, 34, 40, 13, 10, { name: 'Farmacia, medicamento y ensayos clínicos' }),

      room('mainHall', 0, 28, 15, 20, 15, { name: 'Ágora pública campus / admisión central' }),
      room('publicWaiting', 0, 8, 36, 22, 13, { name: 'Espera pública y orientación pacientes' }),
      room('healingCourtyard', 0, 15, 62, 25, 6, { name: 'Patio clínico y orientación ciudadana' }),
      room('ambulanceBay', 0, 80, 14, 15, 10, { name: 'Acceso ambulancias y catástrofes' }),
      room('triage', 0, 68, 16, 11, 8, { name: 'Triaje urgencias adultos' }),
      room('resus', 0, 78, 36, 14, 10, { name: 'Críticos tiempo-dependientes ED' }),
      room('edBoxes', 0, 56, 36, 22, 14, { name: 'Boxes urgencias alta complejidad' }),
      room('edObservation', 0, 56, 53, 22, 5, { name: 'Observación y decisión de ingreso' }),
      room('mentalHealthEd', 0, 78, 52, 12, 6, { name: 'Urgencia salud mental segura' }),
      room('imaging', 0, 54, 7, 17, 9, { name: 'Imagen urgente / TC-RM-intervencionismo' }),

      room('operatingBlock', 1, 63, 13, 24, 18, { name: 'Plataforma quirúrgica alta complejidad' }),
      room('hybridOr', 1, 87, 21, 10, 10, { name: 'Quirófanos híbridos y robótica' }),
      room('pacu', 1, 56, 36, 22, 13, { name: 'Reanimación postquirúrgica / PACU' }),
      room('icu', 1, 78, 36, 16, 14, { name: 'UCI quirúrgica y críticos inmediatos' }),
      room('cathLab', 1, 33, 19, 14, 12, { name: 'Hemodinámica, vascular y neurointervención' }),

      room('ward', 2, 13, 8, 34, 20, { name: 'Institutos médico-quirúrgicos / camas complejas' }),
      room('ward', 2, 64, 11, 28, 20, { name: 'Hospitalización quirúrgica y trasplante' }),
      room('icu', 2, 58, 36, 22, 13, { name: 'Cuidados intermedios y step-down', capacity: 48 }),
      room('ward', 3, 13, 10, 34, 18, { name: 'Cardio-respiratorio y neurociencias' }),
      room('imaging', 3, 64, 18, 22, 13, { name: 'Diagnóstico avanzado programado' }),

      room('oncologyDay', 4, 14, 12, 31, 19, { name: 'Hospital de día onco-hematológico' }),
      room('cartGmp', 4, 64, 18, 20, 13, { name: 'Terapias avanzadas CAR-T / GMP' }),
      room('ward', 4, 16, 42, 31, 14, { name: 'Onco-hematología y ensayos clínicos' }),

      room('maternity', 5, 16, 12, 28, 19, { name: 'Maternidad y salud reproductiva' }),
      room('neonatalIcu', 5, 64, 14, 24, 17, { name: 'Neonatal / pediatría crítica' }),
      room('ward', 5, 17, 40, 30, 14, { name: 'Mujer, perinatal y apoyo familiar' }),

      room('oncologyDay', 6, 14, 13, 30, 18, { name: 'Consultas externas y hospital de día' }),
      room('publicWaiting', 6, 47, 12, 15, 16, { name: 'Esperas ambulatorias distribuidas' }),
      room('imaging', 6, 64, 15, 24, 16, { name: 'Pruebas programadas y diagnóstico rápido' }),

      room('researchCampus', 7, 13, 12, 34, 19, { name: 'IDIBAPS / investigación traslacional' }),
      room('researchCampus', 7, 64, 14, 25, 17, { name: 'ISGlobal / salud global y datos' }),
      room('researchCampus', 8, 13, 14, 34, 18, { name: 'Facultad UB, docencia y simulación clínica' }),
      room('commandCenter', 8, 64, 20, 18, 12, { name: 'Command center, camas y gemelo operacional' }),

      room('futureShell', 9, 12, 12, 32, 18, { name: 'Reserva de crecimiento clínico' }),
      room('futureShell', 9, 65, 12, 23, 18, { name: 'Reserva de tecnología y nuevos modelos' }),
      ...upperVerticalCores(floors),
    ],
  }
  return { ...plan, rooms: addDefaultDoors(withVerticalConnectorGroups(plan.rooms, floors)) }
}

// ---------------------------------------------------------------------------
// Disenos construidos SOLO con bloques del Pla d'Espais (PDF).
// Cada estancia funcional sale de una entrada de CLINIC_SPACE_PROGRAM; la
// circulacion, nucleos verticales y seguridad son andamiaje estructural para
// que el plano sea simulable.
// ---------------------------------------------------------------------------

function programDimensions(areaSqm: number, kind: RoomKind): { w: number; h: number } {
  const worldArea = Math.max(36, areaSqm / 9)
  const aspect = kind === 'public' || kind === 'waiting'
    ? 1.6
    : kind === 'surgery' || kind === 'critical'
      ? 1.25
      : kind === 'logistics' || kind === 'technical'
        ? 1.45
        : 1.35
  let w = Math.sqrt(worldArea * aspect)
  let h = worldArea / w
  if (w > 40) { w = 40; h = worldArea / w }
  if (h > 22) { h = 22; w = worldArea / h }
  return {
    w: Math.max(8, Math.min(40, Math.round(w * 10) / 10)),
    h: Math.max(7, Math.min(22, Math.round(h * 10) / 10)),
  }
}

function programRoom(
  entryId: string,
  floor: number,
  x: number,
  y: number,
  override: Partial<PlacedRoom> = {},
): PlacedRoom {
  const entry = clinicSpaceProgramById(entryId)
  if (!entry) throw new Error(`Entrada PDF desconocida: ${entryId}`)
  const template = templateById(override.templateId ?? entry.templateIds[0] ?? 'ward')
  const targetArea = entry.usefulAreaSqm ? Math.round(entry.usefulAreaSqm * entry.grossingFactor) : template.defaultAreaSqm
  const dims = programDimensions(targetArea, template.kind)
  const w = override.w ?? dims.w
  const h = override.h ?? dims.h
  sequence += 1
  return {
    id: `program-${entry.id}-${sequence}`,
    templateId: template.id,
    name: override.name ?? (override.templateId ? template.name : entry.label),
    kind: template.kind,
    floor,
    x,
    y,
    w,
    h,
    capacity: override.capacity ?? entry.expectedCapacity ?? template.defaultCapacity,
    areaSqm: areaSqmForDimensions(w, h),
    equipment: template.equipment,
    staffModel: template.staffModel,
    simulationNode: template.simulationNode,
    spaceProgramEntryId: entry.id,
    components: componentsForSpaceProgramEntry(entry).map((component, index) => ({
      ...component,
      id: `program-${entry.id}-${sequence}-${component.id}-${index}`,
    })),
  }
}

// La entrada 'a4-emergency-configuration' del PDF agrupa varios tipos de sala.
// La expandimos para que urgencias tenga nodos de flujo reales (triaje, boxes...).
// Fila A pega su borde inferior al pasillo clinico (y=31); fila B pega su borde
// superior por debajo, de modo que todas tocan el pasillo y son alcanzables.
function emergencyClusterFromProgram(floor: number): PlacedRoom[] {
  const layout: Array<{ tpl: string; x: number; y: number; w: number; h: number }> = [
    { tpl: 'ambulanceBay', x: 64, y: 22, w: 12, h: 9 },
    { tpl: 'triage', x: 77, y: 23, w: 9, h: 8 },
    { tpl: 'resus', x: 87, y: 22, w: 6, h: 9 },
    { tpl: 'edBoxes', x: 64, y: 37, w: 20, h: 12 },
    { tpl: 'edObservation', x: 86, y: 37, w: 7, h: 8 },
  ]
  return layout.map(({ tpl, x, y, w, h }) => programRoom('a4-emergency-configuration', floor, x, y, { templateId: tpl, w, h }))
}

export function createClinicPdfDesignVertical(): HospitalPlan {
  sequence = 0
  const floors = [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8]
  const rooms: PlacedRoom[] = [
    ...circulationBackbone(floors, { clinicalWidth: 5, publicWidth: 7, logisticsWidth: 4 }),
    ...safetyBackbone(floors),

    programRoom('st6-mep-maintenance', -2, 10, 15, { w: 32, h: 16 }),
    programRoom('st1-waste', -2, 64, 18, { w: 22, h: 13 }),
    programRoom('st1-logistics-stores', -2, 10, 36, { w: 30, h: 14 }),

    programRoom('st21-sterilization', -1, 10, 18, { w: 24, h: 13 }),
    programRoom('st22-medication-area', -1, 64, 18, { w: 22, h: 13 }),
    programRoom('a2-consultes-shared', -1, 10, 36, { w: 32, h: 14 }),
    programRoom('st1-linen', -1, 64, 36, { w: 20, h: 12 }),

    programRoom('t2-common-meeting', 0, 10, 15, { w: 34, h: 16 }),
    ...emergencyClusterFromProgram(0),
    programRoom('st1-kitchen-food', 0, 10, 36, { w: 28, h: 13 }),

    programRoom('a1-critical-module', 1, 10, 17, { w: 22, h: 14 }),
    programRoom('a3-surgery-module', 1, 64, 15, { w: 24, h: 16 }),
    programRoom('a1-critical-shared', 1, 10, 36, { w: 30, h: 13 }),
    programRoom('a3-pacu-module', 1, 64, 36, { w: 22, h: 13 }),

    programRoom('a1-hospitalitzacio-module', 2, 10, 13, { w: 34, h: 18 }),
    programRoom('a1-hospitalitzacio-module', 2, 64, 13, { w: 28, h: 18 }),
    programRoom('a1-hospitalitzacio-shared', 2, 10, 36, { w: 32, h: 14 }),

    programRoom('a2-consultes-module', 3, 10, 15, { w: 30, h: 16 }),
    programRoom('a2-day-hospital', 3, 64, 16, { w: 26, h: 15 }),
    programRoom('a1-hospitalitzacio-module', 3, 10, 36, { w: 30, h: 14 }),

    programRoom('a2-day-hospital', 4, 10, 15, { w: 28, h: 16 }),
    programRoom('a2-consultes-module', 4, 64, 16, { w: 26, h: 15 }),
    programRoom('t3-innovation', 4, 10, 36, { w: 30, h: 13 }),

    programRoom('r1-basic-research-unit', 5, 10, 13, { w: 32, h: 18 }),
    programRoom('r2-scientific-platforms', 5, 64, 15, { w: 26, h: 16 }),

    programRoom('d2-crai-library', 6, 10, 13, { w: 32, h: 18 }),
    programRoom('d-simulation-center', 6, 64, 13, { w: 28, h: 18 }),
    programRoom('d-xr-audiovisual', 6, 10, 36, { w: 20, h: 12 }),

    programRoom('d1-theory-teaching', 7, 10, 13, { w: 34, h: 18 }),
    programRoom('d1-insitu-teaching', 7, 64, 15, { w: 26, h: 16 }),

    programRoom('t1-management-office-module', 8, 10, 15, { w: 28, h: 16 }),
    programRoom('st7-it', 8, 64, 17, { w: 24, h: 14 }),
    programRoom('st1-security', 8, 10, 36, { w: 12, h: 8 }),

    ...upperVerticalCores(floors),
  ]
  const plan: HospitalPlan = {
    id: 'clinic-pdf-vertical',
    name: 'Nou Clínic PDF · torre asistencial compacta',
    targetAreaSqm: HOSPITAL_CLINIC_FACTS.newCampus.targetAreaSqm,
    siteAreaSqm: HOSPITAL_CLINIC_FACTS.newCampus.targetAreaSqm,
    floors,
    rooms,
  }
  return { ...plan, rooms: addDefaultDoors(withVerticalConnectorGroups(plan.rooms, floors)) }
}

export function createClinicPdfDesignInstitutes(): HospitalPlan {
  sequence = 0
  const floors = [-2, -1, 0, 1, 2, 3, 4, 5, 6]
  const rooms: PlacedRoom[] = [
    ...circulationBackbone(floors, { clinicalWidth: 5, publicWidth: 8, logisticsWidth: 4 }),
    ...safetyBackbone(floors),

    programRoom('st1-logistics-stores', -2, 10, 17, { w: 28, h: 14 }),
    programRoom('st1-kitchen-food', -2, 64, 18, { w: 26, h: 13 }),
    programRoom('st6-mep-maintenance', -2, 10, 36, { w: 26, h: 13 }),
    programRoom('st1-waste', -2, 64, 36, { w: 18, h: 12 }),

    programRoom('st21-sterilization', -1, 10, 18, { w: 22, h: 13 }),
    programRoom('a2-consultes-shared', -1, 64, 16, { w: 28, h: 15 }),
    programRoom('st22-medication-area', -1, 10, 36, { w: 22, h: 13 }),
    programRoom('st7-it', -1, 64, 36, { w: 20, h: 12 }),

    programRoom('t2-common-meeting', 0, 10, 15, { w: 30, h: 16 }),
    ...emergencyClusterFromProgram(0),
    programRoom('a2-day-hospital', 0, 10, 36, { w: 26, h: 13 }),

    programRoom('a3-surgery-module', 1, 10, 15, { w: 24, h: 16 }),
    programRoom('a3-pacu-module', 1, 64, 17, { w: 22, h: 14 }),
    programRoom('a1-critical-module', 1, 10, 36, { w: 22, h: 13 }),
    programRoom('a1-critical-shared', 1, 64, 36, { w: 28, h: 13 }),

    programRoom('a1-hospitalitzacio-module', 2, 10, 13, { w: 32, h: 18 }),
    programRoom('a2-consultes-module', 2, 64, 15, { w: 28, h: 16 }),
    programRoom('a1-hospitalitzacio-shared', 2, 10, 36, { w: 30, h: 14 }),

    programRoom('a1-hospitalitzacio-module', 3, 10, 13, { w: 32, h: 18 }),
    programRoom('a2-consultes-module', 3, 64, 15, { w: 28, h: 16 }),
    programRoom('a2-day-hospital', 3, 10, 36, { w: 28, h: 13 }),

    programRoom('r1-basic-research-unit', 4, 10, 13, { w: 30, h: 18 }),
    programRoom('r2-scientific-platforms', 4, 64, 15, { w: 26, h: 16 }),
    programRoom('t3-innovation', 4, 10, 36, { w: 30, h: 13 }),

    programRoom('d1-theory-teaching', 5, 10, 13, { w: 34, h: 18 }),
    programRoom('d-simulation-center', 5, 64, 13, { w: 28, h: 18 }),
    programRoom('d-xr-audiovisual', 5, 10, 36, { w: 20, h: 12 }),

    programRoom('d2-crai-library', 6, 10, 13, { w: 32, h: 18 }),
    programRoom('d1-insitu-teaching', 6, 64, 15, { w: 26, h: 16 }),
    programRoom('t1-management-office-module', 6, 10, 36, { w: 26, h: 13 }),

    ...upperVerticalCores(floors),
  ]
  const plan: HospitalPlan = {
    id: 'clinic-pdf-institutes',
    name: 'Nou Clínic PDF · institutos distribuidos',
    targetAreaSqm: HOSPITAL_CLINIC_FACTS.newCampus.targetAreaSqm,
    siteAreaSqm: HOSPITAL_CLINIC_FACTS.newCampus.targetAreaSqm,
    floors,
    rooms,
  }
  return { ...plan, rooms: addDefaultDoors(withVerticalConnectorGroups(plan.rooms, floors)) }
}
