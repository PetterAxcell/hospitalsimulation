import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { PatientCaseId, PatientCaseStat, PatientStream, Severity, SimulationNode } from '../types'

export interface PatientCaseStep {
  node: SimulationNode
  phase: string
}

export interface PatientCaseDefinition {
  id: PatientCaseId
  label: string
  code: string
  stream: PatientStream
  severity: Severity
  color: string
  weight: number
  build: (rng: () => number) => PatientCaseStep[]
}

export interface ClinicalCaseDiagnostic {
  level: 'error' | 'warning'
  line: number
  message: string
}

export interface ClinicalCaseCompileResult {
  cases: PatientCaseDefinition[]
  diagnostics: ClinicalCaseDiagnostic[]
  appliedCases: number
}

interface CaseStepSpec {
  chance: number
  build: (rng: () => number) => PatientCaseStep[]
}

export const DEFAULT_PATIENT_CASES: PatientCaseDefinition[] = [
  {
    id: 'trauma_major',
    label: 'Trauma mayor',
    code: 'TRA',
    stream: 'ed_ambulance',
    severity: 'critical',
    color: '#ed7369',
    weight: 9,
    build: (rng) => {
      const surgical = rng() < 0.62
      const needsIcu = rng() < 0.78
      return [
        caseStep('arrival_ambulance', 'Entrada ambulancia'),
        caseStep('resus', 'ABCDE y estabilizacion'),
        caseStep('imaging', 'TAC urgente'),
        ...(surgical ? [caseStep('or', 'Quirofano trauma'), caseStep('pacu', 'Reanimacion postoperatoria')] : []),
        caseStep(needsIcu ? 'icu' : 'ward', needsIcu ? 'Ingreso UCI' : 'Ingreso planta'),
      ]
    },
  },
  {
    id: 'stroke_code',
    label: 'Codigo ictus',
    code: 'ICT',
    stream: 'ed_ambulance',
    severity: 'high',
    color: '#4730c4',
    weight: 7,
    build: (rng) => {
      const needsResus = rng() < 0.34
      const criticalUnit = rng() < 0.58
      return [
        caseStep('arrival_ambulance', 'Preaviso SEM'),
        caseStep('triage', 'Triaje avanzado'),
        caseStep('imaging', 'TC craneal'),
        ...(needsResus ? [caseStep('resus', 'Estabilizacion neuro')] : []),
        caseStep(criticalUnit ? 'icu' : 'ward', criticalUnit ? 'Unidad critica' : 'Ingreso neurologia'),
      ]
    },
  },
  {
    id: 'chest_pain',
    label: 'Dolor toracico',
    code: 'DT',
    stream: 'ed_walkin',
    severity: 'high',
    color: '#f18e7f',
    weight: 11,
    build: (rng) => {
      const needsImaging = rng() < 0.42
      const observation = rng() < 0.46
      return [
        caseStep('registration', 'Admision rapida'),
        caseStep('triage', 'Triaje prioridad alta'),
        caseStep('ed_bay', 'Box monitorizado'),
        caseStep('lab', 'Troponinas seriadas'),
        ...(needsImaging ? [caseStep('imaging', 'Prueba cardiologia')] : []),
        caseStep(observation ? 'observation' : 'pharmacy', observation ? 'Observacion ED' : 'Alta con tratamiento'),
      ]
    },
  },
  {
    id: 'minor_ed',
    label: 'Urgencia leve',
    code: 'UL',
    stream: 'ed_walkin',
    severity: 'low',
    color: '#fbc344',
    weight: 24,
    build: (rng) => [
      caseStep('registration', 'Admision'),
      caseStep('triage', 'Triaje'),
      caseStep('ed_bay', rng() < 0.5 ? 'Cura / analgesia' : 'Valoracion medica'),
      caseStep('pharmacy', 'Receta y alta'),
    ],
  },
  {
    id: 'ed_observation',
    label: 'Urgencia con observacion',
    code: 'OBS',
    stream: 'ed_walkin',
    severity: 'medium',
    color: '#01b7c1',
    weight: 17,
    build: (rng) => {
      const needsLab = rng() < 0.64
      const needsImaging = rng() < 0.38
      const admission = rng() < 0.32
      return [
        caseStep('registration', 'Admision'),
        caseStep('triage', 'Triaje'),
        caseStep('ed_bay', 'Box diagnostico'),
        ...(needsLab ? [caseStep('lab', 'Analitica')] : []),
        ...(needsImaging ? [caseStep('imaging', 'Imagen')] : []),
        caseStep('observation', 'Observacion y decision'),
        caseStep(admission ? 'ward' : 'pharmacy', admission ? 'Ingreso planta' : 'Alta'),
      ]
    },
  },
  {
    id: 'outpatient_consult',
    label: 'Consulta externa',
    code: 'CEX',
    stream: 'outpatient',
    severity: 'medium',
    color: '#386ba6',
    weight: 22,
    build: (rng) => {
      const needsLab = rng() < 0.36
      const needsImaging = rng() < 0.24
      return [
        caseStep('registration', 'Check-in'),
        caseStep('consult', 'Consulta / hospital de dia'),
        ...(needsLab ? [caseStep('lab', 'Extraccion')] : []),
        ...(needsImaging ? [caseStep('imaging', 'Prueba imagen')] : []),
        caseStep('pharmacy', 'Farmacia / salida'),
      ]
    },
  },
  {
    id: 'scheduled_surgery',
    label: 'Cirugia programada',
    code: 'QX',
    stream: 'elective',
    severity: 'medium',
    color: '#8fb8de',
    weight: 9,
    build: (rng) => {
      const needsIcu = rng() < 0.18
      return [
        caseStep('registration', 'Ingreso quirurgico'),
        caseStep('or', 'Quirofano'),
        caseStep('pacu', 'PACU'),
        caseStep(needsIcu ? 'icu' : 'ward', needsIcu ? 'UCI postoperatoria' : 'Planta postoperatoria'),
      ]
    },
  },
  {
    id: 'sepsis_pathway',
    label: 'Sepsis grave',
    code: 'SEP',
    stream: 'ed_walkin',
    severity: 'critical',
    color: '#f5ab38',
    weight: 8,
    build: (rng) => {
      const directIcu = rng() < 0.62
      return [
        caseStep('registration', 'Admision infecciosa'),
        caseStep('triage', 'Codigo sepsis'),
        caseStep('resus', 'Fluidoterapia y antibiotico'),
        caseStep('lab', 'Hemocultivos / lactato'),
        ...(rng() < 0.35 ? [caseStep('imaging', 'Foco infeccioso')] : []),
        caseStep(directIcu ? 'icu' : 'ward', directIcu ? 'UCI sepsis' : 'Hospitalizacion infecciosa'),
      ]
    },
  },
  {
    id: 'hip_fracture',
    label: 'Fractura de cadera',
    code: 'CAD',
    stream: 'ed_walkin',
    severity: 'high',
    color: '#4730c4',
    weight: 7,
    build: (rng) => [
      caseStep(rng() < 0.45 ? 'arrival_ambulance' : 'registration', 'Llegada fragilidad'),
      caseStep('triage', 'Triaje trauma fragil'),
      caseStep('imaging', 'Radiologia urgente'),
      caseStep('lab', 'Preoperatorio'),
      caseStep('or', 'Cirugia traumatologia'),
      caseStep('pacu', 'Reanimacion'),
      caseStep('ward', 'Ingreso traumatologia'),
    ],
  },
  {
    id: 'maternity_delivery',
    label: 'Parto y puerperio',
    code: 'MAT',
    stream: 'elective',
    severity: 'medium',
    color: '#f18e7f',
    weight: 6,
    build: (rng) => {
      const neonatalSupport = rng() < 0.16
      return [
        caseStep('registration', 'Ingreso obstetrico'),
        caseStep('maternity', rng() < 0.74 ? 'Dilatacion y parto' : 'Cesarea programada'),
        ...(neonatalSupport ? [caseStep('neonatal_icu', 'Soporte neonatal')] : []),
        caseStep('ward', 'Puerperio / planta'),
      ]
    },
  },
  {
    id: 'neonatal_critical',
    label: 'Neonato critico',
    code: 'NEO',
    stream: 'ed_ambulance',
    severity: 'critical',
    color: '#4730c4',
    weight: 3,
    build: () => [
      caseStep('arrival_ambulance', 'Traslado neonatal'),
      caseStep('resus', 'Estabilizacion neonatal'),
      caseStep('neonatal_icu', 'Ingreso UCI neonatal'),
      caseStep('lab', 'Analitica neonatal'),
    ],
  },
  {
    id: 'psychiatric_crisis',
    label: 'Crisis psiquiatrica',
    code: 'PSQ',
    stream: 'ed_walkin',
    severity: 'medium',
    color: '#33b578',
    weight: 6,
    build: (rng) => {
      const admission = rng() < 0.38
      return [
        caseStep('registration', 'Admision discreta'),
        caseStep('triage', 'Triaje salud mental'),
        caseStep('ed_bay', 'Box salud mental'),
        caseStep('observation', 'Observacion protegida'),
        caseStep(admission ? 'ward' : 'pharmacy', admission ? 'Ingreso psiquiatria' : 'Plan terapeutico y alta'),
      ]
    },
  },
  {
    id: 'oncology_infusion',
    label: 'Oncologia dia',
    code: 'ONC',
    stream: 'outpatient',
    severity: 'medium',
    color: '#ed7369',
    weight: 9,
    build: (rng) => [
      caseStep('registration', 'Check-in oncologia'),
      caseStep('consult', 'Valoracion oncologica'),
      ...(rng() < 0.52 ? [caseStep('lab', 'Analitica pretratamiento')] : []),
      caseStep('pharmacy', 'Preparacion citostatico'),
      caseStep('research', rng() < 0.2 ? 'Ensayo clinico' : 'Hospital de dia'),
    ],
  },
  {
    id: 'complex_diagnostic',
    label: 'Diagnostico complejo',
    code: 'DXC',
    stream: 'outpatient',
    severity: 'medium',
    color: '#4accd3',
    weight: 10,
    build: (rng) => [
      caseStep('registration', 'Check-in pruebas'),
      caseStep('consult', 'Consulta especializada'),
      caseStep('lab', 'Analitica avanzada'),
      caseStep('imaging', rng() < 0.5 ? 'RM / TAC programado' : 'Intervencionismo diagnostico'),
      caseStep('consult', 'Decision clinica'),
    ],
  },
]

const VALID_STREAMS: PatientStream[] = ['ed_ambulance', 'ed_walkin', 'outpatient', 'elective']
const VALID_SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical']
const VALID_SIMULATION_NODES: SimulationNode[] = [
  'arrival_public',
  'arrival_ambulance',
  'triage',
  'registration',
  'ed_bay',
  'resus',
  'observation',
  'consult',
  'imaging',
  'lab',
  'or',
  'hybrid_or',
  'pacu',
  'icu',
  'ward',
  'maternity',
  'neonatal_icu',
  'pharmacy',
  'discharge',
  'logistics',
  'research',
  'vertical_core',
  'emergency_stair',
  'refuge_area',
  'fire_sector',
  'exit',
]

const NODE_ALIASES: Record<string, SimulationNode> = {
  admision: 'registration',
  admission: 'registration',
  ambulance: 'arrival_ambulance',
  ambulancia: 'arrival_ambulance',
  boxes: 'ed_bay',
  box: 'ed_bay',
  consulta: 'consult',
  consultorio: 'consult',
  diagnostico: 'imaging',
  emergency: 'ed_bay',
  farmacia: 'pharmacy',
  hospitalizacion: 'ward',
  imagen: 'imaging',
  laboratorio: 'lab',
  quirofano: 'or',
  reanimacion: 'resus',
  shock: 'resus',
  urgencias: 'ed_bay',
  uci: 'icu',
}

export const DEFAULT_CLINICAL_CASES_YAML = `cases:
  - id: trauma_major
    label: Trauma mayor
    code: TRA
    stream: ed_ambulance
    severity: critical
    color: "#ed7369"
    weight: 9
    steps:
      - node: arrival_ambulance
        phase: Entrada ambulancia
      - node: resus
        phase: ABCDE y estabilizacion
      - node: imaging
        phase: TAC urgente
      - chance: 0.62
        steps:
          - node: or
            phase: Quirofano trauma
          - node: pacu
            phase: Reanimacion postoperatoria
      - choose:
          - weight: 0.78
            node: icu
            phase: Ingreso UCI
          - weight: 0.22
            node: ward
            phase: Ingreso planta

  - id: stroke_code
    label: Codigo ictus
    code: ICT
    stream: ed_ambulance
    severity: high
    color: "#4730c4"
    weight: 7
    steps:
      - node: arrival_ambulance
        phase: Preaviso SEM
      - node: triage
        phase: Triaje avanzado
      - node: imaging
        phase: TC craneal
      - chance: 0.34
        node: resus
        phase: Estabilizacion neuro
      - choose:
          - weight: 0.58
            node: icu
            phase: Unidad critica
          - weight: 0.42
            node: ward
            phase: Ingreso neurologia

  - id: chest_pain
    label: Dolor toracico
    code: DT
    stream: ed_walkin
    severity: high
    color: "#f18e7f"
    weight: 11
    steps:
      - node: registration
        phase: Admision rapida
      - node: triage
        phase: Triaje prioridad alta
      - node: ed_bay
        phase: Box monitorizado
      - node: lab
        phase: Troponinas seriadas
      - chance: 0.42
        node: imaging
        phase: Prueba cardiologia
      - choose:
          - weight: 0.46
            node: observation
            phase: Observacion ED
          - weight: 0.54
            node: pharmacy
            phase: Alta con tratamiento

  - id: minor_ed
    label: Urgencia leve
    code: UL
    stream: ed_walkin
    severity: low
    color: "#fbc344"
    weight: 24
    steps:
      - node: registration
        phase: Admision
      - node: triage
        phase: Triaje
      - choose:
          - weight: 0.5
            node: ed_bay
            phase: Cura / analgesia
          - weight: 0.5
            node: ed_bay
            phase: Valoracion medica
      - node: pharmacy
        phase: Receta y alta

  - id: ed_observation
    label: Urgencia con observacion
    code: OBS
    stream: ed_walkin
    severity: medium
    color: "#01b7c1"
    weight: 17
    steps:
      - node: registration
        phase: Admision
      - node: triage
        phase: Triaje
      - node: ed_bay
        phase: Box diagnostico
      - chance: 0.64
        node: lab
        phase: Analitica
      - chance: 0.38
        node: imaging
        phase: Imagen
      - node: observation
        phase: Observacion y decision
      - choose:
          - weight: 0.32
            node: ward
            phase: Ingreso planta
          - weight: 0.68
            node: pharmacy
            phase: Alta

  - id: outpatient_consult
    label: Consulta externa
    code: CEX
    stream: outpatient
    severity: medium
    color: "#386ba6"
    weight: 22
    steps:
      - node: registration
        phase: Check-in
      - node: consult
        phase: Consulta / hospital de dia
      - chance: 0.36
        node: lab
        phase: Extraccion
      - chance: 0.24
        node: imaging
        phase: Prueba imagen
      - node: pharmacy
        phase: Farmacia / salida

  - id: scheduled_surgery
    label: Cirugia programada
    code: QX
    stream: elective
    severity: medium
    color: "#8fb8de"
    weight: 9
    steps:
      - node: registration
        phase: Ingreso quirurgico
      - node: or
        phase: Quirofano
      - node: pacu
        phase: PACU
      - choose:
          - weight: 0.18
            node: icu
            phase: UCI postoperatoria
          - weight: 0.82
            node: ward
            phase: Planta postoperatoria

  - id: sepsis_pathway
    label: Sepsis grave
    code: SEP
    stream: ed_walkin
    severity: critical
    color: "#f5ab38"
    weight: 8
    steps:
      - node: registration
        phase: Admision infecciosa
      - node: triage
        phase: Codigo sepsis
      - node: resus
        phase: Fluidoterapia y antibiotico
      - node: lab
        phase: Hemocultivos / lactato
      - chance: 0.35
        node: imaging
        phase: Foco infeccioso
      - choose:
          - weight: 0.62
            node: icu
            phase: UCI sepsis
          - weight: 0.38
            node: ward
            phase: Hospitalizacion infecciosa

  - id: hip_fracture
    label: Fractura de cadera
    code: CAD
    stream: ed_walkin
    severity: high
    color: "#4730c4"
    weight: 7
    steps:
      - choose:
          - weight: 0.45
            node: arrival_ambulance
            phase: Llegada ambulancia fragilidad
          - weight: 0.55
            node: registration
            phase: Admision fragilidad
      - node: triage
        phase: Triaje trauma fragil
      - node: imaging
        phase: Radiologia urgente
      - node: lab
        phase: Preoperatorio
      - node: or
        phase: Cirugia traumatologia
      - node: pacu
        phase: Reanimacion
      - node: ward
        phase: Ingreso traumatologia

  - id: maternity_delivery
    label: Parto y puerperio
    code: MAT
    stream: elective
    severity: medium
    color: "#f18e7f"
    weight: 6
    steps:
      - node: registration
        phase: Ingreso obstetrico
      - choose:
          - weight: 0.74
            node: maternity
            phase: Dilatacion y parto
          - weight: 0.26
            node: maternity
            phase: Cesarea programada
      - chance: 0.16
        node: neonatal_icu
        phase: Soporte neonatal
      - node: ward
        phase: Puerperio / planta

  - id: neonatal_critical
    label: Neonato critico
    code: NEO
    stream: ed_ambulance
    severity: critical
    color: "#4730c4"
    weight: 3
    steps:
      - node: arrival_ambulance
        phase: Traslado neonatal
      - node: resus
        phase: Estabilizacion neonatal
      - node: neonatal_icu
        phase: Ingreso UCI neonatal
      - node: lab
        phase: Analitica neonatal

  - id: psychiatric_crisis
    label: Crisis psiquiatrica
    code: PSQ
    stream: ed_walkin
    severity: medium
    color: "#33b578"
    weight: 6
    steps:
      - node: registration
        phase: Admision discreta
      - node: triage
        phase: Triaje salud mental
      - node: ed_bay
        phase: Box salud mental
      - node: observation
        phase: Observacion protegida
      - choose:
          - weight: 0.38
            node: ward
            phase: Ingreso psiquiatria
          - weight: 0.62
            node: pharmacy
            phase: Plan terapeutico y alta

  - id: oncology_infusion
    label: Oncologia dia
    code: ONC
    stream: outpatient
    severity: medium
    color: "#ed7369"
    weight: 9
    steps:
      - node: registration
        phase: Check-in oncologia
      - node: consult
        phase: Valoracion oncologica
      - chance: 0.52
        node: lab
        phase: Analitica pretratamiento
      - node: pharmacy
        phase: Preparacion citostatico
      - choose:
          - weight: 0.2
            node: research
            phase: Ensayo clinico
          - weight: 0.8
            node: research
            phase: Hospital de dia

  - id: complex_diagnostic
    label: Diagnostico complejo
    code: DXC
    stream: outpatient
    severity: medium
    color: "#4accd3"
    weight: 10
    steps:
      - node: registration
        phase: Check-in pruebas
      - node: consult
        phase: Consulta especializada
      - node: lab
        phase: Analitica avanzada
      - choose:
          - weight: 0.5
            node: imaging
            phase: RM / TAC programado
          - weight: 0.5
            node: imaging
            phase: Intervencionismo diagnostico
      - node: consult
        phase: Decision clinica`

export function compileClinicalCases(source: string): ClinicalCaseCompileResult {
  let document: unknown
  try {
    document = parseYaml(source)
  } catch (error) {
    return {
      cases: DEFAULT_PATIENT_CASES,
      diagnostics: [{
        level: 'error',
        line: 1,
        message: error instanceof Error ? error.message : String(error),
      }],
      appliedCases: 0,
    }
  }

  try {
    const root = requireRecord(document, 'El YAML de casos debe ser un objeto con la clave cases.')
    const cases = listFromValue(root.cases).map(caseFromYamlEntry)
    if (cases.length === 0) {
      throw new Error('Define al menos un caso en cases.')
    }
    const duplicatedId = firstDuplicate(cases.map((item) => item.id))
    if (duplicatedId) throw new Error(`El caso "${duplicatedId}" esta duplicado.`)
    return {
      cases,
      diagnostics: [],
      appliedCases: cases.length,
    }
  } catch (error) {
    return {
      cases: DEFAULT_PATIENT_CASES,
      diagnostics: [{
        level: 'error',
        line: 1,
        message: error instanceof Error ? error.message : String(error),
      }],
      appliedCases: 0,
    }
  }
}

export function clinicalCaseYamlFromSource(source: string, caseId: PatientCaseId, fallbackCases: PatientCaseDefinition[] = DEFAULT_PATIENT_CASES): string {
  try {
    const root = requireRecord(parseYaml(source), 'El YAML de casos debe ser un objeto con la clave cases.')
    const entry = listFromValue(root.cases).find((item) => {
      const record = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : undefined
      return record?.id === caseId
    })
    if (entry) return stringifyClinicalCases([entry])
  } catch {
    // Fall back to the runtime case below.
  }

  const fallback = fallbackCases.find((item) => item.id === caseId)
  if (!fallback) return stringifyClinicalCases([])
  return stringifyClinicalCases([caseDefinitionToYamlEntry(fallback)])
}

export function replaceClinicalCaseInYaml(source: string, caseSource: string, targetCaseId: PatientCaseId): string {
  const root = requireRecord(parseYaml(source), 'El YAML de casos debe ser un objeto con la clave cases.')
  const cases = listFromValue(root.cases)
  const replacementRoot = requireRecord(parseYaml(caseSource), 'El YAML del caso debe ser un objeto.')
  const replacements = listFromValue(replacementRoot.cases ?? replacementRoot)
  if (replacements.length !== 1) throw new Error('Edita un unico caso en este modal.')

  const replacement = requireRecord(replacements[0], 'El caso debe ser un objeto.')
  requiredString(replacement.id, 'case.id')
  const index = cases.findIndex((item) => {
    const record = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : undefined
    return record?.id === targetCaseId
  })
  const nextCases = [...cases]
  if (index >= 0) nextCases[index] = replacement
  else nextCases.push(replacement)

  return stringifyYaml({ ...root, cases: nextCases }, { lineWidth: 0 }).trimEnd()
}

function caseStep(node: SimulationNode, phase: string): PatientCaseStep {
  return { node, phase }
}

export function weightedPatientCase(rng: () => number, patientCases: PatientCaseDefinition[]): PatientCaseDefinition {
  const total = patientCases.reduce((sum, item) => sum + item.weight, 0)
  let roll = rng() * total
  for (const patientCase of patientCases) {
    roll -= patientCase.weight
    if (roll <= 0) return patientCase
  }
  return patientCases[patientCases.length - 1]
}

export function createCaseStats(patientCases: PatientCaseDefinition[]): Map<PatientCaseId, PatientCaseStat> {
  return new Map(patientCases.map((patientCase) => [
    patientCase.id,
    {
      id: patientCase.id,
      label: patientCase.label,
      color: patientCase.color,
      attempted: 0,
      completed: 0,
      blocked: 0,
      samplePath: [],
    },
  ]))
}

function caseFromYamlEntry(value: unknown): PatientCaseDefinition {
  const item = requireRecord(value, 'Cada caso debe ser un objeto.')
  const id = requiredString(item.id, 'case.id')
  if (id === 'all') throw new Error('El id "all" esta reservado.')
  const label = requiredString(item.label ?? item.name, `case ${id}.label`)
  const code = optionalString(item.code) ?? id.slice(0, 3).toUpperCase()
  const stream = streamFromValue(item.stream ?? 'ed_walkin', id)
  const severity = severityFromValue(item.severity ?? 'medium', id)
  const color = optionalString(item.color) ?? '#01b7c1'
  const weight = optionalNumber(item.weight) ?? 1
  const specs = specsFromValue(item.steps, `case ${id}.steps`)
  if (specs.length < 2) throw new Error(`case ${id}.steps necesita al menos 2 pasos.`)
  return {
    id,
    label,
    code,
    stream,
    severity,
    color,
    weight: Math.max(0.01, weight),
    build: (rng) => expandStepSpecs(specs, rng),
  }
}

function specsFromValue(value: unknown, path: string): CaseStepSpec[] {
  return listFromValue(value).flatMap((entry, index) => specFromValue(entry, `${path}[${index}]`))
}

function specFromValue(value: unknown, path: string): CaseStepSpec[] {
  if (typeof value === 'string') {
    const node = simulationNodeFromValue(value, path)
    return [stepSpec(node, titleFromNode(node), 1)]
  }
  const item = requireRecord(value, `${path} debe ser un nodo, un paso o una rama.`)

  if (Array.isArray(item.choose) || Array.isArray(item.oneOf)) {
    const choices = listFromValue(item.choose ?? item.oneOf).map((choice, index) => choiceFromValue(choice, `${path}.choose[${index}]`))
    if (choices.length === 0) throw new Error(`${path}.choose necesita opciones.`)
    const chance = chanceFromValue(item.chance ?? item.probability ?? item.optional)
    return [{
      chance,
      build: (rng) => {
        const total = choices.reduce((sum, choice) => sum + choice.weight, 0)
        let roll = rng() * total
        for (const choice of choices) {
          roll -= choice.weight
          if (roll <= 0) return expandStepSpecs(choice.steps, rng)
        }
        return expandStepSpecs(choices[choices.length - 1].steps, rng)
      },
    }]
  }

  if (Array.isArray(item.steps)) {
    const chance = chanceFromValue(item.chance ?? item.probability ?? item.optional)
    const steps = specsFromValue(item.steps, `${path}.steps`)
    return [{
      chance,
      build: (rng) => expandStepSpecs(steps, rng),
    }]
  }

  const node = simulationNodeFromValue(item.node ?? item.to, `${path}.node`)
  const phase = optionalString(item.phase ?? item.name) ?? titleFromNode(node)
  const chance = chanceFromValue(item.chance ?? item.probability ?? item.optional)
  return [stepSpec(node, phase, chance)]
}

function choiceFromValue(value: unknown, path: string): { weight: number; steps: CaseStepSpec[] } {
  if (typeof value === 'string') {
    const node = simulationNodeFromValue(value, path)
    return { weight: 1, steps: [stepSpec(node, titleFromNode(node), 1)] }
  }
  const item = requireRecord(value, `${path} debe ser una opcion de rama.`)
  const weight = Math.max(0.01, optionalNumber(item.weight ?? item.chance ?? item.probability) ?? 1)
  if (Array.isArray(item.steps)) return { weight, steps: specsFromValue(item.steps, `${path}.steps`) }
  const node = simulationNodeFromValue(item.node ?? item.to, `${path}.node`)
  const phase = optionalString(item.phase ?? item.name) ?? titleFromNode(node)
  return { weight, steps: [stepSpec(node, phase, 1)] }
}

function stepSpec(node: SimulationNode, phase: string, chance: number): CaseStepSpec {
  return {
    chance,
    build: () => [caseStep(node, phase)],
  }
}

function expandStepSpecs(specs: CaseStepSpec[], rng: () => number): PatientCaseStep[] {
  const steps = specs.flatMap((spec) => (rng() <= spec.chance ? spec.build(rng) : []))
  return steps.filter((step, index) => step.node !== steps[index - 1]?.node)
}

function chanceFromValue(value: unknown): number {
  if (value === undefined) return 1
  if (typeof value === 'boolean') return value ? 1 : 0
  const number = optionalNumber(value)
  if (number === undefined) return 1
  return clamp(number, 0, 1)
}

function streamFromValue(value: unknown, id: string): PatientStream {
  const stream = requiredString(value, `case ${id}.stream`) as PatientStream
  if (!VALID_STREAMS.includes(stream)) throw new Error(`case ${id}.stream debe ser ${VALID_STREAMS.join(', ')}.`)
  return stream
}

function severityFromValue(value: unknown, id: string): Severity {
  const severity = requiredString(value, `case ${id}.severity`) as Severity
  if (!VALID_SEVERITIES.includes(severity)) throw new Error(`case ${id}.severity debe ser ${VALID_SEVERITIES.join(', ')}.`)
  return severity
}

function simulationNodeFromValue(value: unknown, path: string): SimulationNode {
  const raw = requiredString(value, path)
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, '_')
  const node = NODE_ALIASES[normalized] ?? normalized
  if (!VALID_SIMULATION_NODES.includes(node as SimulationNode)) {
    throw new Error(`${path} usa un nodo desconocido "${raw}".`)
  }
  return node as SimulationNode
}

function titleFromNode(node: SimulationNode): string {
  return node.split('_').map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ')
}

function stringifyClinicalCases(cases: unknown[]): string {
  return stringifyYaml({ cases }, { lineWidth: 0 }).trimEnd()
}

function caseDefinitionToYamlEntry(patientCase: PatientCaseDefinition): Record<string, unknown> {
  const sample = patientCase.build(() => 0.5)
  return {
    id: patientCase.id,
    label: patientCase.label,
    code: patientCase.code,
    stream: patientCase.stream,
    severity: patientCase.severity,
    color: patientCase.color,
    weight: patientCase.weight,
    steps: sample.map((step) => ({ node: step.node, phase: step.phase })),
  }
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function listFromValue(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} debe ser texto.`)
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const number = Number(value)
    return Number.isFinite(number) ? number : undefined
  }
  return undefined
}

function firstDuplicate(values: string[]): string | undefined {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
