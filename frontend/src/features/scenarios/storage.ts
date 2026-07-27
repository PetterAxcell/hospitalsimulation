import { EMPTY_SCENARIO_LIBRARY, type Scenario, type ScenarioLibrary, type ScenarioRun } from './types'

const STORAGE_KEY = 'simlab.scenarios.v1'

/** Tope de escenarios guardados: cada uno arrastra un plano completo. */
export const MAX_SCENARIOS = 12

export function loadScenarioLibrary(): ScenarioLibrary {
  if (typeof localStorage === 'undefined') return EMPTY_SCENARIO_LIBRARY
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_SCENARIO_LIBRARY
    const parsed = JSON.parse(raw) as Partial<ScenarioLibrary>
    const scenarios = (Array.isArray(parsed.scenarios) ? parsed.scenarios.filter(isScenario) : [])
      // Un escenario heredado puede no traer adyacencias: se normaliza a lista vacia.
      .map((scenario) => (Array.isArray(scenario.adjacencyRules) ? scenario : { ...scenario, adjacencyRules: [] }))
    // Solo conservamos runs con forma valida: un run corrupto (sin score numerico)
    // romperia el ranking y el render de KPIs.
    const runs: Record<string, ScenarioRun> = {}
    if (parsed.runs && typeof parsed.runs === 'object') {
      for (const [id, run] of Object.entries(parsed.runs as Record<string, unknown>)) {
        if (isScenarioRun(run)) runs[id] = run
      }
    }
    return { scenarios, runs }
  } catch {
    // Un guardado corrupto no debe impedir arrancar la app.
    return EMPTY_SCENARIO_LIBRARY
  }
}

export function saveScenarioLibrary(library: ScenarioLibrary): { ok: true } | { ok: false; message: string } {
  if (typeof localStorage === 'undefined') return { ok: false, message: 'Este navegador no permite guardar escenarios.' }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(library))
    return { ok: true }
  } catch (error) {
    const quotaExceeded = error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)
    return {
      ok: false,
      message: quotaExceeded
        ? 'No cabe otro escenario en el almacenamiento local. Borra alguno antes de guardar.'
        : 'No se pudo guardar el escenario en este navegador.',
    }
  }
}

function isScenario(value: unknown): value is Scenario {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Scenario>
  return typeof candidate.id === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.caseSource === 'string'
    && Boolean(candidate.plan)
    && Array.isArray(candidate.plan?.rooms)
    && Boolean(candidate.settings)
}

function isScenarioRun(value: unknown): value is ScenarioRun {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ScenarioRun>
  return typeof candidate.scenarioId === 'string'
    && typeof candidate.signature === 'string'
    && Boolean(candidate.score)
    && typeof candidate.score?.value === 'number'
}
