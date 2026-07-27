import Phaser from 'phaser'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { KIND_COLORS, KIND_LABELS } from '../data/catalog'
import { connectedCorridorGroups, disconnectedPassages, doorConnectsToCorridor, doorWorldPosition } from '../engine/circulation'
import type { PatientCaseDefinition } from '../engine/clinicalCases'
import { positionAt, runHospitalSimulation, type SimulationSettings } from '../engine/simulation'
import type { AgentRole, EquipmentKind, HospitalPlan, PatientCaseFilter, PlacedRoom, RoomKind, SimAgent, SimulationAgentLayer, SimulationResult } from '../types'
import { SimulationControlsBar, type SimulationViewMode } from './SimulationControlsBar'
import { SimulationStageOverlay, type StageProbe } from './SimulationStageOverlay'
import {
  agentUniform,
  ambientForHour,
  floorTexture,
  hourOfDay,
  interiorLightStrength,
  SEVERITY_RING,
} from './simulationVisuals'

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
  lightingLayer: Phaser.GameObjects.Container
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
/** Zoom para el que se disenaron los rotulos; por encima se compensa la escala. */
const LABEL_REFERENCE_ZOOM = 0.62

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
  const dragRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null)
  const [minute, setMinute] = useState(0)
  const [motionMinute, setMotionMinute] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [viewMode, setViewMode] = useState<SimulationViewMode>('topDown')
  const [probe, setProbe] = useState<StageProbe | null>(null)
  const [legendOpen, setLegendOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
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
      backgroundColor: '#101d2c',
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

  const fitView = useCallback(() => {
    sceneRef.current?.fitView()
  }, [])

  const zoomBy = useCallback((factor: number) => {
    sceneRef.current?.zoomBy(factor)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    function onWheel(event: WheelEvent) {
      event.preventDefault()
      sceneRef.current?.zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12)
    }

    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const host = hostRef.current
      if (!host || !host.isConnected) return

      // Se respetan los controles nativos: campos de texto, selects, botones y
      // el propio slider de tiempo mantienen su comportamiento de teclado.
      const tag = target?.tagName ?? ''
      const inputType = target instanceof HTMLInputElement ? target.type : ''
      const isTextField = tag === 'TEXTAREA'
        || target?.isContentEditable === true
        || (tag === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit'].includes(inputType))
      if (isTextField || tag === 'SELECT') return
      const isRange = tag === 'INPUT' && inputType === 'range'
      const isButton = tag === 'BUTTON' || (tag === 'INPUT' && ['button', 'submit', 'checkbox', 'radio'].includes(inputType))
      const isArrow = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
      const isSpace = event.key === ' ' || event.key === 'Spacebar'
      if (isRange && isArrow) return
      if (isButton && (isSpace || event.key === 'Enter')) return

      switch (event.key) {
        case ' ':
        case 'Spacebar':
          event.preventDefault()
          setPlaying((value) => !value)
          break
        case 'ArrowLeft':
        case 'ArrowRight': {
          event.preventDefault()
          const direction = event.key === 'ArrowRight' ? 1 : -1
          const step = event.shiftKey ? 60 : 15
          setPlaying(false)
          setMotionMinute((value) => wrapMinute(value + direction * step, result.motionCycleMinutes))
          setMinute((value) => wrapMinute(value + direction * step * (result.durationMinutes / Math.max(1, result.motionCycleMinutes)), result.durationMinutes))
          break
        }
        case '1':
          onChangeSpeed(1)
          break
        case '2':
          onChangeSpeed(2)
          break
        case '3':
          onChangeSpeed(10)
          break
        case '4':
          onChangeSpeed(20)
          break
        case 'v':
        case 'V':
          setViewMode((value) => (value === 'topDown' ? 'isometric' : 'topDown'))
          break
        case 'f':
        case 'F':
          fitView()
          break
        case 'l':
        case 'L':
          setLegendOpen((value) => !value)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fitView, onChangeSpeed, result.durationMinutes, result.motionCycleMinutes])

  const updateProbe = useCallback((clientX: number, clientY: number) => {
    const host = hostRef.current
    const scene = sceneRef.current
    if (!host || !scene) return
    const rect = host.getBoundingClientRect()
    const localX = clientX - rect.left
    const localY = clientY - rect.top
    const found = scene.probeAt(localX, localY, rect.width, rect.height)
    if (!found) {
      setProbe(null)
      return
    }
    setProbe({
      ...found,
      x: Math.min(Math.max(12, localX + 16), Math.max(12, rect.width - 232)),
      y: Math.min(Math.max(12, localY + 16), Math.max(12, rect.height - 132)),
    })
  }, [])

  return (
    <div className="simulation-stage">
      <SimulationControlsBar
        result={result}
        settings={settings}
        minute={minute}
        motionMinute={motionMinute}
        selectedCaseId={selectedCaseId}
        agentLayer={agentLayer}
        viewMode={viewMode}
        playing={playing}
        onTogglePlaying={() => setPlaying((value) => !value)}
        onChangeMinute={(nextMinute, nextMotionMinute) => {
          setMinute(nextMinute)
          setMotionMinute(nextMotionMinute)
          setPlaying(false)
        }}
        onChangeViewMode={setViewMode}
        onChangeSpeed={onChangeSpeed}
        onChangeAgentLayer={onChangeAgentLayer}
        onSelectCase={onSelectCase}
      />
      <div className="phaser-stage-wrapper">
        <div
          ref={hostRef}
          className={`phaser-stage ${viewMode === 'isometric' ? 'is-isometric' : ''} ${dragging ? 'is-dragging' : ''}`}
          role="application"
          tabIndex={0}
          aria-keyshortcuts="Space ArrowLeft ArrowRight V F L"
          aria-label={viewMode === 'isometric' ? 'Simulación isométrica 3D del hospital completo' : 'Simulación top-down del hospital'}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.focus()
            dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current
            if (drag && drag.pointerId === event.pointerId) {
              const dx = event.clientX - drag.x
              const dy = event.clientY - drag.y
              if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
                if (!drag.moved) setDragging(true)
                drag.moved = true
                drag.x = event.clientX
                drag.y = event.clientY
                sceneRef.current?.panByScreen(dx, dy)
                setProbe(null)
              }
              return
            }
            updateProbe(event.clientX, event.clientY)
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) {
              event.currentTarget.releasePointerCapture(event.pointerId)
              dragRef.current = null
              setDragging(false)
            }
          }}
          onPointerCancel={() => {
            dragRef.current = null
            setDragging(false)
          }}
          onPointerLeave={() => {
            dragRef.current = null
            setDragging(false)
            setProbe(null)
          }}
          onDoubleClick={fitView}
        />
        <SimulationStageOverlay
          motionMinute={motionMinute}
          floorLabel={viewMode === 'isometric' ? 'Todas las plantas' : `Planta ${floorName(selectedFloor)}`}
          probe={probe}
          legendOpen={legendOpen}
          onToggleLegend={() => setLegendOpen((value) => !value)}
          onZoomIn={() => zoomBy(1.18)}
          onZoomOut={() => zoomBy(1 / 1.18)}
          onFitView={fitView}
        />
      </div>
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
  private ambientRect: Phaser.GameObjects.Rectangle | null = null
  private interiorGlow: Phaser.GameObjects.Container | null = null
  private cameraOverride = false
  private viewSignature = ''
  private zoomLabels: Phaser.GameObjects.Container[] = []
  private activeAgents: ActiveAgent[] = []

  constructor() {
    super('hospital-game-scene')
  }

  create() {
    this.scale.on('resize', this.layoutCamera, this)
    this.layoutCamera()
    if (this.snapshot) {
      this.drawStatic(this.snapshot)
      this.updateAgents(this.snapshot)
      this.updateLighting(this.snapshot)
    }
  }

  setSnapshot(snapshot: SimulationSnapshot) {
    this.snapshot = snapshot
    if (!this.sys.settings.active) return

    // Al cambiar de planta o de modo de vista se recupera el encuadre automatico.
    const viewSignature = `${snapshot.viewMode}:${snapshot.selectedFloor}`
    if (viewSignature !== this.viewSignature) {
      this.viewSignature = viewSignature
      this.cameraOverride = false
    }

    const key = staticSceneKey(snapshot)
    if (key !== this.staticKey) {
      this.staticKey = key
      this.drawStatic(snapshot)
    }
    this.updateAgents(snapshot)
    this.updateLighting(snapshot)
    this.layoutCamera()
    this.applyLabelScale()
  }

  /** Reencaja la vista y devuelve el control de camara al encuadre automatico. */
  fitView() {
    this.cameraOverride = false
    this.layoutCamera()
    this.applyLabelScale()
  }

  zoomBy(factor: number) {
    if (!this.cameras.main) return
    this.cameraOverride = true
    const next = clamp(this.cameras.main.zoom * factor, 0.12, 6)
    this.cameras.main.setZoom(next)
    this.applyLabelScale()
  }

  panByScreen(dx: number, dy: number) {
    const camera = this.cameras.main
    if (!camera) return
    this.cameraOverride = true
    camera.setScroll(camera.scrollX - dx / camera.zoom, camera.scrollY - dy / camera.zoom)
  }

  /** Devuelve la sala o el agente bajo el puntero para alimentar el tooltip. */
  probeAt(localX: number, localY: number, hostWidth: number, hostHeight: number): Omit<StageProbe, 'x' | 'y'> | null {
    const snapshot = this.snapshot
    const camera = this.cameras.main
    if (!snapshot || !camera || hostWidth <= 0 || hostHeight <= 0) return null

    const gameX = (localX / hostWidth) * this.scale.width
    const gameY = (localY / hostHeight) * this.scale.height
    const point = camera.getWorldPoint(gameX, gameY)

    if (snapshot.viewMode === 'topDown') {
      const agent = this.activeAgents
        .map((item) => ({ item, distance: Math.hypot(tileX(item.pos.x) - point.x, tileY(item.pos.y) - point.y) }))
        .filter((entry) => entry.distance < 13)
        .sort((a, b) => a.distance - b.distance)[0]
      if (agent) return agentProbe(agent.item)

      const worldX = point.x / TILE
      const worldY = point.y / TILE
      const room = snapshot.plan.rooms
        .filter((candidate) => candidate.floor === snapshot.selectedFloor)
        .filter((candidate) => worldX >= candidate.x && worldX <= candidate.x + candidate.w && worldY >= candidate.y && worldY <= candidate.y + candidate.h)
        .sort((a, b) => a.w * a.h - b.w * b.h)[0]
      return room ? roomProbe(room, snapshot, occupancyForRoom(this.activeAgents, room.id)) : null
    }

    const room = snapshot.plan.rooms
      .filter((candidate) => pointInPolygon(point, isoTopFace(candidate)))
      .sort((a, b) => isoDepth(b.x, b.y, b.floor) - isoDepth(a.x, a.y, a.floor))[0]
    return room ? roomProbe(room, snapshot, occupancyForRoom(this.activeAgents, room.id)) : null
  }

  private drawStatic(snapshot: SimulationSnapshot) {
    this.children.removeAll(true)
    this.agentSprites.clear()
    this.occupancyBadges.clear()
    this.careIndicators.clear()
    this.zoomLabels = []
    this.ambientRect = null
    this.interiorGlow = null
    this.layers = {
      staticLayer: this.add.container(0, 0).setDepth(0),
      // La iluminacion tinta la arquitectura pero queda por debajo de rotulos,
      // contadores y agentes para no perder legibilidad de datos de noche.
      lightingLayer: this.add.container(0, 0).setDepth(40),
      occupancyLayer: this.add.container(0, 0).setDepth(62),
      agentLayer: this.add.container(0, 0).setDepth(80),
      careLayer: this.add.container(0, 0).setDepth(96),
    }

    if (snapshot.viewMode === 'isometric') {
      this.drawIsometricStatic(snapshot)
      this.buildLighting(snapshot)
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
    this.buildLighting(snapshot)
  }

  /**
   * Construye el filtro ambiental (multiply) y las luces interiores (additivas).
   * Se crea una sola vez por escena estatica y luego solo se animan color/alpha.
   */
  private buildLighting(snapshot: SimulationSnapshot) {
    if (!this.layers) return

    const ambient = this.add.rectangle(0, 0, WORLD_PX_W * 4, WORLD_PX_H * 4, 0x000000, 0)
      .setOrigin(0.5, 0.5)
      .setPosition(WORLD_PX_W / 2, WORLD_PX_H / 2)
    if (snapshot.viewMode === 'isometric') {
      const bounds = isometricSceneBounds(snapshot.plan.rooms)
      ambient.setPosition(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2)
      ambient.setSize(Math.max(bounds.w, WORLD_PX_W) * 4, Math.max(bounds.h, WORLD_PX_H) * 4)
    }
    this.layers.lightingLayer.add(ambient)
    this.ambientRect = ambient

    const glow = this.add.container(0, 0)
    glow.setAlpha(0)
    this.layers.lightingLayer.add(glow)
    this.interiorGlow = glow

    if (snapshot.viewMode === 'isometric') return

    const graphics = this.add.graphics()
    graphics.setBlendMode(Phaser.BlendModes.ADD)
    glow.add(graphics)
    snapshot.plan.rooms
      .filter((room) => room.floor === snapshot.selectedFloor)
      .filter((room) => room.kind !== 'green' && room.kind !== 'future')
      .forEach((room) => {
        const pressure = Math.min(1, (snapshot.result.roomPressure[room.id] ?? 0) / Math.max(1, room.capacity * 1.6))
        const strength = interiorLightStrength(room.kind, pressure)
        if (strength <= 0) return
        const warm = room.kind === 'surgery' || room.kind === 'critical' || room.kind === 'laboratory' ? 0x9fd7ff : 0xffe0a8
        graphics.fillStyle(warm, 0.09 + strength * 0.13)
        graphics.fillRect(tileX(room.x) + 3, tileY(room.y) + 3, room.w * TILE - 6, room.h * TILE - 6)
        // El halo exterior solo en salas pequenas: en bloques grandes se acumula
        // y quema la imagen al superponerse con vecinos.
        if (room.w * room.h <= 320) {
          graphics.fillStyle(warm, 0.05 + strength * 0.07)
          graphics.fillRect(tileX(room.x) - 6, tileY(room.y) - 6, room.w * TILE + 12, room.h * TILE + 12)
        }
      })
  }

  /** Anima el ciclo dia/noche en cada frame segun la hora del replay. */
  private updateLighting(snapshot: SimulationSnapshot) {
    const hour = hourOfDay(wrapMinute(snapshot.motionMinute, snapshot.result.motionCycleMinutes))
    const ambient = ambientForHour(hour)
    this.ambientRect?.setFillStyle(toColor(ambient.tint), ambient.tintAlpha)
    this.interiorGlow?.setAlpha(ambient.interiorLight)
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

    g.lineStyle(1, toColor('#afc6c3'), 0.26)
    const bounds = boundsForRooms(rooms)
    for (let x = Math.ceil(bounds.x); x <= bounds.x + bounds.w; x += 2) {
      g.lineBetween(tileX(x), tileY(bounds.y), tileX(x), tileY(bounds.y + bounds.h))
    }
    for (let y = Math.ceil(bounds.y); y <= bounds.y + bounds.h; y += 2) {
      g.lineBetween(tileX(bounds.x), tileY(y), tileX(bounds.x + bounds.w), tileY(y))
    }

    // Banda guia de wayfinding sobre el eje mayor de la red de pasillos.
    g.fillStyle(toColor('#01b7c1'), 0.16)
    if (bounds.w >= bounds.h) {
      for (let x = bounds.x + 0.5; x < bounds.x + bounds.w - 0.5; x += 1.4) {
        g.fillRect(tileX(x), tileY(bounds.y + bounds.h / 2) - 2, TILE * 0.8, 4)
      }
    } else {
      for (let y = bounds.y + 0.5; y < bounds.y + bounds.h - 0.5; y += 1.4) {
        g.fillRect(tileX(bounds.x + bounds.w / 2) - 2, tileY(y), 4, TILE * 0.8)
      }
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
    const outdoor = snapshot.selectedFloor === 0
    const base = outdoor ? '#7fd06f' : '#e7f1ee'
    const speck = outdoor ? '#33b578' : '#c3d4d0'
    g.fillStyle(toColor(base), 1)
    g.fillRect(-WORLD_PX_W, -WORLD_PX_H, WORLD_PX_W * 3, WORLD_PX_H * 3)

    // Manchas de terreno/losa para romper el color plano.
    for (let y = 0; y < WORLD_H; y += 2) {
      for (let x = 0; x < WORLD_W; x += 2) {
        const n = (x * 13 + y * 31 + snapshot.selectedFloor * 7) % 11
        if (n < 3) {
          g.fillStyle(toColor(shadeHex(base, n === 0 ? -14 : 10)), 0.5)
          g.fillRect(x * TILE, y * TILE, TILE * 2, TILE * 2)
        }
      }
    }

    for (let y = 0; y < WORLD_H; y += 1) {
      for (let x = 0; x < WORLD_W; x += 1) {
        const n = (x * 17 + y * 29 + snapshot.selectedFloor * 11) % 23
        if (n === 0) {
          g.fillStyle(toColor(speck), 0.7)
          g.fillRect(x * TILE + 4, y * TILE + 6, 6, 3)
        }
      }
    }

    if (outdoor) {
      this.drawSiteAccess()
      this.drawPixelTree(10, 8)
      this.drawPixelTree(7, 17)
      this.drawPixelTree(89, 8)
      this.drawFlowerPatch(8, 24)
      this.drawFlowerPatch(92, 46)
    }
  }

  /** Vial de acceso y aparcamiento perimetral: da contexto urbano a la planta baja. */
  private drawSiteAccess() {
    if (!this.layers) return
    const g = this.add.graphics()
    this.layers.staticLayer.add(g)
    const roadY = WORLD_H - 5

    g.fillStyle(toColor('#4d5b66'), 1)
    g.fillRect(0, tileY(roadY), WORLD_PX_W, TILE * 3)
    g.fillStyle(toColor('#3c4750'), 1)
    g.fillRect(0, tileY(roadY), WORLD_PX_W, 3)
    g.fillStyle(0xffffff, 0.75)
    for (let x = 1; x < WORLD_W; x += 4) {
      g.fillRect(tileX(x), tileY(roadY + 1.5) - 1, TILE * 2, 3)
    }

    // Plazas de aparcamiento sobre la banda de acceso.
    g.fillStyle(toColor('#5d7186'), 1)
    g.fillRect(tileX(4), tileY(roadY - 4), TILE * 24, TILE * 4)
    g.lineStyle(1.5, 0xffffff, 0.6)
    for (let i = 0; i <= 12; i += 1) {
      g.lineBetween(tileX(4 + i * 2), tileY(roadY - 4), tileX(4 + i * 2), tileY(roadY))
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

    drawRoomShell(g, room, roomColor, wallColor)
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

    const container = this.add.container(tileX(room.x + 0.45), tileY(room.y + 0.45))
    const bg = this.add.rectangle(0, 0, layout.width, layout.height, 0xffffff, 0.94)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0xaab6ae, 0.9)
    const label = this.add.text(
      6,
      4,
      `${truncateText(room.name, layout.titleChars)}\nDem ${pressure} | Cap ${room.capacity}`,
      {
        color: '#1d2f42',
        fontFamily: 'Arial, sans-serif',
        fontSize: `${layout.fontSize}px`,
        fontStyle: 'bold',
        lineSpacing: 2,
      },
    ).setResolution(2)
    container.add([bg, label])
    this.layers.staticLayer.add(container)
    this.zoomLabels.push(container)
  }

  /**
   * Mantiene etiquetas y contadores a tamano de pantalla constante al hacer zoom:
   * sin esto, acercarse convierte los rotulos en carteles gigantes.
   */
  private applyLabelScale() {
    const camera = this.cameras.main
    if (!camera) return
    const scale = clamp(LABEL_REFERENCE_ZOOM / camera.zoom, 0.34, 1.5)
    this.zoomLabels.forEach((label) => {
      if (label.active) label.setScale(scale)
    })
    this.occupancyBadges.forEach((badge) => badge.setScale(scale))
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
    this.activeAgents = active
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
      this.updateAgentFacing(sprite, pos)
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
    const leftArm = sprite.getData('leftArm') as Phaser.GameObjects.Rectangle | undefined
    const rightArm = sprite.getData('rightArm') as Phaser.GameObjects.Rectangle | undefined
    const shadow = sprite.getData('shadow') as Phaser.GameObjects.Ellipse | undefined
    const step = moving ? Math.sin(minute * 1.5 + Number(id.replace(/\D/g, '')) * 0.3) : 0
    leftLeg?.setRotation(step * 0.28)
    rightLeg?.setRotation(-step * 0.28)
    leftLeg?.setX(-3 - Math.abs(step) * 0.9)
    rightLeg?.setX(3 + Math.abs(step) * 0.9)
    leftArm?.setRotation(-step * 0.34)
    rightArm?.setRotation(step * 0.34)
    shadow?.setScale(moving ? 1.08 : 1, moving ? 0.88 : 1)
    shadow?.setAlpha(moving ? 0.2 : 0.28)
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
    const uniform = agentUniform(agent.role, agent.id, agent.color)
    const bodyColor = toColor(uniform.body)

    const shadow = this.add.ellipse(0, 9, 15, 6, 0x0d1a15, 0.26)
    container.add(shadow)

    if (agent.role === 'patient' && agent.severity && SEVERITY_RING[agent.severity]) {
      const ring = SEVERITY_RING[agent.severity]
      const severityRing = this.add.ellipse(0, 9, 23, 11, 0x000000, 0)
        .setStrokeStyle(2, toColor(ring.color), ring.alpha)
      container.add(severityRing)
      container.setData('severityRing', severityRing)
    }

    const leftLeg = this.add.rectangle(-3, 7, 3, 6, 0x293241)
    const rightLeg = this.add.rectangle(3, 7, 3, 6, 0x293241)
    const leftArm = this.add.rectangle(-6, 0, 2.6, 8, shadeColor(uniform.body, -34))
    const rightArm = this.add.rectangle(6, 0, 2.6, 8, shadeColor(uniform.body, -34))
    const body = this.add.rectangle(0, 0, 10, 12, bodyColor).setStrokeStyle(1, 0x17201c, 0.85)
    const trim = this.add.rectangle(0, 1, 2.6, 11, toColor(uniform.trim), 0.9)
    const badge = this.add.rectangle(3.2, -3, 3, 2.4, toColor(uniform.badge))
    const head = this.add.rectangle(0, -8, 7.6, 6.6, toColor(uniform.skin)).setStrokeStyle(1, 0x17201c, 0.6)
    const hair = this.add.rectangle(0, -11.4, 8.6, 3.4, toColor(uniform.hair))
    const face = this.add.rectangle(0, -7.4, 4.4, 1.6, 0x17201c, 0.75)

    container.add([leftLeg, rightLeg, leftArm, rightArm, body, trim, badge, head, hair, face])
    if (uniform.cap) container.add(this.add.rectangle(0, -11.4, 9.2, 3.6, toColor(uniform.cap)))

    container.setData('shadow', shadow)
    container.setData('leftLeg', leftLeg)
    container.setData('rightLeg', rightLeg)
    container.setData('leftArm', leftArm)
    container.setData('rightArm', rightArm)
    container.setData('face', face)
    container.setData('trim', trim)

    if (agent.role === 'porter') {
      // El celador empuja camilla: se dibuja delante del cuerpo.
      const trolley = this.add.rectangle(0, 11, 13, 4, 0xffffff).setStrokeStyle(1, 0x375171, 0.9)
      container.add(trolley)
      container.setData('trolley', trolley)
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

  /**
   * Orienta el agente segun su desplazamiento real entre frames: mirar de frente,
   * de espaldas o de perfil hace la escena mucho mas legible que sprites fijos.
   */
  private updateAgentFacing(sprite: Phaser.GameObjects.Container, pos: AgentPosition) {
    const previousX = (sprite.getData('lastX') as number | undefined) ?? pos.x
    const previousY = (sprite.getData('lastY') as number | undefined) ?? pos.y
    const dx = pos.x - previousX
    const dy = pos.y - previousY
    sprite.setData('lastX', pos.x)
    sprite.setData('lastY', pos.y)

    let facing = (sprite.getData('facing') as string | undefined) ?? 'down'
    if (Math.abs(dx) > 0.02 || Math.abs(dy) > 0.02) {
      facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
      sprite.setData('facing', facing)
    }

    const face = sprite.getData('face') as Phaser.GameObjects.Rectangle | undefined
    const trim = sprite.getData('trim') as Phaser.GameObjects.Rectangle | undefined
    const trolley = sprite.getData('trolley') as Phaser.GameObjects.Rectangle | undefined

    if (face) {
      face.setVisible(facing !== 'up')
      face.setX(facing === 'right' ? 1.4 : facing === 'left' ? -1.4 : 0)
    }
    if (trim) trim.setVisible(facing !== 'up')
    if (trolley) {
      const horizontal = facing === 'left' || facing === 'right'
      trolley.setSize(horizontal ? 4 : 13, horizontal ? 13 : 4)
      trolley.setPosition(facing === 'right' ? 10 : facing === 'left' ? -10 : 0, facing === 'up' ? -11 : horizontal ? 1 : 11)
    }
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
    // Sombra proyectada al sureste para dar volumen.
    g.fillStyle(0x0d1a15, 0.18)
    g.fillEllipse(tileX(x + 1.5), tileY(y + 2.4), 40, 18)
    g.fillStyle(0x8b5a2b, 1)
    g.fillRect(tileX(x + 1.1), tileY(y + 1.6), 9, 20)
    g.fillStyle(0x256f38, 1)
    g.fillEllipse(tileX(x + 1.1), tileY(y + 0.9), 42, 34)
    g.fillStyle(0x2f8f46, 1)
    g.fillEllipse(tileX(x + 0.9), tileY(y + 0.6), 34, 27)
    g.fillStyle(0x46a95a, 0.85)
    g.fillEllipse(tileX(x + 0.7), tileY(y + 0.35), 20, 15)
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
    if (this.cameraOverride) return
    if (this.snapshot?.viewMode === 'isometric') {
      const bounds = isometricSceneBounds(this.snapshot.plan.rooms)
      const padding = 120
      const zoom = Math.min(this.scale.width / (bounds.w + padding * 2), this.scale.height / (bounds.h + padding * 2)) * 0.98
      this.cameras.main.setZoom(zoom)
      this.cameras.main.centerOn(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2)
      return
    }
    const bounds = topDownSceneBounds(this.snapshot?.plan.rooms ?? [], this.snapshot?.selectedFloor ?? 0)
    const zoom = Math.max(this.scale.width / bounds.w, this.scale.height / bounds.h) * 1.01
    this.cameras.main.setZoom(zoom)
    this.cameras.main.centerOn(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2)
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

function topDownSceneBounds(rooms: PlacedRoom[], floor: number): { x: number; y: number; w: number; h: number } {
  const sourceRooms = rooms.filter((room) => room.floor === floor)
  if (sourceRooms.length === 0) return { x: 0, y: 0, w: WORLD_PX_W, h: WORLD_PX_H }

  const bounds = boundsForRooms(sourceRooms)
  const paddingTiles = 1
  const minX = clamp(bounds.x - paddingTiles, 0, WORLD_W)
  const minY = clamp(bounds.y - paddingTiles, 0, WORLD_H)
  const maxX = clamp(bounds.x + bounds.w + paddingTiles, minX + 8, WORLD_W)
  const maxY = clamp(bounds.y + bounds.h + paddingTiles, minY + 8, WORLD_H)

  return {
    x: tileX(minX),
    y: tileY(minY),
    w: (maxX - minX) * TILE,
    h: (maxY - minY) * TILE,
  }
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

/**
 * Envolvente construida de una sala: sombra proyectada, suelo, muro con espesor
 * real y sombreado interior. Sustituye al rectangulo plano anterior para que el
 * plano se lea como arquitectura y no como un diagrama de bloques.
 */
function drawRoomShell(g: Phaser.GameObjects.Graphics, room: PlacedRoom, fill: string, stroke: string) {
  const px = tileX(room.x)
  const py = tileY(room.y)
  const pw = room.w * TILE
  const ph = room.h * TILE
  const wall = room.kind === 'circulation' ? 2 : room.kind === 'technical' || room.kind === 'vertical' ? 5 : 4

  // Sombra proyectada del volumen sobre el terreno.
  g.fillStyle(0x0d1a15, 0.16)
  g.fillRect(px + 4, py + 5, pw, ph)

  // Suelo interior.
  g.fillStyle(toColor(fill), 1)
  g.fillRect(px, py, pw, ph)

  // Muro perimetral con espesor.
  g.fillStyle(toColor(shadeHex(stroke, 34)), 1)
  g.fillRect(px, py, pw, wall)
  g.fillRect(px, py + ph - wall, pw, wall)
  g.fillRect(px, py, wall, ph)
  g.fillRect(px + pw - wall, py, wall, ph)

  // Cantos del muro: linea exterior nitida y junta interior mas oscura.
  g.lineStyle(1.5, toColor(shadeHex(stroke, -26)), 1)
  g.strokeRect(px + 0.75, py + 0.75, pw - 1.5, ph - 1.5)
  g.lineStyle(1, toColor(shadeHex(stroke, -40)), 0.55)
  g.strokeRect(px + wall, py + wall, pw - wall * 2, ph - wall * 2)

  // Sombra interior arrojada por los muros norte y oeste.
  g.fillStyle(0x0d1a15, 0.1)
  g.fillRect(px + wall, py + wall, pw - wall * 2, 3)
  g.fillRect(px + wall, py + wall, 3, ph - wall * 2)

  // Pilares de esquina.
  g.fillStyle(toColor(shadeHex(stroke, -18)), 1)
  const post = wall + 1
  g.fillRect(px, py, post, post)
  g.fillRect(px + pw - post, py, post, post)
  g.fillRect(px, py + ph - post, post, post)
  g.fillRect(px + pw - post, py + ph - post, post, post)
}

/** Textura de suelo por tipo de sala: baldosa, vinilo, terrazo, tecnico o exterior. */
function drawRoomPattern(g: Phaser.GameObjects.Graphics, room: PlacedRoom) {
  if (room.kind === 'circulation') {
    drawCorridorSurface(g, room)
    return
  }

  const texture = floorTexture(room.kind)
  const px = tileX(room.x)
  const py = tileY(room.y)
  const pw = room.w * TILE
  const ph = room.h * TILE
  const step = Math.max(1, texture.tile) * TILE

  if (texture.pattern === 'grass') {
    g.fillStyle(toColor(texture.grout), 0.5)
    for (let y = 0; y < ph; y += 7) {
      for (let x = (y % 14 === 0 ? 0 : 5); x < pw; x += 11) {
        g.fillRect(px + x, py + y, 3, 2)
      }
    }
    return
  }

  g.lineStyle(1, toColor(texture.grout), texture.groutAlpha)
  for (let x = step; x < pw; x += step) {
    g.lineBetween(px + x, py + 2, px + x, py + ph - 2)
  }
  for (let y = step; y < ph; y += step) {
    g.lineBetween(px + 2, py + y, px + pw - 2, py + y)
  }

  if (texture.accent) {
    // Brillo especular suave para dar sensacion de suelo pulido.
    g.fillStyle(toColor(texture.accent), 0.09)
    for (let y = 0; y < ph; y += step * 2) {
      g.fillRect(px + 2, py + y, pw - 4, Math.min(step * 0.5, ph - y))
    }
  }

  if (texture.pattern === 'technical' || texture.pattern === 'asphalt') {
    g.fillStyle(toColor(texture.grout), texture.groutAlpha * 0.8)
    for (let y = step / 2; y < ph; y += step) {
      for (let x = step / 2; x < pw; x += step) {
        g.fillRect(px + x - 1, py + y - 1, 2, 2)
      }
    }
  }
}

/** Pasillo con banda guia central y marcas de sentido de circulacion. */
function drawCorridorSurface(g: Phaser.GameObjects.Graphics, room: PlacedRoom) {
  const px = tileX(room.x)
  const py = tileY(room.y)
  const pw = room.w * TILE
  const ph = room.h * TILE
  const horizontal = room.w >= room.h

  g.lineStyle(1, toColor('#afc6c3'), 0.3)
  const step = 2 * TILE
  if (horizontal) {
    for (let x = step; x < pw; x += step) g.lineBetween(px + x, py + 2, px + x, py + ph - 2)
  } else {
    for (let y = step; y < ph; y += step) g.lineBetween(px + 2, py + y, px + pw - 2, py + y)
  }

  // Rodapie/pasamanos en los lados largos.
  g.fillStyle(toColor('#cfe0dc'), 0.85)
  if (horizontal) {
    g.fillRect(px, py + 1, pw, 2)
    g.fillRect(px, py + ph - 3, pw, 2)
  } else {
    g.fillRect(px + 1, py, 2, ph)
    g.fillRect(px + pw - 3, py, 2, ph)
  }

  // Banda guia central discontinua.
  g.fillStyle(toColor('#01b7c1'), 0.22)
  if (horizontal) {
    for (let x = 6; x < pw - 6; x += 22) g.fillRect(px + x, py + ph / 2 - 1.5, 12, 3)
  } else {
    for (let y = 6; y < ph - 6; y += 22) g.fillRect(px + pw / 2 - 1.5, py + y, 3, 12)
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
      ? (room.simulationNode === 'emergency_stair' ? '#e86464' : '#f7fbfa')
      : '#fff0ed'
    const stroke = connected ? '#375171' : '#ed7369'

    // Hueco de paso: se borra el muro y se coloca el umbral.
    g.fillStyle(toColor(fill), 1)
    g.lineStyle(1.5, toColor(stroke), 1)
    if (horizontal) {
      g.fillRect(px - length / 2, py - thickness / 2, length, thickness)
      g.strokeRect(px - length / 2, py - thickness / 2, length, thickness)
    } else {
      g.fillRect(px - thickness / 2, py - length / 2, thickness, length)
      g.strokeRect(px - thickness / 2, py - length / 2, thickness, length)
    }

    // Hoja de puerta y arco de barrido, como en un plano arquitectonico.
    const inwardX = door.side === 'left' ? 1 : door.side === 'right' ? -1 : 0
    const inwardY = door.side === 'top' ? 1 : door.side === 'bottom' ? -1 : 0
    const leaf = length * 0.82
    const hingeX = horizontal ? px - leaf / 2 : px
    const hingeY = horizontal ? py : py - leaf / 2

    g.lineStyle(1, toColor(stroke), 0.42)
    g.beginPath()
    if (horizontal) {
      g.arc(hingeX, hingeY, leaf, inwardY > 0 ? 0 : Phaser.Math.DegToRad(-90), inwardY > 0 ? Phaser.Math.DegToRad(90) : 0, false)
    } else {
      g.arc(hingeX, hingeY, leaf, inwardX > 0 ? Phaser.Math.DegToRad(-90) : Phaser.Math.DegToRad(90), inwardX > 0 ? 0 : Phaser.Math.DegToRad(180), false)
    }
    g.strokePath()

    g.lineStyle(2.5, toColor(stroke), 0.9)
    if (horizontal) {
      g.lineBetween(hingeX, hingeY, hingeX, hingeY + leaf * (inwardY > 0 ? 1 : -1))
    } else {
      g.lineBetween(hingeX, hingeY, hingeX + leaf * (inwardX > 0 ? 1 : -1), hingeY)
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

function staffRoleLabel(role: AgentRole) {
  if (role === 'doctor') return 'Médico/a'
  if (role === 'nurse') return 'Enfermería'
  if (role === 'porter') return 'Celador/a'
  if (role === 'technician') return 'Técnico/a'
  return 'Paciente'
}

const SEVERITY_LABELS: Record<string, string> = {
  low: 'leve',
  medium: 'moderada',
  high: 'alta',
  critical: 'crítica',
}

/** Datos de tooltip para un agente concreto del replay. */
function agentProbe(item: ActiveAgent): Omit<StageProbe, 'x' | 'y'> {
  const { agent, pos } = item
  const lines = [
    `Estancia: ${pos.room.name}`,
    `Estado: ${pos.moving ? 'en traslado' : 'en atención'}`,
  ]
  if (pos.phase) lines.push(`Fase: ${pos.phase}`)
  if (agent.role === 'patient') {
    if (agent.caseName) lines.push(`Caso: ${agent.caseName}`)
    if (agent.severity) lines.push(`Gravedad: ${SEVERITY_LABELS[agent.severity] ?? agent.severity}`)
  } else if (agent.staffLabel) {
    lines.push(`Equipo: ${agent.staffLabel}`)
  }
  return {
    title: agent.role === 'patient' ? (agent.caseCode ?? 'Paciente') : staffRoleLabel(agent.role),
    subtitle: agent.role === 'patient' ? 'Paciente' : 'Personal',
    lines,
    accent: agent.role === 'patient' ? agent.color : ROOM_WALL_COLORS.staff,
  }
}

/** Datos de tooltip para una estancia, con presión y ocupación en vivo. */
function roomProbe(room: PlacedRoom, snapshot: SimulationSnapshot, occupancy: RoomOccupancy): Omit<StageProbe, 'x' | 'y'> {
  const pressure = snapshot.result.roomPressure[room.id] ?? 0
  const ratio = room.capacity > 0 ? pressure / room.capacity : 0
  const state = ratio > 0.85 ? 'saturada' : ratio > 0.45 ? 'ajustada' : 'holgada'
  const lines = [
    `Tipo: ${KIND_LABELS[room.kind]}`,
    `Planta ${floorName(room.floor)} · ${Math.round(room.areaSqm)} m²`,
    `Demanda ${pressure} / capacidad ${room.capacity} (${state})`,
    `Dentro ahora: ${occupancy.total} (P ${occupancy.patients} · S ${occupancy.staff})`,
  ]
  if ((room.doors ?? []).length === 0 && room.kind !== 'circulation') lines.push('Sin puertas definidas')
  return {
    title: room.name,
    subtitle: room.simulationNode ? `Nodo ${room.simulationNode}` : undefined,
    lines,
    accent: ROOM_WALL_COLORS[room.kind] ?? '#375171',
  }
}

function occupancyForRoom(active: ActiveAgent[], roomId: string): RoomOccupancy {
  return active.reduce<RoomOccupancy>((accumulator, item) => {
    if (item.pos.room.id !== roomId) return accumulator
    accumulator.total += 1
    if (item.agent.role === 'patient') accumulator.patients += 1
    else accumulator.staff += 1
    return accumulator
  }, { total: 0, patients: 0, staff: 0 })
}

/** Cara superior del prisma isometrico, usada para detectar el bloque bajo el puntero. */
function isoTopFace(room: PlacedRoom): Array<{ x: number; y: number }> {
  const height = isoBlockHeight(room)
  return [
    isoPoint(room.x, room.y, room.floor, height),
    isoPoint(room.x + room.w, room.y, room.floor, height),
    isoPoint(room.x + room.w, room.y + room.h, room.floor, height),
    isoPoint(room.x, room.y + room.h, room.floor, height),
  ]
}

function pointInPolygon(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]
    const b = polygon[j]
    const intersects = a.y > point.y !== b.y > point.y
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 0.0001) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

function shadeColor(hex: string, amount: number) {
  return toColor(shadeHex(hex, amount))
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
  // La capa de dibujo nunca debe romper la escena por un color mal formado.
  if (typeof hex !== 'string' || !hex.startsWith('#')) return 0xffffff
  return Phaser.Display.Color.HexStringToColor(hex).color
}

function wrapMinute(minute: number, duration: number) {
  if (duration <= 0) return 0
  return ((minute % duration) + duration) % duration
}

function clamp(value: number, min: number, max: number) {
  if (min > max) return (min + max) / 2
  return Math.max(min, Math.min(max, value))
}
