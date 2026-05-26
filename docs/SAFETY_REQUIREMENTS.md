# Requisitos arquitectonicos y seguridad

## Aviso de alcance

Este documento no sustituye a un proyecto de arquitectura, ingenieria, PCI, accesibilidad o autorizacion sanitaria. Sirve para convertir los requisitos en checklist de producto y en reglas de simulacion. La validacion final debe hacerse con equipos competentes y normativa vigente.

Fuentes base consultadas el 26 de mayo de 2026:

- [CTE - Presentacion](https://www.codigotecnico.org/QueEsCTE/Presentacion.html)
- [CTE DB-SI Seguridad en caso de incendio](https://www.codigotecnico.org/DocumentosCTE/SeguridadEnCasoDeIncendio.html)
- [CTE DB-SUA Seguridad de utilizacion y accesibilidad](https://www.codigotecnico.org/DocumentosCTE/SeguridadUtilizacionAccesibilidad.html)
- [CTE DB-HS Salubridad](https://www.codigotecnico.org/DocumentosCTE/Salubridad.html)

## Estado de cobertura en la app

| Area | Estado actual |
|---|---|
| Ascensores clinicos/camas | Modelados dentro de `verticalCore`; regla automatica por planta activa |
| Escaleras protegidas/emergencia | Nuevo template `emergencyStairCore`; regla automatica por planta activa y dos rutas por planta asistencial |
| Evacuacion horizontal/refugio | Nuevo template `horizontalRefuge`; regla automatica por planta asistencial |
| Sectorizacion PCI/control de humo | Nuevo template `fireCompartment`; regla automatica inicial por planta asistencial |
| Halls, esperas y accesos publicos | Modelados en planta 0 |
| Bahia de ambulancias | Modelada en urgencias con acceso separado |
| Logistica limpia/sucia | Modelada como muelle, CSSD y separacion publico-logistica |
| Redundancia MEP | Nuevo template `criticalMep`; falta regla automatica avanzada |
| Distancias normativas exactas | No implementadas todavia; requieren motor normativo parametrico |

## Checklist para hospital terciario nuevo

| Dominio | Requisito | Estado en app | Validacion pendiente |
|---|---|---|---|
| Acceso publico | Hall principal, admision, seguridad, orientacion, esperas dimensionadas | Parcial | Aforo, accesibilidad, control de colas, evacuacion |
| Ambulancias | Bahia cubierta, ruta directa a triaje/resus, acceso independiente y zona de catastrofe/descontaminacion | Parcial | Giro vehiculos, capacidad simultanea, seguridad vial, descontaminacion |
| Urgencias | Triaje, boxes, resus, observacion, salud mental segura, conexion imagen/UCI/OR | Parcial | Dimensionamiento por demanda, rutas limpias/sucias, violencia y privacidad |
| Ascensores publicos | Ascensores accesibles para publico y familiares | Documentado en nucleo | Cantidad, cabinas, redundancia, recorridos accesibles |
| Ascensores clinicos/camas | Ascensores para camas, criticos, quirofano, UCI y transporte sanitario | Regla automatica basica | Capacidad, segregacion, prioridad, espera maxima |
| Montacargas y logistica | Montacargas limpio/sucio, farmacia, comida, ropa, residuos, mortuorio | Parcial | Separacion completa y horarios operativos |
| Escaleras protegidas | Escaleras por planta, protegidas, con puertas resistentes y control de humo | Regla automatica basica | Anchuras, recorridos, presurizacion, independencia real |
| Escaleras de emergencia | Rutas alternativas independientes hasta exterior seguro | Regla automatica basica | Salidas finales, distancia maxima, capacidad de evacuacion |
| Evacuacion horizontal | Sectores/refugios para pacientes no ambulantes por planta asistencial | Regla automatica basica | Superficie util, resistencia al fuego, rutas de traslado |
| PCI | Sectorizacion, deteccion, alarma, rociadores, BMS, puertas cortafuego, control de humo | Parcial | Proyecto PCI completo y calculos DB-SI |
| Accesibilidad | Itinerarios accesibles, aseos, ascensores, senaletica y uso no discriminatorio | Documentado | Cumplimiento DB-SUA y normativa local |
| Hospitalizacion | Habitaciones, banos, enfermeria, medicacion, limpio/sucio, aislamiento | Parcial visual | Ratios por especialidad, privacidad, luz natural, control infeccion |
| UCI | Boxes criticos, gases, monitorizacion, aislamiento, farmacia satelite, familiares | Parcial visual | Presiones, HVAC, observabilidad, redundancias |
| Quirofanos | Bloque quirurgico, induccion, PACU, esteril, sucio, robotica/hibridos | Parcial visual | Flujos esteriles, HVAC, infeccion, trazabilidad |
| Diagnostico | Imagen central, TC/RM, hemodinamica, laboratorio core, banco de sangre | Parcial | Blindajes, ubicacion de equipos, muestras, tiempos urgentes |
| Farmacia | Unidosis, oncohematologia, ensayos, esteriles, dispensacion alta | Parcial | GMP, trazabilidad, seguridad medicamento |
| Materno-infantil | Obstetricia, partos, neonatal/pediatrica, urgencia obstetrica | Parcial | Circuitos familiares, neonatos, seguridad infantil |
| Oncologia y CAR-T | Hospital de dia, GMP, investigacion, biobanco, ensayos | Parcial | Bioseguridad, farmacia investigacional, criopreservacion |
| Logistica soporte | Cocina, lavanderia, residuos, mortuorio, almacenes, AGV/carros | Parcial | Rutas, muelles, olores, infeccion, horarios |
| MEP/resiliencia | Generadores, UPS, gases medicinales, HVAC, agua, datos, redundancia N+1 | Template inicial | Modelar dependencias y fallo por sector |
| Seguridad fisica | Control accesos, CCTV, urgencias seguras, infantil, farmacia, datos | Documentado | Matriz de riesgos y permisos por zona |
| Ciber/IT | CPD, redes clinicas, BMS, SOC/NOC, continuidad | Parcial command center | Arquitectura IT/OT, ciberseguridad, continuidad |
| Campus | Patios, orientacion, expansion, docencia, investigacion, alojamiento familiar | Parcial | Plan director, fases de obra, expansion sin parar hospital |

## Reglas automaticas actuales

- Presencia de servicios criticos: ambulancias, triaje, resus, boxes ED, imagen, laboratorio, OR, PACU, UCI, ward, farmacia, logistica, nucleo vertical, escaleras, refugios y PCI.
- Proximidades operativas: ED-imagen, resus-OR, resus-UCI, OR-PACU, PACU-UCI, PACU-ward, lab-UCI, logistica-OR.
- Separacion de flujos: publico frente a logistica/residuos y ambulancias frente a acceso publico.
- Evacuacion: nucleo vertical por planta, ascensor clinico por planta, escalera protegida por planta, dos escaleras por planta asistencial, refugio por planta asistencial y sector PCI por planta asistencial.
- Resiliencia: reserva de expansion o shell space.

## Reglas que deben venir despues

- Distancia maxima de recorrido hasta salida protegida.
- Anchura necesaria de escaleras, salidas y pasillos por ocupacion.
- Capacidad real de ascensores clinicos y espera maxima para camas.
- Independencia geometrica de rutas de evacuacion.
- Compatibilidad entre sectores de incendio, humos, puertas y refugios.
- Separacion completa de limpio/sucio, publico/clinico/logistica y adulto/pediatrico cuando aplique.
- Reglas de presiones, HVAC e infeccion por tipo de sala.
- Redundancia MEP por criticidad y simulacion de fallos.
- Reglas por jurisdiccion: CTE, normativa autonomica, criterios sanitarios y guias internas.
