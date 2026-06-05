# Paleta visual Clinic Barcelona

La interfaz de esta rama usa la paleta facilitada desde Marca Clinic Barcelona como base del sistema visual. El objetivo es que la herramienta se perciba como una pieza de trabajo del contexto Clinic, sin convertir la simulacion en una pagina corporativa pesada.

## Colores principales

| Uso | RGB | Hex | Token |
|---|---:|---|---|
| Azul institucional | 55, 81, 113 | `#375171` | `--clinic-blue` |
| Verde acento | 133, 222, 118 | `#85de76` | `--clinic-green` |
| Rojo critico | 241, 142, 127 | `#f18e7f` | `--clinic-red` |
| Amarillo alerta | 251, 195, 68 | `#fbc344` | `--clinic-yellow` |
| Azul/cian informativo | 74, 204, 211 | `#4accd3` | `--clinic-cyan` |

## Colores secundarios

| Uso | RGB | Hex | Token |
|---|---:|---|---|
| Azul secundario 1 | 56, 107, 166 | `#386ba6` | `--clinic-blue-1` |
| Azul secundario 2 | 71, 48, 196 | `#4730c4` | `--clinic-blue-2` |
| Azul secundario 3 | 143, 184, 222 | `#8fb8de` | `--clinic-blue-3` |
| Verde secundario 1 | 51, 181, 120 | `#33b578` | `--clinic-green-1` |
| Verde secundario 2 | 184, 235, 173 | `#b8ebad` | `--clinic-green-2` |
| Rojo secundario 1 | 237, 115, 105 | `#ed7369` | `--clinic-red-1` |
| Rojo secundario 2 | 245, 189, 176 | `#f5bdb0` | `--clinic-red-2` |
| Amarillo secundario 1 | 245, 171, 56 | `#f5ab38` | `--clinic-yellow-1` |
| Amarillo secundario 2 | 250, 214, 125 | `#fad67d` | `--clinic-yellow-2` |
| Cian secundario 1 | 1, 183, 193 | `#01b7c1` | `--clinic-cyan-1` |
| Cian secundario 2 | 124, 218, 223 | `#7cdadf` | `--clinic-cyan-2` |

## Criterio de aplicacion

- Azul Clinic: identidad, encabezados, texto principal, navegacion activa y elementos estructurales.
- Verde: acciones positivas, estados activos y capacidad disponible.
- Cian: informacion, simulacion, conexiones y metricas exploratorias.
- Amarillo: avisos, congestiones moderadas y puntos que requieren observacion.
- Rojo: criticidad, bloqueo, errores de arquitectura y saturacion severa.

La aplicacion visual actual mantiene una superficie blanca de trabajo, pero la marca queda presente durante todo el flujo. La cabecera y navegacion usan azul Clinic; las acciones primarias, estados activos, metricas principales y primeras propuestas usan verde; los controles de simulacion, conexiones e informacion usan cian; y los paneles laterales incorporan lavados suaves azul/verde para que el producto se perciba corporativo sin perder densidad operativa.

La regla practica es evitar bloques grandes de color sobre el lienzo de trabajo. El blanco sigue siendo la base para disenar y leer planos, mientras que azul y verde se aplican en estructura, jerarquia, foco y estados. Esto ayuda a que la pagina se sienta Clinic incluso cuando el usuario esta dentro de Vision, Simulacion, Saturacion o Top.

El asset de cabecera debe usar el logotipo generico Clinic Barcelona, sin area, partner ni descriptor secundario. El SVG vive en `frontend/src/assets/clinic-barcelona-logo.svg` con `viewBox` recortado para que el logotipo se lea correctamente en una cabecera compacta.

Los tokens viven en `frontend/src/index.css`. Los mapas de color que no pueden leer CSS variables, como canvas y Phaser, usan los mismos valores en hexadecimal dentro de `frontend/src/data/catalog.ts`, `frontend/src/components/HospitalCanvas.tsx`, `frontend/src/components/SimulationCanvas.tsx` y `frontend/src/engine/simulation.ts`.
