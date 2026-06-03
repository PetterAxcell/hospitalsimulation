import type { DoorSide, PlacedRoom, RoomDoor } from '../types'

const CONNECT_TOLERANCE = 0.35
const DOOR_TOUCH_TOLERANCE = 0.35
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
  return room.kind !== 'future'
}

export function disconnectedPassages(rooms: PlacedRoom[]): PlacedRoom[] {
  const passages = rooms.filter(isPassage)
  if (passages.length === 0) return []
  const graph = buildPassageGraph(passages)
  const components = passageComponents(passages, graph)
  const largest = components.sort((a, b) => b.size - a.size)[0] ?? new Set<string>()
  return passages.filter((room) => !largest.has(room.id))
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
    && (pointInsideRoom(point, candidate, DOOR_TOUCH_TOLERANCE) || explicitRoomsPhysicallyConnect(room, candidate)),
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
  if (from.floor !== to.floor) return findCrossFloorPassagePath(rooms, from, to)?.path ?? null
  return findWeightedPassagePath(rooms, from, to, { allowVerticalTransitions: false })?.path ?? null
}

function findCrossFloorPassagePath(rooms: PlacedRoom[], from: PlacedRoom, to: PlacedRoom): WeightedPath | null {
  const passages = rooms.filter(isPassage)
  const fromVerticals = passages.filter((room) => room.kind === 'vertical' && room.floor === from.floor)
  const toVerticals = passages.filter((room) => room.kind === 'vertical' && room.floor === to.floor)
  let best: WeightedPath | null = null

  for (const fromVertical of fromVerticals) {
    const startPath = findWeightedPassagePath(rooms, from, fromVertical, { allowVerticalTransitions: false })
    if (!startPath) continue

    for (const toVertical of toVerticals) {
      if (!verticalConnectorsMatch(fromVertical, toVertical)) continue
      const endPath = findWeightedPassagePath(rooms, toVertical, to, { allowVerticalTransitions: false })
      if (!endPath) continue

      const path: PlacedRoom[] = []
      startPath.path.forEach((room) => appendUnique(path, room))
      appendUnique(path, toVertical)
      endPath.path.forEach((room) => appendUnique(path, room))

      const cost = startPath.cost + verticalTransferCost(fromVertical, toVertical) + endPath.cost
      if (!best || cost < best.cost) best = { path, cost }
    }
  }

  return best
}

interface WeightedPath {
  path: PlacedRoom[]
  cost: number
}

function findWeightedPassagePath(
  rooms: PlacedRoom[],
  from: PlacedRoom,
  to: PlacedRoom,
  options: { allowVerticalTransitions: boolean },
): WeightedPath | null {
  const passages = rooms.filter(isPassage)
  const graph = buildWeightedPassageGraph(passages, options)
  const byId = new Map(passages.map((room) => [room.id, room]))
  const startPassages = accessPassages(passages, from)
  const goalPassages = accessPassages(passages, to)
  const goalIds = new Set(goalPassages.map((room) => room.id))

  if (startPassages.length === 0 || goalIds.size === 0) return null

  const unsettled = new Set(passages.map((room) => room.id))
  const distanceById = new Map<string, number>()
  const parent = new Map<string, string | null>()
  startPassages.forEach((room) => {
    distanceById.set(room.id, accessCost(from, room))
    parent.set(room.id, null)
  })

  while (unsettled.size > 0) {
    const current = nearestUnsettled(unsettled, distanceById)
    if (!current) break
    unsettled.delete(current)

    for (const edge of graph.get(current) ?? []) {
      if (!unsettled.has(edge.id)) continue
      const nextDistance = (distanceById.get(current) ?? Infinity) + edge.cost
      if (nextDistance < (distanceById.get(edge.id) ?? Infinity)) {
        distanceById.set(edge.id, nextDistance)
        parent.set(edge.id, current)
      }
    }
  }

  const bestGoal = goalPassages
    .map((room) => ({
      room,
      cost: (distanceById.get(room.id) ?? Infinity) + accessCost(to, room),
    }))
    .sort((a, b) => a.cost - b.cost)[0]
  if (!bestGoal || !Number.isFinite(bestGoal.cost)) return null

  return {
    path: reconstructPath(bestGoal.room.id, parent, byId),
    cost: bestGoal.cost,
  }
}

function accessPassages(passages: PlacedRoom[], room: PlacedRoom): PlacedRoom[] {
  if (isPassage(room)) return [room]
  return passages.filter((passage) =>
    passage.floor === room.floor
    && isCorridor(passage)
    && (
      explicitRoomsPhysicallyConnect(room, passage)
      || ((room.doors?.some((door) => pointInsideRoom(doorWorldPosition(room, door), passage, DOOR_TOUCH_TOLERANCE))) ?? false)
    ),
  )
}

export function connectedCorridorGroups(rooms: PlacedRoom[], floor: number): PlacedRoom[][] {
  const corridors = rooms.filter((room) => room.floor === floor && isCorridor(room))
  const remaining = new Set(corridors.map((room) => room.id))
  const byId = new Map(corridors.map((room) => [room.id, room]))
  const groups: PlacedRoom[][] = []

  while (remaining.size > 0) {
    const start = [...remaining][0]
    const group: PlacedRoom[] = []
    const queue = [start]
    remaining.delete(start)

    while (queue.length > 0) {
      const currentId = queue.shift()
      if (!currentId) break
      const current = byId.get(currentId)
      if (!current) continue
      group.push(current)

      for (const next of corridors) {
        if (!remaining.has(next.id)) continue
        if (roomsTouchOrOverlap(current, next) || explicitRoomsPhysicallyConnect(current, next)) {
          remaining.delete(next.id)
          queue.push(next.id)
        }
      }
    }

    groups.push(group)
  }

  return groups
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

function buildWeightedPassageGraph(
  passages: PlacedRoom[],
  options: { allowVerticalTransitions: boolean },
): Map<string, Array<{ id: string; cost: number }>> {
  const graph = new Map(passages.map((room) => [room.id, [] as Array<{ id: string; cost: number }>]))

  for (let i = 0; i < passages.length; i += 1) {
    for (let j = i + 1; j < passages.length; j += 1) {
      const a = passages[i]
      const b = passages[j]
      if (!options.allowVerticalTransitions && a.floor !== b.floor) continue
      if (!passagesConnect(a, b)) continue
      const cost = passageEdgeCost(a, b)
      graph.get(a.id)?.push({ id: b.id, cost })
      graph.get(b.id)?.push({ id: a.id, cost })
    }
  }

  return graph
}

function nearestUnsettled(unsettled: Set<string>, distanceById: Map<string, number>): string | undefined {
  let bestId: string | undefined
  let bestDistance = Infinity
  unsettled.forEach((id) => {
    const distance = distanceById.get(id) ?? Infinity
    if (distance < bestDistance) {
      bestId = id
      bestDistance = distance
    }
  })
  return bestId
}

function passageEdgeCost(a: PlacedRoom, b: PlacedRoom): number {
  if (a.floor !== b.floor) return verticalTransferCost(a, b)
  const aPoint = roomCenter(a)
  const bPoint = roomCenter(b)
  return Math.max(0.5, Math.hypot(aPoint.x - bPoint.x, aPoint.y - bPoint.y))
}

function verticalTransferCost(a: PlacedRoom, b: PlacedRoom): number {
  const floorDelta = Math.max(1, Math.abs(a.floor - b.floor))
  const usesEmergencyStair = a.simulationNode === 'emergency_stair' || b.simulationNode === 'emergency_stair'
  return floorDelta * (usesEmergencyStair ? 10 : 7)
}

function accessCost(room: PlacedRoom, passage: PlacedRoom): number {
  if (room.id === passage.id) return 0
  const roomPoint = roomCenter(room)
  const passagePoint = closestPointOnRoom(roomPoint, passage)
  return Math.max(0.2, Math.hypot(roomPoint.x - passagePoint.x, roomPoint.y - passagePoint.y))
}

function roomCenter(room: PlacedRoom): DoorPoint {
  return {
    x: room.x + room.w / 2,
    y: room.y + room.h / 2,
  }
}

function closestPointOnRoom(point: DoorPoint, room: PlacedRoom): DoorPoint {
  return {
    x: clamp(point.x, room.x, room.x + room.w),
    y: clamp(point.y, room.y, room.y + room.h),
  }
}

function passagesConnect(a: PlacedRoom, b: PlacedRoom): boolean {
  if (explicitRoomsPhysicallyConnect(a, b)) return true
  if (a.floor === b.floor) {
    if (isCorridor(a) && isCorridor(b)) return roomsTouchOrOverlap(a, b)
    if (a.kind === 'vertical' && isCorridor(b)) return a.doors?.some((door) => pointInsideRoom(doorWorldPosition(a, door), b, DOOR_TOUCH_TOLERANCE)) ?? false
    if (b.kind === 'vertical' && isCorridor(a)) return b.doors?.some((door) => pointInsideRoom(doorWorldPosition(b, door), a, DOOR_TOUCH_TOLERANCE)) ?? false
    return roomsTouchOrOverlap(a, b)
  }
  if (a.kind !== 'vertical' || b.kind !== 'vertical') return false
  return verticalConnectorsMatch(a, b)
}

function explicitRoomsConnect(a: PlacedRoom, b: PlacedRoom): boolean {
  return (a.connectionIds?.includes(b.id) ?? false) || (b.connectionIds?.includes(a.id) ?? false)
}

function explicitRoomsPhysicallyConnect(a: PlacedRoom, b: PlacedRoom): boolean {
  if (!explicitRoomsConnect(a, b)) return false
  if (a.floor === b.floor) return roomsTouchOrOverlap(a, b)
  return a.kind === 'vertical' && b.kind === 'vertical' && verticalConnectorsMatch(a, b)
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
