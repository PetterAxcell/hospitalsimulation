import type { DoorSide, PlacedRoom, RoomDoor } from '../types'

const CONNECT_TOLERANCE = 0.8
const DOOR_TOUCH_TOLERANCE = 4
const VERTICAL_ALIGNMENT_TOLERANCE = 1.2
const DEFAULT_DOOR_OFFSET = 0.5

export interface DoorPoint {
  x: number
  y: number
}

export function isPassage(room: PlacedRoom): boolean {
  return room.kind === 'circulation' || room.kind === 'vertical'
}

function isCorridor(room: PlacedRoom): boolean {
  return room.kind === 'circulation'
}

export function requiresCorridorAccess(room: PlacedRoom): boolean {
  if (isPassage(room)) return false
  return [
    'public',
    'waiting',
    'emergency',
    'diagnostic',
    'laboratory',
    'surgery',
    'critical',
    'inpatient',
    'ambulatory',
    'maternalChild',
    'oncology',
    'pharmacy',
  ].includes(room.kind)
}

export function disconnectedPassages(rooms: PlacedRoom[]): PlacedRoom[] {
  const passages = rooms.filter(isPassage)
  if (passages.length === 0) return []
  const graph = buildPassageGraph(passages)
  const components = passageComponents(passages, graph)
  const largest = components.sort((a, b) => b.size - a.size)[0] ?? new Set<string>()
  return passages.filter((room) => room.kind === 'circulation' && !largest.has(room.id))
}

export function roomsTouchOrOverlap(a: PlacedRoom, b: PlacedRoom, tolerance = CONNECT_TOLERANCE): boolean {
  if (a.floor !== b.floor) return false
  return rangesTouch(a.x, a.x + a.w, b.x, b.x + b.w, tolerance)
    && rangesTouch(a.y, a.y + a.h, b.y, b.y + b.h, tolerance)
}

export function hasPassageAccess(rooms: PlacedRoom[], room: PlacedRoom): boolean {
  if (isPassage(room)) return true
  return room.doors?.some((door) => doorConnectsToCorridor(rooms, room, door)) ?? false
}

export function doorWorldPosition(room: PlacedRoom, door: RoomDoor): DoorPoint {
  const offset = clamp(door.offset, 0, 1)
  if (door.side === 'top') return { x: room.x + room.w * offset, y: room.y }
  if (door.side === 'right') return { x: room.x + room.w, y: room.y + room.h * offset }
  if (door.side === 'bottom') return { x: room.x + room.w * offset, y: room.y + room.h }
  return { x: room.x, y: room.y + room.h * offset }
}

export function snapDoorToRoom(room: PlacedRoom, point: DoorPoint, id: string): RoomDoor {
  const distances: Array<{ side: DoorSide; distance: number }> = [
    { side: 'top', distance: Math.abs(point.y - room.y) },
    { side: 'right', distance: Math.abs(point.x - (room.x + room.w)) },
    { side: 'bottom', distance: Math.abs(point.y - (room.y + room.h)) },
    { side: 'left', distance: Math.abs(point.x - room.x) },
  ]
  const side = distances.sort((a, b) => a.distance - b.distance)[0].side
  return {
    id,
    side,
    offset: doorOffsetForSide(room, side, point),
  }
}

export function doorConnectsToCorridor(rooms: PlacedRoom[], room: PlacedRoom, door: RoomDoor): boolean {
  const point = doorWorldPosition(room, door)
  return rooms.some((candidate) =>
    candidate.floor === room.floor
    && isCorridor(candidate)
    && pointInsideRoom(point, candidate, DOOR_TOUCH_TOLERANCE),
  )
}

export function addDefaultDoors(rooms: PlacedRoom[]): PlacedRoom[] {
  return rooms.map((room) => {
    if (room.doors !== undefined || room.kind === 'circulation' || room.kind === 'future') return room
    const door = defaultDoorForRoom(room, rooms)
    return { ...room, doors: door ? [door] : [] }
  })
}

export function defaultDoorForRoom(room: PlacedRoom, rooms: PlacedRoom[]): RoomDoor | undefined {
  if (room.kind === 'circulation' || room.kind === 'future') return undefined
  const corridors = rooms.filter((candidate) => candidate.floor === room.floor && isCorridor(candidate))
  const nearest = corridors
    .map((corridor) => ({ corridor, distance: rectDistance(room, corridor) }))
    .sort((a, b) => a.distance - b.distance)[0]?.corridor

  if (!nearest) {
    return { id: `${room.id}-door-1`, side: 'bottom', offset: DEFAULT_DOOR_OFFSET }
  }

  const side = nearestDoorSide(room, nearest)
  const corridorCenter = { x: nearest.x + nearest.w / 2, y: nearest.y + nearest.h / 2 }
  return {
    id: `${room.id}-door-1`,
    side,
    offset: doorOffsetForSide(room, side, corridorCenter),
  }
}

export function disconnectedPatientRooms(rooms: PlacedRoom[]): PlacedRoom[] {
  return rooms.filter((room) => requiresCorridorAccess(room) && !hasPassageAccess(rooms, room))
}

export function buildAccessiblePatientRoute(rooms: PlacedRoom[], serviceRooms: PlacedRoom[]): PlacedRoom[] | null {
  if (serviceRooms.length < 2) return serviceRooms

  const route: PlacedRoom[] = [serviceRooms[0]]
  for (let index = 1; index < serviceRooms.length; index += 1) {
    const previous = serviceRooms[index - 1]
    const next = serviceRooms[index]
    const passagePath = findPassagePath(rooms, previous, next)
    if (!passagePath) return null

    for (const passage of passagePath) appendUnique(route, passage)
    appendUnique(route, next)
  }
  return route
}

export function findPassagePath(rooms: PlacedRoom[], from: PlacedRoom, to: PlacedRoom): PlacedRoom[] | null {
  const passages = rooms.filter(isPassage)
  const graph = buildPassageGraph(passages)
  const byId = new Map(passages.map((room) => [room.id, room]))
  const startPassages = accessPassages(passages, from)
  const goalIds = new Set(accessPassages(passages, to).map((room) => room.id))

  if (startPassages.length === 0 || goalIds.size === 0) return null

  const queue = [...startPassages.map((room) => room.id)]
  const visited = new Set(queue)
  const parent = new Map<string, string | null>(queue.map((id) => [id, null]))

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    if (goalIds.has(current)) return reconstructPath(current, parent, byId)

    for (const next of graph.get(current) ?? []) {
      if (visited.has(next)) continue
      visited.add(next)
      parent.set(next, current)
      queue.push(next)
    }
  }

  return null
}

function accessPassages(passages: PlacedRoom[], room: PlacedRoom): PlacedRoom[] {
  if (isPassage(room)) return [room]
  return passages.filter((passage) =>
    isCorridor(passage)
    && ((room.doors?.some((door) => pointInsideRoom(doorWorldPosition(room, door), passage, DOOR_TOUCH_TOLERANCE))) ?? false),
  )
}

function buildPassageGraph(passages: PlacedRoom[]): Map<string, string[]> {
  const graph = new Map(passages.map((room) => [room.id, [] as string[]]))

  for (let i = 0; i < passages.length; i += 1) {
    for (let j = i + 1; j < passages.length; j += 1) {
      const a = passages[i]
      const b = passages[j]
      if (passagesConnect(a, b)) {
        graph.get(a.id)?.push(b.id)
        graph.get(b.id)?.push(a.id)
      }
    }
  }

  return graph
}

function passagesConnect(a: PlacedRoom, b: PlacedRoom): boolean {
  if (a.floor === b.floor) {
    if (isCorridor(a) && isCorridor(b)) return roomsTouchOrOverlap(a, b)
    if (a.kind === 'vertical' && isCorridor(b)) return a.doors?.some((door) => pointInsideRoom(doorWorldPosition(a, door), b, DOOR_TOUCH_TOLERANCE)) ?? false
    if (b.kind === 'vertical' && isCorridor(a)) return b.doors?.some((door) => pointInsideRoom(doorWorldPosition(b, door), a, DOOR_TOUCH_TOLERANCE)) ?? false
    return roomsTouchOrOverlap(a, b)
  }
  if (a.kind !== 'vertical' || b.kind !== 'vertical') return false
  return verticalConnectorsMatch(a, b)
}

function footprintsOverlap(a: PlacedRoom, b: PlacedRoom, tolerance: number): boolean {
  return rangesTouch(a.x, a.x + a.w, b.x, b.x + b.w, tolerance)
    && rangesTouch(a.y, a.y + a.h, b.y, b.y + b.h, tolerance)
}

function reconstructPath(current: string, parent: Map<string, string | null>, byId: Map<string, PlacedRoom>): PlacedRoom[] {
  const ids: string[] = []
  let cursor: string | null | undefined = current
  while (cursor) {
    ids.push(cursor)
    cursor = parent.get(cursor)
  }
  return ids.reverse().map((id) => byId.get(id)).filter(Boolean) as PlacedRoom[]
}

function passageComponents(passages: PlacedRoom[], graph: Map<string, string[]>): Set<string>[] {
  const remaining = new Set(passages.map((room) => room.id))
  const components: Set<string>[] = []

  while (remaining.size > 0) {
    const start = [...remaining][0]
    const component = new Set<string>()
    const queue = [start]
    remaining.delete(start)
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) break
      component.add(current)
      for (const next of graph.get(current) ?? []) {
        if (!remaining.has(next)) continue
        remaining.delete(next)
        queue.push(next)
      }
    }
    components.push(component)
  }

  return components
}

function appendUnique(route: PlacedRoom[], room: PlacedRoom) {
  if (route[route.length - 1]?.id !== room.id) route.push(room)
}

function nearestDoorSide(room: PlacedRoom, corridor: PlacedRoom): DoorSide {
  const candidates: Array<{ side: DoorSide; distance: number; aligned: boolean }> = [
    {
      side: 'top',
      distance: Math.abs(room.y - (corridor.y + corridor.h)),
      aligned: rangesTouch(room.x, room.x + room.w, corridor.x, corridor.x + corridor.w, CONNECT_TOLERANCE),
    },
    {
      side: 'right',
      distance: Math.abs(room.x + room.w - corridor.x),
      aligned: rangesTouch(room.y, room.y + room.h, corridor.y, corridor.y + corridor.h, CONNECT_TOLERANCE),
    },
    {
      side: 'bottom',
      distance: Math.abs(room.y + room.h - corridor.y),
      aligned: rangesTouch(room.x, room.x + room.w, corridor.x, corridor.x + corridor.w, CONNECT_TOLERANCE),
    },
    {
      side: 'left',
      distance: Math.abs(room.x - (corridor.x + corridor.w)),
      aligned: rangesTouch(room.y, room.y + room.h, corridor.y, corridor.y + corridor.h, CONNECT_TOLERANCE),
    },
  ]
  return candidates
    .sort((a, b) => Number(b.aligned) - Number(a.aligned) || a.distance - b.distance)[0].side
}

function verticalConnectorsMatch(a: PlacedRoom, b: PlacedRoom): boolean {
  if (!footprintsOverlap(a, b, VERTICAL_ALIGNMENT_TOLERANCE)) return false
  if (a.verticalGroupId || b.verticalGroupId) {
    if (!a.verticalGroupId || !b.verticalGroupId || a.verticalGroupId !== b.verticalGroupId) return false
  }
  return servesFloor(a, b.floor) && servesFloor(b, a.floor)
}

function servesFloor(room: PlacedRoom, floor: number): boolean {
  return !room.servesFloors?.length || room.servesFloors.includes(room.floor) && room.servesFloors.includes(floor)
}

function doorOffsetForSide(room: PlacedRoom, side: DoorSide, point: DoorPoint): number {
  if (side === 'top' || side === 'bottom') return clamp((point.x - room.x) / room.w, 0.08, 0.92)
  return clamp((point.y - room.y) / room.h, 0.08, 0.92)
}

function pointInsideRoom(point: DoorPoint, room: PlacedRoom, tolerance: number): boolean {
  return point.x >= room.x - tolerance
    && point.x <= room.x + room.w + tolerance
    && point.y >= room.y - tolerance
    && point.y <= room.y + room.h + tolerance
}

function rectDistance(a: PlacedRoom, b: PlacedRoom): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)))
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)))
  return Math.hypot(dx, dy)
}

function rangesTouch(a1: number, a2: number, b1: number, b2: number, tolerance: number): boolean {
  return Math.min(a2, b2) - Math.max(a1, b1) >= -tolerance
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
