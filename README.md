# Simulador hospitalario integral

Herramienta abierta para disenar, simular y comparar arquitecturas de hospitales terciarios. La aplicacion principal esta migrada a React/TypeScript y usa Phaser 3 para la simulacion visual tipo videojuego 2D: plantas, habitaciones, equipamiento, accesos, ambulancias, halls, esperas, ascensores, escaleras, refugios y flujos de pacientes.

La vision es crear una herramienta para redisenar hospitales complejos como Vall d'Hebron o Hospital Clinic, empezando por un programa de gran escala y evolucionando hacia simulacion de pacientes, medicos, enfermeria, celadores, tecnicos y recursos. La rama `feature/hospital-clinic-model` usa un primer modelo funcional del Nou Campus de Salut Clinic-UB de 300.000 m2, basado en fuentes oficiales, para trabajar programa preliminar, adyacencias y escenarios antes de generar alternativas automaticamente.

## Uso rapido

```bash
cd frontend
npm install
npm run dev
```

La app se levanta normalmente en `http://localhost:5173/`.

Para validar:

```bash
cd frontend
npm run lint
npm run build
```

Para desplegar el frontend en Cloudflare Pages:

```bash
cd frontend
npm run deploy
```

Produccion publicada:

- URL Pages fallback: `https://simlab-dum.pages.dev`
- Preview del ultimo deploy manual: `https://16bd9906.simlab-dum.pages.dev`

### Backend API experimental

Esta rama introduce una primera capa desacoplada en Python/FastAPI alrededor del motor SimPy:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn hospital_sim.backend.api:app --reload
```

La API queda disponible en `http://127.0.0.1:8000` con endpoints iniciales para catalogo, proyectos, versiones de planes, evaluacion de reglas y simulaciones reproducibles.

## Estado actual

- Frontend React con editor multi-planta.
- Canvas de Vision para colocar, mover y redimensionar servicios, pasillos, ascensores, escaleras, montacargas y piezas de seguridad.
- Simulacion 2D con Phaser 3, estilo top-down RPG/pixel-art, con agentes, presion por estancia y capas de RPG, flujos y reglas.
- Top de propuestas por autor: ranking local de arquitecturas, puntuado con KPIs de simulacion, reglas abiertas y desviacion de m2. Es la primera vista de la app para priorizar comparacion antes que edicion; ahora usa tarjetas compactas y modales de detalle para evitar paginas demasiado explicativas.
- Saturacion compacta: la vista muestra presion, casos y estado en una pantalla escaneable; la lectura operativa vive en modal para no llenar la pagina con texto fijo.
- Catalogo de hospital terciario: urgencias, diagnostico, quirofanos, PACU, UCI, wards, maternidad, neonatal, oncologia, farmacia, laboratorio, logistica, investigacion y command center.
- Preset Hospital Clinic: primera vision del Nou Campus Clinic-UB con asistencia, docencia, investigacion, infraestructuras, campus, sotanos tecnicos/logisticos, urgencias, quirofanos, UCI, institutos clinicos, consultas, hospital de dia y reservas de crecimiento.
- Identidad visual Clinic: paleta azul/verde/rojo/amarillo/cian aplicada a shell, controles, planificador, simulacion y estados de saturacion.
- Elementos de seguridad arquitectonica: ascensores, escaleras, montacargas, escaleras protegidas/emergencia, refugios de evacuacion horizontal, sectorizacion PCI, central MEP critica y reserva de expansion.
- Circulacion editable: pasillos publicos, pasillos clinicos para camas y pasillos logisticos limpio/sucio se anaden desde el selector `Elemento`, igual que cualquier otro bloque. En la UI, `Asc/Mont` significa ascensores publicos, ascensores clinicos y montacargas; las escaleras son componentes independientes.
- Dimensiones editables en metros: cada bloque tiene ancho y alto, y los m2 se recalculan automaticamente con una escala de 3 m por unidad de plano.
- Movimiento restringido por puertas y pasillos: los pacientes solo pueden salir de una sala por una puerta colocada en su perimetro que toque un pasillo conectado a la red de circulacion; si no existe esa ruta, quedan bloqueados y aparecen como `Sin puerta`.
- Animacion por pasillos: el replay de pacientes y personal interpola por puertas, ejes de pasillo e intersecciones de circulacion, evitando diagonales directas entre salas.
- Puertas con efecto iman: al crear o mover una puerta, Vision la deja libre hasta que entra cerca de un pasillo; entonces se pega al bloque de pasillo y genera/actualiza un umbral transitable.
- Conectores verticales por familia: ascensores/montacargas y escaleras tienen una familia de conector y selector visual de `plantas conectadas`, de modo que un tramo 0-1 debe existir y alinearse en las plantas que declara servir.
- Planificador sin escaleras duplicadas: Vision representa las escaleras como bloques arquitectonicos independientes, no como iconos de equipamiento dentro de otros componentes.
- Reglas de continuidad de pasillos: la app avisa si un pasillo queda fuera de la red principal de circulacion.
- Ayuda de conexion: las puertas rojas no tocan ningun pasillo; los pasillos con borde rojo estan aislados de la red principal. El editor puede proponer un conector de pasillo hacia la sala seleccionada o hacia toda la planta.
- Evaluador inicial de reglas para presencia de servicios, proximidades criticas, separacion de flujos, evacuacion y resiliencia.
- Backend FastAPI desacoplado con contratos Pydantic, repositorio en memoria, versionado de planes, evaluacion de reglas y ejecucion del motor DES.

## Documentacion

La documentacion tecnica vive en [docs/](docs/):

- [Arquitectura de producto](docs/ARCHITECTURE.md)
- [Backend propuesto](docs/BACKEND.md)
- [Despliegue](docs/DEPLOYMENT.md)
- [Modelo funcional Hospital Clinic](docs/HOSPITAL_CLINIC_MODEL.md)
- [Paleta visual Clinic Barcelona](docs/BRAND_COLORS.md)
- [Requisitos arquitectonicos y seguridad](docs/SAFETY_REQUIREMENTS.md)

## Backend

El producto principal sigue siendo frontend-first en experiencia visual, pero ya existe una primera API desacoplada:

- React para diseno, visualizacion y replay.
- `hospital_sim.backend.contracts` para contratos API estables.
- `hospital_sim.backend.adapters` para traducir planes React al motor Python.
- `hospital_sim.backend.services` para orquestar proyectos, versiones y ejecuciones.
- `hospital_sim.backend.api` para transporte HTTP FastAPI.
- `hospital_sim.engine` como motor DES/agentes independiente del transporte.

La propuesta completa esta en [docs/BACKEND.md](docs/BACKEND.md): lo implementado ahora usa FastAPI y memoria; la fase productiva debe sustituir memoria por PostgreSQL y mover simulaciones largas a cola de jobs.

## Seguridad arquitectonica

La app ya contempla de forma inicial:

- Ascensores clinicos/camas por planta activa.
- Ascensores/montacargas para flujos mecanicos entre plantas.
- Familias verticales con posicion consistente entre plantas servidas.
- Escaleras protegidas y de emergencia.
- Dos rutas verticales en plantas asistenciales.
- Refugios para evacuacion horizontal.
- Sectorizacion PCI y control de humo.
- Bahia cubierta de ambulancias separada del acceso publico.
- Separacion publico/logistica/residuos.
- Reserva de expansion o shell space.

Esto no es aun una certificacion normativa. Las distancias exactas, anchuras, ocupacion, presurizacion, independencia real de rutas, sectorizacion detallada y cumplimiento CTE/normativa sanitaria deben entrar en un motor de reglas mas avanzado. Ver [docs/SAFETY_REQUIREMENTS.md](docs/SAFETY_REQUIREMENTS.md).

## Estructura

```text
frontend/
  src/data/        Catalogo de estancias, equipamiento y presets hospitalarios
  src/engine/      Geometria, simulacion ligera y reglas arquitectonicas
  src/components/  Canvas editable y escena Phaser de simulacion
  src/components/ui/ Primitivas compartidas como metricas y modales
  src/features/    Funcionalidades de producto separadas, como ranking/top y saturacion
hospital_sim/      Prototipo Python/SimPy inicial, mantenido como referencia
docs/              Arquitectura, backend y requisitos
tests/             Pruebas de regresion del prototipo Python
```

## Supuestos

El modelo actual es una primera base calibrable, no una representacion validada de un hospital concreto. Las distribuciones de llegada, tiempos de servicio, probabilidades clinicas y reglas de seguridad son sinteticas o conceptuales. Para uso real habria que calibrar con ADT/EHR, programacion quirurgica, censos de camas, imagen/lab, altas, reglas locales y criterio experto.

## Siguiente fase recomendada

1. Conectar el frontend React/Phaser a la API para cargar/guardar proyectos y lanzar simulaciones oficiales.
2. Sustituir el repositorio en memoria por PostgreSQL y migraciones.
3. Mover simulaciones largas a jobs asincronos con Redis/RQ o Celery.
4. Convertir el catalogo en datos editables y versionados desde backend.
5. Anadir reglas normativas parametrizables por jurisdiccion.
6. Implementar imports BIM/IFC o CSV para planos reales.
7. Introducir agentes de pacientes, medicos, enfermeria, celadores y tecnicos con perfiles configurables.
