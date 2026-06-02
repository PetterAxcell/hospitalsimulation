# Lenguaje de planificacion

El lenguaje de planificacion convierte scripts de texto en un `HospitalPlan`. La primera version esta pensada para generar trazados base repetibles desde plantillas del catalogo del frontend.

## Comandos

```text
plan "Nombre del plan"
target 290000
site 210000
floors S1 PB P1 P2
clear

room <plantilla> floor <planta> at <x> <y> size <w> <h> [capacity <n>] [name "Nombre"] [id <id>]
corridor <public|clinical|logistics> floor <planta> at <x> <y> size <w> <h> [name "Nombre"]
vertical <core|stair> floors <rango> at <x> <y> size <w> <h> group <id> [name "Nombre"]
```

## Plantas

- `PB` equivale a planta 0.
- `P1`, `P2`, `P3` equivalen a plantas positivas.
- `S1`, `S2` equivalen a sotanos negativos.
- Los rangos usan `..`, por ejemplo `S1..P8` o `-1..8`.

## Ejemplo

```text
plan "Hospital script 290.000 m2"
target 290000
site 210000
floors S1 PB P1 P2 P3 P4 P5 P6 P7 P8
clear

corridor clinical floor PB at 0 31 size 100 7 name "Pasillo clinico principal"
corridor public floor PB at 47 0 size 9 70 name "Pasillo publico vertical"
room hall floor PB at 8 28 size 18 20
room boxes floor PB at 47 27 size 21 16
vertical core floors S1..P8 at 50 20 size 8 8 group asc-core-central name "Nucleo vertical central"
```

## Semantica actual

- Si el script contiene `clear`, se reemplazan todos los bloques del plan.
- Si no contiene `clear`, los bloques se anaden al plan actual.
- Las puertas se generan automaticamente con las mismas reglas del editor visual.
- Las dimensiones estan en unidades de plano; 1 unidad equivale a 3 m.
- Los bloques se limitan al lienzo de 100 x 70 unidades.
