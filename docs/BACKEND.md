# Backend propuesto

## Por que hace falta

La version React actual permite explorar el producto con rapidez, pero un hospital real necesita trazabilidad, permisos, versiones y simulaciones reproducibles. El backend debe convertirse en la fuente de verdad para proyectos, planos, reglas y ejecuciones.

Sin backend, la app puede servir como maqueta avanzada. Con backend, puede convertirse en herramienta de diseno, comparacion de escenarios y soporte a decision.

## Stack recomendado

| Pieza | Recomendacion | Motivo |
|---|---|---|
| API | FastAPI / Python | Encaja con SimPy, optimizacion, pandas y futuros modelos DES/agentes |
| Base de datos | PostgreSQL | Versionado de proyectos, layouts, reglas y resultados |
| Jobs | Redis + RQ o Celery | Simulaciones asincronas, cancelacion y progreso |
| Artefactos | Object storage local/S3 compatible | Trazas, exports, snapshots, informes y replay |
| Auth | OIDC compatible | Integracion empresarial futura |
| Observabilidad | OpenTelemetry + logs estructurados | Auditoria y depuracion de simulaciones largas |

Si en el futuro el frontend necesita una capa BFF Node por experiencia de producto, se puede anadir, pero no deberia duplicar logica clinica ni simulacion.

## Estado de esta rama

La rama `backend-decoupled-system` abre la migracion con una API FastAPI y una capa de servicios en memoria. No sustituye aun a PostgreSQL ni a una cola real, pero fija las fronteras necesarias:

| Capa | Modulo | Responsabilidad |
|---|---|---|
| Contratos | `hospital_sim.backend.contracts` | DTOs Pydantic con aliases camelCase para React |
| Adaptadores | `hospital_sim.backend.adapters` | Traduccion de planes/rooms a `HospitalConfig` y `ResourceLocation` |
| Repositorio | `hospital_sim.backend.repository` | Persistencia en memoria reemplazable por PostgreSQL |
| Servicios | `hospital_sim.backend.services` | Versionado de planes, reglas y ejecucion de simulaciones |
| HTTP | `hospital_sim.backend.api` | Endpoints FastAPI y CORS para el frontend local |
| Motor | `hospital_sim.engine` | Simulacion DES sin depender de HTTP ni de Streamlit |

Arranque local:

```bash
uvicorn hospital_sim.backend.api:app --reload
```

Endpoints iniciales implementados:

```text
GET    /api/health
GET    /api/catalog
GET    /api/projects
POST   /api/projects
GET    /api/projects/{project_id}/plans/latest
POST   /api/projects/{project_id}/plans
GET    /api/plans/{plan_id}
POST   /api/plans/{plan_id}/rules/evaluate
POST   /api/plans/{plan_id}/simulations
GET    /api/simulations/{run_id}
```

Limitaciones conscientes de esta fase:

- El repositorio es en memoria.
- Las simulaciones se ejecutan de forma sincrona aunque el contrato ya devuelve un `runId`.
- Las reglas iniciales usan cobertura de nodos y metricas de arquitectura existentes.
- La autenticacion y permisos estan descritos, pero aun no implementados.

## Entidades principales

| Entidad | Campos clave | Comentario |
|---|---|---|
| Organization | nombre, jurisdiccion, reglas activas | Permite hospitales de distintas comunidades/paises |
| User | identidad, rol, permisos | Separar arquitecto, operaciones, clinico, admin |
| Project | nombre, siteArea, targetArea, estado | Un hospital o campus |
| HospitalPlan | projectId, version, floors, rooms, metadata | Fuente de verdad del layout |
| Room | floor, x, y, w, h, kind, capacity, equipment | Compatible con canvas y simulacion |
| RuleSet | version, jurisdiccion, checks activos | Normativa y reglas propias del hospital |
| RuleEvaluation | planVersion, resultados, evidencias | Historico auditable |
| SimulationScenario | parametros, demanda, politicas | Lo que se quiere probar |
| SimulationRun | estado, seed, motorVersion, resultados | Ejecucion reproducible |
| AgentProfile | paciente, medico, enfermeria, celador | Entrada futura para simulacion de personas |
| DatasetImport | fuente, esquema, calidad, mapping | ADT/EHR/BIM/CSV cuando haya datos reales |

## API implementada ahora

```text
GET    /api/catalog
GET    /api/projects
POST   /api/projects
GET    /api/projects/{project_id}/plans/latest
POST   /api/projects/{project_id}/plans
GET    /api/plans/{plan_id}
POST   /api/plans/{plan_id}/rules/evaluate
POST   /api/plans/{plan_id}/simulations
GET    /api/simulations/{run_id}
```

## Ciclo de simulacion

En la implementacion actual, `POST /api/plans/{plan_id}/simulations` ejecuta el motor de forma sincrona y guarda el resultado como `completed` en el repositorio en memoria. Esto permite estabilizar contrato, adaptadores y tests antes de introducir workers.

El ciclo objetivo para produccion es:

1. El frontend envia `planVersion`, `scenario`, `seed` y `ruleSetVersion`.
2. El backend valida permisos y congela la entrada.
3. Se crea `SimulationRun` en estado `queued`.
4. Un worker ejecuta el motor DES/agentes.
5. El worker escribe KPIs, trazas y resumen de cuellos de botella.
6. El frontend consulta progreso y reproduce la traza como simulacion 2D.

Endpoints planificados para esa fase:

```text
POST   /api/simulations/{run_id}/cancel
GET    /api/simulations/{run_id}/trace
```

## Seguridad de datos

En fase de diseno no deberia entrar PHI. Si mas adelante se calibran modelos con ADT/EHR, se debe separar:

- Datos identificables en entorno restringido.
- Dataset analitico pseudonimizado para calibracion.
- Parametros agregados para simulacion.
- Auditoria de accesos, exports y ejecuciones.

## Permisos minimos

| Rol | Puede hacer |
|---|---|
| Admin | Gestionar organizacion, usuarios, reglas y proyectos |
| Arquitectura | Editar layouts, versionar planes, lanzar reglas |
| Operaciones | Crear escenarios, lanzar simulaciones, comparar resultados |
| Clinico | Revisar flujos, capacidades y reglas asistenciales |
| Lectura | Ver planes y resultados aprobados |

## Separacion con el frontend actual

El frontend puede seguir teniendo un motor ligero para feedback inmediato, pero el resultado oficial debe venir del backend. Asi se evita que dos usuarios vean calculos distintos, se garantiza versionado y se pueden correr simulaciones mas pesadas que no caben en el navegador.
