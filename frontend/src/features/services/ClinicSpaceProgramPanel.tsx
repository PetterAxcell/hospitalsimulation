import { useMemo, useState } from 'react'
import { Metric } from '../../components/ui/Metric'
import { Modal } from '../../components/ui/Modal'
import { CLINIC_SPACE_PROGRAM_SOURCE } from '../../data/clinicSpaceProgram'
import { auditClinicSpaceProgram, type ClinicProgramAuditRow, type ClinicProgramAuditStatus } from '../../engine/clinicSpaceProgramAudit'
import type { HospitalPlan } from '../../types'
import { formatNumber } from '../../utils/format'

const STATUS_LABELS: Record<ClinicProgramAuditStatus, string> = {
  missing: 'Falta',
  weak: 'Debil',
  partial: 'Parcial',
  ok: 'Cubierto',
  broad: 'Agregado',
  config: 'Regla',
}

export function ClinicSpaceProgramPanel({ plan }: { plan: HospitalPlan }) {
  const audit = useMemo(() => auditClinicSpaceProgram(plan), [plan])
  const [selectedRow, setSelectedRow] = useState<ClinicProgramAuditRow | null>(null)
  const priorityRows = audit.rows
    .filter((row) => row.status === 'missing' || row.status === 'weak' || row.status === 'partial' || row.status === 'broad')
    .slice(0, 8)
  const coveredRows = audit.rows.filter((row) => row.status === 'ok' || row.status === 'config').length

  return (
    <div className="clinic-program-panel">
      <section className="clinic-program-hero">
        <div>
          <span>Sincronizacion Nou Clinic</span>
          <h2>Programa funcional desde PDF</h2>
          <p>
            {CLINIC_SPACE_PROGRAM_SOURCE.label} · {CLINIC_SPACE_PROGRAM_SOURCE.pageCount} paginas · sesion {CLINIC_SPACE_PROGRAM_SOURCE.date}
          </p>
        </div>
        <div className="clinic-program-kpis">
          <Metric label="m2 utiles extraidos" value={formatNumber(audit.extractedUsefulAreaSqm)} />
          <Metric label="m2 brutos objetivo" value={formatNumber(audit.targetGrossAreaSqm)} />
          <Metric label="Entradas PDF" value={String(audit.rows.length)} />
          <Metric label="Cubiertas/reglas" value={String(coveredRows)} />
        </div>
      </section>

      <section className="clinic-program-status-grid">
        <ProgramStatusCard label="Faltan" value={audit.missingCount} tone="fail" />
        <ProgramStatusCard label="Parciales" value={audit.weakCount} tone="warn" />
        <ProgramStatusCard label="Agregadas" value={audit.broadCount} tone="warn" />
        <ProgramStatusCard label="Configuracion" value={audit.configurationCount} tone="ok" />
      </section>

      <section className="clinic-program-table-card">
        <div className="clinic-program-table-head">
          <div>
            <h3>Prioridades de sincronizacion</h3>
            <p>Lo que conviene desagregar o crear antes de fiarnos de la simulacion.</p>
          </div>
        </div>
        <div className="clinic-program-list">
          {priorityRows.map((row) => (
            <button
              key={row.entry.id}
              type="button"
              className={`clinic-program-row ${row.status}`}
              onClick={() => setSelectedRow(row)}
            >
              <span className="clinic-program-status">{STATUS_LABELS[row.status]}</span>
              <strong>{row.entry.label}</strong>
              <span>{row.entry.sector} · paginas {row.entry.sourcePages.join(', ')}</span>
              <span>{row.evidence}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="clinic-program-table-card">
        <div className="clinic-program-table-head">
          <div>
            <h3>Programa completo</h3>
            <p>Auditoria trazable del PDF contra los bloques actuales.</p>
          </div>
        </div>
        <div className="clinic-program-table-wrap">
          <table className="clinic-program-table">
            <thead>
              <tr>
                <th>Entrada PDF</th>
                <th>Pag.</th>
                <th>Estado</th>
                <th>m2 util</th>
                <th>m2 bruto objetivo</th>
                <th>m2 modelado</th>
              </tr>
            </thead>
            <tbody>
              {audit.rows.map((row) => (
                <tr key={row.entry.id} onClick={() => setSelectedRow(row)}>
                  <td>{row.entry.label}</td>
                  <td>{row.entry.sourcePages.join(', ')}</td>
                  <td><span className={`status-pill ${row.status}`}>{STATUS_LABELS[row.status]}</span></td>
                  <td>{row.entry.usefulAreaSqm ? formatNumber(row.entry.usefulAreaSqm) : '-'}</td>
                  <td>{row.targetGrossAreaSqm ? formatNumber(row.targetGrossAreaSqm) : '-'}</td>
                  <td>{formatNumber(row.modeledAreaSqm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedRow && (
        <ClinicProgramDetailModal row={selectedRow} onClose={() => setSelectedRow(null)} />
      )}
    </div>
  )
}

function ProgramStatusCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'ok' | 'warn' | 'fail'
}) {
  return (
    <article className={`clinic-program-status-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function ClinicProgramDetailModal({ row, onClose }: { row: ClinicProgramAuditRow; onClose: () => void }) {
  return (
    <Modal
      titleId="clinic-program-detail-title"
      title={row.entry.label}
      subtitle={`${row.entry.sector} · paginas ${row.entry.sourcePages.join(', ')} · ${STATUS_LABELS[row.status]}`}
      className="section-modal"
      onClose={onClose}
    >
      <div className="clinic-program-detail">
        <section className="section-modal-card">
          <h3>Comparacion</h3>
          <div className="section-metric-grid">
            <Metric label="m2 util PDF" value={row.entry.usefulAreaSqm ? formatNumber(row.entry.usefulAreaSqm) : '-'} />
            <Metric label="m2 bruto objetivo" value={row.targetGrossAreaSqm ? formatNumber(row.targetGrossAreaSqm) : '-'} />
            <Metric label="m2 modelado" value={formatNumber(row.modeledAreaSqm)} />
            <Metric label="Capacidad" value={row.entry.expectedCapacity ? `${row.modeledCapacity}/${row.entry.expectedCapacity}` : String(row.modeledCapacity)} />
          </div>
          <p>{row.evidence}</p>
        </section>

        <section className="section-modal-card">
          <h3>Requisitos del PDF</h3>
          <div className="rule-list compact">
            {row.entry.requirements.map((requirement) => (
              <article key={requirement} className="rule-item ok">
                <strong>{requirement}</strong>
                <span>{row.entry.notes}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="section-modal-card">
          <h3>Bloques asociados</h3>
          <div className="rule-list compact">
            {row.matchedRooms.length > 0 ? (
              row.matchedRooms.slice(0, 10).map((room) => (
                <article key={room.id} className="rule-item ok">
                  <strong>{room.name}</strong>
                  <span>{formatNumber(room.areaSqm)} m2 · capacidad {room.capacity} · plantilla {room.templateId}</span>
                </article>
              ))
            ) : (
              <article className="rule-item fail">
                <strong>Sin bloque equivalente</strong>
                <span>Hace falta crear una plantilla o desagregar un bloque existente.</span>
              </article>
            )}
          </div>
        </section>
      </div>
    </Modal>
  )
}
