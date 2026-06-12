# Sincronizacion del Pla d'Espais del Nou Clinic

Este documento describe como la rama `feature/hospital-clinic-model` empieza a sincronizar el simulador con el PDF `260608-SESSIO3-ESPAIS-Presentacio.pdf`.

## Objetivo

El PDF no es un plano arquitectonico final. Es un programa funcional y plan de espacios: define ambitos, modulos, numero de unidades, superficies utiles y requisitos de configuracion. Por eso la sincronizacion no debe crear geometria directamente sin una capa intermedia.

La cadena correcta es:

```text
PDF Pla d'Espais
  -> programa funcional estructurado
  -> auditoria contra el HospitalPlan actual
  -> catalogo y YAML mas precisos
  -> simulacion calibrable
```

## Implementacion actual

La primera version vive en:

- `frontend/src/data/clinicSpaceProgram.ts`: entradas funcionales extraidas del PDF, con paginas fuente, sector, alcance, m2 utiles, factor bruto, capacidad esperada y requisitos.
- `frontend/src/engine/clinicSpaceProgramAudit.ts`: compara esas entradas contra el `HospitalPlan` activo.
- `frontend/src/features/services/ClinicSpaceProgramPanel.tsx`: muestra sincronizacion, prioridades y detalle por entrada dentro de la pestaña `Servicios`.
- `frontend/src/features/planning/RoomInspector.tsx`: muestra y permite editar los componentes internos de cada sala.

La vista calcula:

- m2 utiles extraidos del PDF.
- m2 brutos objetivo aproximados, aplicando un factor por tipo de uso.
- entradas cubiertas, parciales, faltantes o demasiado agregadas.
- bloques actuales que estan sirviendo de equivalente en el simulador.
- requisitos textuales que todavia deben convertirse en reglas, plantillas o agentes.
- componentes internos por sala, por ejemplo habitaciones, boxes, controles de enfermeria, limpio/sucio, AGV, salas blancas, CPD o muelles.

## Uso en el planificador

El selector `Construir > Elemento` tiene dos grupos:

- `Catalogo base`: piezas genericas del simulador.
- `Pla d'Espais Nou Clinic`: entradas del PDF convertidas en bloques construibles.

Cuando se anade una entrada del PDF a una planta, el planificador:

1. Escoge una plantilla base equivalente.
2. Calcula un tamano inicial desde m2 utiles y `grossingFactor`.
3. Asigna capacidad esperada cuando el PDF la define.
4. Guarda `spaceProgramEntryId` para mantener trazabilidad.
5. Copia componentes internos a `room.components`.

El bloque sigue siendo editable: se puede mover, redimensionar, conectar a pasillos y ajustar capacidad como cualquier otra sala.

## Componentes internos de sala

Cada `PlacedRoom` puede llevar `components`, una lista editable con:

- nombre del componente,
- cantidad,
- m2 utiles por unidad,
- categoria,
- fuente.

Esto permite que una sala grande no sea una caja opaca. Por ejemplo, una `Hospitalizacion convencional - modulo tipo` puede contener 18 habitaciones individuales, 4 dobles, 2 aislamientos, control de enfermeria, limpio/sucio, carros/AGV y locales tecnicos. En la siguiente fase estos componentes deben influir en simulacion fina, personal, limpieza, suministros y reglas.

## Estados de auditoria

| Estado | Significado |
|---|---|
| `Falta` | No hay bloque equivalente en el plan actual. |
| `Debil` | Hay bloque equivalente, pero cubre menos del 50% del objetivo bruto aproximado. |
| `Parcial` | Cubre entre el 50% y el 85% del objetivo bruto aproximado. |
| `Cubierto` | La cobertura de m2 esta dentro de un rango razonable para esta primera capa. |
| `Agregado` | El plan cubre la entrada con bloques demasiado amplios; hace falta desagregar para simular bien. |
| `Regla` | La entrada es configuracional, no de superficie. Debe convertirse en regla o escenario. |

## Lectura de m2

El PDF suele dar `Sup. util (m2)`. El canvas del simulador trabaja con una geometria mas cercana a superficie bruta modelada. Por eso cada entrada incluye `grossingFactor`.

Ejemplos de criterio inicial:

- Hospitalizacion convencional: 1.65.
- Criticos y semicriticos: 2.05.
- Quirofanos: 2.25.
- Consultas y docencia: 1.35-1.45.
- Logistica y farmacia: 1.55-1.75.

Estos factores son supuestos de trabajo. Deben validarse con arquitectura e ingenieria antes de usarlos como dato normativo.

## Que permite ya

La pestaña `Servicios` puede responder preguntas como:

- Que partes del PDF ya estan representadas por el preset Clinic.
- Que partes existen pero estan demasiado agregadas, por ejemplo docencia, CRAI, cocina o TIC.
- Que requisitos no son m2, sino reglas de simulacion: MAT 0-5, flujos limpio/sucio, AGV, CPD Tier III o separacion de residuos.
- Que modulos deben desagregarse antes de confiar en una simulacion de cuellos de botella.

## Limitaciones

- La extraccion actual es una consolidacion manual asistida por tablas del PDF, no un importador generico de PDFs.
- Algunas paginas complejas, especialmente farmacia/medicamento, deben revisarse con la tabla original.
- Los m2 son utiles y se transforman con factores brutos iniciales.
- El modelo todavia no tiene plantillas visuales especificas para CRAI, cocina central, lenceria, seguridad, oficinas, CPD o varias plataformas de recerca; de momento se crean con una plantilla equivalente y componentes internos.
- La auditoria compara por `templateId`, tipo de sala y palabras clave; no entiende aun relaciones BIM/IFC ni geometria real de un plano.
- Los componentes internos todavia no se dibujan dentro del canvas 2D como subhabitaciones; viven como desglose funcional editable en el inspector.

## Siguiente fase recomendada

1. Convertir `clinicSpaceProgram.ts` en JSON versionado servido por backend.
2. Anadir plantillas especificas para los espacios que ahora aparecen agregados.
3. Crear un importador reproducible desde PDF/Excel cuando el equipo comparta una tabla fuente editable.
4. Generar YAML automaticamente desde el programa funcional, separando m2 utiles, m2 brutos y geometria propuesta.
5. Convertir requisitos textuales en reglas ejecutables: MAT, limpio/sucio, AGV, CPD, residuos, seguridad y proximidades criticas.
6. Calibrar los factores brutos con arquitectura.
7. Dibujar subcomponentes dentro de salas grandes cuando el nivel de detalle lo justifique.
