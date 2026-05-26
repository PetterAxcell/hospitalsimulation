# Documentacion del simulador hospitalario

Esta carpeta define la vision tecnica del producto. La aplicacion actual ya tiene una primera base React para disenar plantas y ver simulacion 2D; estos documentos separan lo que ya esta implementado de lo que debe convertirse en backend, motor normativo y simulacion multiagente.

## Documentos

- [Arquitectura de producto](ARCHITECTURE.md): responsabilidades entre frontend, backend, motor de simulacion, reglas y datos.
- [Backend](BACKEND.md): propuesta de API, jobs asincronos, persistencia, seguridad y entidades principales.
- [Requisitos arquitectonicos y seguridad](SAFETY_REQUIREMENTS.md): checklist para un hospital terciario nuevo de 290.000 m2, con estado actual de cobertura en la app.

## Estado actual

La app principal vive en `frontend/` y ejecuta simulacion visual en cliente. Sirve para iterar rapido sobre la experiencia de diseno y sobre las reglas de arquitectura. Para usarla como herramienta real de proyecto hospitalario hacen falta dos piezas adicionales:

1. Backend persistente para usuarios, proyectos, versiones, permisos, historico de cambios y ejecucion de escenarios.
2. Motor de reglas versionado para normativa, criterios de arquitectura hospitalaria y validaciones calibrables por pais/comunidad autonoma.

## Fuentes normativas base

Las reglas de seguridad no deben tratarse como criterio legal definitivo. La validacion final corresponde a arquitectos, ingenierias, proteccion contra incendios, accesibilidad y autoridad sanitaria competente. Como base espanola se han dejado referenciados:

- [CTE - Presentacion](https://www.codigotecnico.org/QueEsCTE/Presentacion.html)
- [CTE DB-SI Seguridad en caso de incendio](https://www.codigotecnico.org/DocumentosCTE/SeguridadEnCasoDeIncendio.html)
- [CTE DB-SUA Seguridad de utilizacion y accesibilidad](https://www.codigotecnico.org/DocumentosCTE/SeguridadUtilizacionAccesibilidad.html)
- [CTE DB-HS Salubridad](https://www.codigotecnico.org/DocumentosCTE/Salubridad.html)
