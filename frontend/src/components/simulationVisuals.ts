import type { AgentRole, RoomKind, Severity } from '../types'

/**
 * Capa de presentacion de la simulacion: ciclo dia/noche, texturas de suelo por
 * tipo de sala y uniformes de agentes. Vive fuera de la escena Phaser para poder
 * reutilizarse desde HUD, leyenda y tests sin instanciar el motor de juego.
 */

export interface AmbientPhase {
  id: 'night' | 'dawn' | 'morning' | 'day' | 'golden' | 'dusk'
  label: string
  tint: string
  /** Intensidad del filtro ambiental (0 = mediodia neutro). */
  tintAlpha: number
  /** Cuanta luz interior se enciende (0 = ninguna, 1 = todas las ventanas). */
  interiorLight: number
}

interface AmbientStop extends AmbientPhase {
  hour: number
}

const AMBIENT_STOPS: AmbientStop[] = [
  { hour: 0, id: 'night', label: 'Noche', tint: '#101d38', tintAlpha: 0.62, interiorLight: 1 },
  { hour: 5, id: 'dawn', label: 'Amanecer', tint: '#3c5385', tintAlpha: 0.46, interiorLight: 0.78 },
  { hour: 7.5, id: 'morning', label: 'Mañana', tint: '#ffd7a6', tintAlpha: 0.16, interiorLight: 0.26 },
  { hour: 13, id: 'day', label: 'Mediodía', tint: '#ffffff', tintAlpha: 0.02, interiorLight: 0.04 },
  { hour: 18.5, id: 'golden', label: 'Tarde', tint: '#ffb478', tintAlpha: 0.2, interiorLight: 0.3 },
  { hour: 21, id: 'dusk', label: 'Anochecer', tint: '#3a3f76', tintAlpha: 0.44, interiorLight: 0.84 },
  { hour: 24, id: 'night', label: 'Noche', tint: '#101d38', tintAlpha: 0.62, interiorLight: 1 },
]

export type ShiftId = 'morning' | 'afternoon' | 'night'

export interface ShiftInfo {
  id: ShiftId
  label: string
  short: string
}

const SHIFTS: Record<ShiftId, ShiftInfo> = {
  morning: { id: 'morning', label: 'Turno mañana', short: 'M' },
  afternoon: { id: 'afternoon', label: 'Turno tarde', short: 'T' },
  night: { id: 'night', label: 'Turno noche', short: 'N' },
}

/** Hora decimal (0-24) a partir del minuto de movimiento del replay. */
export function hourOfDay(motionMinutes: number): number {
  const safe = Number.isFinite(motionMinutes) ? Math.max(0, motionMinutes) : 0
  return (safe / 60) % 24
}

export function shiftForHour(hour: number): ShiftInfo {
  if (hour >= 7 && hour < 15) return SHIFTS.morning
  if (hour >= 15 && hour < 22) return SHIFTS.afternoon
  return SHIFTS.night
}

export function formatClock(motionMinutes: number): string {
  const hour = Math.floor(hourOfDay(motionMinutes))
  const minute = Math.floor(Math.max(0, motionMinutes) % 60)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** Interpola el filtro ambiental para una hora concreta del dia. */
export function ambientForHour(hour: number): AmbientPhase {
  const safeHour = ((hour % 24) + 24) % 24
  let from = AMBIENT_STOPS[0]
  let to = AMBIENT_STOPS[AMBIENT_STOPS.length - 1]
  for (let i = 0; i < AMBIENT_STOPS.length - 1; i += 1) {
    if (safeHour >= AMBIENT_STOPS[i].hour && safeHour <= AMBIENT_STOPS[i + 1].hour) {
      from = AMBIENT_STOPS[i]
      to = AMBIENT_STOPS[i + 1]
      break
    }
  }
  const span = Math.max(0.001, to.hour - from.hour)
  const t = clamp01((safeHour - from.hour) / span)
  return {
    id: t < 0.5 ? from.id : to.id,
    label: t < 0.5 ? from.label : to.label,
    tint: mixHex(from.tint, to.tint, t),
    tintAlpha: lerp(from.tintAlpha, to.tintAlpha, t),
    interiorLight: lerp(from.interiorLight, to.interiorLight, t),
  }
}

export type FloorPattern = 'tile' | 'vinyl' | 'technical' | 'terrazzo' | 'grass' | 'asphalt'

export interface FloorTexture {
  pattern: FloorPattern
  /** Tamano de baldosa en unidades de plano. */
  tile: number
  grout: string
  groutAlpha: number
  accent?: string
}

const DEFAULT_TEXTURE: FloorTexture = { pattern: 'vinyl', tile: 2, grout: '#4d665d', groutAlpha: 0.1 }

export const FLOOR_TEXTURES: Record<RoomKind, FloorTexture> = {
  public: { pattern: 'terrazzo', tile: 3, grout: '#37716f', groutAlpha: 0.16, accent: '#ffffff' },
  waiting: { pattern: 'terrazzo', tile: 2.5, grout: '#7cdadf', groutAlpha: 0.22, accent: '#ffffff' },
  emergency: { pattern: 'tile', tile: 2, grout: '#a63f33', groutAlpha: 0.18, accent: '#ffd6cd' },
  diagnostic: { pattern: 'vinyl', tile: 3, grout: '#2c7d55', groutAlpha: 0.14 },
  surgery: { pattern: 'tile', tile: 1.5, grout: '#b8802a', groutAlpha: 0.2, accent: '#fff3d6' },
  critical: { pattern: 'tile', tile: 1.5, grout: '#a63f33', groutAlpha: 0.2, accent: '#ffe2dc' },
  inpatient: { pattern: 'vinyl', tile: 3, grout: '#2c7d55', groutAlpha: 0.13 },
  ambulatory: { pattern: 'vinyl', tile: 3, grout: '#2c7d55', groutAlpha: 0.13 },
  maternalChild: { pattern: 'vinyl', tile: 2.5, grout: '#c47a68', groutAlpha: 0.15 },
  oncology: { pattern: 'vinyl', tile: 2.5, grout: '#b5544a', groutAlpha: 0.15 },
  pharmacy: { pattern: 'tile', tile: 2, grout: '#2f5c8a', groutAlpha: 0.17 },
  laboratory: { pattern: 'tile', tile: 1.5, grout: '#0f8e96', groutAlpha: 0.2 },
  logistics: { pattern: 'technical', tile: 4, grout: '#375171', groutAlpha: 0.18 },
  research: { pattern: 'tile', tile: 2, grout: '#3b2ba0', groutAlpha: 0.16 },
  staff: { pattern: 'vinyl', tile: 2.5, grout: '#2f5c8a', groutAlpha: 0.13 },
  technical: { pattern: 'technical', tile: 4, grout: '#4a5b68', groutAlpha: 0.22 },
  vertical: { pattern: 'technical', tile: 2, grout: '#375171', groutAlpha: 0.24 },
  circulation: { pattern: 'terrazzo', tile: 2, grout: '#9fb8b4', groutAlpha: 0.28, accent: '#ffffff' },
  green: { pattern: 'grass', tile: 2, grout: '#2c7d55', groutAlpha: 0.2 },
  future: { pattern: 'asphalt', tile: 4, grout: '#b8802a', groutAlpha: 0.24 },
}

export function floorTexture(kind: RoomKind): FloorTexture {
  return FLOOR_TEXTURES[kind] ?? DEFAULT_TEXTURE
}

/** Salas que encienden luz interior visible de noche. */
const ALWAYS_LIT_KINDS = new Set<RoomKind>(['emergency', 'critical', 'surgery', 'laboratory', 'vertical'])

export function interiorLightStrength(kind: RoomKind, pressure: number): number {
  if (ALWAYS_LIT_KINDS.has(kind)) return 1
  if (kind === 'green' || kind === 'future') return 0
  // Los pasillos mantienen alumbrado de guardia, mas bajo que las areas clinicas.
  if (kind === 'circulation') return 0.3
  return clamp01(0.45 + pressure * 0.55)
}

export interface AgentUniform {
  /** Color de la prenda principal. */
  body: string
  /** Detalle de uniforme (bata, cinta, chaleco). */
  trim: string
  /** Gorro o cofia; vacio si el rol no lo usa. */
  cap?: string
  skin: string
  hair: string
  badge: string
}

const SKIN_TONES = ['#f0c8a0', '#dda87c', '#c68642', '#8d5524', '#ffdbac']
const HAIR_TONES = ['#2b2d42', '#4a3728', '#6b4a2f', '#1b1b1b', '#8a8a8a']

export function agentUniform(role: AgentRole, agentId: string, patientColor: string): AgentUniform {
  const seed = hashString(agentId)
  // Se usa desplazamiento sin signo: `>>` convertiria a int32 y daria indices negativos.
  const skin = SKIN_TONES[seed % SKIN_TONES.length] ?? SKIN_TONES[0]
  const hair = HAIR_TONES[(seed >>> 3) % HAIR_TONES.length] ?? HAIR_TONES[0]
  const body = patientColor || '#f18e7f'

  if (role === 'doctor') return { body: '#ffffff', trim: '#01b7c1', cap: undefined, skin, hair, badge: '#386ba6' }
  if (role === 'nurse') return { body: '#4f83cc', trim: '#e8f9fb', cap: '#e8f9fb', skin, hair, badge: '#375171' }
  if (role === 'porter') return { body: '#7c6bb0', trim: '#fad67d', cap: undefined, skin, hair, badge: '#375171' }
  if (role === 'technician') return { body: '#33b578', trim: '#e7fbe2', cap: '#e7fbe2', skin, hair, badge: '#174942' }
  return { body, trim: '#ffffff', cap: undefined, skin, hair, badge: '#375171' }
}

export const SEVERITY_RING: Record<Severity, { color: string; alpha: number }> = {
  low: { color: '#33b578', alpha: 0.55 },
  medium: { color: '#f5ab38', alpha: 0.65 },
  high: { color: '#f18e7f', alpha: 0.8 },
  critical: { color: '#ed7369', alpha: 0.95 },
}

export interface LegendEntry {
  label: string
  color: string
  note?: string
}

export const AGENT_LEGEND: LegendEntry[] = [
  { label: 'Paciente', color: '#f18e7f', note: 'anillo = gravedad' },
  { label: 'Médico/a', color: '#ffffff', note: 'bata blanca' },
  { label: 'Enfermería', color: '#4f83cc', note: 'pijama azul' },
  { label: 'Celador/a', color: '#7c6bb0', note: 'traslados' },
  { label: 'Técnico/a', color: '#33b578', note: 'soporte' },
]

export const PRESSURE_LEGEND: LegendEntry[] = [
  { label: 'Holgada', color: '#33b578' },
  { label: 'Ajustada', color: '#f5ab38' },
  { label: 'Saturada', color: '#ed7369' },
]

export const KEYBOARD_SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: 'Espacio', action: 'Play / pausa' },
  { keys: '← →', action: 'Retroceder / avanzar' },
  { keys: '1 … 4', action: 'Velocidad x1 a x20' },
  { keys: 'V', action: 'Cambiar 2D / 3D' },
  { keys: 'F', action: 'Encajar vista' },
  { keys: 'L', action: 'Mostrar leyenda' },
  { keys: 'Rueda', action: 'Zoom' },
  { keys: 'Arrastrar', action: 'Desplazar cámara' },
]

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export function mixHex(from: string, to: string, t: number): string {
  const a = parseHex(from)
  const b = parseHex(to)
  const ratio = clamp01(t)
  const channels = [0, 1, 2].map((index) => Math.round(lerp(a[index], b[index], ratio)))
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function parseHex(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  const full = normalized.length === 3 ? normalized.split('').map((char) => char + char).join('') : normalized
  const value = Number.parseInt(full, 16)
  if (Number.isNaN(value)) return [255, 255, 255]
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}
