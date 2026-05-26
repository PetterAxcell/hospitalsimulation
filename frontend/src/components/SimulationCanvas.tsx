import { useEffect, useMemo, useRef, useState } from 'react'
import { KIND_COLORS } from '../data/catalog'
import { center, roomByNode } from '../engine/geometry'
import { positionAt, runHospitalSimulation, type SimulationSettings } from '../engine/simulation'
import type { EquipmentKind, HospitalPlan, PlacedRoom, SimulationResult } from '../types'

interface SimulationCanvasProps {
  plan: HospitalPlan
  selectedFloor: number
  settings: SimulationSettings
  onResult: (result: SimulationResult) => void
}

const WORLD_W = 100
const WORLD_H = 70

export function SimulationCanvas({ plan, selectedFloor, settings, onResult }: SimulationCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [minute, setMinute] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [viewMode, setViewMode] = useState<'rpg' | 'flows' | 'rules'>('rpg')
  const result = useMemo(() => runHospitalSimulation(plan, settings), [plan, settings])

  useEffect(() => {
    onResult(result)
  }, [onResult, result])

  useEffect(() => {
    let frame = 0
    let previous = performance.now()
    function tick(now: number) {
      const delta = now - previous
      previous = now
      if (playing) {
        setMinute((value) => (value + (delta / 1000) * settings.speed) % result.durationMinutes)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, result.durationMinutes, settings.speed])

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
    drawSimulation(ctx, rect.width, rect.height, plan, selectedFloor, result, minute, viewMode)
  }, [minute, plan, result, selectedFloor, viewMode])

  return (
    <div className="simulation-stage">
      <div className="sim-controls">
        <button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? 'Pausa' : 'Play'}</button>
        <input
          type="range"
          min={0}
          max={result.durationMinutes}
          value={minute}
          onChange={(event) => {
            setMinute(Number(event.target.value))
            setPlaying(false)
          }}
        />
        <span>{formatTime(minute)}</span>
        <select value={viewMode} onChange={(event) => setViewMode(event.target.value as 'rpg' | 'flows' | 'rules')} aria-label="Capa visual">
          <option value="rpg">RPG</option>
          <option value="flows">Flujos</option>
          <option value="rules">Reglas</option>
        </select>
      </div>
      <canvas ref={canvasRef} className="hospital-canvas simulation-canvas" aria-label="Simulacion visual del hospital" />
    </div>
  )
}

function drawSimulation(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  plan: HospitalPlan,
  selectedFloor: number,
  result: SimulationResult,
  minute: number,
  viewMode: 'rpg' | 'flows' | 'rules',
) {
  const scale = Math.min(width / WORLD_W, height / WORLD_H)
  const ox = (width - WORLD_W * scale) / 2
  const oy = (height - WORLD_H * scale) / 2
  const sx = (x: number) => ox + x * scale
  const sy = (y: number) => oy + y * scale
  const rooms = plan.rooms.filter((room) => room.floor === selectedFloor)
  ctx.clearRect(0, 0, width, height)
  drawGameBackground(ctx, sx, sy, scale, selectedFloor)
  drawCampusRoutes(ctx, sx, sy, scale, selectedFloor)

  rooms.forEach((room) => {
    const pressure = Math.min(1, (result.roomPressure[room.id] ?? 0) / Math.max(1, room.capacity * 1.6))
    drawRoomShell(ctx, room, sx, sy, scale, pressure)
    drawRoomFurniture(ctx, room, sx, sy, scale)
    if (pressure > 0.18) {
      ctx.fillStyle = `rgba(214, 40, 40, ${0.08 + pressure * 0.28})`
      ctx.fillRect(sx(room.x), sy(room.y), room.w * scale, room.h * scale)
    }
    drawRoomLabel(ctx, room, sx, sy, scale, `${result.roomPressure[room.id] ?? 0}/${room.capacity}`)
  })

  if (viewMode === 'flows' || viewMode === 'rules') {
    drawFlowOverlay(ctx, plan, selectedFloor, sx, sy, scale, viewMode)
  }

  const active = result.agents
    .map((agent) => ({ agent, pos: positionAt(agent, plan.rooms, minute) }))
    .filter((item) => item.pos && item.pos.room.floor === selectedFloor)

  active.forEach(({ agent, pos }) => {
    if (!pos) return
    drawPerson(ctx, sx(pos.x), sy(pos.y), scale, agent.color, agent.role, pos.moving)
  })

  drawLegend(ctx, width, height, viewMode)
}

function drawGameBackground(
  ctx: CanvasRenderingContext2D,
  sx: (x: number) => number,
  sy: (y: number) => number,
  scale: number,
  floor: number,
) {
  ctx.fillStyle = floor === 0 ? '#76d957' : '#d8ddca'
  ctx.fillRect(sx(0), sy(0), WORLD_W * scale, WORLD_H * scale)
  for (let y = 0; y < WORLD_H; y += 2) {
    for (let x = 0; x < WORLD_W; x += 2) {
      const n = (x * 19 + y * 31 + floor * 7) % 17
      if (n === 0) {
        ctx.fillStyle = floor === 0 ? '#62bf4a' : '#c8ceb9'
        ctx.fillRect(sx(x + 0.35), sy(y + 0.25), Math.max(1, scale * 0.35), Math.max(1, scale * 0.18))
      }
    }
  }
  ctx.strokeStyle = 'rgba(52, 72, 61, 0.16)'
  ctx.lineWidth = 1
  for (let x = 0; x <= WORLD_W; x += 2) {
    ctx.beginPath()
    ctx.moveTo(sx(x), sy(0))
    ctx.lineTo(sx(x), sy(WORLD_H))
    ctx.stroke()
  }
  for (let y = 0; y <= WORLD_H; y += 2) {
    ctx.beginPath()
    ctx.moveTo(sx(0), sy(y))
    ctx.lineTo(sx(WORLD_W), sy(y))
    ctx.stroke()
  }
}

function drawCampusRoutes(ctx: CanvasRenderingContext2D, sx: (x: number) => number, sy: (y: number) => number, scale: number, floor: number) {
  const pathColor = floor === 0 ? '#d8dec9' : '#cfd6c3'
  ctx.fillStyle = pathColor
  ctx.strokeStyle = '#aeb9a8'
  ctx.lineWidth = Math.max(1, scale * 0.16)
  rect(ctx, sx(0), sy(31), WORLD_W * scale, 7 * scale, pathColor, true)
  rect(ctx, sx(47), sy(0), 9 * scale, WORLD_H * scale, pathColor, true)
  rect(ctx, sx(0), sy(58), WORLD_W * scale, 5 * scale, pathColor, true)
  if (floor === 0) {
    rect(ctx, sx(84), sy(8), 16 * scale, 7 * scale, '#5f6970', false)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(sx(87), sy(11), 9 * scale, scale * 0.4)
  }
}

function drawRoomShell(
  ctx: CanvasRenderingContext2D,
  room: PlacedRoom,
  sx: (x: number) => number,
  sy: (y: number) => number,
  scale: number,
  pressure: number,
) {
  const x = sx(room.x)
  const y = sy(room.y)
  const w = room.w * scale
  const h = room.h * scale
  ctx.fillStyle = KIND_COLORS[room.kind]
  ctx.strokeStyle = pressure > 0.9 ? '#d62828' : '#263a32'
  ctx.lineWidth = pressure > 0.9 ? 3 : Math.max(2, scale * 0.18)
  rect(ctx, x, y, w, h, KIND_COLORS[room.kind], true)
  ctx.strokeStyle = 'rgba(255,255,255,0.46)'
  ctx.lineWidth = 1
  for (let ix = x + scale * 2; ix < x + w; ix += scale * 2) {
    ctx.beginPath()
    ctx.moveTo(ix, y)
    ctx.lineTo(ix, y + h)
    ctx.stroke()
  }
  for (let iy = y + scale * 2; iy < y + h; iy += scale * 2) {
    ctx.beginPath()
    ctx.moveTo(x, iy)
    ctx.lineTo(x + w, iy)
    ctx.stroke()
  }
  ctx.fillStyle = '#5b6a62'
  ctx.fillRect(x + w / 2 - scale * 1.1, y + h - scale * 0.25, scale * 2.2, scale * 0.5)
}

function drawRoomFurniture(
  ctx: CanvasRenderingContext2D,
  room: PlacedRoom,
  sx: (x: number) => number,
  sy: (y: number) => number,
  scale: number,
) {
  if (room.simulationNode === 'arrival_ambulance') {
    for (let i = 0; i < Math.min(4, Math.max(1, Math.floor(room.capacity / 3))); i += 1) {
      drawEquipmentGlyph(ctx, 'ambulance', sx(room.x + 1.2 + i * 3.2), sy(room.y + room.h - 2.4), scale)
    }
    drawEquipmentGlyph(ctx, 'stretcher', sx(room.x + 1.2), sy(room.y + 1.7), scale)
    return
  }
  if (room.simulationNode === 'vertical_core') {
    drawEquipmentGlyph(ctx, 'elevator', sx(room.x + 1.2), sy(room.y + 1.2), scale)
    drawEquipmentGlyph(ctx, 'stairs', sx(room.x + 4.4), sy(room.y + 1.3), scale)
    drawEquipmentGlyph(ctx, 'stairs', sx(room.x + 4.4), sy(room.y + 4.0), scale)
    return
  }
  if (room.simulationNode === 'emergency_stair') {
    drawEquipmentGlyph(ctx, 'emergencyStairs', sx(room.x + 1.0), sy(room.y + 1.2), scale)
    drawEquipmentGlyph(ctx, 'fireDoor', sx(room.x + 1.2), sy(room.y + room.h - 2.2), scale)
    drawEquipmentGlyph(ctx, 'smokeControl', sx(room.x + 2.9), sy(room.y + room.h - 2.2), scale)
    return
  }
  if (room.simulationNode === 'refuge_area' || room.simulationNode === 'fire_sector') {
    drawEquipmentGlyph(ctx, room.simulationNode === 'refuge_area' ? 'refugeArea' : 'sprinkler', sx(room.x + 1.1), sy(room.y + 1.4), scale)
    drawEquipmentGlyph(ctx, 'fireDoor', sx(room.x + room.w - 2.0), sy(room.y + room.h - 2.3), scale)
    drawEquipmentGlyph(ctx, 'smokeControl', sx(room.x + 3.3), sy(room.y + 1.4), scale)
    return
  }
  const count = equipmentCount(room)
  for (let i = 0; i < count; i += 1) {
    const kind = room.equipment[i % room.equipment.length]
    const cols = Math.max(2, Math.floor(room.w / 4))
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = room.x + 1.1 + col * 3.3
    const y = room.y + room.h - 2.5 - row * 2.5
    if (y > room.y + 3.3) drawEquipmentGlyph(ctx, kind, sx(x), sy(y), scale)
  }
}

function equipmentCount(room: PlacedRoom) {
  if (room.kind === 'inpatient') return Math.min(42, Math.max(8, Math.round(room.capacity / 15)))
  if (room.kind === 'critical') return Math.min(20, Math.max(6, Math.round(room.capacity / 5)))
  if (room.kind === 'emergency') return Math.min(28, Math.max(5, Math.round(room.capacity / 4)))
  if (room.kind === 'surgery') return Math.min(16, Math.max(5, Math.round(room.capacity / 3)))
  if (room.kind === 'waiting') return Math.min(34, Math.max(8, Math.round(room.capacity / 25)))
  return Math.min(18, Math.max(4, room.equipment.length * 3))
}

function drawRoomLabel(
  ctx: CanvasRenderingContext2D,
  room: PlacedRoom,
  sx: (x: number) => number,
  sy: (y: number) => number,
  scale: number,
  pressure: string,
) {
  const x = sx(room.x + 0.55)
  const y = sy(room.y + 0.65)
  const w = Math.min(room.w * scale - 8, 158)
  ctx.fillStyle = 'rgba(255,255,255,0.88)'
  ctx.fillRect(x, y, w, 32)
  ctx.fillStyle = '#17201c'
  ctx.font = '700 11px Inter, sans-serif'
  ctx.fillText(room.name.slice(0, 24), x + 5, y + 13)
  ctx.font = '10px Inter, sans-serif'
  ctx.fillText(`${room.floor}F · ${pressure}`, x + 5, y + 26)
}

function drawFlowOverlay(
  ctx: CanvasRenderingContext2D,
  plan: HospitalPlan,
  floor: number,
  sx: (x: number) => number,
  sy: (y: number) => number,
  scale: number,
  mode: 'flows' | 'rules',
) {
  const pairs: Array<[string, string, string, string]> = mode === 'flows'
    ? [
        ['registration', 'triage', '#1d4ed8', 'publico'],
        ['arrival_ambulance', 'resus', '#d62828', 'ambulancia'],
        ['ed_bay', 'imaging', '#2a9d8f', 'clinico'],
        ['or', 'pacu', '#2a9d8f', 'quirurgico'],
        ['logistics', 'or', '#343a40', 'logistica'],
      ]
    : [
        ['arrival_ambulance', 'resus', '#d62828', 'emergencia'],
        ['resus', 'or', '#d62828', 'trauma'],
        ['or', 'pacu', '#2a9d8f', 'OR-PACU'],
        ['pacu', 'icu', '#2a9d8f', 'criticos'],
        ['logistics', 'or', '#6b7280', 'limpio/sucio'],
        ['vertical_core', 'ward', '#7c3aed', 'evacuacion'],
      ]
  for (const [aNode, bNode, color, label] of pairs) {
    const a = roomByNode(plan.rooms, aNode as never)
    const b = roomByNode(plan.rooms, bNode as never)
    if (!a || !b) continue
    if (a.floor !== floor && b.floor !== floor) continue
    const aPoint = a.floor === floor ? center(a) : { x: 51.5, y: 24 }
    const bPoint = b.floor === floor ? center(b) : { x: 51.5, y: 24 }
    drawArrow(ctx, sx(aPoint.x), sy(aPoint.y), sx(bPoint.x), sy(bPoint.y), color, label, scale)
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  label: string,
  scale: number,
) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = Math.max(3, scale * 0.35)
  ctx.globalAlpha = 0.78
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const size = Math.max(8, scale * 1.6)
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - Math.cos(angle - 0.45) * size, y2 - Math.sin(angle - 0.45) * size)
  ctx.lineTo(x2 - Math.cos(angle + 0.45) * size, y2 - Math.sin(angle + 0.45) * size)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.font = '700 11px Inter, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  const tx = (x1 + x2) / 2
  const ty = (y1 + y2) / 2
  ctx.fillRect(tx - 4, ty - 14, label.length * 7 + 8, 18)
  ctx.fillStyle = color
  ctx.fillText(label, tx, ty)
  ctx.restore()
}

function drawEquipmentGlyph(ctx: CanvasRenderingContext2D, kind: EquipmentKind, x: number, y: number, scale: number) {
  const s = Math.max(5, scale * 1.08)
  ctx.save()
  ctx.strokeStyle = '#35463f'
  ctx.lineWidth = 1
  ctx.fillStyle = '#f8fafc'
  if (kind === 'bed' || kind === 'stretcher') {
    rect(ctx, x, y, s * 2, s * 0.82, '#f8fafc', true)
    rect(ctx, x, y, s * 0.38, s * 0.82, '#9bc0d9', false)
  } else if (kind === 'chair') {
    rect(ctx, x, y, s * 0.78, s * 0.78, '#b08968', true)
  } else if (kind === 'desk' || kind === 'nurseStation') {
    rect(ctx, x, y, s * 1.9, s * 0.72, '#9c6b3f', true)
  } else if (kind === 'monitor') {
    rect(ctx, x, y, s, s * 0.75, '#1f2937', true)
    rect(ctx, x + 2, y + 2, s - 4, s * 0.75 - 4, '#76e4b4', false)
  } else if (kind === 'sink') {
    ctx.beginPath()
    ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.44, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  } else if (kind === 'labBench' || kind === 'shelves' || kind === 'cleanStorage' || kind === 'dirtyUtility') {
    rect(ctx, x, y, s * 1.75, s * 0.85, kind === 'dirtyUtility' ? '#9b5964' : '#8d99ae', true)
  } else if (kind === 'imagingGantry') {
    ctx.beginPath()
    ctx.arc(x + s, y + s, s * 0.95, 0, Math.PI * 2)
    ctx.stroke()
    rect(ctx, x + s * 0.35, y + s * 0.8, s * 1.4, s * 0.35, '#d9e4ea', false)
  } else if (kind === 'orTable' || kind === 'sterileTable') {
    rect(ctx, x, y, s * 2.2, s * 0.78, kind === 'orTable' ? '#dfe8ef' : '#d0f0de', true)
  } else if (kind === 'elevator') {
    rect(ctx, x, y, s * 0.8, s * 1.5, '#b8c4cc', true)
    rect(ctx, x + s, y, s * 0.8, s * 1.5, '#b8c4cc', true)
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
    rect(ctx, x, y, s * 0.42, s * 1.4, '#ef4444', true)
    ctx.beginPath()
    ctx.arc(x + s * 0.42, y + s * 1.4, s * 0.9, -Math.PI / 2, 0)
    ctx.stroke()
  } else if (kind === 'smokeControl') {
    ctx.beginPath()
    ctx.arc(x + s * 0.65, y + s * 0.65, s * 0.62, 0, Math.PI * 2)
    ctx.fillStyle = '#dbeafe'
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
    rect(ctx, x, y, s * 1.7, s, '#ecfdf5', true)
    rect(ctx, x + s * 0.18, y + s * 0.18, s * 0.38, s * 0.62, '#047857', false)
    rect(ctx, x + s * 0.7, y + s * 0.45, s * 0.7, s * 0.16, '#047857', false)
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
    rect(ctx, x, y, s * 1.7, s, '#facc15', true)
    rect(ctx, x + s * 0.2, y + s * 0.25, s * 0.55, s * 0.45, '#374151', false)
    rect(ctx, x + s * 0.95, y + s * 0.3, s * 0.5, s * 0.14, '#374151', false)
  } else if (kind === 'ambulance') {
    rect(ctx, x, y, s * 2.3, s, '#ffffff', true)
    rect(ctx, x + s * 0.92, y + s * 0.22, s * 0.18, s * 0.56, '#d62828', false)
    rect(ctx, x + s * 0.72, y + s * 0.42, s * 0.58, s * 0.18, '#d62828', false)
  } else if (kind === 'garden') {
    ctx.fillStyle = '#2f9a44'
    ctx.beginPath()
    ctx.arc(x + s * 0.5, y + s * 0.45, s * 0.45, 0, Math.PI * 2)
    ctx.fill()
  } else {
    rect(ctx, x, y, s, s, '#f8fafc', true)
  }
  ctx.restore()
}

function drawPerson(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: string, role: string, moving: boolean) {
  const s = Math.max(7, scale * (moving ? 1.1 : 0.95))
  ctx.fillStyle = 'rgba(31,41,55,0.22)'
  ctx.fillRect(x - s * 0.3, y + s * 0.25, s * 0.6, s * 0.16)
  ctx.fillStyle = role === 'patient' ? color : '#f8f9fa'
  ctx.fillRect(x - s * 0.28, y - s * 0.22, s * 0.56, s * 0.5)
  ctx.fillStyle = role === 'patient' ? '#293241' : color
  ctx.fillRect(x - s * 0.22, y + s * 0.2, s * 0.16, s * 0.32)
  ctx.fillRect(x + s * 0.06, y + s * 0.2, s * 0.16, s * 0.32)
  ctx.fillStyle = '#d8a878'
  ctx.fillRect(x - s * 0.2, y - s * 0.62, s * 0.4, s * 0.34)
  ctx.fillStyle = '#2b2d42'
  ctx.fillRect(x - s * 0.23, y - s * 0.72, s * 0.46, s * 0.14)
  if (role !== 'patient') {
    ctx.fillStyle = '#d62828'
    ctx.fillRect(x - s * 0.04, y - s * 0.16, s * 0.08, s * 0.22)
    ctx.fillRect(x - s * 0.12, y - s * 0.09, s * 0.24, s * 0.08)
  }
}

function drawLegend(ctx: CanvasRenderingContext2D, width: number, height: number, mode: string) {
  const items = mode === 'rules'
    ? [['#d62828', 'emergencia'], ['#2a9d8f', 'clinico'], ['#6b7280', 'limpio/sucio'], ['#7c3aed', 'evacuacion']]
    : [['#d62828', 'critico'], ['#f4a261', 'urgente'], ['#2a9d8f', 'leve'], ['#f8f9fa', 'staff']]
  const boxW = 420
  const x = width - boxW - 14
  const y = height - 42
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.fillRect(x, y, boxW, 28)
  ctx.strokeStyle = '#c9d4ce'
  ctx.strokeRect(x, y, boxW, 28)
  ctx.font = '700 11px Inter, sans-serif'
  items.forEach(([color, label], index) => {
    const px = x + 10 + index * 100
    ctx.fillStyle = color
    ctx.fillRect(px, y + 8, 12, 12)
    ctx.strokeStyle = '#33413b'
    ctx.strokeRect(px, y + 8, 12, 12)
    ctx.fillStyle = '#17201c'
    ctx.fillText(label, px + 18, y + 18)
  })
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, stroke: boolean) {
  ctx.fillStyle = fill
  ctx.fillRect(x, y, w, h)
  if (stroke) ctx.strokeRect(x, y, w, h)
}

function formatTime(minutes: number) {
  const hour = Math.floor(minutes / 60)
  const minute = Math.floor(minutes % 60)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
