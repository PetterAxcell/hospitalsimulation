# Lenguaje YAML del planificador

El planificador convierte una plantilla `.yaml` en un `HospitalPlan`. El objetivo del formato es que una persona o un agente pueda programar un plan hospitalario de forma legible, versionable y repetible.

El boton `Info` del modal `Programar plan` abre un manual autodidactico con ejemplos de YAML y del objeto interno que genera el parser.

## Estructura basica

```yaml
plan:
  name: Hospital script 290.000 m2
  target: 290000
  site: 210000
  floors: [S1, PB, P1, P2, P3, P4, P5, P6, P7, P8]
clear: true

corridors:
  - template: clinical
    id: clinical-pb
    floor: PB
    at: [0, 31]
    size: [100, 7]
    name: Pasillo clinico principal

rooms:
  - template: boxes
    id: boxes-pb
    floor: PB
    at: [47, 27]
    size: [21, 16]
    capacity: 60

verticals:
  - template: core
    group: asc-core-central
    floors: S1..P8
    at: [50, 20]
    size: [8, 8]
    name: Nucleo vertical central

connections:
  - from: boxes-pb
    to: clinical-pb
  - from: asc-core-central
    to: clinical-pb
```

## Orden recomendado

1. Define `plan` con nombre, superficies y plantas.
2. Usa `clear: true` si quieres reemplazar el plan actual.
3. Crea primero `corridors`, porque las salas se suelen conectar a ellos.
4. Crea `rooms` para los servicios hospitalarios.
5. Crea `verticals` para ascensores, escaleras o nucleos replicados en varias plantas.
6. Declara `connections` para que el motor entienda accesos logicos.

## Campos de `plan`

- `plan.name`: nombre visible del plan.
- `plan.target` o `plan.targetAreaSqm`: superficie objetivo en m2.
- `plan.site` o `plan.siteAreaSqm`: superficie de parcela en m2.
- `plan.floors`: plantas disponibles. Acepta listas y rangos.
- `clear: true`: borra los bloques actuales antes de aplicar el YAML.

Si no se usa `clear: true`, los bloques del YAML se anaden al plan actual.

## Bloques y pasillos

`corridors` solo acepta plantillas de pasillo. `rooms` acepta servicios del catalogo. Cada elemento necesita:

- `template`: alias corto o id completo del catalogo.
- `floor`: planta donde se coloca el bloque.
- `at: [x, y]`: esquina superior izquierda.
- `size: [w, h]`: ancho y alto.

Campos opcionales:

- `id`: identificador estable para conectar o modificar mentalmente el plan.
- `name`: nombre visible del bloque.
- `capacity`: capacidad funcional del servicio.

Ejemplo:

```yaml
rooms:
  - template: triage
    id: triage-pb
    floor: PB
    at: [58, 17]
    size: [11, 8]
  - template: resus
    id: resus-pb
    floor: PB
    at: [68, 28]
    size: [14, 10]
```

## Verticales

`verticals` crea un bloque por cada planta indicada. Es la forma recomendada de programar nucleos de ascensor, escaleras o montacargas.

Campos:

- `template`: debe ser una plantilla vertical, por ejemplo `core` o `stair`.
- `group`: nombre comun para todo el nucleo. Sirve para conectarlo despues.
- `floors`: lista, rango o `all`.
- `at` y `size`: posicion y dimensiones compartidas en cada planta.
- `name`: opcional; el planificador anade la planta al nombre visible.

```yaml
verticals:
  - template: core
    group: asc-core-central
    floors: S1..P8
    at: [50, 20]
    size: [8, 8]
```

## Conexiones

`connections` une bloques de forma topologica sin dibujar pasillos nuevos. La simulacion las trata como accesos reales aunque la geometria no se toque.

```yaml
connections:
  - from: [triage-pb, resus-pb, boxes-pb, observation-pb]
    to: clinical-pb
  - from: hall-pb
    to: public-pb
  - from: asc-core-central
    to: clinical-pb
```

`from` y `to` aceptan:

- `id` del bloque.
- `group` de un vertical, por ejemplo `asc-core-central`.
- alias o `template` del catalogo, por ejemplo `clinical`, `boxes` o `verticalCore`.
- `simulationNode`, por ejemplo `triage`, `ed_bay`, `imaging` o `vertical_core`.
- listas YAML, por ejemplo `[triage-pb, resus-pb]`.
- listas separadas por coma en texto.

Las conexiones entre sala y pasillo solo se aplican en la misma planta. Una conexion entre dos verticales puede abarcar plantas. Puedes limitar una conexion con `floor` o `floors`:

```yaml
connections:
  - from: ward
    to: asc-core-central
    floors: P1..P8
```

## Plantas

- `PB`, `G` y `0` equivalen a planta 0.
- `P1`, `P2`, `P3` equivalen a plantas positivas.
- `S1`, `S2` equivalen a sotanos negativos.
- Tambien se aceptan numeros, por ejemplo `-1`, `0`, `8`.
- Los rangos usan `..`, por ejemplo `S1..P8`, `-1..8` o `P8..S1`.
- `all` usa las plantas ya declaradas en el plan.

## Coordenadas y escala

- El lienzo tiene 100 x 70 unidades.
- `at: [x, y]` usa la esquina superior izquierda.
- `size: [w, h]` usa ancho y alto.
- 1 unidad equivale a 3 m.
- El area se calcula desde las dimensiones.
- Los bloques se limitan al lienzo con las mismas reglas del editor visual.
- Las puertas se generan automaticamente al finalizar el plan.

## Plantillas y alias frecuentes

Atajos aceptados por el parser:

```text
hall, waiting, ambulance, ambulances, bay, triage, resus, boxes, ed,
observation, ward, icu, or, pacu, lab, pharmacy, public, clinical,
logistics, core, vertical, stair, emergency_stair, refuge, fire, mep,
command, courtyard
```

Tambien puedes usar el id completo del catalogo. Ejemplos: `mainHall`, `publicWaiting`, `edBoxes`, `imaging`, `coreLab`, `verticalCore`, `clinicalCorridor`, `logisticsCorridor`.

## Diagnosticos habituales

- `La plantilla YAML debe ser un objeto`: el documento no tiene un objeto raiz.
- `Las listas YAML deben ser arrays`: `rooms`, `corridors`, `verticals` o `connections` no son listas.
- `room.template necesita texto`: falta la plantilla de un bloque.
- `room.at necesita [x, y]`: faltan coordenadas o no son dos valores.
- `Planta no reconocida`: el token de planta no coincide con PB, Pn, Sn o un numero.
- `Referencia de bloque no encontrada`: una conexion apunta a un id, alias o grupo inexistente.

## Ejemplo minimo

```yaml
plan:
  name: Urgencias PB
  floors: [PB]
clear: true

corridors:
  - template: clinical
    id: clinical-pb
    floor: PB
    at: [0, 30]
    size: [100, 7]

rooms:
  - template: triage
    id: triage-pb
    floor: PB
    at: [10, 20]
    size: [12, 8]
  - template: boxes
    id: boxes-pb
    floor: PB
    at: [28, 20]
    size: [24, 16]

connections:
  - from: [triage-pb, boxes-pb]
    to: clinical-pb
```
