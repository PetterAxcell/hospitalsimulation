# Frontend hospital planner

Aplicacion React/TypeScript para disenar y simular un hospital terciario multi-planta.

## Stack

- React para paneles, formularios, KPIs y estado de producto.
- Phaser 3 para la vista de simulacion top-down tipo RPG/pixel-art.
- Ranking `Top` como primera vista para comparar propuestas de arquitectura por autor usando KPIs de simulacion.
- Vite para desarrollo y build.

La simulacion se carga con `React.lazy`, de forma que Phaser solo entra en el bundle cuando se abre la pestana `Simulacion`.

## Uso

```bash
npm install
npm run dev
```

Validacion:

```bash
npm run lint
npm run build
```

Deploy Cloudflare Pages:

```bash
npm run deploy
```

El proyecto Pages esperado es `simlab`; el dominio custom es opcional.

## Estructura

```text
src/components/HospitalCanvas.tsx     Editor de Vision en canvas 2D con bloques, puertas, pasillos y conectores verticales
src/components/SimulationCanvas.tsx   Escena Phaser top-down
src/data/catalog.ts                   Catalogo de servicios y equipamiento
src/data/presets.ts                   Preset hospital terciario 290.000 m2
src/engine/simulation.ts              Simulacion ligera de agentes y rutas
src/engine/architectureRules.ts       Reglas arquitectonicas iniciales
```

Los pasillos se crean desde el selector `Elemento`; los accesos rapidos de pasillos se eliminaron para mantener una unica ruta de creacion de bloques.

Los paneles laterales son contextuales: planificacion y simulacion conservan sus controles, mientras que `Top`, `Servicios` y `Analisis` usan el espacio central sin panel izquierdo.

Durante el arrastre o redimensionado de bloques en el planificador, el canvas usa una previsualizacion local y solo confirma el cambio en el `plan` al soltar. Esto evita recalcular reglas, simulacion y ranking en cada movimiento del puntero.
