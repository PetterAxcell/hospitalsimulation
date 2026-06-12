# Modelo funcional Hospital Clinic

Este documento define la rama de trabajo centrada en Hospital Clinic / Nou Campus de Salut Clinic-UB. No pretende copiar un plano real ni certificar un programa arquitectonico; es un modelo conceptual trazable para convertir necesidades estrategicas y operativas en un primer programa funcional, un plan de espacios preliminar y escenarios de simulacion.

Fecha de contraste de fuentes: 2026-06-04.

## Fuentes usadas

- [Hospital Clinic Barcelona - Sobre el Clinic](https://www.clinicbarcelona.org/asistencia/sobre-el-clinic): rol asistencial, hospital comunitario de Barcelona Esquerra, hospital terciario de alta complejidad, institutos/centros/areas y cifras publicas 2024.
- [Nou Campus de Salut Clinic - Universitat de Barcelona](https://www.clinicbarcelona.org/ca/asistencia/nou-campus-de-salut-clinic-universitat-de-barcelona): campus sanitario, docente e investigador de aproximadamente 300.000 m2 e integracion de Hospital Clinic, IDIBAPS, ISGlobal, Facultad de Medicina y Ciencias de la Salud UB y otros centros de referencia.
- [Que es el Pla Funcional del Nou Campus Clinic-UB](https://www.clinicbarcelona.org/ca/asistencia/nou-campus-de-salut-clinic-universitat-de-barcelona/que-es-el-pla-funcional): dimensiones del plan funcional, definicion de servicios, organizacion, espacios y recursos antes del concurso arquitectonico.
- `260608-SESSIO3-ESPAIS-Presentacio.pdf`: presentacion interna de la sesion 3 del Pla d'Espais. Se ha usado como primera fuente estructurada para crear `frontend/src/data/clinicSpaceProgram.ts` y auditar el preset actual en la pestaña `Servicios`.

## Que significa modelo bien definido

Un modelo bien definido no es solo una lista de habitaciones. Debe funcionar como contrato entre arquitectura, operaciones, simulacion y futuro generador IA:

1. Identidad del hospital: que hospital se modela, para que horizonte, con que area objetivo y que fuentes justifican los supuestos.
2. Cartera funcional: asistencia, docencia, investigacion, infraestructuras/servicios generales y relacion campus-ciudad.
3. Clusters de servicio: agrupaciones operativas que deben simularse juntas porque generan cuellos de botella compartidos.
4. Primitivas espaciales: salas, pasillos, puertas, ascensores, escaleras, montacargas, patios, sectores de incendio, refugios y reservas de expansion.
5. Primitivas de flujo: pacientes, personal, muestras, farmacos, material esteril, residuos, visitas y ambulancias.
6. Restricciones arquitectonicas: continuidad de pasillos, puertas conectadas a pasillo, verticales alineadas por plantas servidas, segregacion publico/clinico/logistico, seguridad contra incendios y resiliencia MEP.
7. Escenarios de simulacion: urgencias saturadas, bloqueo PACU, falta de camas, alta tardia, cirugia electiva, diagnostico urgente, logistica limpia/sucia y crisis.
8. KPIs: waits, boarding, ocupacion de camas, uso de ascensores, viajes verticales, distancia recorrida, pacientes bloqueados, misplacement, saturacion de nodos y penalizaciones de reglas.

## Datos base del Clinic actual

Los datos publicos de referencia no calibran aun la simulacion, pero si fijan el tamano y la complejidad que debe soportar el modelo:

- Poblacion de referencia: 540.000 personas.
- Camas: 750.
- Profesionales: 7.051.
- Altas anuales: 51.605.
- Cirugias anuales: 31.124.
- Residentes: 432.
- IDIBAPS: 99 grupos de investigacion.
- Publicaciones cientificas: 1.511.

## Programa funcional inicial

El preset `createHospitalClinicCampusPlan()` define una primera vision para 300.000 m2. La geometria inicial modela 299.628 m2, lo bastante cerca del objetivo para que el area no distorsione el ranking de simulacion:

- S2: logistica de campus, residuos, reserva tecnica y MEP critica.
- S1: CSSD, core lab, banco de sangre/tejidos y farmacia.
- Planta 0: agora publica, admision, espera, patio, ambulancias, urgencias, resus, observacion, salud mental e imagen urgente.
- Planta 1: bloque quirurgico, quirofanos hibridos, PACU, UCI quirurgica y hemodinamica/intervencionismo.
- Plantas 2-3: institutos medico-quirurgicos, hospitalizacion compleja, step-down, cardio-respiratorio, neurociencias y diagnostico avanzado.
- Planta 4: onco-hematologia, hospital de dia, ensayos y terapias avanzadas CAR-T/GMP.
- Planta 5: maternidad, salud reproductiva, neonatal/pediatria critica y apoyo familiar.
- Planta 6: consultas externas, hospital de dia y pruebas programadas.
- Plantas 7-8: IDIBAPS, ISGlobal, Facultad UB, docencia, simulacion clinica y command center.
- Planta 9: reserva de crecimiento clinico, tecnologia y nuevos modelos asistenciales.

Todas las plantas arrancan con tres redes de circulacion: publica, clinica y logistica. Tambien incluyen escaleras de emergencia, refugio horizontal, sector PCI y un nucleo vertical central alineado en todas las plantas.

## Sincronizacion con el Pla d'Espais

La rama ya incorpora una primera capa `PDF -> programa funcional -> auditoria`:

- `clinicSpaceProgram.ts` guarda entradas trazables del PDF con paginas fuente, ambito, sector, alcance, m2 utiles, factor bruto, capacidad esperada, plantillas equivalentes y requisitos funcionales.
- `clinicSpaceProgramAudit.ts` compara cada entrada con el `HospitalPlan` activo y marca `Falta`, `Debil`, `Parcial`, `Cubierto`, `Agregado` o `Regla`.
- `ClinicSpaceProgramPanel.tsx` muestra esa auditoria en la pestaña `Servicios`, junto a la matriz actual por familias.
- El selector `Elemento` del planificador incluye entradas del `Pla d'Espais Nou Clinic`, por lo que ya se pueden anadir bloques directamente desde el PDF.
- Cada bloque puede llevar `components`: un desglose interno editable para declarar habitaciones, boxes, controles de enfermeria, zonas limpio/sucio, almacenes, AGV, CPD, salas blancas u otros componentes funcionales.

Esta capa no genera aun planos automaticamente. Su objetivo es decir si el plan visual representa suficientemente el programa antes de usarlo como base de simulacion o generacion IA. La documentacion completa esta en [Sincronizacion Pla d'Espais Clinic](CLINIC_SPACE_PROGRAM_SYNC.md).

## Clusters que debe simular la rama

- Urgencias, diagnostico urgente y criticos: boarding ED, entrada de ambulancias, resus-imagen-UCI y ascensores clinicos.
- Bloque quirurgico, hibridos, PACU y esterilizacion: cancelacion quirurgica, bloqueo PACU, flujo limpio/sucio y traslado a UCI/planta.
- Hospitalizacion por institutos: ocupacion de camas, misplacement, alta tardia, interconsultas y pruebas.
- Consultas, pruebas y hospitales de dia: esperas ambulatorias, diagnostico programado y oncologia/hematologia de dia.
- IDIBAPS, ISGlobal, UB, docencia y simulacion: proximidad clinica-recerca, estudiantes/profesionales, ensayos y terapias avanzadas.
- Logistica, farmacia, MEP, residuos y resiliencia: suministros criticos, medicamento, CSSD-quirofano y continuidad energetica.

## Preguntas abiertas para validar con arquitectura

- Que unidades del Clinic actual deben quedar juntas por dependencia funcional y cuales pueden separarse por campus.
- Cuales son los flujos que mas preocupan: pacientes, profesionales, muestras, farmacia, residuos, material esteril, visitas o ambulancias.
- Que unidades requieren acceso directo a planta baja o a ambulancias.
- Que parte de investigacion/docencia debe estar embebida en clinica y que parte puede concentrarse en plantas superiores.
- Que reglas de seguridad se deben parametrizar para Barcelona/Catalunya antes de llamar a un escenario "valido".
- Que datos historicos pueden calibrar demanda, tiempos de servicio, cirugia, altas, ocupacion y movilidad interna.

## Criterio de uso

Esta rama debe servir para preparar una reunion funcional: ensenar una primera propuesta, mover bloques, discutir adyacencias, lanzar simulaciones y recoger supuestos. El siguiente paso no es generar hospitales automaticamente; antes hay que hacer que la simulacion sea suficientemente fiel, trazable y calibrable para que el generador aprenda de resultados utiles.
