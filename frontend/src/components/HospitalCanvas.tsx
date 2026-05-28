import { useEffect, useMemo, useRef, useState } from 'react'
import { KIND_COLORS, DEFAULT_CHANNEL_CONFIGS } from '../data/catalog'
import { clampRoom, renderChannels } from '../engine/geometry'
import type { ChannelConfig, EquipmentKind, HospitalPlan, PlacedRoom } from '../types'

interface HospitalCanvasProps {
  plan: HospitalPlan
  selectedFloor: number
  selectedRoomId?: string
  onSelectRoom: (roomId: string) => void
  onChangeRoom: (room: PlacedRoom) => void
  channelConfigs?: ChannelConfig[]
  showChannels?: boolean
}

interface DragState {
  roomId: string
  offsetX: number
  offsetY: number
}

const WORLD_W = 100
const WORLD_H = 70

export function HospitalCanvas({
  plan, selectedFloor, selectedRoomId, onSelectRoom, onChangeRoom,
  channelConfigs = DEFAULT_CHANNEL_CONFIGS, showChannels = true,
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
    drawHospital(ctx, rect.width, rect.height, floorRooms, selectedRoomId, channelConfigs, plan.rooms, selectedFloor, showChannels)
  }, [floorRooms, selectedRoomId, channelConfigs, plan.rooms, selectedFloor, showChannels])

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
    const room = [...floorRooms].reverse().find((item) => inside(point.x, point.y, item))
    if (!room) return
    onSelectRoom(room.id)
    setDrag({
      roomId: room.id,
      offsetX: point.x - room.x,
      offsetY: point.y - room.y,
    })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag) return
    const room = plan.rooms.find((item) => item.id === drag.roomId)
    if (!room || room.locked) return
    const point = worldFromEvent(event)
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
    />
  )
}

function drawHospital(
  ctx: CanvasRenderingContext2D, width: number, height: number,
  rooms: PlacedRoom[], selectedRoomId?: string,
  channelConfigs?: ChannelConfig[], allRooms?: PlacedRoom[], currentFloor?: number, showChannels?: boolean,
) {
  const scale = Math.min(width / WORLD_W, height / WORLD_H)
  const ox = (width - WORLD_W * scale) / 2
  const oy = (height - WORLD_H * scale) / 2
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#eef4ec'
  ctx.fillRect(0, 0, width, height)

  // Draw channels first (behind rooms)
  if (showChannels && channelConfigs && allRooms && currentFloor !== undefined) {
    const occupancyMap = new Map<string, number>()
    renderChannels(ctx, channelConfigs, allRooms, currentFloor, occupancyMap, WORLD_W, WORLD_H, width, height)
  }

  function sx(x: number) {
    return ox + x * scale
  }
  function sy(y: number) {
    return oy + y * scale
  }

  ctx.fillStyle = '#d6dfd3'
  ctx.fillRect(sx(0), sy(31), WORLD_W * scale, 7 * scale)
  ctx.fillRect(sx(47), sy(0), 9 * scale, WORLD_H * scale)
  ctx.fillRect(sx(0), sy(58), WORLD_W * scale, 5 * scale)

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

  rooms.forEach((room) => {
    const isSelected = room.id === selectedRoomId
    ctx.fillStyle = KIND_COLORS[room.kind]
    ctx.strokeStyle = isSelected ? '#111827' : '#30473e'
    ctx.lineWidth = isSelected ? 3 : 1.4
    roundRect(ctx, sx(room.x), sy(room.y), room.w * scale, room.h * scale, 5)
    ctx.fill()
    ctx.stroke()
    drawFloorPattern(ctx, sx(room.x), sy(room.y), room.w * scale, room.h * scale, room.kind)
    drawEquipment(ctx, room, sx, sy, scale)
    drawLabel(ctx, room, sx(room.x + 0.8), sy(room.y + 2.1), room.w * scale)
  })
}

function drawLabel(ctx: CanvasRenderingContext2D, room: PlacedRoom, x: number, y: number, roomWidth: number) {
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
  ctx.fillText(`${room.capacity} cap.`, x, y + Math.min(2, lines.length) * 12 + 3)
}

function drawEquipment(
  ctx: CanvasRenderingContext2D,
  room: PlacedRoom,
  sx: (x: number) => number,
  sy: (y: number) => number,
  scale: number,
) {
  const equipment = room.equipment.slice(0, Math.min(18, room.equipment.length * 3))
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
  ctx.globalAlpha = 0.2
  ctx.strokeStyle = kind === 'critical' || kind === 'surgery' ? '#7a4c28' : '#4d665d'
  ctx.lineWidth = 1
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
