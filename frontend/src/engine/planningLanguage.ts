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

export const DEFAULT_PLANNING_SCRIPT = `plan "Hospital script 290.000 m2"
target 290000
site 210000
floors S1 PB P1 P2 P3 P4 P5 P6 P7 P8
clear

# Circulacion base
corridor clinical floor PB at 0 31 size 100 7 name "Pasillo clinico principal"
corridor public floor PB at 47 0 size 9 70 name "Pasillo publico vertical"
corridor logistics floor PB at 0 58 size 100 5 name "Pasillo logistico"

# Urgencias y diagnostico
room hall floor PB at 8 28 size 18 20
room waiting floor PB at 26 42 size 20 12
room ambulances floor PB at 74 15 size 15 11
room triage floor PB at 58 17 size 11 8
room resus floor PB at 68 28 size 14 10
room boxes floor PB at 47 27 size 21 16
room observation floor PB at 47 45 size 19 11
room imaging floor PB at 42 14 size 16 11

# Nucleo vertical
vertical core floors S1..P8 at 50 20 size 8 8 group asc-core-central name "Nucleo vertical central"`

export function compilePlanningScript(source: string, basePlan: HospitalPlan): PlanningLanguageResult {
  const state: ScriptState = {
    plan: clonePlan(basePlan),
    rooms: basePlan.rooms.map((room) => ({ ...room, doors: room.doors?.map((door) => ({ ...door })) })),
    diagnostics: [],
    appliedLines: 0,
    sequence: 0,
  }

  source.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1
    const line = stripComment(rawLine).trim()
    if (!line) return

    const tokens = tokenize(line)
    if (tokens.length === 0) return

    const command = tokens[0].toLowerCase()
    try {
      if (command === 'plan') {
        requireTokenCount(tokens, 2, 'plan necesita un nombre entre comillas')
        state.plan.name = tokens.slice(1).join(' ')
        state.appliedLines += 1
        return
      }

      if (command === 'target') {
        state.plan.targetAreaSqm = parsePositiveNumber(tokens[1], 'target')
        state.appliedLines += 1
        return
      }

      if (command === 'site') {
        state.plan.siteAreaSqm = parsePositiveNumber(tokens[1], 'site')
        state.appliedLines += 1
        return
      }

      if (command === 'floors') {
        const floors = parseFloorList(tokens.slice(1), state.plan.floors)
        if (floors.length === 0) throw new Error('floors necesita al menos una planta')
        state.plan.floors = floors
        state.rooms = state.rooms.filter((room) => floors.includes(room.floor))
        state.appliedLines += 1
        return
      }

      if (command === 'clear') {
        state.rooms = []
        state.appliedLines += 1
        return
      }

      if (command === 'room' || command === 'corridor') {
        const room = parseRoomCommand(tokens, state, lineNumber, command)
        state.rooms.push(room)
        state.appliedLines += 1
        return
      }

      if (command === 'vertical') {
        const rooms = parseVerticalCommand(tokens, state, lineNumber)
        state.rooms.push(...rooms)
        state.appliedLines += 1
        return
      }

      throw new Error(`Comando desconocido: ${tokens[0]}`)
    } catch (error) {
      state.diagnostics.push({
        level: 'error',
        line: lineNumber,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

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

function parseRoomCommand(
  tokens: string[],
  state: ScriptState,
  lineNumber: number,
  command: 'room' | 'corridor',
): PlacedRoom {
  requireTokenCount(tokens, 2, `${command} necesita una plantilla`)
  const template = resolveTemplate(tokens[1], command)
  const floorToken = valueAfter(tokens, 'floor') ?? valueAfter(tokens, 'on')
  const at = pairAfter(tokens, 'at')
  const size = pairAfter(tokens, 'size')
  const id = valueAfter(tokens, 'id')
  const name = valueAfter(tokens, 'name')
  const capacity = valueAfter(tokens, 'capacity')

  if (!floorToken) throw new Error(`${command} necesita floor`)
  if (!at) throw new Error(`${command} necesita at x y`)
  if (!size) throw new Error(`${command} necesita size w h`)

  const floor = parseFloor(floorToken)
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
    id: id ?? `${template.id}-${lineNumber}-${state.sequence += 1}`,
    name,
    capacity: capacity ? parsePositiveNumber(capacity, 'capacity') : undefined,
  })
}

function parseVerticalCommand(tokens: string[], state: ScriptState, lineNumber: number): PlacedRoom[] {
  requireTokenCount(tokens, 2, 'vertical necesita una plantilla')
  const template = resolveTemplate(tokens[1], 'vertical')
  const floorsToken = valuesAfter(tokens, 'floors')
  const at = pairAfter(tokens, 'at')
  const size = pairAfter(tokens, 'size')
  const group = valueAfter(tokens, 'group') ?? `${template.id}-${lineNumber}`
  const name = valueAfter(tokens, 'name')

  if (!at) throw new Error('vertical necesita at x y')
  if (!size) throw new Error('vertical necesita size w h')

  const floors = floorsToken.length > 0 ? parseFloorList(floorsToken, state.plan.floors) : state.plan.floors
  if (floors.length === 0) throw new Error('vertical necesita floors o un plan con plantas')

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

function valueAfter(tokens: string[], key: string): string | undefined {
  const index = tokens.findIndex((token) => token.toLowerCase() === key)
  return index >= 0 ? tokens[index + 1] : undefined
}

function valuesAfter(tokens: string[], key: string): string[] {
  const index = tokens.findIndex((token) => token.toLowerCase() === key)
  if (index < 0) return []
  const values: string[] = []
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    if (['at', 'capacity', 'floor', 'group', 'id', 'name', 'on', 'size'].includes(tokens[cursor].toLowerCase())) break
    values.push(tokens[cursor])
  }
  return values
}

function pairAfter(tokens: string[], key: string): [number, number] | undefined {
  const first = valueAfter(tokens, key)
  const index = tokens.findIndex((token) => token.toLowerCase() === key)
  const second = index >= 0 ? tokens[index + 2] : undefined
  if (!first || !second) return undefined
  return [parsePositiveNumber(first, key), parsePositiveNumber(second, key)]
}

function parsePositiveNumber(raw: string | undefined, label: string): number {
  if (!raw) throw new Error(`${label} necesita un valor numerico`)
  const value = Number(raw.replace(',', '.'))
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} no es un numero valido: ${raw}`)
  return value
}

function tokenize(line: string): string[] {
  const tokens: string[] = []
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|[^\s]+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(line)) !== null) {
    tokens.push(match[1] ? match[1].replace(/\\"/g, '"') : match[0])
  }
  return tokens
}

function stripComment(line: string): string {
  let quoted = false
  let escaped = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (char === '#' && !quoted) return line.slice(0, index)
  }
  return line
}

function requireTokenCount(tokens: string[], count: number, message: string) {
  if (tokens.length < count) throw new Error(message)
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
