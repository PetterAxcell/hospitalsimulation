# Simulador hospitalario integral

Herramienta abierta para disenar, simular y comparar arquitecturas de hospitales terciarios. La aplicacion principal esta migrada a React/TypeScript para poder construir una experiencia visual tipo videojuego 2D: plantas, habitaciones, equipamiento, accesos, ambulancias, halls, esperas, ascensores, escaleras, refugios y flujos de pacientes.

La vision es crear una herramienta para redisenar hospitales complejos como Vall d'Hebron o Hospital Clinic, empezando por un programa de 290.000 m2 y evolucionando hacia simulacion de pacientes, medicos, enfermeria, celadores, tecnicos y recursos.

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

## Estado actual

- Frontend React con editor multi-planta.
- Canvas de Vision para colocar y mover servicios.
- Canvas de Simulacion 2D tipo videojuego con agentes, presion por estancia y capas de RPG, flujos y reglas.
- Catalogo de hospital terciario: urgencias, diagnostico, quirofanos, PACU, UCI, wards, maternidad, neonatal, oncologia, farmacia, laboratorio, logistica, investigacion y command center.
- Elementos de seguridad arquitectonica: nucleos verticales, ascensores clinicos, escaleras protegidas/emergencia, refugios de evacuacion horizontal, sectorizacion PCI, central MEP critica y reserva de expansion.
- Evaluador inicial de reglas para presencia de servicios, proximidades criticas, separacion de flujos, evacuacion y resiliencia.

## Documentacion

La documentacion tecnica vive en [docs/](/Users/petteraxcell/Documents/Projects/Simulation/docs):

- [Arquitectura de producto](/Users/petteraxcell/Documents/Projects/Simulation/docs/ARCHITECTURE.md)
- [Backend propuesto](/Users/petteraxcell/Documents/Projects/Simulation/docs/BACKEND.md)
- [Requisitos arquitectonicos y seguridad](/Users/petteraxcell/Documents/Projects/Simulation/docs/SAFETY_REQUIREMENTS.md)

## Backend

Ahora mismo el producto principal es frontend-first: permite iterar rapido sobre la experiencia visual y la logica de reglas. Para convertirlo en herramienta real de proyecto hospitalario hace falta separar responsabilidades:

- React para diseno, visualizacion y replay.
- Backend API para usuarios, permisos, proyectos, versiones, catalogos y escenarios.
- Motor DES/agentes para simulaciones reproducibles y pesadas.
- Motor de reglas para normativa, evidencias y jurisdicciones.
- Base de datos para historico, auditoria, trazas y comparacion de alternativas.

La propuesta recomendada esta en [docs/BACKEND.md](/Users/petteraxcell/Documents/Projects/Simulation/docs/BACKEND.md): FastAPI, PostgreSQL, cola de jobs y motor Python separado para simulacion.

## Seguridad arquitectonica

La app ya contempla de forma inicial:

- Ascensores clinicos/camas por planta activa.
- Nucleos verticales.
- Escaleras protegidas y de emergencia.
- Dos rutas verticales en plantas asistenciales.
- Refugios para evacuacion horizontal.
- Sectorizacion PCI y control de humo.
- Bahia cubierta de ambulancias separada del acceso publico.
- Separacion publico/logistica/residuos.
- Reserva de expansion o shell space.

Esto no es aun una certificacion normativa. Las distancias exactas, anchuras, ocupacion, presurizacion, independencia real de rutas, sectorizacion detallada y cumplimiento CTE/normativa sanitaria deben entrar en un motor de reglas mas avanzado. Ver [docs/SAFETY_REQUIREMENTS.md](/Users/petteraxcell/Documents/Projects/Simulation/docs/SAFETY_REQUIREMENTS.md).

## Estructura

```text
frontend/
  src/data/        Catalogo de estancias, equipamiento y preset terciario
  src/engine/      Geometria, simulacion visual y reglas arquitectonicas
  src/components/  Canvas editable y canvas de simulacion
hospital_sim/      Prototipo Python/SimPy inicial, mantenido como referencia
docs/              Arquitectura, backend y requisitos
tests/             Pruebas de regresion del prototipo Python
```

## Supuestos

El modelo actual es una primera base calibrable, no una representacion validada de un hospital concreto. Las distribuciones de llegada, tiempos de servicio, probabilidades clinicas y reglas de seguridad son sinteticas o conceptuales. Para uso real habria que calibrar con ADT/EHR, programacion quirurgica, censos de camas, imagen/lab, altas, reglas locales y criterio experto.

## Siguiente fase recomendada

1. Crear backend API y persistencia de proyectos/versiones.
2. Convertir el catalogo en datos editables y versionados.
3. Separar motor DES/agentes del frontend.
4. Anadir reglas normativas parametrizables por jurisdiccion.
5. Implementar imports BIM/IFC o CSV para planos reales.
6. Introducir agentes de pacientes, medicos, enfermeria, celadores y tecnicos con perfiles configurables.
