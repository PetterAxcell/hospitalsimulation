import type { PlacedRoom, SimulationNode, ChannelConfig } from '../types'

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

/* ─── Channel Graph & Pathfinding ─── */

export interface ChannelGraphNode {
  roomId: string
  edges: Array<{ to: string; channelId: string; baseCost: number }>
}

export class ChannelGraph {
  private nodes: Map<string, ChannelGraphNode> = new Map()
  private channels: Map<string, ChannelConfig> = new Map()

  constructor(channelConfigs: ChannelConfig[], rooms: PlacedRoom[] = []) {
    // Build simulationNode → roomId map (first room per node)
    const nodeToRoom = new Map<string, string>()
    for (const room of rooms) {
      if (room.simulationNode && !nodeToRoom.has(room.simulationNode)) {
        nodeToRoom.set(room.simulationNode, room.id)
      }
    }

    for (const ch of channelConfigs) {
      // Resolve fromRoomId/toRoomId: if they match a simulationNode, use the actual room ID
      const fromId = nodeToRoom.get(ch.fromRoomId) ?? ch.fromRoomId
      const toId = nodeToRoom.get(ch.toRoomId) ?? ch.toRoomId

      this.channels.set(ch.id, { ...ch, fromRoomId: fromId, toRoomId: toId })
      this.addEdge(fromId, toId, ch.id, ch.baseTravelTime)
      if (ch.isBidirectional) {
        this.addEdge(toId, fromId, ch.id, ch.baseTravelTime)
      }
    }

    // Vertical channels: connect rooms with same simulationNode on adjacent floors
    for (const ch of channelConfigs) {
      if (ch.fromRoomId === ch.toRoomId) {
        const roomsWithNode = rooms.filter(r => r.simulationNode === ch.fromRoomId)
        for (let i = 0; i < roomsWithNode.length; i += 1) {
          for (let j = i + 1; j < roomsWithNode.length; j += 1) {
            const a = roomsWithNode[i]
            const b = roomsWithNode[j]
            if (Math.abs(a.floor - b.floor) === 1) {
              this.addEdge(a.id, b.id, ch.id, ch.baseTravelTime)
              this.addEdge(b.id, a.id, ch.id, ch.baseTravelTime)
            }
          }
        }
      }
    }
  }

  private addEdge(from: string, to: string, channelId: string, cost: number) {
    if (!this.nodes.has(from)) {
      this.nodes.set(from, { roomId: from, edges: [] })
    }
    this.nodes.get(from)!.edges.push({ to, channelId, baseCost: cost })
  }

  getChannel(id: string): ChannelConfig | undefined {
    return this.channels.get(id)
  }

  getAllChannels(): ChannelConfig[] {
    return Array.from(this.channels.values())
  }

  /** A* pathfinding using ONLY static baseTravelTime — NO congestion knowledge */
  findStaticRoute(fromRoomId: string, toRoomId: string): { roomIds: string[]; channelIds: string[]; totalBaseCost: number } | null {
    if (!this.nodes.has(fromRoomId) || !this.nodes.has(toRoomId)) return null
    if (fromRoomId === toRoomId) return { roomIds: [fromRoomId], channelIds: [], totalBaseCost: 0 }

    const open = new Set<string>([fromRoomId])
    const cameFrom = new Map<string, { room: string; channelId: string }>()
    const gScore = new Map<string, number>()
    const fScore = new Map<string, number>()

    gScore.set(fromRoomId, 0)
    fScore.set(fromRoomId, this.heuristic(fromRoomId, toRoomId))

    while (open.size > 0) {
      let current = ''
      let best = Infinity
      for (const id of open) {
        const score = fScore.get(id) ?? Infinity
        if (score < best) {
          best = score
          current = id
        }
      }

      if (current === toRoomId) {
        return this.reconstructPath(cameFrom, current)
      }

      open.delete(current)
      const node = this.nodes.get(current)
      if (!node) continue

      for (const edge of node.edges) {
        const tentative = (gScore.get(current) ?? Infinity) + edge.baseCost
        if (tentative < (gScore.get(edge.to) ?? Infinity)) {
          cameFrom.set(edge.to, { room: current, channelId: edge.channelId })
          gScore.set(edge.to, tentative)
          fScore.set(edge.to, tentative + this.heuristic(edge.to, toRoomId))
          open.add(edge.to)
        }
      }
    }

    return null
  }

  /** Dynamic reroute: recalculates path using current congestion costs.
   *  Called when an agent encounters a congested channel (>80% occupancy). */
  findDynamicRoute(
    fromRoomId: string,
    toRoomId: string,
    occupancyMap: Map<string, number>,
  ): { roomIds: string[]; channelIds: string[]; totalCost: number } | null {
    if (!this.nodes.has(fromRoomId) || !this.nodes.has(toRoomId)) return null
    if (fromRoomId === toRoomId) return { roomIds: [fromRoomId], channelIds: [], totalCost: 0 }

    const open = new Set<string>([fromRoomId])
    const cameFrom = new Map<string, { room: string; channelId: string }>()
    const gScore = new Map<string, number>()
    const fScore = new Map<string, number>()

    gScore.set(fromRoomId, 0)
    fScore.set(fromRoomId, this.heuristic(fromRoomId, toRoomId))

    while (open.size > 0) {
      let current = ''
      let best = Infinity
      for (const id of open) {
        const score = fScore.get(id) ?? Infinity
        if (score < best) {
          best = score
          current = id
        }
      }

      if (current === toRoomId) {
        return this.reconstructPath(cameFrom, current)
      }

      open.delete(current)
      const node = this.nodes.get(current)
      if (!node) continue

      for (const edge of node.edges) {
        const ch = this.channels.get(edge.channelId)
        const active = occupancyMap.get(edge.channelId) ?? 0
        const maxC = ch?.maxConcurrent ?? 10
        const slope = ch?.congestionSlope ?? 0.5
        const congestionPenalty = slope * Math.pow(active / maxC, 2)
        const dynamicCost = edge.baseCost * (1 + congestionPenalty)

        const tentative = (gScore.get(current) ?? Infinity) + dynamicCost
        if (tentative < (gScore.get(edge.to) ?? Infinity)) {
          cameFrom.set(edge.to, { room: current, channelId: edge.channelId })
          gScore.set(edge.to, tentative)
          fScore.set(edge.to, tentative + this.heuristic(edge.to, toRoomId))
          open.add(edge.to)
        }
      }
    }

    return null
  }

  /** Calculate travel time through a channel given current congestion */
  travelTimeWithCongestion(channelId: string, activeMovements: number): number {
    const ch = this.channels.get(channelId)
    if (!ch) return 3
    const occupancy = activeMovements / Math.max(1, ch.maxConcurrent)
    return ch.baseTravelTime * (1 + ch.congestionSlope * occupancy * occupancy)
  }

  private heuristic(_from: string, _to: string): number {
    return 0
  }

  private reconstructPath(
    cameFrom: Map<string, { room: string; channelId: string }>,
    current: string,
  ): { roomIds: string[]; channelIds: string[]; totalBaseCost: number; totalCost: number } {
    const roomIds: string[] = [current]
    const channelIds: string[] = []
    let totalCost = 0

    while (cameFrom.has(current)) {
      const prev = cameFrom.get(current)!
      channelIds.unshift(prev.channelId)
      roomIds.unshift(prev.room)
      const ch = this.channels.get(prev.channelId)
      if (ch) totalCost += ch.baseTravelTime
      current = prev.room
    }

    return { roomIds, channelIds, totalBaseCost: totalCost, totalCost }
  }
}

/* ─── Channel Rendering ─── */

export function renderChannels(
  ctx: CanvasRenderingContext2D,
  channels: ChannelConfig[],
  rooms: PlacedRoom[],
  selectedFloor: number,
  occupancyMap: Map<string, number>,
  worldW: number,
  worldH: number,
  canvasW: number,
  canvasH: number,
) {
  const scale = Math.min(canvasW / worldW, canvasH / worldH)
  const ox = (canvasW - worldW * scale) / 2
  const oy = (canvasH - worldH * scale) / 2

  function toScreen(x: number, y: number) {
    return { sx: ox + x * scale, sy: oy + y * scale }
  }

  for (const ch of channels) {
    const fromRoom = rooms.find((r) => r.id === ch.fromRoomId)
    const toRoom = rooms.find((r) => r.id === ch.toRoomId)
    if (!fromRoom || !toRoom) continue
    if (fromRoom.floor !== selectedFloor || toRoom.floor !== selectedFloor) continue

    const from = center(fromRoom)
    const to = center(toRoom)
    const { sx: x1, sy: y1 } = toScreen(from.x, from.y)
    const { sx: x2, sy: y2 } = toScreen(to.x, to.y)

    const active = occupancyMap.get(ch.id) ?? 0
    const occupancy = active / Math.max(1, ch.maxConcurrent)

    let color: string
    if (occupancy > 0.8) color = '#e74c3c'
    else if (occupancy > 0.5) color = '#f39c12'
    else color = '#27ae60'

    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(1.5, 3 * (1 + occupancy))
    ctx.globalAlpha = 0.6
    ctx.stroke()
    ctx.globalAlpha = 1.0
  }
}
