import { useEffect, useMemo, useRef, useState } from 'react'
import { KIND_COLORS } from '../data/catalog'
import { disconnectedPassages, doorConnectsToCorridor, doorWorldPosition, type DoorPoint } from '../engine/circulation'
import { clampRoom } from '../engine/geometry'
import type { EquipmentKind, HospitalPlan, PlacedRoom } from '../types'

interface HospitalCanvasProps {
  plan: HospitalPlan
  selectedFloor: number
  selectedRoomId?: string
  doorToolRoomId?: string
  onSelectRoom: (roomId: string) => void
  onChangeRoom: (room: PlacedRoom) => void
  onAddDoorAtPoint: (roomId: string, point: DoorPoint) => void
  onMoveDoor: (roomId: string, doorId: string, point: DoorPoint) => void
}

type DragState =
  | { kind: 'room'; roomId: string; offsetX: number; offsetY: number }
  | { kind: 'door'; roomId: string; doorId: string }
  | { kind: 'resize'; roomId: string; handle: ResizeHandle }

type ResizeHandle = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const WORLD_W = 100
const WORLD_H = 70
const MIN_ROOM_SIZE = 4
const OMITTED_PLANNER_EQUIPMENT = new Set<EquipmentKind>(['stairs', 'emergencyStairs'])

export function HospitalCanvas({
  plan,
  selectedFloor,
  selectedRoomId,
  doorToolRoomId,
  onSelectRoom,
  onChangeRoom,
  onAddDoorAtPoint,
  onMoveDoor,
}: HospitalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const floorRooms = useMemo(() => plan.rooms.filter((room) => room.floor === selectedFloor), [plan.rooms, selectedFloor])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.round(rect.width * ratio)
    canvas.height = Math.round(rect.height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawHospital(ctx, rect.width, rect.height, floorRooms, selectedRoomId, plan.rooms)
  }, [floorRooms, plan.rooms, selectedRoomId])

  function worldFromEvent(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scale = Math.min(rect.width / WORLD_W, rect.height / WORLD_H)
    const ox = (rect.width - WORLD_W * scale) / 2
    const oy = (rect.height - WORLD_H * scale) / 2
    return {
      x: (event.clientX - rect.left - ox) / scale,
      y: (event.clientY - rect.top - oy) / scale,
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = worldFromEvent(event)
    const doorHit = findDoorAtPoint(floorRooms, point)
    if (doorHit) {
      onSelectRoom(doorHit.room.id)
      setDrag({ kind: 'door', roomId: doorHit.room.id, doorId: doorHit.doorId })
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    if (doorToolRoomId) {
      const target = floorRooms.find((item) => item.id === doorToolRoomId)
      if (target && inside(point.x, point.y, target) && target.kind !== 'circulation') {
        onSelectRoom(target.id)
        onAddDoorAtPoint(target.id, point)
        return
      }
    }

    const selectedRoom = floorRooms.find((item) => item.id === selectedRoomId)
    const resizeHandle = selectedRoom ? findResizeHandleAtPoint(selectedRoom, point) : undefined
    if (selectedRoom && resizeHandle) {
      onSelectRoom(selectedRoom.id)
      setDrag({ kind: 'resize', roomId: selectedRoom.id, handle: resizeHandle })
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    const room = [...floorRooms].reverse().find((item) => inside(point.x, point.y, item))
    if (!room) return
    onSelectRoom(room.id)
    setDrag({
      kind: 'room',
      roomId: room.id,
      offsetX: point.x - room.x,
      offsetY: point.y - room.y,
    })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag) return
    const point = worldFromEvent(event)
    if (drag.kind === 'door') {
      onMoveDoor(drag.roomId, drag.doorId, point)
      return
    }
    const room = plan.rooms.find((item) => item.id === drag.roomId)
    if (!room) return
    if (drag.kind === 'resize') {
      onChangeRoom(resizeRoomFromHandle(room, drag.handle, point))
      return
    }
    onChangeRoom(clampRoom({ ...room, x: point.x - drag.offsetX, y: point.y - drag.offsetY }))
  }

  function handlePointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    setDrag(null)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <canvas
      ref={canvasRef}
      className="hospital-canvas"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => setDrag(null)}
      aria-label="Plano editable del hospital"
      style={{ cursor: doorToolRoomId ? 'crosshair' : undefined }}
    />
  )
}

function drawHospital(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rooms: PlacedRoom[],
  selectedRoomId: string | undefined,
  allRooms: PlacedRoom[],
) {
  const scale = Math.min(width / WORLD_W, height / WORLD_H)
  const ox = (width - WORLD_W * scale) / 2
  const oy = (height - WORLD_H * scale) / 2
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#eef4ec'
  ctx.fillRect(0, 0, width, height)

  function sx(x: number) {
    return ox + x * scale
  }
  function sy(y: number) {
    return oy + y * scale
  }

  ctx.strokeStyle = 'rgba(54, 68, 59, 0.18)'
  ctx.lineWidth = 1
  for (let x = 0; x <= WORLD_W; x += 5) {
    ctx.beginPath()
    ctx.moveTo(sx(x), sy(0))
    ctx.lineTo(sx(x), sy(WORLD_H))
    ctx.stroke()
  }
  for (let y = 0; y <= WORLD_H; y += 5) {
    ctx.beginPath()
    ctx.moveTo(sx(0), sy(y))
    ctx.lineTo(sx(WORLD_W), sy(y))
    ctx.stroke()
  }

  const disconnectedIds = new Set(disconnectedPassages(allRooms).map((room) => room.id))
  rooms.forEach((room) => {
    const isSelected = room.id === selectedRoomId
    const isDisconnectedPassage = disconnectedIds.has(room.id)
    ctx.fillStyle = KIND_COLORS[room.kind]
    ctx.strokeStyle = isDisconnectedPassage ? '#dc2626' : isSelected ? '#111827' : '#30473e'
    ctx.lineWidth = isDisconnectedPassage || isSelected ? 3 : 1.4
    roundRect(ctx, sx(room.x), sy(room.y), room.w * scale, room.h * scale, room.kind === 'circulation' ? 2 : 5)
    ctx.fill()
    ctx.stroke()
    drawFloorPattern(ctx, sx(room.x), sy(room.y), room.w * scale, room.h * scale, room.kind)
    drawEquipment(ctx, room, sx, sy, scale)
    drawLabel(ctx, room, sx(room.x + 0.8), sy(room.y + 2.1), room.w * scale)
  })
  drawDoors(ctx, rooms, allRooms, selectedRoomId, sx, sy, scale)
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId)
  if (selectedRoom) drawResizeHandles(ctx, selectedRoom, sx, sy, scale)
}

function drawDoors(
  ctx: CanvasRenderingContext2D,
  rooms: PlacedRoom[],
  allRooms: PlacedRoom[],
  selectedRoomId: string | undefined,
  sx: (x: number) => number,
  sy: (y: number) => number,
  scale: number,
) {
  rooms.forEach((room) => {
    (room.doors ?? []).forEach((door) => {
      const position = doorWorldPosition(room, door)
      const connected = doorConnectsToCorridor(allRooms, room, door)
      const horizontal = door.side === 'top' || door.side === 'bottom'
      const length = 2.4 * scale
      const thickness = Math.max(5, 0.42 * scale)
      ctx.save()
      ctx.translate(sx(position.x), sy(position.y))
      ctx.fillStyle = connected ? '#ffffff' : '#fee2e2'
      ctx.strokeStyle = connected ? (room.id === selectedRoomId ? '#1d4ed8' : '#16685f') : '#dc2626'
      ctx.lineWidth = room.id === selectedRoomId ? 2.4 : 1.6
      if (horizontal) {
        ctx.fillRect(-length / 2, -thickness / 2, length, thickness)
        ctx.strokeRect(-length / 2, -thickness / 2, length, thickness)
      } else {
        ctx.fillRect(-thickness / 2, -length / 2, thickness, length)
        ctx.strokeRect(-thickness / 2, -length / 2, thickness, length)
      }
      ctx.restore()
    })
  })
}

function drawLabel(ctx: CanvasRenderingContext2D, room: PlacedRoom, x: number, y: number, roomWidth: number) {
  if (room.kind === 'circulation' && roomWidth < 130) return
  const words = room.name.split(' ')
  const lines: string[] = []
  let current = ''
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > Math.max(8, Math.floor(roomWidth / 8)) && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  })
  if (current) lines.push(current)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.84)'
  ctx.fillRect(x - 3, y - 14, Math.min(roomWidth - 4, 150), Math.min(44, lines.length * 13 + 18))
  ctx.fillStyle = '#17201c'
  ctx.font = '700 11px Inter, sans-serif'
  lines.slice(0, 2).forEach((line, index) => ctx.fillText(line, x, y + index * 12))
  ctx.font = '10px Inter, sans-serif'
  const metadata = room.kind === 'circulation' ? formatCompactArea(room.areaSqm) : `${room.capacity} cap. · ${formatCompactArea(room.areaSqm)}`
  ctx.fillText(metadata, x, y + Math.min(2, lines.length) * 12 + 3)
}

function drawResizeHandles(
  ctx: CanvasRenderingContext2D,
  room: PlacedRoom,
  sx: (x: number) => number,
  sy: (y: number) => number,
  scale: number,
) {
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#111827'
  ctx.lineWidth = 1.8
  const size = Math.max(7, scale * 0.9)
  resizeHandlePoints(room).forEach(({ x, y, handle }) => {
    ctx.beginPath()
    if (handle.length === 2) {
      ctx.rect(sx(x) - size / 2, sy(y) - size / 2, size, size)
    } else {
      ctx.roundRect(sx(x) - size / 2, sy(y) - size / 2, size, size, 2)
    }
    ctx.fill()
    ctx.stroke()
  })
  ctx.restore()
}

function drawEquipment(
  ctx: CanvasRenderingContext2D,
  room: PlacedRoom,
  sx: (x: number) => number,
  sy: (y: number) => number,
  scale: number,
) {
  if (room.kind === 'circulation') return
  const visibleEquipment = room.equipment.filter((kind) => !OMITTED_PLANNER_EQUIPMENT.has(kind))
  const equipment = visibleEquipment.slice(0, Math.min(18, visibleEquipment.length * 3))
  equipment.forEach((kind, index) => {
    const col = index % Math.max(2, Math.floor(room.w / 4))
    const row = Math.floor(index / Math.max(2, Math.floor(room.w / 4)))
    const x = room.x + 1.2 + col * 3.2
    const y = room.y + room.h - 2.4 - row * 2.4
    drawEquipmentGlyph(ctx, kind, sx(x), sy(y), scale)
  })
}

function drawEquipmentGlyph(ctx: CanvasRenderingContext2D, kind: EquipmentKind, x: number, y: number, scale: number) {
  const s = Math.max(5, scale * 1.2)
  ctx.save()
  ctx.strokeStyle = '#41534b'
  ctx.lineWidth = 1.2
  ctx.fillStyle = '#f8fafc'
  if (kind === 'bed' || kind === 'stretcher') {
    ctx.fillRect(x, y, s * 2, s * 0.85)
    ctx.strokeRect(x, y, s * 2, s * 0.85)
    ctx.fillStyle = '#9bc0d9'
    ctx.fillRect(x, y, s * 0.42, s * 0.85)
  } else if (kind === 'chair') {
    ctx.fillStyle = '#b08968'
    ctx.fillRect(x, y, s * 0.75, s * 0.75)
    ctx.strokeRect(x, y, s * 0.75, s * 0.75)
  } else if (kind === 'desk' || kind === 'nurseStation') {
    ctx.fillStyle = '#9c6b3f'
    ctx.fillRect(x, y, s * 1.8, s * 0.72)
    ctx.strokeRect(x, y, s * 1.8, s * 0.72)
  } else if (kind === 'monitor') {
    ctx.fillStyle = '#1f2937'
    ctx.fillRect(x, y, s, s * 0.75)
    ctx.fillStyle = '#76e4b4'
    ctx.fillRect(x + 2, y + 2, s - 4, s * 0.75 - 4)
  } else if (kind === 'sink') {
    ctx.beginPath()
    ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.45, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  } else if (kind === 'labBench' || kind === 'shelves' || kind === 'cleanStorage' || kind === 'dirtyUtility') {
    ctx.fillStyle = kind === 'dirtyUtility' ? '#9b5964' : '#8d99ae'
    ctx.fillRect(x, y, s * 1.7, s * 0.85)
    ctx.strokeRect(x, y, s * 1.7, s * 0.85)
  } else if (kind === 'imagingGantry') {
    ctx.beginPath()
    ctx.arc(x + s, y + s, s, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#d9e4ea'
    ctx.fillRect(x + s * 0.35, y + s * 0.8, s * 1.4, s * 0.35)
  } else if (kind === 'orTable' || kind === 'sterileTable') {
    ctx.fillStyle = kind === 'orTable' ? '#dfe8ef' : '#d0f0de'
    ctx.fillRect(x, y, s * 2.2, s * 0.8)
    ctx.strokeRect(x, y, s * 2.2, s * 0.8)
  } else if (kind === 'elevator') {
    ctx.fillStyle = '#b8c4cc'
    ctx.fillRect(x, y, s * 0.75, s * 1.45)
    ctx.fillRect(x + s, y, s * 0.75, s * 1.45)
    ctx.strokeRect(x, y, s * 1.75, s * 1.45)
  } else if (kind === 'stairs') {
    ctx.strokeStyle = '#334155'
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath()
      ctx.moveTo(x + i * s * 0.35, y + s)
      ctx.lineTo(x + i * s * 0.35, y + i * s * 0.25)
      ctx.lineTo(x + (i + 1) * s * 0.35, y + i * s * 0.25)
      ctx.stroke()
    }
  } else if (kind === 'emergencyStairs') {
    ctx.strokeStyle = '#b91c1c'
    ctx.lineWidth = 1.6
    ctx.strokeRect(x - s * 0.12, y - s * 0.12, s * 1.75, s * 1.35)
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath()
      ctx.moveTo(x + i * s * 0.36, y + s)
      ctx.lineTo(x + i * s * 0.36, y + i * s * 0.25)
      ctx.lineTo(x + (i + 1) * s * 0.36, y + i * s * 0.25)
      ctx.stroke()
    }
  } else if (kind === 'fireDoor') {
    ctx.fillStyle = '#ef4444'
    ctx.fillRect(x, y, s * 0.42, s * 1.4)
    ctx.strokeRect(x, y, s * 0.42, s * 1.4)
    ctx.beginPath()
    ctx.arc(x + s * 0.42, y + s * 1.4, s * 0.9, -Math.PI / 2, 0)
    ctx.stroke()
  } else if (kind === 'smokeControl') {
    ctx.fillStyle = '#dbeafe'
    ctx.beginPath()
    ctx.arc(x + s * 0.65, y + s * 0.65, s * 0.62, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.strokeStyle = '#2563eb'
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath()
      ctx.moveTo(x + s * 0.65, y + s * 0.65)
      ctx.lineTo(x + s * (0.65 + Math.cos(i * 2.1) * 0.48), y + s * (0.65 + Math.sin(i * 2.1) * 0.48))
      ctx.stroke()
    }
  } else if (kind === 'refugeArea') {
    ctx.fillStyle = '#ecfdf5'
    ctx.fillRect(x, y, s * 1.7, s)
    ctx.strokeRect(x, y, s * 1.7, s)
    ctx.fillStyle = '#047857'
    ctx.fillRect(x + s * 0.18, y + s * 0.18, s * 0.38, s * 0.62)
    ctx.fillRect(x + s * 0.7, y + s * 0.45, s * 0.7, s * 0.16)
  } else if (kind === 'sprinkler') {
    ctx.strokeStyle = '#2563eb'
    ctx.beginPath()
    ctx.moveTo(x + s * 0.65, y)
    ctx.lineTo(x + s * 0.65, y + s * 0.42)
    ctx.stroke()
    ctx.fillStyle = '#38bdf8'
    for (let i = 0; i < 3; i += 1) {
      ctx.beginPath()
      ctx.arc(x + s * (0.25 + i * 0.4), y + s * 0.85, s * 0.1, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (kind === 'generator') {
    ctx.fillStyle = '#facc15'
    ctx.fillRect(x, y, s * 1.7, s)
    ctx.strokeRect(x, y, s * 1.7, s)
    ctx.fillStyle = '#374151'
    ctx.fillRect(x + s * 0.2, y + s * 0.25, s * 0.55, s * 0.45)
    ctx.fillRect(x + s * 0.95, y + s * 0.3, s * 0.5, s * 0.14)
  } else if (kind === 'ambulance') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x, y, s * 2.2, s)
    ctx.strokeRect(x, y, s * 2.2, s)
    ctx.fillStyle = '#d62828'
    ctx.fillRect(x + s * 0.92, y + s * 0.22, s * 0.18, s * 0.56)
    ctx.fillRect(x + s * 0.72, y + s * 0.42, s * 0.58, s * 0.18)
  } else if (kind === 'garden') {
    ctx.fillStyle = '#2f9a44'
    ctx.beginPath()
    ctx.arc(x + s * 0.5, y + s * 0.45, s * 0.45, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.fillRect(x, y, s, s)
    ctx.strokeRect(x, y, s, s)
  }
  ctx.restore()
}

function drawFloorPattern(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, kind: string) {
  ctx.save()
  ctx.globalAlpha = kind === 'circulation' ? 0.34 : 0.2
  ctx.strokeStyle = kind === 'circulation' ? '#a7b3a4' : kind === 'critical' || kind === 'surgery' ? '#7a4c28' : '#4d665d'
  ctx.lineWidth = 1
  if (kind === 'circulation') {
    for (let ix = x + 10; ix < x + w; ix += 18) {
      ctx.beginPath()
      ctx.moveTo(ix, y)
      ctx.lineTo(ix - 16, y + h)
      ctx.stroke()
    }
  } else {
    for (let ix = x + 12; ix < x + w; ix += 12) {
      ctx.beginPath()
      ctx.moveTo(ix, y)
      ctx.lineTo(ix, y + h)
      ctx.stroke()
    }
    for (let iy = y + 12; iy < y + h; iy += 12) {
      ctx.beginPath()
      ctx.moveTo(x, iy)
      ctx.lineTo(x + w, iy)
      ctx.stroke()
    }
  }
  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function inside(x: number, y: number, room: PlacedRoom) {
  return x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h
}

function findResizeHandleAtPoint(room: PlacedRoom, point: DoorPoint): ResizeHandle | undefined {
  const handles = resizeHandlePoints(room)
  return handles.find(({ x, y }) => Math.hypot(x - point.x, y - point.y) <= 1.7)?.handle
}

function resizeHandlePoints(room: PlacedRoom): Array<{ handle: ResizeHandle; x: number; y: number }> {
  const midX = room.x + room.w / 2
  const midY = room.y + room.h / 2
  const right = room.x + room.w
  const bottom = room.y + room.h
  return [
    { handle: 'nw', x: room.x, y: room.y },
    { handle: 'ne', x: right, y: room.y },
    { handle: 'se', x: right, y: bottom },
    { handle: 'sw', x: room.x, y: bottom },
    { handle: 'n', x: midX, y: room.y },
    { handle: 'e', x: right, y: midY },
    { handle: 's', x: midX, y: bottom },
    { handle: 'w', x: room.x, y: midY },
  ]
}

function resizeRoomFromHandle(room: PlacedRoom, handle: ResizeHandle, point: DoorPoint): PlacedRoom {
  let { x, y, w, h } = room
  const right = room.x + room.w
  const bottom = room.y + room.h

  if (handle.includes('e')) w = Math.max(MIN_ROOM_SIZE, point.x - room.x)
  if (handle.includes('s')) h = Math.max(MIN_ROOM_SIZE, point.y - room.y)
  if (handle.includes('w')) {
    x = Math.min(point.x, right - MIN_ROOM_SIZE)
    w = right - x
  }
  if (handle.includes('n')) {
    y = Math.min(point.y, bottom - MIN_ROOM_SIZE)
    h = bottom - y
  }

  return clampRoom({ ...room, x, y, w, h })
}

function findDoorAtPoint(rooms: PlacedRoom[], point: DoorPoint): { room: PlacedRoom; doorId: string } | undefined {
  for (const room of [...rooms].reverse()) {
    for (const door of room.doors ?? []) {
      const position = doorWorldPosition(room, door)
      if (Math.hypot(position.x - point.x, position.y - point.y) <= 1.4) return { room, doorId: door.id }
    }
  }
  return undefined
}

function formatCompactArea(value: number) {
  return `${Math.round(value).toLocaleString('es-ES')} m2`
}
