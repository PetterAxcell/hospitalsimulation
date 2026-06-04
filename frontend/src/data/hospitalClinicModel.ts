export const HOSPITAL_CLINIC_MODEL_VERSION = 'clinic-functional-model-0.1'

export const HOSPITAL_CLINIC_SOURCES = [
  {
    id: 'clinic-about',
    label: 'Hospital Clinic Barcelona - Sobre el Clinic',
    url: 'https://www.clinicbarcelona.org/asistencia/sobre-el-clinic',
    usedFor: [
      'Hospital comunitario de Barcelona Esquerra y hospital terciario de alta complejidad.',
      'Organizacion en institutos, centros y areas transversales.',
      'Cifras 2024: camas, profesionales, altas, cirugia, residentes e investigacion.',
    ],
  },
  {
    id: 'clinic-new-campus',
    label: 'Nou Campus de Salut Clinic - Universitat de Barcelona',
    url: 'https://www.clinicbarcelona.org/ca/asistencia/nou-campus-de-salut-clinic-universitat-de-barcelona',
    usedFor: [
      'Campus sanitario, docente y de investigacion de unos 300.000 m2.',
      'Integracion de Hospital Clinic Barcelona, IDIBAPS, ISGlobal, Facultad de Medicina y Ciencias de la Salud UB y otros centros de referencia.',
    ],
  },
  {
    id: 'clinic-functional-plan',
    label: 'Que es el Pla Funcional del Nou Campus Clinic-UB',
    url: 'https://www.clinicbarcelona.org/ca/asistencia/nou-campus-de-salut-clinic-universitat-de-barcelona/que-es-el-pla-funcional',
    usedFor: [
      'El plan funcional define servicios, organizacion, espacios y recursos.',
      'Dimensiones: asistencia, docencia, recerca/innovacion, infraestructuras y convivencia ciudadana.',
      'Fase de plan funcional, plan de espacios y salida hacia concurso arquitectonico.',
    ],
  },
] as const

export const HOSPITAL_CLINIC_FACTS = {
  currentCareRole: {
    catchmentPopulation: 540000,
    beds: 750,
    professionals: 7051,
    annualDischarges: 51605,
    annualSurgeries: 31124,
    residents: 432,
    idibapsResearchGroups: 99,
    scientificArticles: 1511,
  },
  newCampus: {
    targetAreaSqm: 300000,
    planningHorizon: 'Nou Campus de Salut Clinic-UB',
    integratedEntities: [
      'Hospital Clinic Barcelona',
      'IDIBAPS',
      'ISGlobal',
      'Facultat de Medicina i Ciencies de la Salut UB',
      'Altres centres de recerca de referencia',
    ],
  },
} as const

export const HOSPITAL_CLINIC_FUNCTIONAL_DIMENSIONS = [
  {
    id: 'care',
    label: 'Asistencia',
    modelNeeds: [
      'Urgencias y procesos tiempo-dependientes',
      'Hospitalizacion, UCI, bloque quirurgico y diagnostico',
      'Consultas, hospital de dia y pruebas',
      'Continuidad de alta y gestion de camas',
    ],
  },
  {
    id: 'teaching',
    label: 'Docencia',
    modelNeeds: [
      'Grado, posgrado, residentes y formacion continuada',
      'Aulas, simulacion clinica y espacios de aprendizaje cerca de actividad real',
    ],
  },
  {
    id: 'research',
    label: 'Recerca e innovacion',
    modelNeeds: [
      'Laboratorios, biobanco, investigacion traslacional y plataformas',
      'Proximidad con clinica para ensayos, terapias avanzadas y transferencia',
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infraestructuras y servicios generales',
    modelNeeds: [
      'Logistica limpia/sucia, farmacia, CSSD, residuos, MEP critica e IT/OT',
      'Movilidad interna, ascensores clinicos, montacargas y rutas segregadas',
    ],
  },
  {
    id: 'campus',
    label: 'Campus y convivencia',
    modelNeeds: [
      'Relaciones con ciudadania, pacientes, estudiantes y entidades',
      'Hall, orientacion, espacios comunes, patios y expansion futura',
    ],
  },
] as const

export const HOSPITAL_CLINIC_SERVICE_CLUSTERS = [
  {
    id: 'emergency-critical',
    label: 'Urgencias, diagnostico urgente y criticos',
    simulationFocus: ['boarding ED', 'resus-imagen-UCI', 'alta ocupacion UCI', 'ascensores clinicos'],
  },
  {
    id: 'surgery-pacu',
    label: 'Bloque quirurgico, hibridos, PACU y esterilizacion',
    simulationFocus: ['cancelacion quirurgica', 'bloqueo PACU', 'flujo limpio-sucio', 'traslado a UCI/planta'],
  },
  {
    id: 'inpatient-institutes',
    label: 'Hospitalizacion por institutos clinicos',
    simulationFocus: ['ocupacion de camas', 'misplacement', 'alta tardia', 'interconsultas y pruebas'],
  },
  {
    id: 'ambulatory-day-care',
    label: 'Consultas, pruebas y hospitales de dia',
    simulationFocus: ['esperas ambulatorias', 'diagnostico programado', 'hospital de dia onco/hematologico'],
  },
  {
    id: 'research-teaching',
    label: 'IDIBAPS, ISGlobal, UB, docencia y simulacion',
    simulationFocus: ['proximidad clinica-recerca', 'flujos de estudiantes/profesionales', 'ensayos y terapias avanzadas'],
  },
  {
    id: 'logistics-resilience',
    label: 'Logistica, farmacia, MEP, residuos y resiliencia',
    simulationFocus: ['suministros criticos', 'farmacia/medicamento', 'CSSD-quirofano', 'resiliencia energetica'],
  },
] as const

