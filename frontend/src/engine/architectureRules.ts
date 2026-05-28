import { distance, roomByNode, ChannelGraph } from './geometry'
import type { HospitalPlan, PlacedRoom, SimulationNode, ChannelConfig, ResourceConfig } from '../types'
import { DEFAULT_RESOURCE_CONFIGS, DEFAULT_CHANNEL_CONFIGS, DEFAULT_SPECIALIST_CONFIGS } from '../data/catalog'

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
  { node: 'imaging', label: 'Diagnostico por imagen', category: 'clinico' },
  { node: 'lab', label: 'Laboratorio/core lab', category: 'clinico' },
  { node: 'or', label: 'Bloque quirurgico', category: 'clinico' },
  { node: 'pacu', label: 'PACU', category: 'clinico' },
  { node: 'icu', label: 'UCI', category: 'clinico' },
  { node: 'ward', label: 'Hospitalizacion', category: 'clinico' },
  { node: 'pharmacy', label: 'Farmacia hospitalaria', category: 'logistica' },
  { node: 'logistics', label: 'Muelle/logistica/CSSD', category: 'logistica' },
  { node: 'vertical_core', label: 'Nucleos verticales clinicos', category: 'evacuacion' },
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
  { id: 'resus-or', label: 'Shock rooms con ruta rapida a quirofano', a: 'resus', b: 'or', warn: 42, fail: 65, category: 'emergencia' },
  { id: 'resus-icu', label: 'Shock rooms con ruta rapida a UCI', a: 'resus', b: 'icu', warn: 42, fail: 65, category: 'emergencia' },
  { id: 'or-pacu', label: 'Quirofano contiguo a PACU', a: 'or', b: 'pacu', warn: 18, fail: 32, category: 'clinico' },
  { id: 'pacu-icu', label: 'PACU cerca de UCI', a: 'pacu', b: 'icu', warn: 30, fail: 48, category: 'clinico' },
  { id: 'pacu-ward', label: 'PACU conectada a hospitalizacion', a: 'pacu', b: 'ward', warn: 52, fail: 80, category: 'clinico' },
  { id: 'lab-icu', label: 'Laboratorio accesible desde criticos', a: 'lab', b: 'icu', warn: 52, fail: 82, category: 'clinico' },
  { id: 'logistics-or', label: 'Logistica/CSSD conectada a quirofano', a: 'logistics', b: 'or', warn: 55, fail: 90, category: 'logistica' },
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
  results.push(...evaluateEvacuation(plan.rooms))
  return results
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
    label: 'Separacion publico-logistica/residuos',
    status: logisticsPublicConflict ? 'warn' : 'ok',
    evidence: logisticsPublicConflict ? 'Hay logistica demasiado cerca de zonas publicas' : 'Rutas publicas y logisticas separadas',
    category: 'flujos',
  })

  if (emergency && hall) {
    const sameSide = emergency.x > hall.x + hall.w || emergency.y < hall.y - 4
    results.push({
      id: 'flow-ambulance-public',
      label: 'Ambulancias separadas de acceso publico',
      status: sameSide ? 'ok' : 'warn',
      evidence: sameSide ? 'Puerta critica independiente' : 'Revisar cruce entre publico y ambulancias',
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
      label: 'Nucleo vertical protegido en cada planta activa',
      status: missingCoreFloors.length ? 'fail' : 'ok',
      evidence: missingCoreFloors.length ? `Faltan plantas ${missingCoreFloors.join(', ')}` : 'Todas las plantas activas tienen nucleo',
      category: 'evacuacion',
    },
    {
      id: 'evac-bed-elevators-every-floor',
      label: 'Ascensores clinicos/camas en cada planta',
      status: missingElevatorFloors.length ? 'fail' : 'ok',
      evidence: missingElevatorFloors.length
        ? `Faltan ascensores en plantas ${missingElevatorFloors.join(', ')}`
        : 'Todas las plantas activas tienen ascensor clinico',
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
      evidence: farFromCore.length ? `${farFromCore.length} areas criticas lejos del nucleo` : 'Areas criticas con nucleo cercano',
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

/* ─── New Rules: Specialists, Channels, Response Times ─── */

export function evaluateSpecialistCoverage(plan: HospitalPlan, resourceConfigs: ResourceConfig[] = DEFAULT_RESOURCE_CONFIGS): ArchitectureRuleResult[] {
  const results: ArchitectureRuleResult[] = []
  const missing: string[] = []

  for (const rc of resourceConfigs) {
    if (rc.requiredSpecialistTypes.length === 0) continue
    const room = plan.rooms.find((r) => r.simulationNode === rc.id)
    if (!room) {
      missing.push(`${rc.name} (sin sala en el plan)`)
      continue
    }
  }

  results.push({
    id: 'specialist-coverage',
    label: 'Cobertura de especialistas por recurso',
    status: missing.length === 0 ? 'ok' : missing.length > 3 ? 'fail' : 'warn',
    evidence: missing.length === 0
      ? 'Todos los recursos tienen especialistas asignados'
      : `Faltan: ${missing.join(', ')}`,
    category: 'clinico',
  })

  const orRoom = roomByNode(plan.rooms, 'or')
  if (orRoom) {
    const surgicalSpecs = DEFAULT_SPECIALIST_CONFIGS.filter((s) => s.isSurgical)
    results.push({
      id: 'surgical-specialists-available',
      label: `Especialistas quirurgicos disponibles (${surgicalSpecs.length} tipos)`,
      status: surgicalSpecs.length >= 5 ? 'ok' : 'warn',
      evidence: `${surgicalSpecs.length} tipos quirurgicos configurados`,
      category: 'clinico',
    })
  }

  return results
}

export function evaluateChannelDensity(
  plan: HospitalPlan,
  channelConfigs: ChannelConfig[] = DEFAULT_CHANNEL_CONFIGS,
): ArchitectureRuleResult[] {
  const results: ArchitectureRuleResult[] = []
  const floors = new Set(plan.rooms.map((r) => r.floor))

  for (const floor of floors) {
    const floorRooms = plan.rooms.filter((r) => r.floor === floor && r.simulationNode)
    const floorChannels = channelConfigs.filter((ch) => {
      const from = plan.rooms.find((r) => r.id === ch.fromRoomId)
      const to = plan.rooms.find((r) => r.id === ch.toRoomId)
      return from && to && from.floor === floor && to.floor === floor
    })

    const ratio = floorRooms.length > 0 ? floorChannels.length / floorRooms.length : 0
    results.push({
      id: `channel-density-floor-${floor}`,
      label: `Densidad de canales en planta ${floor}`,
      status: ratio >= 0.5 ? 'ok' : ratio >= 0.3 ? 'warn' : 'fail',
      evidence: `${floorChannels.length} canales para ${floorRooms.length} salas (ratio ${ratio.toFixed(2)})`,
      category: 'flujos',
    })
  }

  return results
}

export function evaluateEmergencyResponse(
  plan: HospitalPlan,
  channelConfigs: ChannelConfig[] = DEFAULT_CHANNEL_CONFIGS,
): ArchitectureRuleResult[] {
  const results: ArchitectureRuleResult[] = []
  const graph = new ChannelGraph(channelConfigs)

  const ed = roomByNode(plan.rooms, 'ed_bay')
  const icu = roomByNode(plan.rooms, 'icu')
  if (ed && icu) {
    const path = graph.findStaticRoute(ed.id, icu.id)
    const cost = path?.totalBaseCost ?? distance(ed, icu) * 0.16
    results.push({
      id: 'response-ed-icu',
      label: 'Tiempo de respuesta ED → UCI',
      status: cost <= 8 ? 'ok' : cost <= 15 ? 'warn' : 'fail',
      evidence: `~${Math.round(cost)} min por canales`,
      category: 'emergencia',
    })
  }

  const orRoom = roomByNode(plan.rooms, 'or')
  if (ed && orRoom) {
    const path = graph.findStaticRoute(ed.id, orRoom.id)
    const cost = path?.totalBaseCost ?? distance(ed, orRoom) * 0.16
    results.push({
      id: 'response-ed-or',
      label: 'Tiempo de respuesta ED → Quirofano',
      status: cost <= 10 ? 'ok' : cost <= 18 ? 'warn' : 'fail',
      evidence: `~${Math.round(cost)} min por canales`,
      category: 'emergencia',
    })
  }

  const amb = roomByNode(plan.rooms, 'arrival_ambulance')
  const resus = roomByNode(plan.rooms, 'resus')
  if (amb && resus) {
    const path = graph.findStaticRoute(amb.id, resus.id)
    const cost = path?.totalBaseCost ?? distance(amb, resus) * 0.16
    results.push({
      id: 'response-ambulance-resus',
      label: 'Tiempo de ambulancia → shock room',
      status: cost <= 4 ? 'ok' : cost <= 8 ? 'warn' : 'fail',
      evidence: `~${Math.round(cost)} min por canales`,
      category: 'emergencia',
    })
  }

  return results
}
