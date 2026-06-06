import { disconnectedPassages, disconnectedPatientRooms } from './circulation'
import { distance, roomByNode } from './geometry'
import type { HospitalPlan, PlacedRoom, SimulationNode } from '../types'

export type RuleStatus = 'ok' | 'warn' | 'fail'

export interface ArchitectureRuleResult {
  id: string
  label: string
  status: RuleStatus
  evidence: string
  category: 'emergencia' | 'flujos' | 'evacuacion' | 'clinico' | 'logistica' | 'resiliencia'
}

interface RequiredNode {
  node: SimulationNode
  label: string
  category: ArchitectureRuleResult['category']
}

const REQUIRED_NODES: RequiredNode[] = [
  { node: 'arrival_ambulance', label: 'Bahia cubierta de ambulancias', category: 'emergencia' },
  { node: 'triage', label: 'Triaje ED', category: 'emergencia' },
  { node: 'resus', label: 'Shock rooms / reanimacion ED', category: 'emergencia' },
  { node: 'ed_bay', label: 'Boxes de urgencias', category: 'emergencia' },
  { node: 'imaging', label: 'Diagnóstico por imagen', category: 'clinico' },
  { node: 'lab', label: 'Laboratorio/core lab', category: 'clinico' },
  { node: 'or', label: 'Bloque quirúrgico', category: 'clinico' },
  { node: 'pacu', label: 'PACU', category: 'clinico' },
  { node: 'icu', label: 'UCI', category: 'clinico' },
  { node: 'ward', label: 'Hospitalización', category: 'clinico' },
  { node: 'pharmacy', label: 'Farmacia hospitalaria', category: 'logistica' },
  { node: 'logistics', label: 'Muelle/logistica/CSSD', category: 'logistica' },
  { node: 'vertical_core', label: 'Ascensores clínicos y montacargas', category: 'evacuacion' },
  { node: 'emergency_stair', label: 'Escaleras protegidas/de emergencia', category: 'evacuacion' },
  { node: 'refuge_area', label: 'Refugios de evacuacion horizontal', category: 'evacuacion' },
  { node: 'fire_sector', label: 'Sectorizacion PCI y control de humo', category: 'evacuacion' },
]

const ADJACENCY_RULES: Array<{
  id: string
  label: string
  a: SimulationNode
  b: SimulationNode
  warn: number
  fail: number
  category: ArchitectureRuleResult['category']
}> = [
  { id: 'ed-imaging', label: 'Urgencias cerca de imagen', a: 'ed_bay', b: 'imaging', warn: 34, fail: 55, category: 'clinico' },
  { id: 'resus-or', label: 'Shock rooms con ruta rápida a quirófano', a: 'resus', b: 'or', warn: 42, fail: 65, category: 'emergencia' },
  { id: 'resus-icu', label: 'Shock rooms con ruta rápida a UCI', a: 'resus', b: 'icu', warn: 42, fail: 65, category: 'emergencia' },
  { id: 'or-pacu', label: 'Quirófano contiguo a PACU', a: 'or', b: 'pacu', warn: 18, fail: 32, category: 'clinico' },
  { id: 'pacu-icu', label: 'PACU cerca de UCI', a: 'pacu', b: 'icu', warn: 30, fail: 48, category: 'clinico' },
  { id: 'pacu-ward', label: 'PACU conectada a hospitalización', a: 'pacu', b: 'ward', warn: 52, fail: 80, category: 'clinico' },
  { id: 'lab-icu', label: 'Laboratorio accesible desde críticos', a: 'lab', b: 'icu', warn: 52, fail: 82, category: 'clinico' },
  { id: 'logistics-or', label: 'Logística/CSSD conectada a quirófano', a: 'logistics', b: 'or', warn: 55, fail: 90, category: 'logistica' },
]

export function evaluateArchitectureRules(plan: HospitalPlan): ArchitectureRuleResult[] {
  const results: ArchitectureRuleResult[] = []
  for (const required of REQUIRED_NODES) {
    const room = roomByNode(plan.rooms, required.node)
    results.push({
      id: `required-${required.node}`,
      label: required.label,
      status: room ? 'ok' : 'fail',
      evidence: room ? `${room.name}, planta ${room.floor}` : 'No esta colocado en el plan',
      category: required.category,
    })
  }

  for (const rule of ADJACENCY_RULES) {
    const a = roomByNode(plan.rooms, rule.a)
    const b = roomByNode(plan.rooms, rule.b)
    if (!a || !b) {
      results.push({
        id: rule.id,
        label: rule.label,
        status: 'fail',
        evidence: 'Falta uno de los nodos',
        category: rule.category,
      })
      continue
    }
    const value = Math.round(distance(a, b))
    results.push({
      id: rule.id,
      label: rule.label,
      status: value >= rule.fail ? 'fail' : value >= rule.warn ? 'warn' : 'ok',
      evidence: `${value} unidades ponderadas`,
      category: rule.category,
    })
  }

  results.push(...evaluateFlowSeparation(plan.rooms))
  results.push(evaluateCorridorAccess(plan.rooms))
  results.push(evaluatePassageContinuity(plan.rooms))
  results.push(...evaluateEvacuation(plan.rooms))
  results.push(...evaluateVerticalConnectorGroups(plan.rooms))
  return results
}

function evaluateCorridorAccess(rooms: PlacedRoom[]): ArchitectureRuleResult {
  const disconnected = disconnectedPatientRooms(rooms)
  const sample = disconnected.slice(0, 4).map((room) => room.name).join(', ')
  return {
    id: 'flow-corridor-access',
    label: 'Bloques conectados a pasillos',
    status: disconnected.length ? 'fail' : 'ok',
    evidence: disconnected.length
      ? `${disconnected.length} bloques sin puerta a pasillo: ${sample}${disconnected.length > 4 ? '...' : ''}`
      : 'Todos los bloques operativos tienen puerta física a pasillo; los conectores verticales enlazan plantas desde esa red',
    category: 'flujos',
  }
}

function evaluatePassageContinuity(rooms: PlacedRoom[]): ArchitectureRuleResult {
  const disconnected = disconnectedPassages(rooms)
  const sample = disconnected.slice(0, 4).map((room) => `${room.name} ${room.floor}`).join(', ')
  return {
    id: 'flow-passage-continuity',
    label: 'Red de circulación conectada',
    status: disconnected.length ? 'fail' : 'ok',
    evidence: disconnected.length
      ? `${disconnected.length} elementos fuera de la red principal: ${sample}${disconnected.length > 4 ? '...' : ''}`
      : 'Pasillos, escaleras y núcleos verticales pertenecen a una red de circulación conectada',
    category: 'flujos',
  }
}

function evaluateFlowSeparation(rooms: PlacedRoom[]): ArchitectureRuleResult[] {
  const publicRooms = rooms.filter((room) => room.kind === 'public' || room.kind === 'waiting')
  const logisticsRooms = rooms.filter((room) => room.kind === 'logistics')
  const emergency = roomByNode(rooms, 'arrival_ambulance')
  const hall = roomByNode(rooms, 'registration')
  const results: ArchitectureRuleResult[] = []

  const logisticsPublicConflict = logisticsRooms.some((logistics) =>
    publicRooms.some((publicRoom) => logistics.floor === publicRoom.floor && distance(logistics, publicRoom) < 22),
  )
  results.push({
    id: 'flow-public-logistics',
    label: 'Separación público-logística/residuos',
    status: logisticsPublicConflict ? 'warn' : 'ok',
    evidence: logisticsPublicConflict ? 'Hay logística demasiado cerca de zonas públicas' : 'Rutas públicas y logísticas separadas',
    category: 'flujos',
  })

  if (emergency && hall) {
    const sameSide = emergency.x > hall.x + hall.w || emergency.y < hall.y - 4
    results.push({
      id: 'flow-ambulance-public',
      label: 'Ambulancias separadas de acceso público',
      status: sameSide ? 'ok' : 'warn',
      evidence: sameSide ? 'Puerta crítica independiente' : 'Revisar cruce entre público y ambulancias',
      category: 'flujos',
    })
  }

  return results
}

function evaluateEvacuation(rooms: PlacedRoom[]): ArchitectureRuleResult[] {
  const cores = rooms.filter((room) => room.simulationNode === 'vertical_core')
  const elevatorCores = cores.filter((room) => room.equipment.includes('elevator'))
  const emergencyStairs = rooms.filter((room) => room.simulationNode === 'emergency_stair')
  const refugeAreas = rooms.filter((room) => room.simulationNode === 'refuge_area')
  const fireSectors = rooms.filter((room) => room.simulationNode === 'fire_sector')
  const floors = new Set(rooms.map((room) => room.floor))
  const floorsWithCore = new Set(cores.map((room) => room.floor))
  const floorsWithElevator = new Set(elevatorCores.map((room) => room.floor))
  const floorsWithEmergencyStair = new Set(emergencyStairs.map((room) => room.floor))
  const floorsWithRefuge = new Set(refugeAreas.map((room) => room.floor))
  const floorsWithFireSector = new Set(fireSectors.map((room) => room.floor))
  const missingCoreFloors = [...floors].filter((floor) => !floorsWithCore.has(floor))
  const missingElevatorFloors = [...floors].filter((floor) => !floorsWithElevator.has(floor))
  const missingEmergencyStairFloors = [...floors].filter((floor) => !floorsWithEmergencyStair.has(floor))
  const highCareRooms = rooms.filter((room) => ['critical', 'surgery', 'inpatient', 'emergency', 'maternalChild'].includes(room.kind))
  const patientCareFloors = [...new Set(highCareRooms.map((room) => room.floor))]
  const floorsWithoutTwoStairs = patientCareFloors.filter((floor) => emergencyStairs.filter((stair) => stair.floor === floor).length < 2)
  const floorsWithoutRefuge = patientCareFloors.filter((floor) => !floorsWithRefuge.has(floor))
  const floorsWithoutFireSector = patientCareFloors.filter((floor) => !floorsWithFireSector.has(floor))
  const farFromCore = highCareRooms.filter((room) => cores.some((core) => core.floor === room.floor) && nearestCoreDistance(room, cores) > 44)

  return [
    {
      id: 'evac-core-every-floor',
      label: 'Ascensores/montacargas en cada planta activa',
      status: missingCoreFloors.length ? 'fail' : 'ok',
      evidence: missingCoreFloors.length ? `Faltan plantas ${missingCoreFloors.join(', ')}` : 'Todas las plantas activas tienen conexion vertical',
      category: 'evacuacion',
    },
    {
      id: 'evac-bed-elevators-every-floor',
      label: 'Ascensores clínicos/camas en cada planta',
      status: missingElevatorFloors.length ? 'fail' : 'ok',
      evidence: missingElevatorFloors.length
        ? `Faltan ascensores en plantas ${missingElevatorFloors.join(', ')}`
        : 'Todas las plantas activas tienen ascensor clínico',
      category: 'evacuacion',
    },
    {
      id: 'evac-emergency-stairs-every-floor',
      label: 'Escaleras protegidas en cada planta',
      status: missingEmergencyStairFloors.length ? 'fail' : 'ok',
      evidence: missingEmergencyStairFloors.length
        ? `Faltan escaleras en plantas ${missingEmergencyStairFloors.join(', ')}`
        : 'Todas las plantas activas tienen escalera protegida',
      category: 'evacuacion',
    },
    {
      id: 'evac-two-independent-stairs',
      label: 'Dos rutas verticales independientes en plantas asistenciales',
      status: floorsWithoutTwoStairs.length ? 'fail' : 'ok',
      evidence: floorsWithoutTwoStairs.length
        ? `Revisar plantas ${floorsWithoutTwoStairs.join(', ')}`
        : 'Hay al menos dos escaleras por planta asistencial; independencia geometrica pendiente de certificacion',
      category: 'evacuacion',
    },
    {
      id: 'evac-horizontal-progressive',
      label: 'Evacuacion horizontal progresiva',
      status: farFromCore.length ? 'warn' : 'ok',
      evidence: farFromCore.length ? `${farFromCore.length} areas criticas lejos de conectores verticales` : 'Areas criticas con conexion vertical cercana',
      category: 'evacuacion',
    },
    {
      id: 'evac-refuge-every-care-floor',
      label: 'Refugio horizontal en plantas asistenciales',
      status: floorsWithoutRefuge.length ? 'fail' : 'ok',
      evidence: floorsWithoutRefuge.length
        ? `Falta refugio en plantas ${floorsWithoutRefuge.join(', ')}`
        : 'Plantas asistenciales con area de refugio modelada',
      category: 'evacuacion',
    },
    {
      id: 'evac-fire-sector-care-floor',
      label: 'Sectorizacion PCI por planta asistencial',
      status: floorsWithoutFireSector.length ? 'warn' : 'ok',
      evidence: floorsWithoutFireSector.length
        ? `Falta modelar sector PCI en plantas ${floorsWithoutFireSector.join(', ')}`
        : 'Sector PCI modelado en plantas asistenciales',
      category: 'evacuacion',
    },
    {
      id: 'resilience-growth',
      label: 'Reserva de expansion / shell space',
      status: rooms.some((room) => room.kind === 'future') ? 'ok' : 'warn',
      evidence: rooms.some((room) => room.kind === 'future') ? 'Existe reserva de crecimiento' : 'Conviene reservar shell space para crecimiento',
      category: 'resiliencia',
    },
  ]
}

function nearestCoreDistance(room: PlacedRoom, cores: PlacedRoom[]): number {
  const sameFloorCores = cores.filter((core) => core.floor === room.floor)
  return Math.min(...sameFloorCores.map((core) => distance(room, core)))
}

function evaluateVerticalConnectorGroups(rooms: PlacedRoom[]): ArchitectureRuleResult[] {
  const connectors = rooms.filter((room) => room.kind === 'vertical')
  const missingGroup = connectors.filter((room) => !room.verticalGroupId)
  const grouped = connectors.reduce<Record<string, PlacedRoom[]>>((acc, room) => {
    if (!room.verticalGroupId) return acc
    acc[room.verticalGroupId] ??= []
    acc[room.verticalGroupId].push(room)
    return acc
  }, {})

  const results: ArchitectureRuleResult[] = []
  results.push({
    id: 'vertical-connectors-have-groups',
    label: 'Conectores verticales con familia',
    status: missingGroup.length ? 'warn' : 'ok',
    evidence: missingGroup.length
      ? `${missingGroup.length} conectores sin familia vertical especificada`
      : 'Ascensores y escaleras tienen familia vertical',
    category: 'evacuacion',
  })

  Object.entries(grouped).forEach(([groupId, groupRooms]) => {
    const expectedFloors = servedFloorsForGroup(groupRooms)
    const floorsWithRoom = new Set(groupRooms.map((room) => room.floor))
    const missingFloors = expectedFloors.filter((floor) => !floorsWithRoom.has(floor))
    const misaligned = groupRooms.filter((room) => !sameFootprint(groupRooms[0], room))
    results.push({
      id: `vertical-group-${groupId}`,
      label: `Familia vertical ${groupId}`,
      status: missingFloors.length || misaligned.length ? 'fail' : 'ok',
      evidence: missingFloors.length
        ? `Faltan piezas en plantas ${missingFloors.join(', ')}`
        : misaligned.length
          ? `${misaligned.length} piezas no mantienen posicion/tamano`
          : `Alineado en plantas ${expectedFloors.join(', ')}`,
      category: 'evacuacion',
    })
  })

  return results
}

function servedFloorsForGroup(rooms: PlacedRoom[]): number[] {
  const served = new Set<number>()
  rooms.forEach((room) => {
    if (room.servesFloors?.length) room.servesFloors.forEach((floor) => served.add(floor))
    else served.add(room.floor)
  })
  return [...served].sort((a, b) => a - b)
}

function sameFootprint(a: PlacedRoom, b: PlacedRoom): boolean {
  return Math.abs(a.x - b.x) < 0.7
    && Math.abs(a.y - b.y) < 0.7
    && Math.abs(a.w - b.w) < 0.7
    && Math.abs(a.h - b.h) < 0.7
}
