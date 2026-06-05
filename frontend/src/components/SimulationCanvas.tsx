import Phaser from 'phaser'
import { useEffect, useMemo, useRef, useState } from 'react'
import { KIND_COLORS } from '../data/catalog'
import { connectedCorridorGroups, disconnectedPassages, doorConnectsToCorridor, doorWorldPosition } from '../engine/circulation'
import type { PatientCaseDefinition } from '../engine/clinicalCases'
import { positionAt, runHospitalSimulation, type SimulationSettings } from '../engine/simulation'
import type { AgentRole, EquipmentKind, HospitalPlan, PatientCaseFilter, PlacedRoom, RoomKind, SimAgent, SimulationAgentLayer, SimulationResult } from '../types'

interface SimulationCanvasProps {
  plan: HospitalPlan
  selectedFloor: number
  settings: SimulationSettings
  patientCases: PatientCaseDefinition[]
  selectedCaseId: PatientCaseFilter
  agentLayer: SimulationAgentLayer
  onSelectCase: (caseId: PatientCaseFilter) => void
  onChangeAgentLayer: (layer: SimulationAgentLayer) => void
  onChangeSpeed: (speed: number) => void
}

type SimulationViewMode = 'topDown' | 'isometric'

interface SimulationSnapshot {
  plan: HospitalPlan
  selectedFloor: number
  result: SimulationResult
  minute: number
  motionMinute: number
  selectedCaseId: PatientCaseFilter
  agentLayer: SimulationAgentLayer
  viewMode: SimulationViewMode
}

interface SceneLayers {
  staticLayer: Phaser.GameObjects.Container
  occupancyLayer: Phaser.GameObjects.Container
  agentLayer: Phaser.GameObjects.Container
  careLayer: Phaser.GameObjects.Container
}

interface RoomOccupancy {
  total: number
  patients: number
  staff: number
}

type AgentPosition = NonNullable<ReturnType<typeof positionAt>>
type ActiveAgent = { agent: SimAgent; pos: AgentPosition }
type CarePair = { id: string; patient: ActiveAgent; professional: ActiveAgent }

const WORLD_W = 100
const WORLD_H = 70
const TILE = 16
const WORLD_PX_W = WORLD_W * TILE
const WORLD_PX_H = WORLD_H * TILE
const ISO_TILE_X = 14
const ISO_TILE_Y = 7
const ISO_FLOOR_Z = 48
const ISO_ORIGIN_X = WORLD_H * ISO_TILE_X + 150
const ISO_ORIGIN_Y = 330
const HORIZON_SECONDS_AT_1X = 3600
const MOTION_MINUTES_PER_SECOND_AT_1X = 1
const SPEED_PRESETS = [1, 2, 10, 20]

const CARE_ROOM_KINDS = new Set<RoomKind>([
  'emergency',
  'diagnostic',
  'surgery',
  'critical',
  'inpatient',
  'ambulatory',
  'maternalChild',
  'oncology',
  'laboratory',
])

const ROOM_FLOOR_COLORS: Record<RoomKind, string> = {
  public: '#7cdadf',
  waiting: '#e8f9fb',
  emergency: '#f18e7f',
  diagnostic: '#b8ebad',
  surgery: '#fad67d',
  critical: '#ed7369',
  inpatient: '#85de76',
  ambulatory: '#b8ebad',
  maternalChild: '#f5bdb0',
  oncology: '#f5bdb0',
  pharmacy: '#8fb8de',
  laboratory: '#4accd3',
  logistics: '#8fb8de',
  research: '#8fb8de',
  staff: '#e8f9fb',
  technical: '#d5e3e1',
  vertical: '#8fb8de',
  circulation: '#eef8f1',
  green: '#85de76',
  future: '#fad67d',
}

const ROOM_WALL_COLORS: Record<RoomKind, string> = {
  public: '#01b7c1',
  waiting: '#7cdadf',
  emergency: '#ed7369',
  diagnostic: '#33b578',
  surgery: '#f5ab38',
  critical: '#ed7369',
  inpatient: '#33b578',
  ambulatory: '#33b578',
  maternalChild: '#f18e7f',
  oncology: '#ed7369',
  pharmacy: '#386ba6',
  laboratory: '#01b7c1',
  logistics: '#375171',
  research: '#4730c4',
  staff: '#386ba6',
  technical: '#5d7186',
  vertical: '#375171',
  circulation: '#afc6c3',
  green: '#33b578',
  future: '#f5ab38',
}

export function SimulationCanvas({ plan, selectedFloor, settings, patientCases, selectedCaseId, agentLayer, onSelectCase, onChangeAgentLayer, onChangeSpeed }: SimulationCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const gameRef = useRef<Phaser.Game | null>(null)
  const sceneRef = useRef<HospitalGameScene | null>(null)
  const [minute, setMinute] = useState(0)
  const [motionMinute, setMotionMinute] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [viewMode, setViewMode] = useState<SimulationViewMode>('topDown')
  const result = useMemo(() => runHospitalSimulation(plan, settings, patientCases), [patientCases, plan, settings])

  useEffect(() => {
    let frame = 0
    let previous = performance.now()
    function tick(now: number) {
      const delta = now - previous
      previous = now
      if (playing) {
        const horizonStep = (delta / 1000) * (result.durationMinutes / HORIZON_SECONDS_AT_1X) * settings.speed
        const motionStep = (delta / 1000) * MOTION_MINUTES_PER_SECOND_AT_1X * settings.speed
        setMinute((value) => (value + horizonStep) % result.durationMinutes)
        setMotionMinute((value) => (value + motionStep) % result.motionCycleMinutes)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, result.durationMinutes, result.motionCycleMinutes, settings.speed])

  useEffect(() => {
    if (!hostRef.current || gameRef.current) return

    const scene = new HospitalGameScene()
    sceneRef.current = scene
    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: hostRef.current,
      backgroundColor: '#1d2f42',
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
    sceneRef.current?.setSnapshot({ plan, selectedFloor, result, minute, motionMinute, selectedCaseId, agentLayer, viewMode })
  }, [agentLayer, minute, motionMinute, plan, result, selectedCaseId, selectedFloor, viewMode])

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
            const nextMinute = Number(event.target.value)
            setMinute(nextMinute)
            setMotionMinute((nextMinute / Math.max(1, result.durationMinutes)) * result.motionCycleMinutes)
            setPlaying(false)
          }}
        />
        <span>{formatHorizonTime(minute, motionMinute, settings.horizonYears)}</span>
        <div className="sim-view-toggle" aria-label="Vista de simulacion">
          <button
            type="button"
            className={viewMode === 'topDown' ? 'is-active' : ''}
            onClick={() => setViewMode('topDown')}
          >
            2D
          </button>
          <button
            type="button"
            className={viewMode === 'isometric' ? 'is-active' : ''}
            onClick={() => setViewMode('isometric')}
          >
            3D
          </button>
        </div>
        <div className="sim-speed-presets" aria-label="Velocidad de simulacion">
          {SPEED_PRESETS.map((speed) => (
            <button
              key={speed}
              type="button"
              className={settings.speed === speed ? 'is-active' : ''}
              onClick={() => onChangeSpeed(speed)}
              data-speed={speed}
            >
              x{speed}
            </button>
          ))}
        </div>
        <select value={agentLayer} onChange={(event) => onChangeAgentLayer(event.target.value as SimulationAgentLayer)} aria-label="Agentes visibles">
          <option value="all">Pacientes + personal</option>
          <option value="patients">Solo casos</option>
          <option value="staff">Solo personal</option>
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
      <div
        ref={hostRef}
        className={`phaser-stage ${viewMode === 'isometric' ? 'is-isometric' : ''}`}
        role="img"
        aria-label={viewMode === 'isometric' ? 'Simulacion isometrica 3D del hospital completo' : 'Simulacion top-down del hospital'}
      />
    </div>
  )
}

class HospitalGameScene extends Phaser.Scene {
  private snapshot: SimulationSnapshot | null = null
  private staticKey = ''
  private layers: SceneLayers | null = null
  private agentSprites = new Map<string, Phaser.GameObjects.Container>()
  private occupancyBadges = new Map<string, Phaser.GameObjects.Container>()
  private careIndicators = new Map<string, Phaser.GameObjects.Container>()

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
    this.careIndicators.clear()
    this.layers = {
      staticLayer: this.add.container(0, 0).setDepth(0),
      occupancyLayer: this.add.container(0, 0).setDepth(62),
      agentLayer: this.add.container(0, 0).setDepth(80),
      careLayer: this.add.container(0, 0).setDepth(96),
    }

    if (snapshot.viewMode === 'isometric') {
      this.drawIsometricStatic(snapshot)
      return
    }

    this.drawBackground(snapshot)
    this.drawAmbulanceApron(snapshot)

    const rooms = snapshot.plan.rooms.filter((room) => room.floor === snapshot.selectedFloor)
    const disconnectedIds = new Set(disconnectedPassages(snapshot.plan.rooms).map((room) => room.id))
    connectedCorridorGroups(snapshot.plan.rooms, snapshot.selectedFloor).forEach((group) => {
      this.drawCorridorGroup(group, group.some((room) => disconnectedIds.has(room.id)))
    })
    rooms.filter((room) => room.kind !== 'circulation').forEach((room) => {
      this.drawRoom(room, snapshot.result, disconnectedIds.has(room.id), snapshot.plan.rooms)
    })
  }

  private drawIsometricStatic(snapshot: SimulationSnapshot) {
    if (!this.layers) return
    const floors = uniqueFloors(snapshot.plan.rooms)
    const disconnectedIds = new Set(disconnectedPassages(snapshot.plan.rooms).map((room) => room.id))
    const floorGraphics = this.add.graphics()
    this.layers.staticLayer.add(floorGraphics)

    floors.forEach((floor) => {
      this.drawIsometricFloorPlate(floorGraphics, floor, floor === snapshot.selectedFloor)
    })

    floors.forEach((floor) => {
      connectedCorridorGroups(snapshot.plan.rooms, floor).forEach((group) => {
        this.drawIsometricCorridorGroup(group, group.some((room) => disconnectedIds.has(room.id)))
      })
    })

    snapshot.plan.rooms
      .filter((room) => room.kind !== 'circulation')
      .sort((a, b) => a.floor - b.floor || a.x + a.y - (b.x + b.y))
      .forEach((room) => {
        this.drawIsometricRoom(room, snapshot, disconnectedIds.has(room.id))
      })
  }

  private drawIsometricFloorPlate(g: Phaser.GameObjects.Graphics, floor: number, active: boolean) {
    const a = isoPoint(0, 0, floor, 0)
    const b = isoPoint(WORLD_W, 0, floor, 0)
    const c = isoPoint(WORLD_W, WORLD_H, floor, 0)
    const d = isoPoint(0, WORLD_H, floor, 0)
    fillPolygon(g, [a, b, c, d], active ? '#eef8f1' : '#eef8f1', active ? 0.28 : 0.14, active ? '#01b7c1' : '#afc6c3', active ? 0.65 : 0.28)

    const label = this.add.text(d.x - 16, d.y - 12, floorName(floor), {
      color: active ? '#174942' : '#5d7186',
      backgroundColor: active ? '#e8f9fb' : '#ffffff',
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      fontStyle: 'bold',
      padding: { x: 7, y: 3 },
    }).setResolution(2)
    this.layers?.staticLayer.add(label)
  }

  private drawIsometricCorridorGroup(rooms: PlacedRoom[], disconnectedPassage: boolean) {
    if (!this.layers || rooms.length === 0) return
    const g = this.add.graphics()
    this.layers.staticLayer.add(g)
    rooms
      .sort((a, b) => a.x + a.y - (b.x + b.y))
      .forEach((room) => {
        drawIsoPrism(g, room.x, room.y, room.w, room.h, room.floor, 4, ROOM_FLOOR_COLORS.circulation, disconnectedPassage ? '#ed7369' : '#8f9d8b', 0.96)
      })
  }

  private drawIsometricRoom(room: PlacedRoom, snapshot: SimulationSnapshot, disconnectedPassage: boolean) {
    if (!this.layers) return
    const g = this.add.graphics()
    this.layers.staticLayer.add(g)
    const roomColor = ROOM_FLOOR_COLORS[room.kind] ?? KIND_COLORS[room.kind]
    const wallColor = disconnectedPassage ? '#ed7369' : ROOM_WALL_COLORS[room.kind] ?? '#375171'
    const height = isoBlockHeight(room)
    const alpha = room.floor === snapshot.selectedFloor ? 1 : 0.72
    drawIsoPrism(g, room.x, room.y, room.w, room.h, room.floor, height, roomColor, wallColor, alpha)

    const pressure = Math.min(1, (snapshot.result.roomPressure[room.id] ?? 0) / Math.max(1, room.capacity * 1.6))
    if (pressure > 0.25) {
      const a = isoPoint(room.x, room.y, room.floor, height + 1)
      const b = isoPoint(room.x + room.w, room.y, room.floor, height + 1)
      const c = isoPoint(room.x + room.w, room.y + room.h, room.floor, height + 1)
      const d = isoPoint(room.x, room.y + room.h, room.floor, height + 1)
      fillPolygon(g, [a, b, c, d], '#ed7369', 0.12 + pressure * 0.2)
    }

    if (room.floor !== snapshot.selectedFloor) return
    if (room.w < 7 && room.h < 7) return
    const labelPoint = isoPoint(room.x + room.w / 2, room.y + room.h / 2, room.floor, height + 8)
    const label = this.add.text(labelPoint.x, labelPoint.y, truncateText(room.name, room.w >= 12 ? 22 : 14), {
      color: '#1d2f42',
      backgroundColor: '#ffffff',
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      padding: { x: 5, y: 2 },
    }).setOrigin(0.5, 0.5).setResolution(2)
    this.layers.staticLayer.add(label)
  }

  private drawCorridorGroup(rooms: PlacedRoom[], disconnectedPassage: boolean) {
    if (!this.layers || rooms.length === 0) return
    const g = this.add.graphics()
    this.layers.staticLayer.add(g)

    const fill = ROOM_FLOOR_COLORS.circulation
    const stroke = disconnectedPassage ? '#ed7369' : ROOM_WALL_COLORS.circulation
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

    g.lineStyle(1, toColor('#afc6c3'), 0.3)
    const bounds = boundsForRooms(rooms)
    for (let x = Math.ceil(bounds.x); x < bounds.x + bounds.w + bounds.h; x += 2) {
      g.lineBetween(tileX(x), tileY(bounds.y), tileX(x - bounds.h), tileY(bounds.y + bounds.h))
    }

    if (bounds.w >= 12 || bounds.h >= 12) {
      const label = rooms.length === 1 ? rooms[0].name : `Red pasillos (${rooms.length})`
      this.addPixelText(label.slice(0, 26), bounds.x + 0.7, bounds.y + 0.7, '#375171', '#f7faf7', this.layers.staticLayer, 10)
    }
  }

  private drawBackground(snapshot: SimulationSnapshot) {
    if (!this.layers) return
    const g = this.add.graphics()
    this.layers.staticLayer.add(g)
    const base = snapshot.selectedFloor === 0 ? '#85de76' : '#eef8f1'
    const speck = snapshot.selectedFloor === 0 ? '#33b578' : '#afc6c3'
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
    drawTileRect(g, 84, 8, 16, 7, '#5d7186', '#375171')
    g.fillStyle(0xffffff, 1)
    g.fillRect(87 * TILE, 11 * TILE, 9 * TILE, 5)
    this.addPixelText('AMBULANCIAS', 84.8, 8.4, '#ffffff', '#375171', this.layers.staticLayer, 10)
  }

  private drawRoom(room: PlacedRoom, result: SimulationResult, disconnectedPassage: boolean, allRooms: PlacedRoom[]) {
    if (!this.layers) return
    const g = this.add.graphics()
    this.layers.staticLayer.add(g)

    const roomColor = ROOM_FLOOR_COLORS[room.kind] ?? KIND_COLORS[room.kind]
    const wallColor = disconnectedPassage ? '#ed7369' : ROOM_WALL_COLORS[room.kind] ?? '#375171'
    const pressure = Math.min(1, (result.roomPressure[room.id] ?? 0) / Math.max(1, room.capacity * 1.6))

    drawTileRect(g, room.x, room.y, room.w, room.h, roomColor, wallColor)
    drawRoomPattern(g, room)
    if (room.kind !== 'circulation') drawDoors(g, room, allRooms)

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
      color: '#1d2f42',
      fontFamily: 'Arial, sans-serif',
      fontSize: `${layout.fontSize}px`,
      fontStyle: 'bold',
      lineSpacing: 2,
    },
    ).setResolution(2)
    this.layers.staticLayer.add([bg, label])
  }

  private updateAgents(snapshot: SimulationSnapshot) {
    if (!this.layers) return
    const visibleAgents = visibleAgentsForSnapshot(snapshot)
    const motionMinute = wrapMinute(snapshot.motionMinute, snapshot.result.motionCycleMinutes)
    const active = resolveAgentCollisions(visibleAgents
      .map((agent) => ({ agent, pos: positionAt(agent, snapshot.plan.rooms, motionMinute) }))
      .filter((item): item is ActiveAgent => item.pos !== null && (snapshot.viewMode === 'isometric' || item.pos.room.floor === snapshot.selectedFloor))
    )

    const activeIds = new Set<string>()
    active.forEach(({ agent, pos }) => {
      activeIds.add(agent.id)
      const sprite = this.agentSprites.get(agent.id) ?? this.createAgentSprite(agent)
      const bob = pos.moving ? Math.sin((motionMinute + Number(agent.id.replace(/\D/g, ''))) * 0.8) * 2 : 0
      if (snapshot.viewMode === 'isometric') {
        const projected = isoPoint(pos.x, pos.y, pos.room.floor, isoBlockHeight(pos.room) + 8)
        sprite.setPosition(projected.x, projected.y + bob)
        sprite.setScale(0.72)
        sprite.setDepth(isoDepth(pos.x, pos.y, pos.room.floor) + 500)
      } else {
        sprite.setPosition(tileX(pos.x), tileY(pos.y) + bob)
        sprite.setScale(1)
        sprite.setDepth(pos.y * TILE)
      }
      sprite.setVisible(true)
      this.updateAgentWalk(sprite, pos.moving, motionMinute, agent.id)
      const roleLabel = sprite.getData('roleLabel') as Phaser.GameObjects.Text | undefined
      if (roleLabel) roleLabel.setVisible(false)
    })

    this.agentSprites.forEach((sprite, id) => {
      if (!activeIds.has(id)) sprite.setVisible(false)
    })

    if (snapshot.viewMode === 'isometric') {
      this.careIndicators.forEach((indicator) => indicator.setVisible(false))
      this.occupancyBadges.forEach((badge) => badge.setVisible(false))
      return
    }

    this.updateCareIndicators(active, motionMinute)
    this.updateOccupancy(snapshot, active)
  }

  private updateAgentWalk(sprite: Phaser.GameObjects.Container, moving: boolean, minute: number, id: string) {
    const leftLeg = sprite.getData('leftLeg') as Phaser.GameObjects.Rectangle | undefined
    const rightLeg = sprite.getData('rightLeg') as Phaser.GameObjects.Rectangle | undefined
    const shadow = sprite.getData('shadow') as Phaser.GameObjects.Rectangle | undefined
    const step = moving ? Math.sin(minute * 1.5 + Number(id.replace(/\D/g, '')) * 0.3) : 0
    leftLeg?.setRotation(step * 0.28)
    rightLeg?.setRotation(-step * 0.28)
    leftLeg?.setX(-3 - Math.abs(step) * 0.9)
    rightLeg?.setX(3 + Math.abs(step) * 0.9)
    shadow?.setScale(moving ? 1.08 : 1, moving ? 0.9 : 1)
  }

  private updateCareIndicators(active: ActiveAgent[], minute: number) {
    if (!this.layers) return
    const pairs = carePairsForActiveAgents(active)
    const visibleIds = new Set<string>()

    pairs.forEach((pair, index) => {
      visibleIds.add(pair.id)
      const indicator = this.careIndicators.get(pair.id) ?? this.createCareIndicator(pair.id)
      this.updateCareIndicator(indicator, pair, minute, index)
    })

    this.careIndicators.forEach((indicator, id) => {
      if (!visibleIds.has(id)) indicator.setVisible(false)
    })
  }

  private createCareIndicator(id: string) {
    const container = this.add.container(0, 0)
    const graphics = this.add.graphics()
    container.add(graphics)
    container.setData('graphics', graphics)
    this.layers?.careLayer.add(container)
    this.careIndicators.set(id, container)
    return container
  }

  private updateCareIndicator(container: Phaser.GameObjects.Container, pair: CarePair, minute: number, index: number) {
    const graphics = container.getData('graphics') as Phaser.GameObjects.Graphics
    const patientX = tileX(pair.patient.pos.x)
    const patientY = tileY(pair.patient.pos.y)
    const professionalX = tileX(pair.professional.pos.x)
    const professionalY = tileY(pair.professional.pos.y)
    const midX = (patientX + professionalX) / 2
    const midY = (patientY + professionalY) / 2 - 7
    const pulse = 1 + Math.sin(minute * 0.5 + index) * 0.09
    const radius = 9 * pulse
    const handAngle = minute * 0.34 + index * 0.6
    const hourAngle = minute * 0.08 + index * 0.35

    container.setPosition(midX, midY)
    container.setDepth(midY + 18)
    container.setVisible(true)
    graphics.clear()

    graphics.lineStyle(2, 0x0f766e, 0.3)
    graphics.lineBetween(patientX - midX, patientY - midY, professionalX - midX, professionalY - midY)

    graphics.fillStyle(0xffffff, 0.96)
    graphics.fillCircle(0, 0, radius + 2)
    graphics.lineStyle(2, 0x0f766e, 0.95)
    graphics.strokeCircle(0, 0, radius + 2)
    graphics.fillStyle(0xe4f3ee, 1)
    graphics.fillCircle(0, 0, radius)

    graphics.fillStyle(0x17201c, 1)
    graphics.fillCircle(0, -radius + 3, 1.3)
    graphics.fillCircle(radius - 3, 0, 1.3)
    graphics.fillCircle(0, radius - 3, 1.3)
    graphics.fillCircle(-radius + 3, 0, 1.3)

    graphics.lineStyle(2, 0xd65f50, 1)
    graphics.lineBetween(0, 0, Math.cos(handAngle) * radius * 0.62, Math.sin(handAngle) * radius * 0.62)
    graphics.lineStyle(2, 0x17201c, 0.9)
    graphics.lineBetween(0, 0, Math.cos(hourAngle) * radius * 0.45, Math.sin(hourAngle) * radius * 0.45)
    graphics.fillStyle(0x17201c, 1)
    graphics.fillCircle(0, 0, 2)
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
      color: '#1d2f42',
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
    const fill = ratio > 0.85 ? '#fff0ed' : ratio > 0.45 ? '#fff3d1' : count.total > 0 ? '#e8f9fb' : '#ffffff'
    const stroke = ratio > 0.85 ? '#ed7369' : ratio > 0.45 ? '#f5ab38' : '#33b578'
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
    container.setData('shadow', shadow)
    container.setData('leftLeg', leftLeg)
    container.setData('rightLeg', rightLeg)

    if (agent.role !== 'patient') {
      container.add(this.add.rectangle(0, 0, 3, 10, 0xf8f9fa, 0.9))
      container.add(this.add.rectangle(0, -1, 8, 2, 0xd62828))
    }

    const roleLabel = this.add.text(8, -18, shortAgentLabel(agent), {
      color: '#1d2f42',
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
    if (this.snapshot?.viewMode === 'isometric') {
      const bounds = isometricSceneBounds(this.snapshot.plan.rooms)
      const padding = 120
      const zoom = Math.min(this.scale.width / (bounds.w + padding * 2), this.scale.height / (bounds.h + padding * 2)) * 0.98
      this.cameras.main.setZoom(zoom)
      this.cameras.main.centerOn(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2)
      return
    }
    const zoom = Math.min(this.scale.width / WORLD_PX_W, this.scale.height / WORLD_PX_H) * 0.98
    this.cameras.main.setZoom(zoom)
    this.cameras.main.centerOn(WORLD_PX_W / 2, WORLD_PX_H / 2)
  }
}

function staticSceneKey(snapshot: SimulationSnapshot) {
  const rooms = snapshot.plan.rooms
    .filter((room) => snapshot.viewMode === 'isometric' || room.floor === snapshot.selectedFloor)
    .map((room) => {
      const doors = (room.doors ?? []).map((door) => `${door.id}:${door.side}:${door.offset}`).join(',')
      const connections = (room.connectionIds ?? []).join(',')
      return `${room.id}:${room.floor}:${room.x}:${room.y}:${room.w}:${room.h}:${room.kind}:${doors}:${connections}:${snapshot.result.roomPressure[room.id] ?? 0}`
    })
    .join('|')
  return `${snapshot.viewMode}:${snapshot.selectedFloor}:${snapshot.result.kpis.completed}:${rooms}`
}

function visibleAgentsForSnapshot(snapshot: SimulationSnapshot): SimAgent[] {
  const patients = snapshot.selectedCaseId === 'all'
    ? snapshot.result.agents.filter((agent) => agent.role === 'patient')
    : snapshot.result.agents.filter((agent) => agent.role === 'patient' && agent.caseId === snapshot.selectedCaseId)
  const staff = snapshot.result.agents.filter((agent) => agent.role !== 'patient')
  if (snapshot.agentLayer === 'patients') return patients
  if (snapshot.agentLayer === 'staff') return staff
  return [...patients, ...staff]
}

function resolveAgentCollisions(active: ActiveAgent[]): ActiveAgent[] {
  const placed = active.map(({ agent, pos }) => ({ agent, pos: { ...pos } }))
  const minDistance = 0.78

  for (let iteration = 0; iteration < 4; iteration += 1) {
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]
        const b = placed[j]
        const dx = b.pos.x - a.pos.x
        const dy = b.pos.y - a.pos.y
        const distance = Math.hypot(dx, dy)
        if (distance >= minDistance) continue

        const fallbackAngle = stableAngle(`${a.agent.id}:${b.agent.id}`)
        const nx = distance > 0.001 ? dx / distance : Math.cos(fallbackAngle)
        const ny = distance > 0.001 ? dy / distance : Math.sin(fallbackAngle)
        const push = (minDistance - Math.max(0.001, distance)) / 2

        a.pos = clampAgentPosition(a.pos, a.pos.x - nx * push, a.pos.y - ny * push)
        b.pos = clampAgentPosition(b.pos, b.pos.x + nx * push, b.pos.y + ny * push)
      }
    }
  }

  return placed
}

function clampAgentPosition(pos: AgentPosition, x: number, y: number): AgentPosition {
  const margin = pos.room.kind === 'circulation' || pos.room.kind === 'vertical' ? 0.42 : 0.65
  return {
    ...pos,
    x: clamp(x, pos.room.x + margin, pos.room.x + pos.room.w - margin),
    y: clamp(y, pos.room.y + margin, pos.room.y + pos.room.h - margin),
  }
}

function stableAngle(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 2654435761)
  return ((hash >>> 0) / 4294967295) * Math.PI * 2
}

function carePairsForActiveAgents(active: ActiveAgent[]): CarePair[] {
  const availableStaff = new Map<string, ActiveAgent[]>()
  active
    .filter(isCareProfessional)
    .forEach((item) => {
      const roomStaff = availableStaff.get(item.pos.room.id) ?? []
      roomStaff.push(item)
      availableStaff.set(item.pos.room.id, roomStaff)
    })

  availableStaff.forEach((items) => {
    items.sort((a, b) => careProfessionalPriority(a.agent.role) - careProfessionalPriority(b.agent.role))
  })

  const usedStaff = new Set<string>()
  const pairs: CarePair[] = []
  active
    .filter(isCarePatient)
    .sort((a, b) => severityPriority(b.agent.severity) - severityPriority(a.agent.severity))
    .forEach((patient) => {
      const professionals = availableStaff.get(patient.pos.room.id) ?? []
      const professional = professionals
        .filter((item) => !usedStaff.has(item.agent.id))
        .sort((a, b) => {
          const roleDelta = careProfessionalPriority(a.agent.role) - careProfessionalPriority(b.agent.role)
          if (roleDelta !== 0) return roleDelta
          return distanceBetweenPositions(a.pos, patient.pos) - distanceBetweenPositions(b.pos, patient.pos)
        })[0]
      if (!professional) return
      usedStaff.add(professional.agent.id)
      pairs.push({
        id: patient.agent.id,
        patient,
        professional,
      })
    })

  return pairs.slice(0, 32)
}

function isCarePatient(item: ActiveAgent): boolean {
  return item.agent.role === 'patient'
    && !item.pos.moving
    && CARE_ROOM_KINDS.has(item.pos.room.kind)
    && isCarePhase(item.pos.phase)
}

function isCareProfessional(item: ActiveAgent): boolean {
  return (item.agent.role === 'doctor' || item.agent.role === 'nurse')
    && !item.pos.moving
    && CARE_ROOM_KINDS.has(item.pos.room.kind)
    && isCarePhase(item.pos.phase)
}

function isCarePhase(phase: string | undefined): boolean {
  if (!phase) return true
  const normalized = phase.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return !/traslado|entrada|check-in|admision|alta|receta|farmacia|salida|turno|base/.test(normalized)
}

function careProfessionalPriority(role: AgentRole): number {
  if (role === 'doctor') return 0
  if (role === 'nurse') return 1
  return 2
}

function severityPriority(severity: SimAgent['severity']): number {
  if (severity === 'critical') return 4
  if (severity === 'high') return 3
  if (severity === 'medium') return 2
  if (severity === 'low') return 1
  return 0
}

function distanceBetweenPositions(a: AgentPosition, b: AgentPosition): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
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
    g.lineStyle(1, toColor('#afc6c3'), 0.34)
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

function drawDoors(g: Phaser.GameObjects.Graphics, room: PlacedRoom, allRooms: PlacedRoom[]) {
  (room.doors ?? []).forEach((door) => {
    const position = doorWorldPosition(room, door)
    const connected = doorConnectsToCorridor(allRooms, room, door)
    const horizontal = door.side === 'top' || door.side === 'bottom'
    const px = tileX(position.x)
    const py = tileY(position.y)
    const length = Math.max(30, Math.min(62, (horizontal ? room.w : room.h) * TILE * 0.32))
    const thickness = 12
    const fill = connected
      ? (room.simulationNode === 'emergency_stair' ? '#e86464' : ROOM_FLOOR_COLORS.circulation)
      : '#fff0ed'
    const stroke = connected ? '#375171' : '#ed7369'
    g.fillStyle(toColor(fill), 1)
    g.lineStyle(2, toColor(stroke), 1)
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
    pixelRect(g, px, py, 31, 13, '#ffffff', '#375171')
    pixelRect(g, px, py, 7, 13, '#8fb8de', '#375171')
  } else if (kind === 'chair') {
    pixelRect(g, px, py, 12, 12, '#b08968', '#375171')
  } else if (kind === 'desk' || kind === 'nurseStation') {
    pixelRect(g, px, py, 30, 12, '#9c6b3f', '#375171')
  } else if (kind === 'monitor') {
    pixelRect(g, px, py, 16, 12, '#1f2937', '#375171')
    g.fillStyle(0x76e4b4, 1)
    g.fillRect(px + 3, py + 3, 10, 6)
  } else if (kind === 'sink') {
    pixelRect(g, px, py, 13, 13, '#ffffff', '#375171')
    g.fillStyle(0xbfe5f2, 1)
    g.fillRect(px + 3, py + 4, 7, 5)
  } else if (kind === 'labBench' || kind === 'shelves' || kind === 'cleanStorage' || kind === 'dirtyUtility') {
    pixelRect(g, px, py, 28, 13, kind === 'dirtyUtility' ? '#9b5964' : '#8fb8de', '#375171')
  } else if (kind === 'imagingGantry') {
    g.lineStyle(3, 0x41534b, 1)
    g.strokeCircle(px + 15, py + 14, 13)
    pixelRect(g, px + 5, py + 13, 22, 6, '#8fb8de', '#375171')
  } else if (kind === 'orTable' || kind === 'sterileTable') {
    pixelRect(g, px, py, 34, 13, kind === 'orTable' ? '#8fb8de' : '#b8ebad', '#375171')
  } else if (kind === 'elevator') {
    pixelRect(g, px, py, 13, 23, '#8fb8de', '#375171')
    pixelRect(g, px + 16, py, 13, 23, '#8fb8de', '#375171')
  } else if (kind === 'stairs' || kind === 'emergencyStairs') {
    const color = kind === 'emergencyStairs' ? '#ed7369' : '#334155'
    g.lineStyle(2, toColor(color), 1)
    if (kind === 'emergencyStairs') g.strokeRect(px - 2, py - 2, 30, 24)
    for (let i = 0; i < 4; i += 1) {
      g.lineBetween(px + i * 6, py + 18, px + i * 6, py + i * 4)
      g.lineBetween(px + i * 6, py + i * 4, px + (i + 1) * 6, py + i * 4)
    }
  } else if (kind === 'fireDoor') {
    pixelRect(g, px, py, 7, 22, '#f18e7f', '#ed7369')
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
    pixelRect(g, px, py, 28, 16, '#e7fbe2', '#33b578')
    pixelRect(g, px + 4, py + 4, 7, 8, '#33b578', '#33b578')
    pixelRect(g, px + 14, py + 7, 10, 3, '#33b578', '#33b578')
  } else if (kind === 'sprinkler') {
    g.lineStyle(2, 0x2563eb, 1)
    g.lineBetween(px + 10, py, px + 10, py + 7)
    g.fillStyle(0x38bdf8, 1)
    g.fillRect(px + 3, py + 12, 3, 3)
    g.fillRect(px + 10, py + 14, 3, 3)
    g.fillRect(px + 17, py + 12, 3, 3)
  } else if (kind === 'generator') {
    pixelRect(g, px, py, 28, 16, '#fbc344', '#375171')
    pixelRect(g, px + 4, py + 5, 9, 7, '#375171', '#375171')
    pixelRect(g, px + 17, py + 6, 8, 3, '#375171', '#375171')
  } else if (kind === 'ambulance') {
    pixelRect(g, px, py, 37, 17, '#ffffff', '#375171')
    pixelRect(g, px + 15, py + 4, 4, 9, '#ed7369', '#ed7369')
    pixelRect(g, px + 10, py + 7, 14, 4, '#ed7369', '#ed7369')
    g.fillStyle(0x111827, 1)
    g.fillRect(px + 6, py + 16, 5, 5)
    g.fillRect(px + 27, py + 16, 5, 5)
  } else if (kind === 'garden') {
    g.fillStyle(0x2f9a44, 1)
    g.fillRect(px, py + 7, 18, 8)
    g.fillRect(px + 4, py, 10, 16)
  } else {
    pixelRect(g, px, py, 16, 16, '#ffffff', '#375171')
  }
}

function pixelRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, fill: string, stroke: string) {
  g.fillStyle(toColor(fill), 1)
  g.fillRect(x, y, w, h)
  g.lineStyle(1, toColor(stroke), 1)
  g.strokeRect(x, y, w, h)
}

function drawIsoPrism(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  floor: number,
  height: number,
  fill: string,
  stroke: string,
  alpha = 1,
) {
  const topA = isoPoint(x, y, floor, height)
  const topB = isoPoint(x + w, y, floor, height)
  const topC = isoPoint(x + w, y + h, floor, height)
  const topD = isoPoint(x, y + h, floor, height)
  const baseB = isoPoint(x + w, y, floor, 0)
  const baseC = isoPoint(x + w, y + h, floor, 0)
  const baseD = isoPoint(x, y + h, floor, 0)

  fillPolygon(g, [topB, topC, baseC, baseB], shadeHex(fill, -30), alpha * 0.86, stroke, alpha * 0.65)
  fillPolygon(g, [topD, topC, baseC, baseD], shadeHex(fill, -44), alpha * 0.82, stroke, alpha * 0.55)
  fillPolygon(g, [topA, topB, topC, topD], fill, alpha, stroke, alpha)
}

function fillPolygon(
  g: Phaser.GameObjects.Graphics,
  points: Array<{ x: number; y: number }>,
  fill: string,
  alpha = 1,
  stroke?: string,
  strokeAlpha = 1,
) {
  if (points.length < 3) return
  g.fillStyle(toColor(fill), alpha)
  g.beginPath()
  g.moveTo(points[0].x, points[0].y)
  points.slice(1).forEach((point) => g.lineTo(point.x, point.y))
  g.closePath()
  g.fillPath()
  if (!stroke) return
  g.lineStyle(1, toColor(stroke), strokeAlpha)
  g.beginPath()
  g.moveTo(points[0].x, points[0].y)
  points.slice(1).forEach((point) => g.lineTo(point.x, point.y))
  g.closePath()
  g.strokePath()
}

function isoPoint(x: number, y: number, floor: number, z = 0) {
  return {
    x: ISO_ORIGIN_X + (x - y) * ISO_TILE_X,
    y: ISO_ORIGIN_Y + (x + y) * ISO_TILE_Y - floor * ISO_FLOOR_Z - z,
  }
}

function isoDepth(x: number, y: number, floor: number) {
  return floor * 10000 + (x + y) * 20
}

function isoBlockHeight(room: PlacedRoom) {
  if (room.kind === 'green' || room.kind === 'future') return 2
  if (room.kind === 'circulation') return 4
  if (room.kind === 'vertical') return 32
  if (room.kind === 'critical' || room.kind === 'surgery') return 27
  return 18 + Math.min(12, Math.max(0, Math.floor(room.capacity / 30)))
}

function isometricSceneBounds(rooms: PlacedRoom[]) {
  const points = rooms.flatMap((room) => {
    const height = isoBlockHeight(room)
    return [
      isoPoint(room.x, room.y, room.floor, height),
      isoPoint(room.x + room.w, room.y, room.floor, height),
      isoPoint(room.x + room.w, room.y + room.h, room.floor, height),
      isoPoint(room.x, room.y + room.h, room.floor, height),
      isoPoint(room.x, room.y, room.floor, 0),
      isoPoint(room.x + room.w, room.y + room.h, room.floor, 0),
    ]
  })
  if (points.length === 0) return { x: 0, y: 0, w: WORLD_PX_W, h: WORLD_PX_H }
  const minX = Math.min(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxX = Math.max(...points.map((point) => point.x))
  const maxY = Math.max(...points.map((point) => point.y))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function shadeHex(hex: string, amount: number) {
  const normalized = hex.replace('#', '')
  const value = Number.parseInt(normalized.length === 3 ? normalized.split('').map((char) => char + char).join('') : normalized, 16)
  if (Number.isNaN(value)) return hex
  const r = clamp((value >> 16) + amount, 0, 255)
  const g = clamp(((value >> 8) & 0xff) + amount, 0, 255)
  const b = clamp((value & 0xff) + amount, 0, 255)
  return `#${[r, g, b].map((component) => Math.round(component).toString(16).padStart(2, '0')).join('')}`
}

function uniqueFloors(rooms: PlacedRoom[]) {
  return [...new Set(rooms.map((room) => room.floor))].sort((a, b) => a - b)
}

function floorName(floor: number) {
  if (floor < 0) return `S${Math.abs(floor)}`
  if (floor === 0) return 'PB'
  return `P${floor}`
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

function formatHorizonTime(minutes: number, motionMinutes: number, horizonYears: number) {
  const totalDays = Math.max(1, horizonYears) * 365
  const dayIndex = Math.floor(minutes / (24 * 60)) % totalDays
  const year = Math.floor(dayIndex / 365) + 1
  const day = dayIndex % 365 + 1
  const hour = Math.floor(motionMinutes / 60) % 24
  const minute = Math.floor(motionMinutes % 60)
  return `Ano ${year} · dia ${day} · ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function wrapMinute(minute: number, duration: number) {
  if (duration <= 0) return 0
  return ((minute % duration) + duration) % duration
}

function clamp(value: number, min: number, max: number) {
  if (min > max) return (min + max) / 2
  return Math.max(min, Math.min(max, value))
}
