import Phaser from 'phaser'
import { useEffect, useMemo, useRef, useState } from 'react'
import { KIND_COLORS } from '../data/catalog'
import { connectedCorridorGroups, disconnectedPassages, doorWorldPosition } from '../engine/circulation'
import { center, roomByNode } from '../engine/geometry'
import { positionAt, runHospitalSimulation, type SimulationSettings } from '../engine/simulation'
import type { AgentRole, EquipmentKind, HospitalPlan, PatientCaseFilter, PlacedRoom, RoomKind, SimAgent, SimulationResult } from '../types'

interface SimulationCanvasProps {
  plan: HospitalPlan
  selectedFloor: number
  settings: SimulationSettings
  selectedCaseId: PatientCaseFilter
  onSelectCase: (caseId: PatientCaseFilter) => void
}

type ViewMode = 'rpg' | 'flows' | 'rules'

interface SimulationSnapshot {
  plan: HospitalPlan
  selectedFloor: number
  result: SimulationResult
  minute: number
  viewMode: ViewMode
  selectedCaseId: PatientCaseFilter
}

interface SceneLayers {
  staticLayer: Phaser.GameObjects.Container
  overlayLayer: Phaser.GameObjects.Container
  occupancyLayer: Phaser.GameObjects.Container
  agentLayer: Phaser.GameObjects.Container
}

interface RoomOccupancy {
  total: number
  patients: number
  staff: number
}

type AgentPosition = NonNullable<ReturnType<typeof positionAt>>
type ActiveAgent = { agent: SimAgent; pos: AgentPosition }

const WORLD_W = 100
const WORLD_H = 70
const TILE = 16
const WORLD_PX_W = WORLD_W * TILE
const WORLD_PX_H = WORLD_H * TILE

const ROOM_FLOOR_COLORS: Record<RoomKind, string> = {
  public: '#b9e3ef',
  waiting: '#e6f0f7',
  emergency: '#f0b06f',
  diagnostic: '#b8dfc6',
  surgery: '#e8cc74',
  critical: '#df765d',
  inpatient: '#93d2b7',
  ambulatory: '#c6e7cf',
  maternalChild: '#f2bfd8',
  oncology: '#c98fa5',
  pharmacy: '#cfbfeb',
  laboratory: '#b9d8eb',
  logistics: '#a1acbd',
  research: '#c5b4dd',
  staff: '#d1dec6',
  technical: '#c4ccd3',
  vertical: '#dce4ea',
  circulation: '#d8dec9',
  green: '#8bcf7f',
  future: '#d4d6d0',
}

const ROOM_WALL_COLORS: Record<RoomKind, string> = {
  public: '#587f8a',
  waiting: '#6b8795',
  emergency: '#8e5f35',
  diagnostic: '#5e846b',
  surgery: '#80692d',
  critical: '#8c3c2f',
  inpatient: '#4c8068',
  ambulatory: '#698f72',
  maternalChild: '#925d78',
  oncology: '#7b4d5f',
  pharmacy: '#76639d',
  laboratory: '#5f7d92',
  logistics: '#4c5565',
  research: '#725d8b',
  staff: '#687b5f',
  technical: '#636d76',
  vertical: '#59646d',
  circulation: '#a6b09f',
  green: '#3d8e42',
  future: '#7b7f78',
}

export function SimulationCanvas({ plan, selectedFloor, settings, selectedCaseId, onSelectCase }: SimulationCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const sceneRef = useRef<HospitalGameScene | null>(null)
  const [minute, setMinute] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('rpg')
  const result = useMemo(() => runHospitalSimulation(plan, settings), [plan, settings])

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
    if (!hostRef.current || gameRef.current) return

    const scene = new HospitalGameScene()
    sceneRef.current = scene
    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      backgroundColor: '#17201c',
      pixelArt: false,
      roundPixels: false,
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: hostRef.current.clientWidth,
        height: hostRef.current.clientHeight,
      },
      render: {
        antialias: true,
        pixelArt: false,
        roundPixels: false,
      },
      scene,
    })

    return () => {
      gameRef.current?.destroy(true)
      gameRef.current = null
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    sceneRef.current?.setSnapshot({ plan, selectedFloor, result, minute, viewMode, selectedCaseId })
  }, [minute, plan, result, selectedCaseId, selectedFloor, viewMode])

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
        <select value={viewMode} onChange={(event) => setViewMode(event.target.value as ViewMode)} aria-label="Capa visual">
          <option value="rpg">RPG</option>
          <option value="flows">Flujos</option>
          <option value="rules">Reglas</option>
        </select>
        <select value={selectedCaseId} onChange={(event) => onSelectCase(event.target.value as PatientCaseFilter)} aria-label="Caso clinico visible">
          <option value="all">Todos los casos</option>
          {result.caseStats.map((stat) => (
            <option key={stat.id} value={stat.id}>
              {stat.label}
            </option>
          ))}
        </select>
      </div>
      <div ref={hostRef} className="phaser-stage" role="img" aria-label="Simulacion top-down del hospital" />
    </div>
  )
}

class HospitalGameScene extends Phaser.Scene {
  private snapshot: SimulationSnapshot | null = null
  private staticKey = ''
  private layers: SceneLayers | null = null
  private agentSprites = new Map<string, Phaser.GameObjects.Container>()
  private occupancyBadges = new Map<string, Phaser.GameObjects.Container>()

  constructor() {
    super('hospital-game-scene')
  }

  create() {
    this.scale.on('resize', this.layoutCamera, this)
    this.layoutCamera()
    if (this.snapshot) {
      this.drawStatic(this.snapshot)
      this.updateAgents(this.snapshot)
    }
  }

  setSnapshot(snapshot: SimulationSnapshot) {
    this.snapshot = snapshot
    if (!this.sys.settings.active) return

    const key = staticSceneKey(snapshot)
    if (key !== this.staticKey) {
      this.staticKey = key
      this.drawStatic(snapshot)
    }
    this.updateAgents(snapshot)
    this.layoutCamera()
  }

  private drawStatic(snapshot: SimulationSnapshot) {
    this.children.removeAll(true)
    this.agentSprites.clear()
    this.occupancyBadges.clear()
    this.layers = {
      staticLayer: this.add.container(0, 0).setDepth(0),
      overlayLayer: this.add.container(0, 0).setDepth(40),
      occupancyLayer: this.add.container(0, 0).setDepth(62),
      agentLayer: this.add.container(0, 0).setDepth(80),
    }

    this.drawBackground(snapshot)
    this.drawAmbulanceApron(snapshot)

    const rooms = snapshot.plan.rooms.filter((room) => room.floor === snapshot.selectedFloor)
    const disconnectedIds = new Set(disconnectedPassages(snapshot.plan.rooms).map((room) => room.id))
    connectedCorridorGroups(snapshot.plan.rooms, snapshot.selectedFloor).forEach((group) => {
      this.drawCorridorGroup(group, group.some((room) => disconnectedIds.has(room.id)))
    })
    rooms.filter((room) => room.kind !== 'circulation').forEach((room) => {
      this.drawRoom(room, snapshot.result, disconnectedIds.has(room.id))
    })

    if (snapshot.viewMode === 'flows' || snapshot.viewMode === 'rules') {
      this.drawFlowOverlay(snapshot)
    }
    this.drawLegend(snapshot.viewMode)
  }

  private drawCorridorGroup(rooms: PlacedRoom[], disconnectedPassage: boolean) {
    if (!this.layers || rooms.length === 0) return
    const g = this.add.graphics()
    this.layers.staticLayer.add(g)

    const fill = ROOM_FLOOR_COLORS.circulation
    const stroke = disconnectedPassage ? '#dc2626' : ROOM_WALL_COLORS.circulation
    const cells = corridorCells(rooms)
    g.fillStyle(toColor(fill), 1)
    cells.forEach((cell) => {
      const [x, y] = cell.split(':').map(Number)
      g.fillRect(tileX(x), tileY(y), TILE, TILE)
    })

    g.lineStyle(2, toColor(stroke), 1)
    cells.forEach((cell) => {
      const [x, y] = cell.split(':').map(Number)
      if (!cells.has(cellKey(x, y - 1))) g.lineBetween(tileX(x), tileY(y), tileX(x + 1), tileY(y))
      if (!cells.has(cellKey(x + 1, y))) g.lineBetween(tileX(x + 1), tileY(y), tileX(x + 1), tileY(y + 1))
      if (!cells.has(cellKey(x, y + 1))) g.lineBetween(tileX(x), tileY(y + 1), tileX(x + 1), tileY(y + 1))
      if (!cells.has(cellKey(x - 1, y))) g.lineBetween(tileX(x), tileY(y), tileX(x), tileY(y + 1))
    })

    g.lineStyle(1, toColor('#a7b3a4'), 0.3)
    const bounds = boundsForRooms(rooms)
    for (let x = Math.ceil(bounds.x); x < bounds.x + bounds.w + bounds.h; x += 2) {
      g.lineBetween(tileX(x), tileY(bounds.y), tileX(x - bounds.h), tileY(bounds.y + bounds.h))
    }

    if (bounds.w >= 12 || bounds.h >= 12) {
      const label = rooms.length === 1 ? rooms[0].name : `Red pasillos (${rooms.length})`
      this.addPixelText(label.slice(0, 26), bounds.x + 0.7, bounds.y + 0.7, '#33413b', '#f7faf7', this.layers.staticLayer, 10)
    }
  }

  private drawBackground(snapshot: SimulationSnapshot) {
    if (!this.layers) return
    const g = this.add.graphics()
    this.layers.staticLayer.add(g)
    const base = snapshot.selectedFloor === 0 ? '#73d85a' : '#d6dbca'
    const speck = snapshot.selectedFloor === 0 ? '#56b747' : '#c5cbb8'
    g.fillStyle(toColor(base), 1)
    g.fillRect(0, 0, WORLD_PX_W, WORLD_PX_H)

    for (let y = 0; y < WORLD_H; y += 1) {
      for (let x = 0; x < WORLD_W; x += 1) {
        const n = (x * 17 + y * 29 + snapshot.selectedFloor * 11) % 23
        if (n === 0) {
          g.fillStyle(toColor(speck), 0.7)
          g.fillRect(x * TILE + 4, y * TILE + 6, 6, 3)
        }
      }
    }

    if (snapshot.selectedFloor === 0) {
      this.drawPixelTree(10, 8)
      this.drawPixelTree(7, 17)
      this.drawPixelTree(89, 8)
      this.drawFlowerPatch(8, 24)
      this.drawFlowerPatch(92, 46)
    }
  }

  private drawAmbulanceApron(snapshot: SimulationSnapshot) {
    if (!this.layers) return
    if (snapshot.selectedFloor !== 0) return
    const g = this.add.graphics()
    this.layers.staticLayer.add(g)
    drawTileRect(g, 84, 8, 16, 7, '#68727a', '#374151')
    g.fillStyle(0xffffff, 1)
    g.fillRect(87 * TILE, 11 * TILE, 9 * TILE, 5)
    this.addPixelText('AMBULANCIAS', 84.8, 8.4, '#ffffff', '#47525c', this.layers.staticLayer, 10)
  }

  private drawRoom(room: PlacedRoom, result: SimulationResult, disconnectedPassage: boolean) {
    if (!this.layers) return
    const g = this.add.graphics()
    this.layers.staticLayer.add(g)

    const roomColor = ROOM_FLOOR_COLORS[room.kind] ?? KIND_COLORS[room.kind]
    const wallColor = disconnectedPassage ? '#dc2626' : ROOM_WALL_COLORS[room.kind] ?? '#374151'
    const pressure = Math.min(1, (result.roomPressure[room.id] ?? 0) / Math.max(1, room.capacity * 1.6))

    drawTileRect(g, room.x, room.y, room.w, room.h, roomColor, wallColor)
    drawRoomPattern(g, room)
    if (room.kind !== 'circulation') drawDoors(g, room)

    if (pressure > 0.18) {
      g.fillStyle(0xd62828, 0.08 + pressure * 0.26)
      g.fillRect(room.x * TILE, room.y * TILE, room.w * TILE, room.h * TILE)
    }

    this.drawFurniture(room)
    if (room.kind !== 'circulation' || room.w >= 12) {
      this.drawRoomLabel(room, result.roomPressure[room.id] ?? 0)
    }
  }

  private drawFurniture(room: PlacedRoom) {
    if (!this.layers) return
    if (room.kind === 'circulation') return
    const g = this.add.graphics()
    this.layers.staticLayer.add(g)

    if (room.simulationNode === 'arrival_ambulance') {
      for (let i = 0; i < Math.min(4, Math.max(1, Math.floor(room.capacity / 3))); i += 1) {
        drawEquipment(g, 'ambulance', room.x + 1.2 + i * 3.4, room.y + room.h - 2.8)
      }
      drawEquipment(g, 'stretcher', room.x + 1.2, room.y + 1.8)
      return
    }

    if (room.simulationNode === 'vertical_core') {
      drawEquipment(g, 'elevator', room.x + 1.2, room.y + 1.2)
      drawEquipment(g, 'elevator', room.x + 4.4, room.y + 1.2)
      return
    }

    if (room.simulationNode === 'emergency_stair') {
      drawEquipment(g, 'emergencyStairs', room.x + 1.1, room.y + 1.2)
      drawEquipment(g, 'fireDoor', room.x + 1.1, room.y + room.h - 2.2)
      drawEquipment(g, 'smokeControl', room.x + 3.0, room.y + room.h - 2.2)
      return
    }

    if (room.simulationNode === 'refuge_area' || room.simulationNode === 'fire_sector') {
      drawEquipment(g, room.simulationNode === 'refuge_area' ? 'refugeArea' : 'sprinkler', room.x + 1.2, room.y + 1.3)
      drawEquipment(g, 'fireDoor', room.x + room.w - 2.3, room.y + room.h - 2.4)
      drawEquipment(g, 'smokeControl', room.x + 3.6, room.y + 1.3)
      return
    }

    const count = equipmentCount(room)
    for (let i = 0; i < count; i += 1) {
      const kind = room.equipment[i % room.equipment.length]
      const cols = Math.max(2, Math.floor(room.w / 4))
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = room.x + 1.2 + col * 3.4
      const y = room.y + room.h - 2.7 - row * 2.6
      if (y > room.y + 3.2) drawEquipment(g, kind, x, y)
    }
  }

  private drawRoomLabel(room: PlacedRoom, pressure: number) {
    if (!this.layers) return
    const layout = roomLabelLayout(room)
    if (!layout) return

    const bg = this.add.rectangle(tileX(room.x + 0.45), tileY(room.y + 0.45), layout.width, layout.height, 0xffffff, 0.94)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0xaab6ae, 0.9)
    const label = this.add.text(
      tileX(room.x + 0.75),
      tileY(room.y + 0.62),
      `${truncateText(room.name, layout.titleChars)}\nDem ${pressure} | Cap ${room.capacity}`,
      {
      color: '#17201c',
      fontFamily: 'Arial, sans-serif',
      fontSize: `${layout.fontSize}px`,
      fontStyle: 'bold',
      lineSpacing: 2,
    },
    ).setResolution(2)
    this.layers.staticLayer.add([bg, label])
  }

  private drawFlowOverlay(snapshot: SimulationSnapshot) {
    if (!this.layers) return
    const pairs: Array<[string, string, string, string]> = snapshot.viewMode === 'flows'
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
          ['emergency_stair', 'refuge_area', '#dc2626', 'refugio'],
        ]

    const g = this.add.graphics()
    this.layers.overlayLayer.add(g)
    pairs.forEach(([aNode, bNode, color, label]) => {
      const a = roomByNode(snapshot.plan.rooms, aNode as never)
      const b = roomByNode(snapshot.plan.rooms, bNode as never)
      if (!a || !b) return
      if (a.floor !== snapshot.selectedFloor && b.floor !== snapshot.selectedFloor) return
      const aPoint = a.floor === snapshot.selectedFloor ? center(a) : { x: 51.5, y: 24 }
      const bPoint = b.floor === snapshot.selectedFloor ? center(b) : { x: 51.5, y: 24 }
      drawArrow(g, aPoint.x, aPoint.y, bPoint.x, bPoint.y, color)
      this.addPixelText(label, (aPoint.x + bPoint.x) / 2, (aPoint.y + bPoint.y) / 2 - 1, color, '#ffffff', this.layers?.overlayLayer, 11)
    })
  }

  private drawLegend(viewMode: ViewMode) {
    if (!this.layers) return
    const items = viewMode === 'rules'
      ? [['#d62828', 'emergencia'], ['#2a9d8f', 'clinico'], ['#6b7280', 'limpio/sucio'], ['#7c3aed', 'evacuacion']]
      : [['#d62828', 'critico'], ['#f4a261', 'urgente'], ['#2a9d8f', 'leve'], ['#f8f9fa', 'staff']]
    const group = this.add.container(WORLD_PX_W - 420, WORLD_PX_H - 42)
    const bg = this.add.rectangle(0, 0, 400, 28, 0xffffff, 0.92).setOrigin(0, 0).setStrokeStyle(1, 0xc9d4ce)
    group.add(bg)
    items.forEach(([color, label], index) => {
      const x = 10 + index * 96
      group.add(this.add.rectangle(x, 8, 12, 12, toColor(color)).setOrigin(0, 0).setStrokeStyle(1, 0x33413b))
      group.add(this.add.text(x + 18, 7, label, {
        color: '#17201c',
        fontFamily: 'Arial, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
      }).setResolution(2))
    })
    this.layers.overlayLayer.add(group)
  }

  private updateAgents(snapshot: SimulationSnapshot) {
    if (!this.layers) return
    const visibleAgents = snapshot.selectedCaseId === 'all'
      ? snapshot.result.agents
      : snapshot.result.agents.filter((agent) => agent.role === 'patient' && agent.caseId === snapshot.selectedCaseId)
    const active: ActiveAgent[] = visibleAgents
      .map((agent) => ({ agent, pos: positionAt(agent, snapshot.plan.rooms, snapshot.minute) }))
      .filter((item): item is ActiveAgent => item.pos !== null && item.pos.room.floor === snapshot.selectedFloor)

    const activeIds = new Set<string>()
    active.forEach(({ agent, pos }) => {
      activeIds.add(agent.id)
      const sprite = this.agentSprites.get(agent.id) ?? this.createAgentSprite(agent)
      const bob = pos.moving ? Math.sin((snapshot.minute + Number(agent.id.replace(/\D/g, ''))) * 0.6) * 2 : 0
      sprite.setPosition(tileX(pos.x), tileY(pos.y) + bob)
      sprite.setVisible(true)
      sprite.setDepth(pos.y * TILE)
      const roleLabel = sprite.getData('roleLabel') as Phaser.GameObjects.Text | undefined
      if (roleLabel) roleLabel.setVisible(snapshot.viewMode !== 'rpg')
    })

    this.agentSprites.forEach((sprite, id) => {
      if (!activeIds.has(id)) sprite.setVisible(false)
    })

    this.updateOccupancy(snapshot, active)
  }

  private updateOccupancy(snapshot: SimulationSnapshot, active: ActiveAgent[]) {
    if (!this.layers) return
    const counts = new Map<string, RoomOccupancy>()

    active.forEach(({ agent, pos }) => {
      const current = counts.get(pos.room.id) ?? { total: 0, patients: 0, staff: 0 }
      current.total += 1
      if (agent.role === 'patient') current.patients += 1
      else current.staff += 1
      counts.set(pos.room.id, current)
    })

    const visibleIds = new Set<string>()
    snapshot.plan.rooms
      .filter((room) => room.floor === snapshot.selectedFloor && room.kind !== 'green' && room.kind !== 'future')
      .forEach((room) => {
        const count = counts.get(room.id) ?? { total: 0, patients: 0, staff: 0 }
        if (room.kind === 'circulation' && count.total === 0) return
        visibleIds.add(room.id)
        const badge = this.occupancyBadges.get(room.id) ?? this.createOccupancyBadge(room)
        this.updateOccupancyBadge(badge, room, count)
      })

    this.occupancyBadges.forEach((badge, id) => {
      badge.setVisible(visibleIds.has(id))
    })
  }

  private createOccupancyBadge(room: PlacedRoom) {
    const container = this.add.container(0, 0)
    const bg = this.add.rectangle(0, 0, 68, 25, 0xffffff, 0.92)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0x66736e, 0.9)
    const text = this.add.text(7, 4, '', {
      color: '#17201c',
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      lineSpacing: 1,
    }).setResolution(2)
    container.add([bg, text])
    container.setData('bg', bg)
    container.setData('text', text)
    this.layers?.occupancyLayer.add(container)
    this.occupancyBadges.set(room.id, container)
    return container
  }

  private updateOccupancyBadge(container: Phaser.GameObjects.Container, room: PlacedRoom, count: RoomOccupancy) {
    const bg = container.getData('bg') as Phaser.GameObjects.Rectangle
    const text = container.getData('text') as Phaser.GameObjects.Text
    const hasStaff = count.staff > 0
    text.setText(hasStaff ? `${count.total} pers\nP ${count.patients} S ${count.staff}` : `${count.total} pers`)
    text.setPosition(7, hasStaff ? 4 : 5)

    const width = Math.max(64, Math.min(room.w * TILE - 8, text.width + 14))
    const height = hasStaff ? 39 : 27
    const ratio = room.capacity > 0 ? count.total / room.capacity : count.total > 0 ? 1 : 0
    const fill = ratio > 0.85 ? '#fee2e2' : ratio > 0.45 ? '#fff3c4' : count.total > 0 ? '#e4f3ee' : '#ffffff'
    const stroke = ratio > 0.85 ? '#dc2626' : ratio > 0.45 ? '#d9a441' : '#6aa89b'
    bg.setSize(width, height)
    bg.setFillStyle(toColor(fill), count.total > 0 ? 0.96 : 0.72)
    bg.setStrokeStyle(1, toColor(stroke), count.total > 0 ? 1 : 0.5)

    const x = Math.max(tileX(room.x) + 4, tileX(room.x + room.w) - width - 5)
    const y = Math.max(tileY(room.y) + 4, tileY(room.y + room.h) - height - 5)
    container.setPosition(x, y)
  }

  private createAgentSprite(agent: SimAgent) {
    const container = this.add.container(0, 0)
    const roleColor = agent.role === 'patient' ? agent.color : staffColor(agent.role)
    const shadow = this.add.rectangle(0, 8, 12, 4, 0x111827, 0.25)
    const body = this.add.rectangle(0, 0, 9, 11, toColor(roleColor)).setStrokeStyle(1, 0x17201c)
    const head = this.add.rectangle(0, -8, 7, 6, 0xd8a878).setStrokeStyle(1, 0x17201c)
    const hair = this.add.rectangle(0, -12, 8, 3, 0x2b2d42)
    const leftLeg = this.add.rectangle(-3, 7, 3, 6, 0x293241)
    const rightLeg = this.add.rectangle(3, 7, 3, 6, 0x293241)
    container.add([shadow, leftLeg, rightLeg, body, head, hair])

    if (agent.role !== 'patient') {
      container.add(this.add.rectangle(0, 0, 3, 10, 0xf8f9fa, 0.9))
      container.add(this.add.rectangle(0, -1, 8, 2, 0xd62828))
    }

    const roleLabel = this.add.text(8, -18, shortAgentLabel(agent), {
      color: '#17201c',
      backgroundColor: '#ffffff',
      fontFamily: 'Arial, sans-serif',
      fontSize: '11px',
      fontStyle: 'bold',
      padding: { x: 3, y: 1 },
    }).setResolution(2)
    roleLabel.setVisible(false)
    container.add(roleLabel)
    container.setData('roleLabel', roleLabel)
    this.layers?.agentLayer.add(container)
    this.agentSprites.set(agent.id, container)
    return container
  }

  private addPixelText(text: string, x: number, y: number, color: string, background: string, layer?: Phaser.GameObjects.Container, fontSize = 10) {
    const label = this.add.text(tileX(x), tileY(y), text, {
      color,
      backgroundColor: background,
      fontFamily: 'Arial, sans-serif',
      fontSize: `${fontSize}px`,
      fontStyle: 'bold',
      padding: { x: 4, y: 2 },
    }).setResolution(2)
    layer?.add(label)
    return label
  }

  private drawPixelTree(x: number, y: number) {
    if (!this.layers) return
    const g = this.add.graphics()
    this.layers.staticLayer.add(g)
    g.fillStyle(0x8b5a2b, 1)
    g.fillRect(tileX(x + 1.1), tileY(y + 2.0), 10, 22)
    g.fillStyle(0x2f8f46, 1)
    g.fillRect(tileX(x), tileY(y + 0.7), 36, 16)
    g.fillRect(tileX(x + 0.6), tileY(y), 24, 18)
    g.fillStyle(0x256f38, 1)
    g.fillRect(tileX(x + 0.3), tileY(y + 1.4), 30, 8)
  }

  private drawFlowerPatch(x: number, y: number) {
    if (!this.layers) return
    const g = this.add.graphics()
    this.layers.staticLayer.add(g)
    const colors = [0xec4899, 0xfacc15, 0x38bdf8]
    for (let i = 0; i < 16; i += 1) {
      const px = tileX(x + (i % 4) * 0.8)
      const py = tileY(y + Math.floor(i / 4) * 0.8)
      g.fillStyle(colors[i % colors.length], 1)
      g.fillRect(px, py, 4, 4)
    }
  }

  private layoutCamera() {
    if (!this.cameras.main) return
    const zoom = Math.max(this.scale.width / WORLD_PX_W, this.scale.height / WORLD_PX_H)
    this.cameras.main.setZoom(zoom)
    this.cameras.main.centerOn(WORLD_PX_W / 2, WORLD_PX_H / 2)
  }
}

function staticSceneKey(snapshot: SimulationSnapshot) {
  const rooms = snapshot.plan.rooms
    .filter((room) => room.floor === snapshot.selectedFloor)
    .map((room) => {
      const doors = (room.doors ?? []).map((door) => `${door.id}:${door.side}:${door.offset}`).join(',')
      const connections = (room.connectionIds ?? []).join(',')
      return `${room.id}:${room.x}:${room.y}:${room.w}:${room.h}:${room.kind}:${doors}:${connections}:${snapshot.result.roomPressure[room.id] ?? 0}`
    })
    .join('|')
  return `${snapshot.selectedFloor}:${snapshot.viewMode}:${snapshot.result.kpis.completed}:${rooms}`
}

function corridorCells(rooms: PlacedRoom[]): Set<string> {
  const cells = new Set<string>()
  rooms.forEach((room) => {
    const minX = Math.max(0, Math.floor(room.x))
    const maxX = Math.min(WORLD_W, Math.ceil(room.x + room.w))
    const minY = Math.max(0, Math.floor(room.y))
    const maxY = Math.min(WORLD_H, Math.ceil(room.y + room.h))
    for (let y = minY; y < maxY; y += 1) {
      for (let x = minX; x < maxX; x += 1) {
        cells.add(cellKey(x, y))
      }
    }
  })
  return cells
}

function cellKey(x: number, y: number): string {
  return `${x}:${y}`
}

function boundsForRooms(rooms: PlacedRoom[]): { x: number; y: number; w: number; h: number } {
  const minX = Math.min(...rooms.map((room) => room.x))
  const minY = Math.min(...rooms.map((room) => room.y))
  const maxX = Math.max(...rooms.map((room) => room.x + room.w))
  const maxY = Math.max(...rooms.map((room) => room.y + room.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function drawTileRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, fill: string, stroke: string) {
  const px = tileX(x)
  const py = tileY(y)
  const pw = w * TILE
  const ph = h * TILE
  g.fillStyle(toColor(fill), 1)
  g.fillRect(px, py, pw, ph)
  g.lineStyle(2, toColor(stroke), 1)
  g.strokeRect(px + 1, py + 1, pw - 2, ph - 2)
}

function drawRoomPattern(g: Phaser.GameObjects.Graphics, room: PlacedRoom) {
  if (room.kind === 'circulation') {
    g.lineStyle(1, toColor('#a7b3a4'), 0.34)
    for (let x = Math.ceil(room.x); x < room.x + room.w + room.h; x += 2) {
      g.lineBetween(tileX(x), tileY(room.y), tileX(x - room.h), tileY(room.y + room.h))
    }
    return
  }
  const stripeColor = room.kind === 'surgery' || room.kind === 'critical' ? '#7a4c28' : '#4d665d'
  g.lineStyle(1, toColor(stripeColor), 0.14)
  for (let x = Math.ceil(room.x); x < room.x + room.w; x += 1) {
    g.lineBetween(tileX(x), tileY(room.y), tileX(x), tileY(room.y + room.h))
  }
  for (let y = Math.ceil(room.y); y < room.y + room.h; y += 1) {
    g.lineBetween(tileX(room.x), tileY(y), tileX(room.x + room.w), tileY(y))
  }
}

function drawDoors(g: Phaser.GameObjects.Graphics, room: PlacedRoom) {
  (room.doors ?? []).forEach((door) => {
    const position = doorWorldPosition(room, door)
    const horizontal = door.side === 'top' || door.side === 'bottom'
    const px = tileX(position.x)
    const py = tileY(position.y)
    const length = Math.max(20, Math.min(44, (horizontal ? room.w : room.h) * TILE * 0.22))
    const thickness = 6
    g.fillStyle(toColor(room.simulationNode === 'emergency_stair' ? '#dc2626' : '#f8fafc'), 1)
    g.lineStyle(1, toColor('#33413b'), 1)
    if (horizontal) {
      g.fillRect(px - length / 2, py - thickness / 2, length, thickness)
      g.strokeRect(px - length / 2, py - thickness / 2, length, thickness)
    } else {
      g.fillRect(px - thickness / 2, py - length / 2, thickness, length)
      g.strokeRect(px - thickness / 2, py - length / 2, thickness, length)
    }
  })
}

function drawEquipment(g: Phaser.GameObjects.Graphics, kind: EquipmentKind, x: number, y: number) {
  const px = tileX(x)
  const py = tileY(y)
  if (kind === 'bed' || kind === 'stretcher') {
    pixelRect(g, px, py, 31, 13, '#f8fafc', '#41534b')
    pixelRect(g, px, py, 7, 13, '#9bc0d9', '#41534b')
  } else if (kind === 'chair') {
    pixelRect(g, px, py, 12, 12, '#b08968', '#41534b')
  } else if (kind === 'desk' || kind === 'nurseStation') {
    pixelRect(g, px, py, 30, 12, '#9c6b3f', '#41534b')
  } else if (kind === 'monitor') {
    pixelRect(g, px, py, 16, 12, '#1f2937', '#41534b')
    g.fillStyle(0x76e4b4, 1)
    g.fillRect(px + 3, py + 3, 10, 6)
  } else if (kind === 'sink') {
    pixelRect(g, px, py, 13, 13, '#f8fafc', '#41534b')
    g.fillStyle(0xbfe5f2, 1)
    g.fillRect(px + 3, py + 4, 7, 5)
  } else if (kind === 'labBench' || kind === 'shelves' || kind === 'cleanStorage' || kind === 'dirtyUtility') {
    pixelRect(g, px, py, 28, 13, kind === 'dirtyUtility' ? '#9b5964' : '#8d99ae', '#41534b')
  } else if (kind === 'imagingGantry') {
    g.lineStyle(3, 0x41534b, 1)
    g.strokeCircle(px + 15, py + 14, 13)
    pixelRect(g, px + 5, py + 13, 22, 6, '#d9e4ea', '#41534b')
  } else if (kind === 'orTable' || kind === 'sterileTable') {
    pixelRect(g, px, py, 34, 13, kind === 'orTable' ? '#dfe8ef' : '#d0f0de', '#41534b')
  } else if (kind === 'elevator') {
    pixelRect(g, px, py, 13, 23, '#b8c4cc', '#41534b')
    pixelRect(g, px + 16, py, 13, 23, '#b8c4cc', '#41534b')
  } else if (kind === 'stairs' || kind === 'emergencyStairs') {
    const color = kind === 'emergencyStairs' ? '#b91c1c' : '#334155'
    g.lineStyle(2, toColor(color), 1)
    if (kind === 'emergencyStairs') g.strokeRect(px - 2, py - 2, 30, 24)
    for (let i = 0; i < 4; i += 1) {
      g.lineBetween(px + i * 6, py + 18, px + i * 6, py + i * 4)
      g.lineBetween(px + i * 6, py + i * 4, px + (i + 1) * 6, py + i * 4)
    }
  } else if (kind === 'fireDoor') {
    pixelRect(g, px, py, 7, 22, '#ef4444', '#7f1d1d')
    g.lineStyle(1, 0x7f1d1d, 1)
    g.strokeCircle(px + 7, py + 22, 12)
  } else if (kind === 'smokeControl') {
    g.fillStyle(0xdbeafe, 1)
    g.fillCircle(px + 10, py + 10, 10)
    g.lineStyle(2, 0x2563eb, 1)
    g.lineBetween(px + 10, py + 10, px + 18, py + 10)
    g.lineBetween(px + 10, py + 10, px + 6, py + 17)
    g.lineBetween(px + 10, py + 10, px + 6, py + 3)
  } else if (kind === 'refugeArea') {
    pixelRect(g, px, py, 28, 16, '#ecfdf5', '#047857')
    pixelRect(g, px + 4, py + 4, 7, 8, '#047857', '#047857')
    pixelRect(g, px + 14, py + 7, 10, 3, '#047857', '#047857')
  } else if (kind === 'sprinkler') {
    g.lineStyle(2, 0x2563eb, 1)
    g.lineBetween(px + 10, py, px + 10, py + 7)
    g.fillStyle(0x38bdf8, 1)
    g.fillRect(px + 3, py + 12, 3, 3)
    g.fillRect(px + 10, py + 14, 3, 3)
    g.fillRect(px + 17, py + 12, 3, 3)
  } else if (kind === 'generator') {
    pixelRect(g, px, py, 28, 16, '#facc15', '#374151')
    pixelRect(g, px + 4, py + 5, 9, 7, '#374151', '#374151')
    pixelRect(g, px + 17, py + 6, 8, 3, '#374151', '#374151')
  } else if (kind === 'ambulance') {
    pixelRect(g, px, py, 37, 17, '#ffffff', '#41534b')
    pixelRect(g, px + 15, py + 4, 4, 9, '#d62828', '#d62828')
    pixelRect(g, px + 10, py + 7, 14, 4, '#d62828', '#d62828')
    g.fillStyle(0x111827, 1)
    g.fillRect(px + 6, py + 16, 5, 5)
    g.fillRect(px + 27, py + 16, 5, 5)
  } else if (kind === 'garden') {
    g.fillStyle(0x2f9a44, 1)
    g.fillRect(px, py + 7, 18, 8)
    g.fillRect(px + 4, py, 10, 16)
  } else {
    pixelRect(g, px, py, 16, 16, '#f8fafc', '#41534b')
  }
}

function pixelRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, fill: string, stroke: string) {
  g.fillStyle(toColor(fill), 1)
  g.fillRect(x, y, w, h)
  g.lineStyle(1, toColor(stroke), 1)
  g.strokeRect(x, y, w, h)
}

function drawArrow(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, color: string) {
  const px1 = tileX(x1)
  const py1 = tileY(y1)
  const px2 = tileX(x2)
  const py2 = tileY(y2)
  const angle = Math.atan2(py2 - py1, px2 - px1)
  g.lineStyle(6, toColor(color), 0.78)
  g.lineBetween(px1, py1, px2, py2)
  g.fillStyle(toColor(color), 0.9)
  g.fillTriangle(
    px2,
    py2,
    px2 - Math.cos(angle - 0.48) * 18,
    py2 - Math.sin(angle - 0.48) * 18,
    px2 - Math.cos(angle + 0.48) * 18,
    py2 - Math.sin(angle + 0.48) * 18,
  )
}

function roomLabelLayout(room: PlacedRoom): { width: number; height: number; fontSize: number; titleChars: number } | null {
  const roomPxW = room.w * TILE
  const roomPxH = room.h * TILE
  if (roomPxW < 76 || roomPxH < 40) return null

  const compact = roomPxW < 160 || roomPxH < 92
  const fontSize = compact ? 13 : 15
  const width = Math.max(74, Math.min(roomPxW - 10, compact ? 150 : 220))
  const height = compact ? 42 : 48
  const titleChars = Math.max(8, Math.floor((width - 14) / (fontSize * 0.54)))
  return { width, height, fontSize, titleChars }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(1, maxLength - 1))}.`
}

function equipmentCount(room: PlacedRoom) {
  if (room.kind === 'inpatient') return Math.min(42, Math.max(8, Math.round(room.capacity / 15)))
  if (room.kind === 'critical') return Math.min(20, Math.max(6, Math.round(room.capacity / 5)))
  if (room.kind === 'emergency') return Math.min(28, Math.max(5, Math.round(room.capacity / 4)))
  if (room.kind === 'surgery') return Math.min(16, Math.max(5, Math.round(room.capacity / 3)))
  if (room.kind === 'waiting') return Math.min(34, Math.max(8, Math.round(room.capacity / 25)))
  return Math.min(18, Math.max(4, room.equipment.length * 3))
}

function staffColor(role: AgentRole) {
  if (role === 'doctor') return '#f8f9fa'
  if (role === 'nurse') return '#4f83cc'
  if (role === 'porter') return '#7c6bb0'
  return '#6c757d'
}

function shortAgentLabel(agent: SimAgent) {
  if (agent.role === 'patient') return agent.caseCode ?? agent.severity?.slice(0, 1).toUpperCase() ?? 'P'
  if (agent.role === 'doctor') return 'DR'
  if (agent.role === 'nurse') return 'ENF'
  if (agent.role === 'porter') return 'CEL'
  return 'TEC'
}

function tileX(value: number) {
  return Math.round(value * TILE)
}

function tileY(value: number) {
  return Math.round(value * TILE)
}

function toColor(hex: string) {
  return Phaser.Display.Color.HexStringToColor(hex).color
}

function formatTime(minutes: number) {
  const hour = Math.floor(minutes / 60)
  const minute = Math.floor(minutes % 60)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
