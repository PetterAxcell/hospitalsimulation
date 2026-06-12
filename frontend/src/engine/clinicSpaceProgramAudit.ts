import { CLINIC_SPACE_PROGRAM, type ClinicSpaceProgramEntry } from '../data/clinicSpaceProgram'
import type { HospitalPlan, PlacedRoom } from '../types'

export type ClinicProgramAuditStatus = 'missing' | 'weak' | 'partial' | 'ok' | 'broad' | 'config'

export interface ClinicProgramAuditRow {
  entry: ClinicSpaceProgramEntry
  status: ClinicProgramAuditStatus
  matchedRooms: PlacedRoom[]
  modeledAreaSqm: number
  modeledCapacity: number
  targetGrossAreaSqm?: number
  areaCoverage?: number
  capacityCoverage?: number
  evidence: string
}

export interface ClinicProgramAuditSummary {
  rows: ClinicProgramAuditRow[]
  extractedUsefulAreaSqm: number
  targetGrossAreaSqm: number
  modeledSyncedAreaSqm: number
  missingCount: number
  weakCount: number
  broadCount: number
  configurationCount: number
}

export function auditClinicSpaceProgram(plan: HospitalPlan): ClinicProgramAuditSummary {
  const rows = CLINIC_SPACE_PROGRAM.map((entry) => auditEntry(plan, entry))
  return {
    rows,
    extractedUsefulAreaSqm: CLINIC_SPACE_PROGRAM.reduce((sum, entry) => sum + (entry.usefulAreaSqm ?? 0), 0),
    targetGrossAreaSqm: rows.reduce((sum, row) => sum + (row.targetGrossAreaSqm ?? 0), 0),
    modeledSyncedAreaSqm: rows.reduce((sum, row) => sum + row.modeledAreaSqm, 0),
    missingCount: rows.filter((row) => row.status === 'missing').length,
    weakCount: rows.filter((row) => row.status === 'weak' || row.status === 'partial').length,
    broadCount: rows.filter((row) => row.status === 'broad').length,
    configurationCount: rows.filter((row) => row.status === 'config').length,
  }
}

function auditEntry(plan: HospitalPlan, entry: ClinicSpaceProgramEntry): ClinicProgramAuditRow {
  const matches = matchingRooms(plan.rooms, entry)
  const targetGrossAreaSqm = entry.usefulAreaSqm ? Math.round(entry.usefulAreaSqm * entry.grossingFactor) : undefined
  const roomsForArea = entry.scope === 'module_type' ? bestModuleMatches(matches, entry) : matches
  const modeledAreaSqm = Math.round(roomsForArea.reduce((sum, room) => sum + room.areaSqm, 0))
  const modeledCapacity = Math.round(roomsForArea.reduce((sum, room) => sum + room.capacity, 0))
  const areaCoverage = targetGrossAreaSqm ? modeledAreaSqm / Math.max(1, targetGrossAreaSqm) : undefined
  const capacityCoverage = entry.expectedCapacity ? modeledCapacity / Math.max(1, entry.expectedCapacity) : undefined
  const status = statusFor(entry, matches, areaCoverage)

  return {
    entry,
    status,
    matchedRooms: roomsForArea,
    modeledAreaSqm,
    modeledCapacity,
    targetGrossAreaSqm,
    areaCoverage,
    capacityCoverage,
    evidence: evidenceFor(entry, roomsForArea, areaCoverage, capacityCoverage),
  }
}

function matchingRooms(rooms: PlacedRoom[], entry: ClinicSpaceProgramEntry): PlacedRoom[] {
  const normalizedKeywords = entry.keywords.map(normalize)
  return rooms.filter((room) => {
    if (entry.templateIds.includes(room.templateId)) return true
    if (entry.roomKinds.includes(room.kind)) return true
    const haystack = normalize(`${room.name} ${room.templateId} ${room.staffModel.join(' ')}`)
    return normalizedKeywords.some((keyword) => keyword.length > 2 && haystack.includes(keyword))
  })
}

function bestModuleMatches(matches: PlacedRoom[], entry: ClinicSpaceProgramEntry): PlacedRoom[] {
  if (!matches.length) return []
  const capacityTarget = entry.expectedCapacity
  if (!capacityTarget) return [largestRoom(matches)]
  const sorted = [...matches].sort((a, b) => {
    const capacityDelta = Math.abs(a.capacity - capacityTarget) - Math.abs(b.capacity - capacityTarget)
    if (capacityDelta !== 0) return capacityDelta
    return b.areaSqm - a.areaSqm
  })
  return [sorted[0]]
}

function largestRoom(rooms: PlacedRoom[]): PlacedRoom {
  return [...rooms].sort((a, b) => b.areaSqm - a.areaSqm)[0]
}

function statusFor(
  entry: ClinicSpaceProgramEntry,
  matches: PlacedRoom[],
  areaCoverage: number | undefined,
): ClinicProgramAuditStatus {
  if (!matches.length) return 'missing'
  if (entry.scope === 'configuration') return 'config'
  if (areaCoverage === undefined) return 'ok'
  if (areaCoverage < 0.5) return 'weak'
  if (areaCoverage < 0.85) return 'partial'
  if (areaCoverage > 1.8) return 'broad'
  return 'ok'
}

function evidenceFor(
  entry: ClinicSpaceProgramEntry,
  rooms: PlacedRoom[],
  areaCoverage: number | undefined,
  capacityCoverage: number | undefined,
): string {
  if (!rooms.length) return 'No hay bloques equivalentes en el plan actual.'
  const names = rooms.slice(0, 3).map((room) => room.name).join(', ')
  const area = areaCoverage === undefined ? 'sin m2 objetivo' : `${Math.round(areaCoverage * 100)}% de m2 objetivo bruto`
  const capacity = capacityCoverage === undefined ? '' : ` · ${Math.round(capacityCoverage * 100)}% de capacidad`
  const basis = entry.scope === 'module_type' ? 'mejor modulo encontrado' : `${rooms.length} bloques asociados`
  return `${basis}: ${names}${rooms.length > 3 ? '...' : ''} · ${area}${capacity}`
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}
