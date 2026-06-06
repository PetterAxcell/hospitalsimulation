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
      'Hospitalización, UCI, bloque quirúrgico y diagnóstico',
      'Consultas, hospital de día y pruebas',
      'Continuidad de alta y gestión de camas',
    ],
  },
  {
    id: 'teaching',
    label: 'Docencia',
    modelNeeds: [
      'Grado, posgrado, residentes y formación continuada',
      'Aulas, simulación clínica y espacios de aprendizaje cerca de actividad real',
    ],
  },
  {
    id: 'research',
    label: 'Recerca e innovación',
    modelNeeds: [
      'Laboratorios, biobanco, investigación traslacional y plataformas',
      'Proximidad con clínica para ensayos, terapias avanzadas y transferencia',
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infraestructuras y servicios generales',
    modelNeeds: [
      'Logística limpia/sucia, farmacia, CSSD, residuos, MEP crítica e IT/OT',
      'Movilidad interna, ascensores clínicos, montacargas y rutas segregadas',
    ],
  },
  {
    id: 'campus',
    label: 'Campus y convivencia',
    modelNeeds: [
      'Relaciones con ciudadanía, pacientes, estudiantes y entidades',
      'Hall, orientación, espacios comunes, patios y expansión futura',
    ],
  },
] as const

export const HOSPITAL_CLINIC_SERVICE_CLUSTERS = [
  {
    id: 'emergency-critical',
    label: 'Urgencias, diagnóstico urgente y críticos',
    simulationFocus: ['boarding ED', 'resus-imagen-UCI', 'alta ocupación UCI', 'ascensores clínicos'],
  },
  {
    id: 'surgery-pacu',
    label: 'Bloque quirúrgico, híbridos, PACU y esterilización',
    simulationFocus: ['cancelación quirúrgica', 'bloqueo PACU', 'flujo limpio-sucio', 'traslado a UCI/planta'],
  },
  {
    id: 'inpatient-institutes',
    label: 'Hospitalización por institutos clínicos',
    simulationFocus: ['ocupación de camas', 'misplacement', 'alta tardía', 'interconsultas y pruebas'],
  },
  {
    id: 'ambulatory-day-care',
    label: 'Consultas, pruebas y hospitales de día',
    simulationFocus: ['esperas ambulatorias', 'diagnóstico programado', 'hospital de día onco/hematológico'],
  },
  {
    id: 'research-teaching',
    label: 'IDIBAPS, ISGlobal, UB, docencia y simulación',
    simulationFocus: ['proximidad clínica-recerca', 'flujos de estudiantes/profesionales', 'ensayos y terapias avanzadas'],
  },
  {
    id: 'logistics-resilience',
    label: 'Logística, farmacia, MEP, residuos y resiliencia',
    simulationFocus: ['suministros críticos', 'farmacia/medicamento', 'CSSD-quirófano', 'resiliencia energética'],
  },
] as const
