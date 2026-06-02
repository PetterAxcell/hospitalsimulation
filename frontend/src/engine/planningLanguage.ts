import { parse as parseYaml } from 'yaml'
import { ROOM_TEMPLATES, templateById } from '../data/catalog'
import { addDefaultDoors } from './circulation'
import { areaSqmForDimensions, clampRoom } from './geometry'
import type { HospitalPlan, PlacedRoom, RoomTemplate } from '../types'

export type PlanningDiagnosticLevel = 'error' | 'warning'

export interface PlanningDiagnostic {
  level: PlanningDiagnosticLevel
  line: number
  message: string
}

export interface PlanningLanguageResult {
  plan: HospitalPlan
  diagnostics: PlanningDiagnostic[]
  appliedLines: number
}

interface ScriptState {
  plan: HospitalPlan
  rooms: PlacedRoom[]
  diagnostics: PlanningDiagnostic[]
  appliedLines: number
  sequence: number
}

const TEMPLATE_ALIASES: Record<string, string> = {
  ambulance: 'ambulanceBay',
  ambulances: 'ambulanceBay',
  bay: 'ambulanceBay',
  boxes: 'edBoxes',
  clinical: 'clinicalCorridor',
  command: 'commandCenter',
  core: 'verticalCore',
  courtyard: 'healingCourtyard',
  ed: 'edBoxes',
  emergency_stair: 'emergencyStairCore',
  fire: 'fireCompartment',
  hall: 'mainHall',
  icu: 'icu',
  lab: 'coreLab',
  logistics: 'logisticsCorridor',
  mep: 'criticalMep',
  observation: 'edObservation',
  or: 'operatingBlock',
  pacu: 'pacu',
  pharmacy: 'pharmacy',
  public: 'publicCorridor',
  refuge: 'horizontalRefuge',
  resus: 'resus',
  stair: 'emergencyStairCore',
  triage: 'triage',
  vertical: 'verticalCore',
  waiting: 'publicWaiting',
  ward: 'ward',
}

export const DEFAULT_PLANNING_SCRIPT = `plan:
  name: Hospital script 290.000 m2
  target: 290000
  site: 210000
  floors: [S1, PB, P1, P2, P3, P4, P5, P6, P7, P8]
clear: true

corridors:
  - template: clinical
    floor: PB
    at: [0, 31]
    size: [100, 7]
    name: Pasillo clinico principal
  - template: public
    floor: PB
    at: [47, 0]
    size: [9, 70]
    name: Pasillo publico vertical
  - template: logistics
    floor: PB
    at: [0, 58]
    size: [100, 5]
    name: Pasillo logistico

rooms:
  - template: hall
    floor: PB
    at: [8, 28]
    size: [18, 20]
  - template: waiting
    floor: PB
    at: [26, 42]
    size: [20, 12]
  - template: ambulances
    floor: PB
    at: [74, 15]
    size: [15, 11]
  - template: triage
    floor: PB
    at: [58, 17]
    size: [11, 8]
  - template: resus
    floor: PB
    at: [68, 28]
    size: [14, 10]
  - template: boxes
    floor: PB
    at: [47, 27]
    size: [21, 16]
  - template: observation
    floor: PB
    at: [47, 45]
    size: [19, 11]
  - template: imaging
    floor: PB
    at: [42, 14]
    size: [16, 11]

verticals:
  - template: core
    floors: S1..P8
    at: [50, 20]
    size: [8, 8]
    group: asc-core-central
    name: Nucleo vertical central`

export function compilePlanningScript(source: string, basePlan: HospitalPlan): PlanningLanguageResult {
  if (!looksLikeYaml(source)) {
    const state = createScriptState(basePlan)
    return {
      plan: state.plan,
      diagnostics: [{
        level: 'error',
        line: 1,
        message: 'El planificador solo acepta plantillas YAML con claves como plan, clear, rooms, corridors o verticals.',
      }],
      appliedLines: 0,
    }
  }

  return compileStructuredTemplate(source, basePlan)
}

function compileStructuredTemplate(source: string, basePlan: HospitalPlan): PlanningLanguageResult {
  const state = createScriptState(basePlan)
  let document: unknown

  try {
    document = parseYaml(source)
  } catch (error) {
    return {
      plan: state.plan,
      diagnostics: [{
        level: 'error',
        line: 1,
        message: error instanceof Error ? error.message : String(error),
      }],
      appliedLines: 0,
    }
  }

  try {
    const root = requireRecord(document, 'La plantilla YAML debe ser un objeto')
    const planConfig = asRecord(root.plan)

    if (planConfig) {
      const name = optionalString(planConfig.name)
      const target = optionalNumber(planConfig.target ?? planConfig.targetAreaSqm)
      const site = optionalNumber(planConfig.site ?? planConfig.siteAreaSqm)
      const floors = floorTokensFromValue(planConfig.floors)
      if (name) state.plan.name = name
      if (target !== undefined) state.plan.targetAreaSqm = target
      if (site !== undefined) state.plan.siteAreaSqm = site
      if (floors.length > 0) {
        state.plan.floors = parseFloorList(floors, state.plan.floors)
        state.rooms = state.rooms.filter((room) => state.plan.floors.includes(room.floor))
      }
      state.appliedLines += 1
    }

    if (root.clear === true) {
      state.rooms = []
      state.appliedLines += 1
    }

    for (const item of listFromValue(root.corridors)) {
      state.rooms.push(roomFromStructuredEntry(item, state, 'corridor'))
      state.appliedLines += 1
    }

    for (const item of listFromValue(root.rooms)) {
      state.rooms.push(roomFromStructuredEntry(item, state, 'room'))
      state.appliedLines += 1
    }

    for (const item of listFromValue(root.verticals)) {
      state.rooms.push(...verticalsFromStructuredEntry(item, state))
      state.appliedLines += 1
    }
  } catch (error) {
    state.diagnostics.push({
      level: 'error',
      line: 1,
      message: error instanceof Error ? error.message : String(error),
    })
  }

  return finishResult(state)
}

function createScriptState(basePlan: HospitalPlan): ScriptState {
  return {
    plan: clonePlan(basePlan),
    rooms: basePlan.rooms.map((room) => ({ ...room, doors: room.doors?.map((door) => ({ ...door })) })),
    diagnostics: [],
    appliedLines: 0,
    sequence: 0,
  }
}

function finishResult(state: ScriptState): PlanningLanguageResult {
  const rooms = addDefaultDoors(state.rooms.map(clampRoom))
  return {
    plan: {
      ...state.plan,
      id: state.plan.id || 'script-plan',
      rooms,
    },
    diagnostics: state.diagnostics,
    appliedLines: state.appliedLines,
  }
}

function roomFromStructuredEntry(value: unknown, state: ScriptState, command: 'room' | 'corridor'): PlacedRoom {
  const item = requireRecord(value, `${command} debe ser un objeto`)
  const template = resolveTemplate(requiredString(item.template, `${command}.template`), command)
  const floor = parseFloor(requiredString(item.floor, `${command}.floor`))
  const at = pairFromValue(item.at, `${command}.at`)
  const size = pairFromValue(item.size, `${command}.size`)
  const id = optionalString(item.id)
  const name = optionalString(item.name)
  const capacity = optionalNumber(item.capacity)

  if (!state.plan.floors.includes(floor)) {
    state.plan.floors = [...state.plan.floors, floor].sort((a, b) => a - b)
  }

  return buildRoom({
    template,
    floor,
    x: at[0],
    y: at[1],
    w: size[0],
    h: size[1],
    id: id ?? `${template.id}-yaml-${state.sequence += 1}`,
    name,
    capacity,
  })
}

function verticalsFromStructuredEntry(value: unknown, state: ScriptState): PlacedRoom[] {
  const item = requireRecord(value, 'vertical debe ser un objeto')
  const template = resolveTemplate(requiredString(item.template, 'vertical.template'), 'vertical')
  const floors = parseFloorList(floorTokensFromValue(item.floors), state.plan.floors)
  const at = pairFromValue(item.at, 'vertical.at')
  const size = pairFromValue(item.size, 'vertical.size')
  const group = optionalString(item.group) ?? `${template.id}-yaml-${state.sequence += 1}`
  const name = optionalString(item.name)

  if (floors.length === 0) throw new Error('vertical.floors necesita al menos una planta')
  for (const floor of floors) {
    if (!state.plan.floors.includes(floor)) state.plan.floors.push(floor)
  }
  state.plan.floors = [...new Set(state.plan.floors)].sort((a, b) => a - b)

  return floors.map((floor) => buildRoom({
    template,
    floor,
    x: at[0],
    y: at[1],
    w: size[0],
    h: size[1],
    id: `${template.id}-${sanitizeId(group)}-${floor}`,
    name: name ? `${name} ${formatFloorLabel(floor)}` : undefined,
    verticalGroupId: group,
    servesFloors: floors,
  }))
}

function looksLikeYaml(source: string): boolean {
  return /^\s*(plan|target|site|floors|clear|rooms|corridors|verticals)\s*:/m.test(source)
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  const record = asRecord(value)
  if (!record) throw new Error(message)
  return record
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function requiredString(value: unknown, label: string): string {
  const text = optionalString(value)
  if (!text) throw new Error(`${label} necesita texto`)
  return text
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return String(value)
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(String(value).replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Numero no valido: ${value}`)
  return parsed
}

function pairFromValue(value: unknown, label: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label} necesita [x, y]`)
  return [parsePositiveNumber(String(value[0]), label), parsePositiveNumber(String(value[1]), label)]
}

function floorTokensFromValue(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.flatMap((item) => floorTokensFromValue(item))
  return String(value).split(/[\s,]+/).filter(Boolean)
}

function listFromValue(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('Las listas YAML deben ser arrays')
  return value
}

function buildRoom({
  template,
  floor,
  x,
  y,
  w,
  h,
  id,
  name,
  capacity,
  verticalGroupId,
  servesFloors,
}: {
  template: RoomTemplate
  floor: number
  x: number
  y: number
  w: number
  h: number
  id: string
  name?: string
  capacity?: number
  verticalGroupId?: string
  servesFloors?: number[]
}): PlacedRoom {
  return clampRoom({
    id,
    templateId: template.id,
    name: name ?? template.name,
    kind: template.kind,
    floor,
    x,
    y,
    w,
    h,
    capacity: capacity ?? template.defaultCapacity,
    areaSqm: areaSqmForDimensions(w, h),
    equipment: template.equipment,
    staffModel: template.staffModel,
    simulationNode: template.simulationNode,
    verticalGroupId,
    servesFloors,
  })
}

function resolveTemplate(rawTemplateId: string, command: string): RoomTemplate {
  const templateId = TEMPLATE_ALIASES[rawTemplateId] ?? rawTemplateId
  const template = ROOM_TEMPLATES.find((item) => item.id === templateId)
  if (!template) {
    templateById(templateId)
  }
  const resolved = templateById(templateId)
  if (command === 'corridor' && resolved.kind !== 'circulation') {
    throw new Error(`corridor espera una plantilla de pasillo, recibido ${rawTemplateId}`)
  }
  if (command === 'vertical' && resolved.kind !== 'vertical') {
    throw new Error(`vertical espera una plantilla vertical, recibido ${rawTemplateId}`)
  }
  return resolved
}

function parseFloorList(tokens: string[], currentFloors: number[]): number[] {
  const floors = tokens.flatMap((token) => {
    if (token.toLowerCase() === 'all') return currentFloors
    if (token.includes('..')) {
      const [startRaw, endRaw] = token.split('..')
      const start = parseFloor(startRaw)
      const end = parseFloor(endRaw)
      const direction = start <= end ? 1 : -1
      const range: number[] = []
      for (let floor = start; direction > 0 ? floor <= end : floor >= end; floor += direction) {
        range.push(floor)
      }
      return range
    }
    return [parseFloor(token)]
  })
  return [...new Set(floors)].sort((a, b) => a - b)
}

function parseFloor(raw: string): number {
  const normalized = raw.trim().toUpperCase()
  if (normalized === 'PB' || normalized === 'G' || normalized === '0') return 0
  if (/^S\d+$/.test(normalized)) return -Number(normalized.slice(1))
  if (/^P\d+$/.test(normalized)) return Number(normalized.slice(1))
  const numeric = Number(normalized)
  if (Number.isFinite(numeric)) return Math.round(numeric)
  throw new Error(`Planta no reconocida: ${raw}`)
}

function parsePositiveNumber(raw: string | undefined, label: string): number {
  if (!raw) throw new Error(`${label} necesita un valor numerico`)
  const value = Number(raw.replace(',', '.'))
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} no es un numero valido: ${raw}`)
  return value
}

function clonePlan(plan: HospitalPlan): HospitalPlan {
  return {
    ...plan,
    floors: [...plan.floors],
    rooms: plan.rooms.map((room) => ({ ...room, doors: room.doors?.map((door) => ({ ...door })) })),
  }
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'group'
}

function formatFloorLabel(floor: number): string {
  if (floor === 0) return 'PB'
  if (floor < 0) return `S${Math.abs(floor)}`
  return `P${floor}`
}
