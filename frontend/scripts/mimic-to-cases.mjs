#!/usr/bin/env node
/**
 * Conversor de MIMIC-IV (o cualquier extraccion EHR con el mismo esquema) a la
 * mezcla clinica que consume el simulador.
 *
 * Lee los CSV de MIMIC, agrupa los ingresos en cohortes por capitulo diagnostico
 * y calcula, para cada cohorte, su peso relativo y las probabilidades observadas
 * de laboratorio, imagen, quirofano, UCI, planta y alta directa. Con eso escribe
 * un YAML de casos clinicos listo para subir en la pestana Simulacion.
 *
 * MIMIC-IV requiere credenciales de PhysioNet. Este script no descarga nada:
 * trabaja sobre ficheros locales que ya tengas (sirve la version demo abierta).
 *
 * Uso:
 *   node scripts/mimic-to-cases.mjs --input /ruta/mimic-iv [opciones]
 *
 * Opciones:
 *   --input <dir>    Carpeta raiz con hosp/, icu/, ed/ (o todos los CSV juntos).
 *   --out <fichero>  YAML de salida. Por defecto casos-mimic.yaml
 *   --stats <fich.>  JSON con el detalle de cada cohorte y los supuestos.
 *   --top <n>        Numero maximo de cohortes (por defecto 8).
 *   --min <n>        Ingresos minimos para conservar una cohorte (por defecto 5).
 *   --label <texto>  Etiqueta de procedencia que se escribe en meta.source.
 *   --labs           Recorre labevents.csv para medir la probabilidad real de
 *                    analitica. Es el fichero mas grande de MIMIC; sin esta
 *                    opcion se usa un supuesto documentado.
 *
 * Ficheros usados (todos opcionales salvo admissions o edstays):
 *   hosp/admissions.csv, hosp/diagnoses_icd.csv, hosp/d_icd_diagnoses.csv,
 *   hosp/procedures_icd.csv, hosp/labevents.csv, icu/icustays.csv,
 *   ed/edstays.csv, ed/triage.csv
 */
import { createReadStream, existsSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { basename, join } from 'node:path'

const options = parseArgs(process.argv.slice(2))
if (!options.input) {
  console.error('Falta --input con la carpeta de CSV de MIMIC-IV.')
  process.exit(2)
}

const PATHS = {
  admissions: resolveTable(options.input, 'admissions', ['hosp']),
  diagnoses: resolveTable(options.input, 'diagnoses_icd', ['hosp']),
  dDiagnoses: resolveTable(options.input, 'd_icd_diagnoses', ['hosp']),
  procedures: resolveTable(options.input, 'procedures_icd', ['hosp']),
  labs: resolveTable(options.input, 'labevents', ['hosp']),
  icustays: resolveTable(options.input, 'icustays', ['icu']),
  edstays: resolveTable(options.input, 'edstays', ['ed']),
  triage: resolveTable(options.input, 'triage', ['ed']),
}

if (!PATHS.admissions && !PATHS.edstays) {
  console.error('No se encontro admissions.csv ni edstays.csv bajo la carpeta indicada.')
  process.exit(2)
}

/**
 * Capitulos diagnosticos usados como cohortes. `route` describe el recorrido
 * base; las probabilidades reales se calculan despues con los datos.
 */
const CHAPTERS = [
  { id: 'infecciosas', label: 'Infecciosas', code: 'INF', color: '#33b578', route: 'medical' },
  { id: 'neoplasias', label: 'Neoplasias', code: 'ONC', color: '#4730c4', route: 'medical' },
  { id: 'sangre', label: 'Sangre e inmunidad', code: 'HEM', color: '#8fb8de', route: 'medical' },
  { id: 'endocrino', label: 'Endocrino y metabolico', code: 'END', color: '#f5ab38', route: 'medical' },
  { id: 'mental', label: 'Salud mental', code: 'PSQ', color: '#7c6bb0', route: 'mental' },
  { id: 'nervioso', label: 'Sistema nervioso', code: 'NEU', color: '#386ba6', route: 'medical' },
  { id: 'sentidos', label: 'Ojo y oido', code: 'ORL', color: '#7cdadf', route: 'ambulatory' },
  { id: 'circulatorio', label: 'Circulatorio', code: 'CIR', color: '#ed7369', route: 'medical' },
  { id: 'respiratorio', label: 'Respiratorio', code: 'RES', color: '#01b7c1', route: 'medical' },
  { id: 'digestivo', label: 'Digestivo', code: 'DIG', color: '#fbc344', route: 'medical' },
  { id: 'piel', label: 'Piel y tejido', code: 'DER', color: '#f5bdb0', route: 'ambulatory' },
  { id: 'musculoesqueletico', label: 'Musculoesqueletico', code: 'MSK', color: '#b8ebad', route: 'surgical' },
  { id: 'genitourinario', label: 'Genitourinario', code: 'NEF', color: '#4accd3', route: 'medical' },
  { id: 'obstetricia', label: 'Obstetricia', code: 'OBS', color: '#f18e7f', route: 'obstetric' },
  { id: 'perinatal', label: 'Perinatal', code: 'NEO', color: '#fad67d', route: 'neonatal' },
  { id: 'congenito', label: 'Congenito', code: 'CON', color: '#b8ebad', route: 'medical' },
  { id: 'sintomas', label: 'Sintomas mal definidos', code: 'SIN', color: '#5d7186', route: 'medical' },
  { id: 'trauma', label: 'Trauma e intoxicaciones', code: 'TRA', color: '#ed7369', route: 'trauma' },
  { id: 'otros', label: 'Otros motivos', code: 'OTR', color: '#afc6c3', route: 'ambulatory' },
]

const CHAPTER_BY_ID = new Map(CHAPTERS.map((chapter) => [chapter.id, chapter]))

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})

async function main() {
  const admissions = new Map()
  let edOnly = 0

  if (PATHS.admissions) {
    await readCsv(PATHS.admissions, (row) => {
      const hadmId = row.hadm_id
      if (!hadmId) return
      admissions.set(hadmId, {
        hadmId,
        admissionType: (row.admission_type ?? '').toUpperCase(),
        admissionLocation: (row.admission_location ?? '').toUpperCase(),
        dischargeLocation: (row.discharge_location ?? '').toUpperCase(),
        expired: row.hospital_expire_flag === '1',
        lengthOfStayHours: hoursBetween(row.admittime, row.dischtime),
        arrivalHour: hourOf(row.admittime),
        arrivalDay: dayOf(row.admittime),
        chapter: null,
        transport: null,
        acuity: null,
        icu: false,
        icuLosDays: null,
        surgery: false,
        imaging: false,
        lab: null,
      })
    })
  }

  // Diagnostico principal (seq_num = 1) por ingreso.
  if (PATHS.diagnoses) {
    await readCsv(PATHS.diagnoses, (row) => {
      if (row.seq_num !== '1') return
      const record = admissions.get(row.hadm_id)
      if (!record) return
      record.chapter = chapterForIcd(row.icd_code, row.icd_version)
    })
  }

  if (PATHS.procedures) {
    await readCsv(PATHS.procedures, (row) => {
      const record = admissions.get(row.hadm_id)
      if (!record) return
      if (isImagingProcedure(row.icd_code, row.icd_version)) record.imaging = true
      else if (isSurgicalProcedure(row.icd_code, row.icd_version)) record.surgery = true
    })
  }

  if (PATHS.icustays) {
    await readCsv(PATHS.icustays, (row) => {
      const record = admissions.get(row.hadm_id)
      if (!record) return
      record.icu = true
      const los = Number.parseFloat(row.los ?? '')
      if (Number.isFinite(los)) record.icuLosDays = Math.max(record.icuLosDays ?? 0, los)
    })
  }

  const edArrivalHours = new Array(24).fill(0)
  if (PATHS.edstays) {
    await readCsv(PATHS.edstays, (row) => {
      const hour = hourOf(row.intime)
      if (hour !== null) edArrivalHours[hour] += 1
      const transport = (row.arrival_transport ?? '').toUpperCase()
      if (row.hadm_id && admissions.has(row.hadm_id)) {
        const record = admissions.get(row.hadm_id)
        record.transport = transport
        record.stayId = row.stay_id
        return
      }
      // Episodios de urgencias que no acaban en ingreso: cuentan como demanda.
      edOnly += 1
      admissions.set(`ed-${row.stay_id}`, {
        hadmId: null,
        stayId: row.stay_id,
        admissionType: 'ED ONLY',
        admissionLocation: 'EMERGENCY ROOM',
        dischargeLocation: (row.disposition ?? '').toUpperCase(),
        expired: false,
        lengthOfStayHours: hoursBetween(row.intime, row.outtime),
        arrivalHour: hour,
        arrivalDay: dayOf(row.intime),
        chapter: null,
        transport,
        acuity: null,
        icu: false,
        icuLosDays: null,
        surgery: false,
        imaging: false,
        lab: null,
      })
    })
  }

  if (PATHS.triage) {
    const byStay = new Map()
    for (const record of admissions.values()) {
      if (record.stayId) byStay.set(record.stayId, record)
    }
    await readCsv(PATHS.triage, (row) => {
      const record = byStay.get(row.stay_id)
      if (!record) return
      const acuity = Number.parseFloat(row.acuity ?? '')
      if (Number.isFinite(acuity)) record.acuity = acuity
    })
  }

  if (options.labs && PATHS.labs) {
    const seen = new Set()
    await readCsv(PATHS.labs, (row) => {
      if (!row.hadm_id || seen.has(row.hadm_id)) return
      seen.add(row.hadm_id)
      const record = admissions.get(row.hadm_id)
      if (record) record.lab = true
    })
    for (const record of admissions.values()) {
      if (record.lab === null) record.lab = false
    }
  }

  const records = [...admissions.values()]
  if (records.length === 0) {
    console.error('No se pudo construir ningun episodio a partir de los CSV indicados.')
    process.exit(1)
  }

  const cohorts = buildCohorts(records)
  const kept = cohorts
    .filter((cohort) => cohort.count >= options.min)
    .slice(0, options.top)
  if (kept.length === 0) {
    console.error(`Ninguna cohorte alcanza el minimo de ${options.min} episodios.`)
    process.exit(1)
  }

  const totalKept = kept.reduce((sum, cohort) => sum + cohort.count, 0)
  const meta = {
    source: options.label ?? `MIMIC-IV (${basename(options.input)})`,
    generatedAt: new Date().toISOString(),
    patients: records.length,
    notes: buildAssumptionNotes(edOnly),
  }
  const yaml = renderYaml(meta, kept, totalKept)
  writeFileSync(options.out, yaml)

  const stats = {
    meta,
    episodes: records.length,
    edOnlyEpisodes: edOnly,
    suggestedArrivalsPerHour: suggestedArrivalsPerHour(records),
    arrivalProfileByHour: edArrivalHours,
    cohorts: kept.map((cohort) => ({
      id: cohort.id,
      label: cohort.label,
      count: cohort.count,
      sharePercent: Math.round((cohort.count / totalKept) * 1000) / 10,
      stream: cohort.stream,
      severity: cohort.severity,
      probabilities: cohort.probabilities,
      medianLengthOfStayHours: cohort.medianLosHours,
      medianIcuLosDays: cohort.medianIcuLosDays,
    })),
    discarded: cohorts.filter((cohort) => !kept.includes(cohort)).map((cohort) => ({ id: cohort.id, count: cohort.count })),
  }
  if (options.stats) writeFileSync(options.stats, `${JSON.stringify(stats, null, 2)}\n`)

  console.log(`Episodios procesados: ${records.length} (${edOnly} solo urgencias)`)
  console.log(`Cohortes escritas: ${kept.length} -> ${options.out}`)
  kept.forEach((cohort) => {
    const share = ((cohort.count / totalKept) * 100).toFixed(1)
    console.log(`  ${cohort.id.padEnd(20)} ${String(cohort.count).padStart(6)} episodios  ${share.padStart(5)}%  ${cohort.stream}/${cohort.severity}`)
  })
  console.log(`Llegadas/h sugeridas: ${stats.suggestedArrivalsPerHour}`)
  if (options.stats) console.log(`Detalle: ${options.stats}`)
}

function buildCohorts(records) {
  const groups = new Map()
  records.forEach((record) => {
    const chapterId = record.chapter ?? 'otros'
    const group = groups.get(chapterId) ?? []
    group.push(record)
    groups.set(chapterId, group)
  })

  return [...groups.entries()]
    .map(([chapterId, group]) => {
      const chapter = CHAPTER_BY_ID.get(chapterId) ?? CHAPTER_BY_ID.get('otros')
      const count = group.length
      const ambulance = group.filter((item) => item.transport === 'AMBULANCE').length
      const walkIn = group.filter((item) => item.transport && item.transport !== 'AMBULANCE').length
      const elective = group.filter((item) => item.admissionType.includes('ELECTIVE') || item.admissionType.includes('SURGICAL SAME DAY')).length
      const observation = group.filter((item) => item.admissionType.includes('OBSERVATION') || item.admissionType === 'ED ONLY').length
      const icu = group.filter((item) => item.icu).length
      const surgery = group.filter((item) => item.surgery).length
      const imaging = group.filter((item) => item.imaging).length
      const labMeasured = group.filter((item) => item.lab !== null)
      const lab = labMeasured.length > 0
        ? labMeasured.filter((item) => item.lab).length / labMeasured.length
        : null
      const admitted = group.filter((item) => item.hadmId).length
      const acuityValues = group.map((item) => item.acuity).filter((value) => Number.isFinite(value))

      return {
        ...chapter,
        chapterId,
        count,
        stream: dominantStream({ ambulance, walkIn, elective, observation, count }),
        severity: severityFor({ acuityValues, icu, count, expired: group.filter((item) => item.expired).length }),
        probabilities: {
          lab: lab ?? assumedLabProbability(chapter.route),
          labMeasured: lab !== null,
          imaging: ratio(imaging, count),
          surgery: ratio(surgery, count),
          icu: ratio(icu, count),
          admission: ratio(admitted, count),
        },
        medianLosHours: median(group.map((item) => item.lengthOfStayHours).filter((value) => Number.isFinite(value))),
        medianIcuLosDays: median(group.map((item) => item.icuLosDays).filter((value) => Number.isFinite(value))),
      }
    })
    .sort((a, b) => b.count - a.count)
}

function dominantStream({ ambulance, walkIn, elective, observation, count }) {
  const options = [
    ['ed_ambulance', ambulance],
    ['ed_walkin', walkIn + observation],
    ['elective', elective],
  ].sort((a, b) => b[1] - a[1])
  if (options[0][1] === 0) return count > 0 ? 'ed_walkin' : 'outpatient'
  return options[0][0]
}

function severityFor({ acuityValues, icu, count, expired }) {
  if (acuityValues.length > 0) {
    const meanAcuity = acuityValues.reduce((sum, value) => sum + value, 0) / acuityValues.length
    if (meanAcuity <= 1.6) return 'critical'
    if (meanAcuity <= 2.4) return 'high'
    if (meanAcuity <= 3.4) return 'medium'
    return 'low'
  }
  const icuShare = ratio(icu, count)
  const mortality = ratio(expired, count)
  if (icuShare > 0.5 || mortality > 0.15) return 'critical'
  if (icuShare > 0.25 || mortality > 0.06) return 'high'
  if (icuShare > 0.08) return 'medium'
  return 'low'
}

/** Construye el YAML de casos que ya entiende el motor de simulacion. */
function renderYaml(meta, cohorts, totalKept) {
  const lines = []
  lines.push('meta:')
  lines.push(`  source: ${quote(meta.source)}`)
  lines.push(`  generatedAt: ${quote(meta.generatedAt)}`)
  lines.push(`  patients: ${meta.patients}`)
  lines.push(`  notes: ${quote(meta.notes)}`)
  lines.push('cases:')

  cohorts.forEach((cohort) => {
    const weight = Math.max(0.1, Math.round((cohort.count / totalKept) * 1000) / 10)
    lines.push(`  - id: mimic_${cohort.id}`)
    lines.push(`    label: ${quote(`${cohort.label} (MIMIC)`)}`)
    lines.push(`    code: ${cohort.code}`)
    lines.push(`    stream: ${cohort.stream}`)
    lines.push(`    severity: ${cohort.severity}`)
    lines.push(`    color: ${quote(cohort.color)}`)
    lines.push(`    weight: ${weight}`)
    lines.push(`    steps:`)
    stepsForCohort(cohort).forEach((step) => lines.push(`      ${step}`))
  })

  return `${lines.join('\n')}\n`
}

/**
 * Recorrido de la cohorte. Entrada y triaje segun el flujo dominante, y despues
 * pruebas y destino con las probabilidades observadas en los datos.
 */
function stepsForCohort(cohort) {
  const steps = []
  const p = cohort.probabilities

  if (cohort.stream === 'ed_ambulance') {
    steps.push('- arrival_ambulance')
    steps.push(`- { node: resus, chance: ${round2(Math.min(0.95, p.icu + 0.1))} }`)
    steps.push('- triage')
  } else if (cohort.stream === 'elective') {
    steps.push('- arrival_public')
    steps.push('- registration')
  } else {
    steps.push('- arrival_public')
    steps.push('- registration')
    steps.push('- triage')
  }

  if (cohort.route === 'obstetric') {
    steps.push('- { node: maternity, phase: Parto y puerperio }')
  } else if (cohort.route === 'neonatal') {
    steps.push('- { node: neonatal_icu, phase: Cuidados neonatales }')
  } else if (cohort.route === 'mental') {
    steps.push('- { node: consult, phase: Valoracion psiquiatrica }')
  } else if (cohort.route === 'ambulatory') {
    steps.push('- { node: consult, phase: Consulta }')
  } else {
    steps.push('- ed_bay')
  }

  if (p.lab > 0.02) steps.push(`- { node: lab, chance: ${round2(p.lab)} }`)
  if (p.imaging > 0.02) steps.push(`- { node: imaging, chance: ${round2(p.imaging)} }`)
  if (p.surgery > 0.02) {
    steps.push(`- chance: ${round2(p.surgery)}`)
    steps.push('  steps:')
    steps.push('    - { node: or, phase: Intervencion }')
    steps.push('    - { node: pacu, phase: Reanimacion postoperatoria }')
  }

  const icuWeight = Math.max(0, p.icu)
  const wardWeight = Math.max(0, p.admission - p.icu)
  const homeWeight = Math.max(0.02, 1 - p.admission)
  steps.push('- choose:')
  steps.push(`    - { weight: ${round2(icuWeight)}, steps: [{ node: icu, phase: Ingreso critico }] }`)
  steps.push(`    - { weight: ${round2(wardWeight)}, steps: [{ node: ward, phase: Ingreso planta }] }`)
  steps.push(`    - { weight: ${round2(homeWeight)}, steps: [{ node: pharmacy, phase: Alta con tratamiento }] }`)

  return steps
}

function buildAssumptionNotes(edOnly) {
  const parts = [
    'Pesos por frecuencia de capitulo diagnostico principal.',
    'Probabilidades de UCI, imagen y quirofano medidas sobre los CSV.',
  ]
  parts.push(options.labs
    ? 'Probabilidad de analitica medida en labevents.'
    : 'Probabilidad de analitica estimada por tipo de recorrido (sin --labs).')
  if (edOnly > 0) parts.push(`${edOnly} episodios de urgencias sin ingreso incluidos como demanda.`)
  parts.push('Los tiempos de servicio siguen siendo los del motor, no los de la base de datos.')
  return parts.join(' ')
}

/** Sin --labs no hay dato: se usa un supuesto explicito por tipo de recorrido. */
function assumedLabProbability(route) {
  if (route === 'medical' || route === 'trauma') return 0.85
  if (route === 'obstetric' || route === 'neonatal') return 0.6
  if (route === 'mental') return 0.4
  return 0.3
}

function suggestedArrivalsPerHour(records) {
  const hours = records.map((record) => record.arrivalHour).filter((value) => value !== null)
  if (hours.length === 0) return 9
  const days = new Set(records.map((record) => record.arrivalDay).filter(Boolean))
  const spanDays = days.size > 0 ? days.size : Math.max(1, Math.round(hours.length / 24))
  return Math.max(1, Math.round(hours.length / (spanDays * 24)))
}

function chapterForIcd(code, version) {
  const value = (code ?? '').trim().toUpperCase()
  if (!value) return null
  if (version === '9') return chapterForIcd9(value)
  return chapterForIcd10(value)
}

function chapterForIcd10(code) {
  const letter = code[0]
  const numeric = Number.parseInt(code.slice(1, 3), 10)
  if (letter === 'A' || letter === 'B') return 'infecciosas'
  if (letter === 'C') return 'neoplasias'
  if (letter === 'D') return Number.isFinite(numeric) && numeric < 50 ? 'neoplasias' : 'sangre'
  if (letter === 'E') return 'endocrino'
  if (letter === 'F') return 'mental'
  if (letter === 'G') return 'nervioso'
  if (letter === 'H') return 'sentidos'
  if (letter === 'I') return 'circulatorio'
  if (letter === 'J') return 'respiratorio'
  if (letter === 'K') return 'digestivo'
  if (letter === 'L') return 'piel'
  if (letter === 'M') return 'musculoesqueletico'
  if (letter === 'N') return 'genitourinario'
  if (letter === 'O') return 'obstetricia'
  if (letter === 'P') return 'perinatal'
  if (letter === 'Q') return 'congenito'
  if (letter === 'R') return 'sintomas'
  if (letter === 'S' || letter === 'T') return 'trauma'
  return 'otros'
}

function chapterForIcd9(code) {
  if (code.startsWith('V') || code.startsWith('E')) return 'otros'
  const numeric = Number.parseInt(code.slice(0, 3), 10)
  if (!Number.isFinite(numeric)) return 'otros'
  if (numeric <= 139) return 'infecciosas'
  if (numeric <= 239) return 'neoplasias'
  if (numeric <= 279) return 'endocrino'
  if (numeric <= 289) return 'sangre'
  if (numeric <= 319) return 'mental'
  if (numeric <= 389) return numeric >= 360 ? 'sentidos' : 'nervioso'
  if (numeric <= 459) return 'circulatorio'
  if (numeric <= 519) return 'respiratorio'
  if (numeric <= 579) return 'digestivo'
  if (numeric <= 629) return 'genitourinario'
  if (numeric <= 679) return 'obstetricia'
  if (numeric <= 709) return 'piel'
  if (numeric <= 739) return 'musculoesqueletico'
  if (numeric <= 759) return 'congenito'
  if (numeric <= 779) return 'perinatal'
  if (numeric <= 799) return 'sintomas'
  if (numeric <= 999) return 'trauma'
  return 'otros'
}

/** ICD-10-PCS: la seccion B es imagen. ICD-9-CM: 87-88 son radiologia. */
function isImagingProcedure(code, version) {
  const value = (code ?? '').trim().toUpperCase()
  if (!value) return false
  if (version === '9') {
    const numeric = Number.parseInt(value.slice(0, 2), 10)
    return numeric === 87 || numeric === 88
  }
  return value.startsWith('B')
}

/** Secciones 0 (medico-quirurgica) en PCS y 01-86 en ICD-9-CM. */
function isSurgicalProcedure(code, version) {
  const value = (code ?? '').trim().toUpperCase()
  if (!value) return false
  if (version === '9') {
    const numeric = Number.parseInt(value.slice(0, 2), 10)
    return Number.isFinite(numeric) && numeric >= 1 && numeric <= 86
  }
  return value.startsWith('0')
}

async function readCsv(path, onRow) {
  const stream = path.endsWith('.gz')
    ? createReadStream(path).pipe(createGunzip())
    : createReadStream(path)
  const reader = createInterface({ input: stream, crlfDelay: Infinity })
  let header = null
  for await (const line of reader) {
    if (!line) continue
    const cells = parseCsvLine(line)
    if (!header) {
      header = cells.map((cell) => cell.trim().toLowerCase())
      continue
    }
    const row = {}
    header.forEach((key, index) => {
      row[key] = cells[index] ?? ''
    })
    onRow(row)
  }
}

function parseCsvLine(line) {
  const cells = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        current += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ',') {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  return cells
}

function resolveTable(root, name, subdirs) {
  const candidates = []
  subdirs.forEach((dir) => {
    candidates.push(join(root, dir, `${name}.csv`))
    candidates.push(join(root, dir, `${name}.csv.gz`))
  })
  candidates.push(join(root, `${name}.csv`))
  candidates.push(join(root, `${name}.csv.gz`))
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function parseArgs(argv) {
  const parsed = { out: 'casos-mimic.yaml', top: 8, min: 5, labs: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--labs') parsed.labs = true
    else if (arg === '--input') parsed.input = argv[++i]
    else if (arg === '--out') parsed.out = argv[++i]
    else if (arg === '--stats') parsed.stats = argv[++i]
    else if (arg === '--label') parsed.label = argv[++i]
    else if (arg === '--top') parsed.top = Math.max(1, Number.parseInt(argv[++i], 10) || 8)
    else if (arg === '--min') parsed.min = Math.max(1, Number.parseInt(argv[++i], 10) || 5)
  }
  return parsed
}

function hoursBetween(from, to) {
  const start = Date.parse((from ?? '').replace(' ', 'T'))
  const end = Date.parse((to ?? '').replace(' ', 'T'))
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.max(0, (end - start) / 3600000)
}

function dayOf(value) {
  const text = String(value ?? "")
  return text.length >= 10 ? text.slice(0, 10) : null
}

function hourOf(value) {
  const parsed = Date.parse((value ?? '').replace(' ', 'T'))
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).getUTCHours()
}

function ratio(part, total) {
  if (!total) return 0
  return Math.round((part / total) * 1000) / 1000
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const value = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
  return Math.round(value * 100) / 100
}

function round2(value) {
  return Math.round(Math.max(0, value) * 100) / 100
}

function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}
