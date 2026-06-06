import { Metric } from '../../components/ui/Metric'
import {
  disconnectedPassages,
  doorConnectsToCorridor,
  hasPassageAccess,
  isPassage,
  requiresCorridorAccess,
} from '../../engine/circulation'
import { clampRoom, metersToWorldUnits, worldUnitsToMeters } from '../../engine/geometry'
import type { PlacedRoom } from '../../types'
import { floorLabel, formatNumber } from '../../utils/format'

interface RoomInspectorProps {
  room?: PlacedRoom
  allRooms: PlacedRoom[]
  floors: number[]
  onChange: (room: PlacedRoom) => void
  onDuplicate: () => void
  onRemove: () => void
  doorToolActive: boolean
  onStartDoorTool: () => void
  onRemoveDoor: (roomId: string, doorId: string) => void
  onAutoConnect: () => void
}

export function RoomInspector({
  room,
  allRooms,
  floors,
  onChange,
  onDuplicate,
  onRemove,
  doorToolActive,
  onStartDoorTool,
  onRemoveDoor,
  onAutoConnect,
}: RoomInspectorProps) {
  if (!room) {
    return (
      <section className="panel-section">
        <h2>Elemento</h2>
        <p className="muted">Selecciona un bloque del plano.</p>
      </section>
    )
  }
  const accessRequired = requiresCorridorAccess(room)
  const hasCorridor = hasPassageAccess(allRooms, room)
  const isDisconnectedPassage = isPassage(room) && disconnectedPassages(allRooms).some((item) => item.id === room.id)

  return (
    <>
      <section className="panel-section">
        <h2>Elemento</h2>
        <label>
          Nombre
          <input value={room.name} onChange={(event) => onChange({ ...room, name: event.target.value })} />
        </label>
        <label>
          Planta
          <select value={room.floor} onChange={(event) => onChange(changeRoomFloor(room, Number(event.target.value)))}>
            {floors.map((floor) => (
              <option key={floor} value={floor}>{floorLabel(floor)}</option>
            ))}
          </select>
        </label>
        <label>
          Capacidad
          <input type="number" value={room.capacity} onChange={(event) => onChange({ ...room, capacity: Number(event.target.value) })} />
        </label>
        <div className="dimension-grid">
          <label>
            Ancho (m)
            <input
              type="number"
              min={12}
              step={3}
              value={worldUnitsToMeters(room.w)}
              onChange={(event) => onChange(resizeRoomInMeters(room, 'w', Number(event.target.value)))}
            />
          </label>
          <label>
            Alto (m)
            <input
              type="number"
              min={12}
              step={3}
              value={worldUnitsToMeters(room.h)}
              onChange={(event) => onChange(resizeRoomInMeters(room, 'h', Number(event.target.value)))}
            />
          </label>
        </div>
        <div className="status-metrics">
          <Metric label="m2 calculados" value={formatNumber(room.areaSqm)} />
          <Metric
            label={isPassage(room) ? 'Red circulación' : 'Acceso pasillo'}
            value={isPassage(room) ? (isDisconnectedPassage ? 'Aislado' : 'Conectado') : accessRequired ? (hasCorridor ? 'Conectado' : 'Sin pasillo') : 'Opcional'}
          />
        </div>
      </section>

      <section className="panel-section">
        <h2>Equipamiento</h2>
        <div className="tag-list">
          {room.equipment.map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>

      {room.kind === 'vertical' && (
        <section className="panel-section">
          <h2>Conexión vertical</h2>
          <label>
            Familia de conector
            <input
              value={room.verticalGroupId ?? ''}
              onChange={(event) => onChange({ ...room, verticalGroupId: event.target.value })}
              placeholder="ascensor-central"
            />
          </label>
          <FloorConnectionSelector room={room} floors={floors} onChange={onChange} />
        </section>
      )}

      <section className="panel-section">
        <h2>Personal</h2>
        <div className="tag-list">
          {room.staffModel.map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>

      <section className="panel-section">
        <h2>Puertas</h2>
        <Metric label="Puertas" value={String(room.doors?.length ?? 0)} />
        <button
          type="button"
          className={doorToolActive ? 'primary-action' : undefined}
          onClick={onStartDoorTool}
          disabled={room.kind === 'circulation' || room.kind === 'future'}
        >
          {doorToolActive ? 'Colocando puerta' : 'Añadir puerta'}
        </button>
        <button
          type="button"
          className="secondary-action"
          onClick={onAutoConnect}
          disabled={!accessRequired || hasCorridor}
        >
          Conectar a pasillo cercano
        </button>
        <div className="tag-list">
          {(room.doors ?? []).map((door, index) => {
            const connected = doorConnectsToCorridor(allRooms, room, door)
            return (
              <button
                key={door.id}
                type="button"
                className={`door-chip ${connected ? 'connected' : 'blocked'}`}
                onClick={() => onRemoveDoor(room.id, door.id)}
                title="Click para eliminar"
              >
                Puerta {index + 1} · {connected ? 'pasillo' : 'sin pasillo'}
              </button>
            )
          })}
        </div>
      </section>

      <div className="button-row">
        <button type="button" onClick={onDuplicate}>Duplicar</button>
        <button type="button" onClick={onRemove}>Eliminar</button>
      </div>
    </>
  )
}

function FloorConnectionSelector({
  room,
  floors,
  onChange,
}: {
  room: PlacedRoom
  floors: number[]
  onChange: (room: PlacedRoom) => void
}) {
  const servedFloors = normalizeServedFloors(room.servesFloors ?? [room.floor], room.floor)

  return (
    <div className="floor-connection-editor">
      <span>Plantas conectadas</span>
      <div className="floor-selector-grid">
        {floors.map((floor) => {
          const isActive = servedFloors.includes(floor)
          return (
            <button
              key={floor}
              type="button"
              className={`${isActive ? 'is-active' : ''} ${floor === room.floor ? 'is-anchor' : ''}`}
              onClick={() => onChange({ ...room, servesFloors: toggleServedFloor(servedFloors, floor, room.floor) })}
            >
              {floorLabel(floor)}
            </button>
          )
        })}
      </div>
      <div className="floor-quick-actions">
        <button type="button" onClick={() => onChange({ ...room, servesFloors: [room.floor] })}>Solo esta</button>
        <button type="button" onClick={() => onChange({ ...room, servesFloors: adjacentFloorRange(floors, room.floor) })}>Tramo +1</button>
        <button type="button" onClick={() => onChange({ ...room, servesFloors: floors })}>Todas</button>
      </div>
    </div>
  )
}

function resizeRoomInMeters(room: PlacedRoom, dimension: 'w' | 'h', meters: number): PlacedRoom {
  if (!Number.isFinite(meters)) return room
  return clampRoom({ ...room, [dimension]: metersToWorldUnits(meters) })
}

function changeRoomFloor(room: PlacedRoom, floor: number): PlacedRoom {
  if (!Number.isFinite(floor)) return room
  const nextFloor = Math.round(floor)
  return clampRoom({
    ...room,
    floor: nextFloor,
    servesFloors: room.kind === 'vertical' ? normalizeServedFloors(room.servesFloors ?? [room.floor], nextFloor) : room.servesFloors,
  })
}

function normalizeServedFloors(floors: number[], anchorFloor: number): number[] {
  const normalized = new Set(floors.map((floor) => Math.round(floor)).filter((floor) => Number.isFinite(floor)))
  normalized.add(anchorFloor)
  return [...normalized].sort((a, b) => a - b)
}

function toggleServedFloor(floors: number[], floor: number, anchorFloor: number): number[] {
  const next = new Set(floors)
  if (next.has(floor) && floor !== anchorFloor) next.delete(floor)
  else next.add(floor)
  next.add(anchorFloor)
  return [...next].sort((a, b) => a - b)
}

function adjacentFloorRange(floors: number[], anchorFloor: number): number[] {
  const index = floors.indexOf(anchorFloor)
  const adjacent = floors[index + 1] ?? floors[index - 1] ?? anchorFloor
  return normalizeServedFloors([anchorFloor, adjacent], anchorFloor)
}
