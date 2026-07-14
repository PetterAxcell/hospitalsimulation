import { KIND_LABELS } from '../data/catalog'
import { distance } from './geometry'
import type { HospitalPlan, PlacedRoom, RoomKind } from '../types'

export type AdjacencyDesire = 'near' | 'far'
export type AdjacencyStatus = 'ok' | 'warn' | 'fail' | 'missing'

/**
 * Regla de adyacencia definida por el usuario en la matriz.
 * `aKind`/`bKind` se guardan en orden canonico (indice de aKind <= indice de bKind)
 * para evitar duplicar la pareja (a,b) y (b,a).
 *
 * Para desire = 'near': `warn`/`fail` son distancias ponderadas MAXIMAS toleradas
 *   (si la distancia supera el umbral, empeora el estado).
 * Para desire = 'far': `warn`/`fail` son distancias ponderadas MINIMAS exigidas
 *   (si la distancia queda por debajo del umbral, empeora el estado).
 */
export interface AdjacencyRule {
  id: string
  aKind: RoomKind
  bKind: RoomKind
  desire: AdjacencyDesire
  warn: number
  fail: number
}

export interface AdjacencyRuleResult {
  id: string
  label: string
  aKind: RoomKind
  bKind: RoomKind
  desire: AdjacencyDesire
  status: AdjacencyStatus
  distance: number | null
  evidence: string
}

export const KIND_ORDER: RoomKind[] = [
  'public',
  'waiting',
  'emergency',
  'diagnostic',
  'surgery',
  'critical',
  'inpatient',
  'ambulatory',
  'maternalChild',
  'oncology',
  'pharmacy',
  'laboratory',
  'logistics',
  'research',
  'staff',
  'technical',
  'vertical',
  'circulation',
  'green',
  'future',
]

const NEAR_DEFAULT_WARN = 40
const NEAR_DEFAULT_FAIL = 65
const FAR_DEFAULT_WARN = 30
const FAR_DEFAULT_FAIL = 18

/** Reglas de arranque razonables para un hospital terciario. */
export const DEFAULT_ADJACENCY_RULES: AdjacencyRule[] = [
  buildDefaultRule('emergency', 'diagnostic', 'near'),
  buildDefaultRule('surgery', 'critical', 'near'),
  buildDefaultRule('surgery', 'logistics', 'near'),
  buildDefaultRule('critical', 'laboratory', 'near'),
  buildDefaultRule('waiting', 'logistics', 'far'),
  buildDefaultRule('public', 'logistics', 'far'),
]

function buildDefaultRule(a: RoomKind, b: RoomKind, desire: AdjacencyDesire): AdjacencyRule {
  return normalizeRule({
    id: `adj-${a}-${b}`,
    aKind: a,
    bKind: b,
    desire,
    warn: desire === 'near' ? NEAR_DEFAULT_WARN : FAR_DEFAULT_WARN,
    fail: desire === 'near' ? NEAR_DEFAULT_FAIL : FAR_DEFAULT_FAIL,
  })
}

/** Devuelve la pareja en orden canonico segun KIND_ORDER. */
export function orderKinds(a: RoomKind, b: RoomKind): [RoomKind, RoomKind] {
  return KIND_ORDER.indexOf(a) <= KIND_ORDER.indexOf(b) ? [a, b] : [b, a]
}

export function ruleIdFor(a: RoomKind, b: RoomKind): string {
  const [first, second] = orderKinds(a, b)
  return `adj-${first}-${second}`
}

function normalizeRule(rule: AdjacencyRule): AdjacencyRule {
  const [aKind, bKind] = orderKinds(rule.aKind, rule.bKind)
  return { ...rule, aKind, bKind, id: `adj-${aKind}-${bKind}` }
}

export function findRule(rules: AdjacencyRule[], a: RoomKind, b: RoomKind): AdjacencyRule | undefined {
  const id = ruleIdFor(a, b)
  return rules.find((rule) => rule.id === id)
}

/**
 * Cicla el estado de una celda de la matriz: sin regla -> cerca -> lejos -> sin regla.
 * Devuelve la nueva lista de reglas.
 */
export function cycleRule(rules: AdjacencyRule[], a: RoomKind, b: RoomKind): AdjacencyRule[] {
  if (a === b) return rules
  const existing = findRule(rules, a, b)
  const id = ruleIdFor(a, b)
  const rest = rules.filter((rule) => rule.id !== id)
  if (!existing) return [...rest, buildDefaultRule(a, b, 'near')]
  if (existing.desire === 'near') return [...rest, { ...existing, desire: 'far', warn: FAR_DEFAULT_WARN, fail: FAR_DEFAULT_FAIL }]
  return rest
}

export function labelForRule(rule: Pick<AdjacencyRule, 'aKind' | 'bKind' | 'desire'>): string {
  const connector = rule.desire === 'near' ? 'cerca de' : 'lejos de'
  return `${KIND_LABELS[rule.aKind]} ${connector} ${KIND_LABELS[rule.bKind]}`
}

function minDistanceBetweenKinds(rooms: PlacedRoom[], aKind: RoomKind, bKind: RoomKind): {
  value: number
  a?: PlacedRoom
  b?: PlacedRoom
} | null {
  const roomsA = rooms.filter((room) => room.kind === aKind)
  const roomsB = rooms.filter((room) => room.kind === bKind)
  if (!roomsA.length || !roomsB.length) return null

  let best: { value: number; a: PlacedRoom; b: PlacedRoom } | null = null
  for (const a of roomsA) {
    for (const b of roomsB) {
      if (a.id === b.id) continue
      const value = distance(a, b)
      if (!best || value < best.value) best = { value, a, b }
    }
  }
  return best
}

export function evaluateAdjacencyRule(plan: HospitalPlan, rule: AdjacencyRule): AdjacencyRuleResult {
  const label = labelForRule(rule)
  const closest = minDistanceBetweenKinds(plan.rooms, rule.aKind, rule.bKind)

  if (!closest) {
    const missingKind = plan.rooms.some((room) => room.kind === rule.aKind) ? rule.bKind : rule.aKind
    return {
      id: rule.id,
      label,
      aKind: rule.aKind,
      bKind: rule.bKind,
      desire: rule.desire,
      status: 'missing',
      distance: null,
      evidence: `Falta ${KIND_LABELS[missingKind]} en el plan`,
    }
  }

  const value = Math.round(closest.value)
  let status: AdjacencyStatus
  if (rule.desire === 'near') {
    status = value >= rule.fail ? 'fail' : value >= rule.warn ? 'warn' : 'ok'
  } else {
    status = value <= rule.fail ? 'fail' : value <= rule.warn ? 'warn' : 'ok'
  }

  const pair = closest.a && closest.b ? ` · ${closest.a.name} ↔ ${closest.b.name}` : ''
  const target = rule.desire === 'near' ? `objetivo < ${rule.warn}` : `objetivo > ${rule.warn}`
  return {
    id: rule.id,
    label,
    aKind: rule.aKind,
    bKind: rule.bKind,
    desire: rule.desire,
    status,
    distance: value,
    evidence: `${value} u ponderadas (${target})${pair}`,
  }
}

export function evaluateAdjacencyRules(plan: HospitalPlan, rules: AdjacencyRule[]): AdjacencyRuleResult[] {
  return rules.map((rule) => evaluateAdjacencyRule(plan, rule))
}

export interface AdjacencySummary {
  total: number
  ok: number
  warn: number
  fail: number
  missing: number
}

export function summarizeAdjacency(results: AdjacencyRuleResult[]): AdjacencySummary {
  return results.reduce<AdjacencySummary>(
    (acc, result) => {
      acc.total += 1
      acc[result.status] += 1
      return acc
    },
    { total: 0, ok: 0, warn: 0, fail: 0, missing: 0 },
  )
}
