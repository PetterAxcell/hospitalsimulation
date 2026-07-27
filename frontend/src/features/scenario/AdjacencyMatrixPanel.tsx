import { useMemo } from 'react'
import { Metric } from '../../components/ui/Metric'
import { KIND_LABELS } from '../../data/catalog'
import {
  KIND_ORDER,
  adjacencyComplies,
  findRule,
  labelForRule,
  summarizeAdjacency,
  type AdjacencyRule,
  type AdjacencyRuleResult,
  type AdjacencyStatus,
} from '../../engine/adjacencyMatrix'
import type { RoomKind } from '../../types'

const SHORT_KIND_LABELS: Record<RoomKind, string> = {
  public: 'Púb',
  waiting: 'Esp',
  emergency: 'Urg',
  diagnostic: 'Diag',
  surgery: 'Quir',
  critical: 'Crít',
  inpatient: 'Hosp',
  ambulatory: 'Amb',
  maternalChild: 'M-I',
  oncology: 'Onc',
  pharmacy: 'Farm',
  laboratory: 'Lab',
  logistics: 'Log',
  research: 'Inv',
  staff: 'Pers',
  technical: 'Téc',
  vertical: 'Asc',
  circulation: 'Pas',
  green: 'Pat',
  future: 'Exp',
}

const STATUS_LABELS: Record<AdjacencyStatus, string> = {
  ok: 'Cumple',
  warn: 'Cumple',
  fail: 'No cumple',
  missing: 'No cumple · falta bloque',
}

interface AdjacencyMatrixPanelProps {
  rules: AdjacencyRule[]
  results: AdjacencyRuleResult[]
  onCycle: (a: RoomKind, b: RoomKind) => void
  onReset: () => void
  onClear: () => void
}

export function AdjacencyMatrixPanel({ rules, results, onCycle, onReset, onClear }: AdjacencyMatrixPanelProps) {
  const summary = useMemo(() => summarizeAdjacency(results), [results])
  const complies = summary.ok + summary.warn
  const noComplies = summary.fail + summary.missing
  const resultById = useMemo(() => new Map(results.map((result) => [result.id, result])), [results])
  const activeResults = useMemo(
    () => [...results].sort((a, b) => statusWeight(b.status) - statusWeight(a.status)),
    [results],
  )

  return (
    <div className="adjacency-panel">
      <section className="adjacency-hero">
        <div>
          <span>Matriz de adyacencia</span>
          <h2>Reglas de proximidad por servicio</h2>
          <p>Haz clic en una celda para ciclar: sin regla → cerca → lejos. El análisis comprueba si el plano las cumple.</p>
        </div>
        <div className="adjacency-kpis">
          <Metric label="Reglas" value={String(summary.total)} />
          <Metric label="Cumplen" value={String(complies)} />
          <Metric label="No cumplen" value={String(noComplies)} />
        </div>
      </section>

      <section className="adjacency-toolbar">
        <div className="adjacency-legend">
          <span className="adjacency-legend-item"><i className="adj-swatch near" /> Cerca</span>
          <span className="adjacency-legend-item"><i className="adj-swatch far" /> Lejos</span>
          <span className="adjacency-legend-item"><i className="adj-swatch ok" /> Cumple</span>
          <span className="adjacency-legend-item"><i className="adj-swatch fail" /> No cumple</span>
        </div>
        <div className="adjacency-toolbar-actions">
          <button type="button" className="secondary-action" onClick={onReset}>Reglas por defecto</button>
          <button type="button" className="secondary-action" onClick={onClear}>Vaciar</button>
        </div>
      </section>

      <section className="adjacency-matrix-card">
        <div className="adjacency-matrix-wrap">
          <table className="adjacency-matrix">
            <thead>
              <tr>
                <th className="adjacency-corner" scope="col">Servicio</th>
                {KIND_ORDER.map((kind) => (
                  <th key={kind} scope="col" title={KIND_LABELS[kind]}>
                    <span className="adjacency-col-label">{SHORT_KIND_LABELS[kind]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {KIND_ORDER.map((rowKind) => (
                <tr key={rowKind}>
                  <th scope="row" title={KIND_LABELS[rowKind]}>{KIND_LABELS[rowKind]}</th>
                  {KIND_ORDER.map((colKind) => {
                    if (rowKind === colKind) {
                      return <td key={colKind} className="adjacency-cell diagonal" aria-hidden="true" />
                    }
                    const rule = findRule(rules, rowKind, colKind)
                    const result = rule ? resultById.get(rule.id) : undefined
                    const desire = rule?.desire
                    const cellState = result ? (adjacencyComplies(result.status) ? 'meets' : 'breaks') : ''
                    const symbol = desire === 'near' ? '●' : desire === 'far' ? '✕' : ''
                    const cellTitle = rule
                      ? `${labelForRule(rule)}${result ? ` · ${STATUS_LABELS[result.status]}` : ''}`
                      : `Definir regla ${KIND_LABELS[rowKind]} / ${KIND_LABELS[colKind]}`
                    return (
                      <td key={colKind} className="adjacency-cell">
                        <button
                          type="button"
                          className={`adjacency-dot ${desire ?? 'empty'} ${cellState}`}
                          onClick={() => onCycle(rowKind, colKind)}
                          title={cellTitle}
                          aria-label={cellTitle}
                        >
                          {symbol}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="adjacency-results-card">
        <div className="adjacency-results-head">
          <h3>Reglas activas</h3>
          <p>Estado de cada regla frente al plano actual.</p>
        </div>
        <div className="rule-list compact">
          {activeResults.length > 0 ? (
            activeResults.map((result) => {
              const ok = adjacencyComplies(result.status)
              return (
                <article key={result.id} className={`rule-item ${ok ? 'ok' : 'fail'}`}>
                  <strong>{result.label} · {ok ? 'Cumple' : 'No cumple'}</strong>
                  <span>{result.evidence}</span>
                </article>
              )
            })
          ) : (
            <article className="rule-item ok">
              <strong>Sin reglas definidas</strong>
              <span>Añade reglas haciendo clic en las celdas de la matriz.</span>
            </article>
          )}
        </div>
      </section>
    </div>
  )
}

function statusWeight(status: AdjacencyStatus): number {
  if (status === 'fail' || status === 'missing') return 3
  if (status === 'warn') return 2
  return 1
}
