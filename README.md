# Simulador hospitalario integral

Herramienta abierta para diseñar, simular y comparar arquitecturas de hospitales terciarios. La aplicación principal está migrada a React/TypeScript para construir una experiencia visual tipo videojuego 2D: plantas, habitaciones, equipamiento, accesos, ambulancias, halls, esperas, ascensores, escaleras, refugios y flujos de pacientes.

La visión es crear una herramienta para rediseñar hospitales complejos como Vall d'Hebron o Hospital Clínic, empezando por un programa de 290.000 m² y evolucionando hacia simulación de pacientes, médicos, enfermería, celadores, técnicos y recursos.

---

## Uso rápido

```bash
cd frontend
npm install
npm run dev
```

La app se levanta en `http://localhost:5173/`.

Para validar:

```bash
cd frontend
npm run lint
npm run build
```

---

## Estado actual

### Frontend React — Editor y simulador visual

- **Editor multi-planta** con canvas interactivo para colocar y mover servicios.
- **Canvas de simulación 2D** tipo videojuego con agentes, presión por estancia, capas RPG/flujos/reglas/perturbadores.
- **Catálogo de hospital terciario**: urgencias, diagnóstico, quirófanos, PACU, UCI, wards, maternidad, neonatal, oncología, farmacia, laboratorio, logística, investigación y command center.
- **Elementos de seguridad arquitectónica**: núcleos verticales, ascensores clínicos, escaleras protegidas/emergencia, refugios de evacuación horizontal, sectorización PCI, central MEP crítica y reserva de expansión.
- **Evaluador de reglas**: presencia de servicios, proximidades críticas, separación de flujos, evacuación, resiliencia, cobertura de especialistas, densidad de canales y tiempos de respuesta.

### Sistema de agentes

| Tipo | Descripción |
|---|---|
| **Pacientes ambulatorios** | 7 flujos: ED ambulancia, ED a pie, consultas externas, cirugía programada, maternidad, oncología, salud mental |
| **Pacientes ingresados (inpatients)** | Ocupación de camas 70-95% en wards, con estancia de 6-18h |
| **Visitantes** | Familiares que visitan a pacientes ingresados (1-3 visitas por paciente) |
| **Especialistas** | 20 tipos (cardiología, neurología, traumatología, etc.) con proporción configurable, clasificados en quirúrgicos/médicos. Hacen rondas visitando pacientes. |
| **Enfermeras** | 40% del staff, asignadas a salas |
| **Técnicos** | 30% del staff, asignados a laboratorio/imagen |
| **Seguridad** | 5% del staff, patrulla zonas críticas (hall, urgencias, farmacia) |
| **Emergency team** | 5% del staff (1/200), responde a eventos críticos |

### Sistema de canales

- **Canales horizontales** (pasillos): 24 conexiones entre salas con capacidad y pendiente de congestión configurables.
- **Canales verticales** (ascensores/escaleras): conectan núcleos verticales entre plantas adyacentes.
- **Pathfinding A\*** con costos estáticos — los agentes NO conocen la congestión futura.
- **Reruteo dinámico**: al encontrar un canal con >80% de ocupación, el agente recalcula la ruta.
- **Congestión emergente**: penalización cuadrática `baseTime × (1 + slope × occupancy²)`.
- **Visualización**: canales en verde (<50%), naranja (50-80%), rojo (>80%).

### Sistema de perturbadores

15 plantillas predefinidas + sistema extensible para crear nuevas sin código:

| Tipo | Severidad | Requiere |
|---|---|---|
| Paciente suicida | high | Seguridad + Psiquiatra |
| Robo en farmacia/lab | medium | Seguridad |
| Amenaza terrorista | critical | Seguridad + Emergency team |
| Parada cardíaca súbita | critical | Emergency team + Cardiólogo |
| Familiar agresivo | medium | Seguridad |
| Incendio localizado | critical | Emergency team |
| Derrame biológico | high | Emergency team + Infectólogo |
| Corte eléctrico | medium | Emergency team |
| Ascensor atrapa paciente | low | Emergency team |
| Hemorragia masiva | critical | Emergency team + Cirujano |
| Shock anafiláctico | high | Emergency team + Urgenciólogo |
| Intento de fuga | medium | Seguridad |
| Fuga de gas medicinal | high | Emergency team |
| Ataque informático | medium | Emergency team |
| Emergencia obstétrica | critical | Emergency team + Obstetria |

Cada perturbador tiene: `responseTime` (viaje del staff) + `resolutionTime` (resolución). Si se excede `escalationTime`, el evento escala y puede propagarse a salas vecinas.

### KPIs y métricas

- **Generales**: pacientes completados, ED P90, tiempo de traslado medio, movimientos verticales
- **Staff**: total por rol, desglose por tipo de especialista
- **Perturbadores**: total, resueltos, escalados, tiempo medio de respuesta, tiempo medio de resolución, tasa de escalado, propagaciones, salas bloqueadas, pacientes afectados
- **Canales**: hotspots de congestión (>80% de ocupación)
- **Arquitectura**: cobertura de especialistas, densidad de canales, tiempos de respuesta ED→UCI, ED→quirófano, ambulancia→shock room

---

## Documentación

La documentación técnica vive en [docs/](docs/):

- [Arquitectura de producto](docs/ARCHITECTURE.md)
- [Backend propuesto](docs/BACKEND.md)
- [Requisitos arquitectónicos y seguridad](docs/SAFETY_REQUIREMENTS.md)

---

## Backend Python (SimPy)

Prototipo de simulación de eventos discretos (DES) mantenido como referencia:

- `hospital_sim/config.py` — Configuración con dataclasses para capacidad, recursos, especialistas, canales, perturbadores
- `hospital_sim/engine.py` — Motor DES con colas, prioridades, tiempos de viaje horizontal/vertical
- `hospital_sim/architecture.py` — Métricas de arquitectura y asignación de recursos a plantas
- `hospital_sim/game_view.py` — Mapeo de resultados a vista tipo juego
- `hospital_sim/master_plan.py` — Programa arquitectónico de referencia
- `hospital_sim/scenarios.py` — Biblioteca de escenarios y optimización de capacidad

---

## Estructura del proyecto

```text
frontend/
  src/
    types.ts           Tipos compartidos (agentes, recursos, canales, perturbadores)
    data/
      catalog.ts       Catálogo de estancias, configuraciones por defecto
      presets.ts       Plan predefinido de hospital terciario
    engine/
      geometry.ts      Geometría, ChannelGraph, pathfinding A*, renderizado de canales
      simulation.ts    Motor de simulación visual (staff, rutas, canales, perturbadores)
      architectureRules.ts  Reglas arquitectónicas y de seguridad
    components/
      HospitalCanvas.tsx    Canvas interactivo para editar plantas
      SimulationCanvas.tsx  Canvas de simulación 2D con agentes y eventos
    App.tsx            Orquestador principal con paneles de configuración
hospital_sim/          Prototipo Python/SimPy de referencia
docs/                  Arquitectura, backend y requisitos
tests/                 Pruebas de regresión del prototipo Python
```

---

## Supuestos

El modelo actual es una primera base calibrable, no una representación validada de un hospital concreto. Las distribuciones de llegada, tiempos de servicio, probabilidades clínicas y reglas de seguridad son sintéticas o conceptuales. Para uso real habría que calibrar con ADT/EHR, programación quirúrgica, censos de camas, imagen/lab, altas, reglas locales y criterio experto.

---

## Siguiente fase recomendada

1. Crear backend API y persistencia de proyectos/versiones (FastAPI + PostgreSQL).
2. Convertir el catálogo en datos editables y versionados.
3. Separar motor DES/agentes del frontend.
4. Añadir reglas normativas parametrizables por jurisdicción (CTE, NFPA, etc.).
5. Implementar imports BIM/IFC o CSV para planos reales.
6. Introducir agentes de pacientes, médicos, enfermería, celadores y técnicos con perfiles configurables.
7. Calibrar tiempos de servicio y probabilidades con datos reales de ADT/EHR.
8. Implementar simulación de catástrofes y múltiples víctimas.
