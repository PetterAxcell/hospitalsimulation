# Documentacion del simulador hospitalario

Esta carpeta define la vision tecnica del producto. La aplicacion actual ya tiene una primera base React para disenar plantas y ver simulacion 2D; estos documentos separan lo que ya esta implementado de lo que debe convertirse en backend, motor normativo y simulacion multiagente.

## Documentos

- [Arquitectura de producto](ARCHITECTURE.md): responsabilidades entre frontend, backend, motor de simulacion, reglas y datos.
- [Backend](BACKEND.md): propuesta de API, jobs asincronos, persistencia, seguridad y entidades principales.
- [Despliegue](DEPLOYMENT.md): publicacion del frontend en Cloudflare Pages siguiendo el patron de `ontour`.
- [Lenguaje de planificacion](PLANNING_LANGUAGE.md): comandos iniciales para generar planes desde scripts.
- [Requisitos arquitectonicos y seguridad](SAFETY_REQUIREMENTS.md): checklist para un hospital terciario nuevo de 290.000 m2, con estado actual de cobertura en la app.

## Estado actual

La app principal vive en `frontend/` y ejecuta simulacion visual en cliente con React + Phaser 3. Vision permite mover y redimensionar bloques, calcular m2 desde la geometria, colocar puertas y marcar en rojo puertas o pasillos que no conectan con la red de circulacion. El backend experimental vive en `hospital_sim/backend/` y expone FastAPI para catalogo, proyectos, versiones de planes, reglas y simulaciones. Sirve para iterar rapido sobre la experiencia de diseno y sobre las fronteras del sistema.

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
