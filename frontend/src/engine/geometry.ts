import type { PlacedRoom, SimulationNode } from '../types'

export interface Point {
  x: number
  y: number
}

export function center(room: PlacedRoom): Point {
  return { x: room.x + room.w / 2, y: room.y + room.h / 2 }
}

export function roomByNode(rooms: PlacedRoom[], node: SimulationNode): PlacedRoom | undefined {
  return rooms.find((room) => room.simulationNode === node)
}

export function roomsByFloor(rooms: PlacedRoom[], floor: number): PlacedRoom[] {
  return rooms.filter((room) => room.floor === floor)
}

export function distance(a: PlacedRoom, b: PlacedRoom): number {
  const ac = center(a)
  const bc = center(b)
  const horizontal = Math.hypot(ac.x - bc.x, ac.y - bc.y)
  const vertical = Math.abs(a.floor - b.floor) * 18
  return horizontal + vertical
}

export function clampRoom(room: PlacedRoom): PlacedRoom {
  const w = Math.max(4, Math.min(96, room.w))
  const h = Math.max(4, Math.min(66, room.h))
  return {
    ...room,
    w,
    h,
    x: Math.max(0, Math.min(100 - w, room.x)),
    y: Math.max(0, Math.min(70 - h, room.y)),
    capacity: Math.max(1, Math.round(room.capacity)),
  }
}

export function overlapScore(rooms: PlacedRoom[], floor: number): number {
  const floorRooms = rooms.filter((room) => room.floor === floor)
  let overlaps = 0
  for (let i = 0; i < floorRooms.length; i += 1) {
    for (let j = i + 1; j < floorRooms.length; j += 1) {
      const a = floorRooms[i]
      const b = floorRooms[j]
      const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
      const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
      overlaps += overlapX * overlapY
    }
  }
  return Math.round(overlaps)
}
