import { useState } from 'react'
import { Metric } from '../../components/ui/Metric'
import { Modal } from '../../components/ui/Modal'
import { CLINIC_SPACE_PROGRAM, clinicSpaceProgramById, componentsForSpaceProgramEntry } from '../../data/clinicSpaceProgram'
import {
  disconnectedPassages,
  doorConnectsToCorridor,
  hasPassageAccess,
  isPassage,
  requiresCorridorAccess,
} from '../../engine/circulation'
import { clampRoom, metersToWorldUnits, worldUnitsToMeters } from '../../engine/geometry'
import type { PlacedRoom, RoomComponent } from '../../types'
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
  const [isComponentsOpen, setComponentsOpen] = useState(false)
  const [componentDraft, setComponentDraft] = useState({ name: '', quantity: 1, areaSqm: 0, category: '' })

  if (!room) {
    return (
      <section className="panel-section">
        <h2>Elemento</h2>
        <p className="muted">Selecciona un bloque del plano.</p>
      </section>
    )
  }
  const selectedRoom = room
  const accessRequired = requiresCorridorAccess(selectedRoom)
  const hasCorridor = hasPassageAccess(allRooms, selectedRoom)
  const isDisconnectedPassage = isPassage(selectedRoom) && disconnectedPassages(allRooms).some((item) => item.id === selectedRoom.id)
  const components = componentsForRoom(selectedRoom)
  const componentArea = components.reduce((sum, component) => sum + (component.areaSqm ?? 0) * component.quantity, 0)
  const sourceEntry = clinicEntryForRoom(selectedRoom)

  function addComponent() {
    const name = componentDraft.name.trim()
    if (!name) return
    const nextIndex = components.filter((component) => component.id.includes('-custom-component-')).length + 1
    const nextComponent: RoomComponent = {
      id: `${selectedRoom.id}-custom-component-${nextIndex}`,
      name,
      quantity: Math.max(1, Math.round(componentDraft.quantity || 1)),
      areaSqm: componentDraft.areaSqm > 0 ? componentDraft.areaSqm : undefined,
      category: componentDraft.category.trim() || 'componente manual',
      source: 'manual',
    }
    onChange({ ...selectedRoom, components: [...components, nextComponent] })
    setComponentDraft({ name: '', quantity: 1, areaSqm: 0, category: '' })
  }

  function removeComponent(componentId: string) {
    onChange({ ...selectedRoom, components: components.filter((component) => component.id !== componentId) })
  }

  function updateComponent(componentId: string, patch: Partial<RoomComponent>) {
    onChange({
      ...selectedRoom,
      components: components.map((component) => (component.id === componentId ? { ...component, ...patch } : component)),
    })
  }

  function applyClinicComponents() {
    if (!sourceEntry) return
    onChange({
      ...selectedRoom,
      spaceProgramEntryId: sourceEntry.id,
      components: componentsForSpaceProgramEntry(sourceEntry).map((component) => ({
        ...component,
        id: `${selectedRoom.id}-${component.id}`,
      })),
    })
  }

  function applyDefaultComponents() {
    onChange({
      ...selectedRoom,
      spaceProgramEntryId: undefined,
      components: defaultComponentsForRoom(selectedRoom),
    })
  }

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
        <div className="inspector-main-actions">
          <button type="button" className="primary-action" onClick={() => setComponentsOpen(true)}>
            Editar contenido
          </button>
        </div>
      </section>

      <section className="panel-section">
        <h2>Equipamiento</h2>
        <div className="tag-list">
          {room.equipment.map((item) => <span key={item}>{item}</span>)}
        </div>
      </section>

      <section className="panel-section">
        <h2>Contenido del bloque</h2>
        <div className="status-metrics">
          <Metric label="Componentes" value={String(components.length)} />
          <Metric label="m2 utiles comp." value={componentArea > 0 ? formatNumber(componentArea) : '-'} />
        </div>
        {sourceEntry && <p className="muted">Origen: PDF p.{sourceEntry.sourcePages.join(', ')} · {sourceEntry.sector}</p>}
        <div className="component-source-actions">
          <button type="button" className="secondary-action" onClick={applyClinicComponents} disabled={!sourceEntry}>
            Usar Nou Clínic
          </button>
          <button type="button" className="secondary-action" onClick={applyDefaultComponents}>
            Usar por defecto
          </button>
        </div>
        <div className="tag-list">
          {components.slice(0, 6).map((component) => (
            <span key={component.id}>{component.quantity}x {component.name}</span>
          ))}
        </div>
        <button type="button" className="secondary-action" onClick={() => setComponentsOpen(true)}>
          Editar contenido
        </button>
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

      {isComponentsOpen && (
        <RoomComponentsModal
          room={room}
          components={components}
          componentArea={componentArea}
          draft={componentDraft}
          onChangeDraft={setComponentDraft}
          onAdd={addComponent}
          onUpdate={updateComponent}
          onRemove={removeComponent}
          onClose={() => setComponentsOpen(false)}
        />
      )}
    </>
  )
}

function RoomComponentsModal({
  room,
  components,
  componentArea,
  draft,
  onChangeDraft,
  onAdd,
  onUpdate,
  onRemove,
  onClose,
}: {
  room: PlacedRoom
  components: RoomComponent[]
  componentArea: number
  draft: { name: string; quantity: number; areaSqm: number; category: string }
  onChangeDraft: (draft: { name: string; quantity: number; areaSqm: number; category: string }) => void
  onAdd: () => void
  onUpdate: (componentId: string, patch: Partial<RoomComponent>) => void
  onRemove: (componentId: string) => void
  onClose: () => void
}) {
  return (
    <Modal
      titleId="room-components-title"
      title="Contenido del bloque"
      subtitle={`${room.name} · ${components.length} componentes · ${componentArea > 0 ? `${formatNumber(componentArea)} m2 utiles` : 'sin m2 utiles definidos'}`}
      className="section-modal"
      onClose={onClose}
    >
      <div className="room-components-modal">
        <section className="section-modal-card">
          <h3>Añadir componente</h3>
          <div className="component-form-grid">
            <label>
              Nombre
              <input value={draft.name} onChange={(event) => onChangeDraft({ ...draft, name: event.target.value })} placeholder="Ej. Sala de curas" />
            </label>
            <label>
              Cantidad
              <input type="number" min={1} value={draft.quantity} onChange={(event) => onChangeDraft({ ...draft, quantity: Number(event.target.value) })} />
            </label>
            <label>
              m2 utiles/unidad
              <input type="number" min={0} value={draft.areaSqm} onChange={(event) => onChangeDraft({ ...draft, areaSqm: Number(event.target.value) })} />
            </label>
            <label>
              Categoría
              <input value={draft.category} onChange={(event) => onChangeDraft({ ...draft, category: event.target.value })} placeholder="clinico, logistica..." />
            </label>
          </div>
          <button type="button" className="primary-action" onClick={onAdd}>Añadir componente</button>
        </section>

        <section className="section-modal-card">
          <h3>Desglose de la sala</h3>
          <div className="room-component-list">
            {components.map((component) => (
              <article key={component.id} className="room-component-row">
                <div className="room-component-edit-grid">
                  <label>
                    Componente
                    <input value={component.name} onChange={(event) => onUpdate(component.id, { name: event.target.value })} />
                  </label>
                  <label>
                    Cant.
                    <input
                      type="number"
                      min={0}
                      value={component.quantity}
                      onChange={(event) => onUpdate(component.id, { quantity: Math.max(0, Number(event.target.value)) })}
                    />
                  </label>
                  <label>
                    m2/u
                    <input
                      type="number"
                      min={0}
                      value={component.areaSqm ?? 0}
                      onChange={(event) => onUpdate(component.id, { areaSqm: Number(event.target.value) || undefined })}
                    />
                  </label>
                  <label>
                    Categoria
                    <input value={component.category ?? ''} onChange={(event) => onUpdate(component.id, { category: event.target.value })} />
                  </label>
                </div>
                <button type="button" onClick={() => onRemove(component.id)}>Quitar</button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  )
}

function componentsForRoom(room: PlacedRoom): RoomComponent[] {
  if (room.components?.length) return room.components
  return defaultComponentsForRoom(room)
}

function clinicEntryForRoom(room: PlacedRoom) {
  return room.spaceProgramEntryId
    ? clinicSpaceProgramById(room.spaceProgramEntryId)
    : CLINIC_SPACE_PROGRAM.find((entry) => entry.templateIds.includes(room.templateId))
}

function defaultComponentsForRoom(room: PlacedRoom): RoomComponent[] {
  return room.equipment.map((equipment, index) => ({
    id: `${room.id}-default-component-${index + 1}`,
    name: equipment,
    quantity: 1,
    category: 'equipamiento por defecto',
    source: 'catalogo base',
  }))
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
