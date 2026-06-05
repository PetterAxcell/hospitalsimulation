# Documentacion del simulador hospitalario

Esta carpeta define la vision tecnica del producto. La aplicacion actual ya tiene una primera base React para disenar plantas y ver simulacion 2D; estos documentos separan lo que ya esta implementado de lo que debe convertirse en backend, motor normativo y simulacion multiagente.

## Documentos

- [Arquitectura de producto](ARCHITECTURE.md): responsabilidades entre frontend, backend, motor de simulacion, reglas y datos.
- [Backend](BACKEND.md): propuesta de API, jobs asincronos, persistencia, seguridad y entidades principales.
- [Paleta visual Clinic Barcelona](BRAND_COLORS.md): tokens de color, equivalencias RGB/hex y criterio de uso en la interfaz y simulacion.
- [Despliegue](DEPLOYMENT.md): publicacion del frontend en Cloudflare Pages siguiendo el patron de `ontour`.
- [Modelo funcional Hospital Clinic](HOSPITAL_CLINIC_MODEL.md): fuentes, supuestos, clusters y programa preliminar para la rama centrada en Nou Campus de Salut Clinic-UB.
- [Lenguaje de planificacion](PLANNING_LANGUAGE.md): comandos iniciales para generar planes desde scripts.
- [Requisitos arquitectonicos y seguridad](SAFETY_REQUIREMENTS.md): checklist para un hospital terciario nuevo de 290.000 m2, con estado actual de cobertura en la app.

## Estado actual

La app principal vive en `frontend/` y ejecuta simulacion visual en cliente con React + Phaser 3. Vision permite mover y redimensionar bloques, calcular m2 desde la geometria, colocar puertas y marcar en rojo puertas o pasillos que no conectan con la red de circulacion. La rama `feature/hospital-clinic-model` arranca con un preset source-backed del Nou Campus Clinic-UB de 300.000 m2 para discutir programa funcional y simulacion antes de plantear generacion automatica. El shell de marca esta separado en `frontend/src/components/AppHeader.tsx` y `frontend/src/components/WorkspaceTabs.tsx`; el inspector de estancias vive en `frontend/src/features/planning/RoomInspector.tsx`; el ranking inicial se ha separado en `frontend/src/features/top/`, la lectura de saturacion en `frontend/src/features/saturation/`, el selector operativo de casos/personal y el panel compacto de parametros/KPIs en `frontend/src/features/simulation/`, y los controles de replay en `frontend/src/components/SimulationControlsBar.tsx`. Estas vistas usan UI compacta con modales o paneles escaneables para que las paginas no queden cargadas de explicaciones. Simulacion usa un layout viewport-fit con paneles laterales mas estrechos, fondo extendido y encuadre 2D tipo cover para que el mapa ocupe todo el canvas sin bandas oscuras. El motor de preview empieza a dividir responsabilidades: `simulation.ts` orquesta recorridos y KPIs, `clinicalCases.ts` contiene la libreria YAML de casos y `staffSimulation.ts` contiene la simulacion de turnos de personal. El backend experimental vive en `hospital_sim/backend/` y expone FastAPI para catalogo, proyectos, versiones de planes, reglas y simulaciones. Sirve para iterar rapido sobre la experiencia de diseno y sobre las fronteras del sistema.

Para usarlo como herramienta real de proyecto hospitalario hacen falta tres piezas adicionales:

1. Backend persistente con PostgreSQL para usuarios, proyectos, versiones, permisos e historico de cambios.
2. Workers asincronos para simulaciones largas y trazas reproducibles.
3. Motor de reglas versionado para normativa, criterios de arquitectura hospitalaria y validaciones calibrables por pais/comunidad autonoma.

## Fuentes normativas base

Las reglas de seguridad no deben tratarse como criterio legal definitivo. La validacion final corresponde a arquitectos, ingenierias, proteccion contra incendios, accesibilidad y autoridad sanitaria competente. Como base espanola se han dejado referenciados:

- [CTE - Presentacion](https://www.codigotecnico.org/QueEsCTE/Presentacion.html)
- [CTE DB-SI Seguridad en caso de incendio](https://www.codigotecnico.org/DocumentosCTE/SeguridadEnCasoDeIncendio.html)
- [CTE DB-SUA Seguridad de utilizacion y accesibilidad](https://www.codigotecnico.org/DocumentosCTE/SeguridadUtilizacionAccesibilidad.html)
- [CTE DB-HS Salubridad](https://www.codigotecnico.org/DocumentosCTE/Salubridad.html)
