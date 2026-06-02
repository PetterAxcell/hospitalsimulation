# Lenguaje de planificacion

El lenguaje de planificacion convierte plantillas `.yaml` en un `HospitalPlan`. El formato es YAML porque permite versionar planes de forma legible y estructurada.

## Plantilla YAML

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
    floors: S1..P8
    at: [50, 20]
    size: [8, 8]
    group: asc-core-central
    name: Nucleo vertical central

connections:
  - from: boxes-pb
    to: clinical-pb
  - from: asc-core-central
    to: clinical-pb
```

## Campos

- `plan.name`: nombre visible del plan.
- `plan.target`: m2 objetivo.
- `plan.site`: m2 de parcela.
- `plan.floors`: plantas disponibles.
- `clear: true`: reemplaza el plan actual antes de crear bloques.
- `corridors`: pasillos publicos, clinicos o logisticos.
- `rooms`: servicios hospitalarios del catalogo.
- `verticals`: nucleos verticales replicados en varias plantas.
- `connections`: conexiones topologicas entre bloques sin crear pasillos intermedios.

## Conexiones

Las conexiones unen bloques por codigo aunque no se toquen geometricamente. Esto evita generar pasillos auxiliares y permite que la simulacion use esa relacion como acceso real.

```yaml
connections:
  - from: boxes-pb
    to: clinical-pb
  - from: [triage-pb, resus-pb, imaging-pb]
    to: clinical-pb
```

`from` y `to` pueden referirse a:

- `id` del bloque.
- `group` de un nucleo vertical, por ejemplo `asc-core-central`.
- alias o `template` del catalogo, por ejemplo `clinical`, `boxes` o `verticalCore`.
- `simulationNode`, por ejemplo `triage` o `vertical_core`.

Las conexiones entre sala y pasillo solo se aplican en la misma planta. Los nucleos verticales conectan plantas mediante `verticals.floors` y `verticals.group`.

## Plantas

- `PB` equivale a planta 0.
- `P1`, `P2`, `P3` equivalen a plantas positivas.
- `S1`, `S2` equivalen a sotanos negativos.
- Los rangos usan `..`, por ejemplo `S1..P8` o `-1..8`.

## Plantillas cortas

Alias iniciales: `hall`, `waiting`, `ambulances`, `triage`, `resus`, `boxes`, `observation`, `imaging`, `ward`, `icu`, `or`, `pacu`, `public`, `clinical`, `logistics`, `core`, `stair`, `refuge`, `fire`, `mep`.

Tambien se puede usar el `id` completo del catalogo, por ejemplo `edBoxes`, `verticalCore` o `clinicalCorridor`.

## Semantica actual

- Las puertas se generan automaticamente con las mismas reglas del editor visual.
- Las dimensiones estan en unidades de plano; 1 unidad equivale a 3 m.
- Los bloques se limitan al lienzo de 100 x 70 unidades.
- Si no se usa `clear: true`, los bloques se anaden al plan actual.
- En simulacion, los pasillos conectados en una misma planta se dibujan como una sola red continua.
