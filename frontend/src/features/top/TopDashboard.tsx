import { useState } from 'react'
import { Metric } from '../../components/ui/Metric'
import { Modal } from '../../components/ui/Modal'
import { bestProposalByOwner, formatScore } from './scoring'
import type { ArchitectureProposal, ArchitectureScore, ProposalOwner } from './types'

export function TopPanel({ proposals }: { proposals: ArchitectureProposal[] }) {
  const [detailProposalId, setDetailProposalId] = useState<string | undefined>()
  const [isScoreModalOpen, setScoreModalOpen] = useState(false)
  const userRows = bestProposalByOwner(proposals).slice(0, 5)
  const best = proposals[0]
  const detailProposal = proposals.find((proposal) => proposal.id === detailProposalId)

  return (
    <div className="top-panel">
      <section className="top-hero">
        <div className="top-hero-main">
          <span>Ranking por simulación</span>
          <h2>{best ? `${best.owner} · ${formatScore(best.score.value)}` : 'Sin propuestas'}</h2>
          <div className="top-hero-actions">
            <button type="button" className="ghost-action" onClick={() => setScoreModalOpen(true)}>Ver formula</button>
            {best && <button type="button" className="ghost-action" onClick={() => setDetailProposalId(best.id)}>Detalle lider</button>}
          </div>
        </div>
        <div className="top-kpis">
          <Metric label="Score" value={best ? formatScore(best.score.value) : '-'} />
          <Metric label="Propuestas" value={String(proposals.length)} />
          <Metric label="Bloqueados" value={String(best?.blocked ?? 0)} />
          <Metric label="ED P90" value={best ? `${best.edP90} min` : '-'} />
        </div>
      </section>

      <div className="top-grid top-grid-compact">
        <section className="top-block wide">
          <h3>Arquitecturas</h3>
          <div className="proposal-list">
            {proposals.map((proposal, index) => (
              <article key={proposal.id} className="proposal-card is-compact">
                <header>
                  <span>#{index + 1}</span>
                  <div>
                    <h4>{proposal.title}</h4>
                    <p>{proposal.owner} · {proposal.createdAt}</p>
                  </div>
                  <strong>{formatScore(proposal.score.value)}</strong>
                </header>
                <div className="score-track" aria-hidden="true">
                  <span style={{ width: `${proposal.score.value}%` }} />
                </div>
                <div className="proposal-chips">
                  <span>ED {proposal.edP90}m</span>
                  <span>{proposal.blocked} bloqueados</span>
                  <span>{proposal.verticalMoves} verticales</span>
                  <button type="button" onClick={() => setDetailProposalId(proposal.id)}>Ver detalle</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="top-block">
          <h3>Usuarios</h3>
          <div className="leaderboard-list">
            {userRows.map((proposal, index) => (
              <article key={proposal.owner} className="leaderboard-row">
                <strong>{index + 1}</strong>
                <div>
                  <h4>{proposal.owner}</h4>
                  <span>{proposal.title}</span>
                </div>
                <b>{formatScore(proposal.score.value)}</b>
              </article>
            ))}
          </div>
        </section>

        <section className="top-block top-score-card">
          <h3>Modelo de decision</h3>
          <Metric label="Penaliza" value="Bloqueos" />
          <Metric label="Prioriza" value="Flujo" />
          <button type="button" className="secondary-action" onClick={() => setScoreModalOpen(true)}>Abrir desglose</button>
        </section>
      </div>

      {detailProposal && (
        <ProposalDetailModal proposal={detailProposal} onClose={() => setDetailProposalId(undefined)} />
      )}
      {isScoreModalOpen && (
        <ScoreFormulaModal proposal={best} onClose={() => setScoreModalOpen(false)} />
      )}
    </div>
  )
}

export function TopControls({
  owner,
  proposals,
  currentScore,
  onChangeOwner,
  onSubmit,
}: {
  owner: ProposalOwner
  proposals: ArchitectureProposal[]
  currentScore: ArchitectureScore
  onChangeOwner: (owner: ProposalOwner) => void
  onSubmit: () => void
}) {
  const submittedCount = proposals.filter((proposal) => proposal.source === 'submitted').length
  return (
    <>
      <section className="panel-section">
        <h2>Registrar propuesta</h2>
        <label>
          Autor
          <input value={owner} onChange={(event) => onChangeOwner(event.target.value)} placeholder="Nombre del autor o equipo" />
        </label>
        <Metric label="Score actual" value={formatScore(currentScore.value)} />
        <button type="button" className="primary-action" onClick={onSubmit}>Guardar arquitectura</button>
      </section>

      <section className="panel-section">
        <h2>Ranking</h2>
        <Metric label="Guardadas" value={String(submittedCount)} />
        <Metric label="Lider" value={proposals[0]?.owner ?? '-'} />
        <Metric label="Score" value={proposals[0] ? formatScore(proposals[0].score.value) : '-'} />
      </section>
    </>
  )
}

function ProposalDetailModal({ proposal, onClose }: { proposal: ArchitectureProposal; onClose: () => void }) {
  return (
    <Modal
      titleId="proposal-detail-title"
      title={proposal.title}
      subtitle={`${proposal.owner} · score ${formatScore(proposal.score.value)}`}
      onClose={onClose}
    >
      <div className="top-modal-grid">
        <Metric label="Completados" value={String(proposal.completed)} />
        <Metric label="Bloqueados" value={String(proposal.blocked)} />
        <Metric label="ED P90" value={`${proposal.edP90} min`} />
        <Metric label="Traslado" value={`${proposal.averageTravel} min`} />
        <Metric label="Cambios planta" value={String(proposal.verticalMoves)} />
        <Metric label="Reglas abiertas" value={String(proposal.ruleIssues)} />
        <Metric label="m2 modelados" value={formatInteger(proposal.modeledArea)} />
        <Metric label="Estancias" value={String(proposal.roomCount)} />
      </div>

      <section className="top-modal-section">
        <h3>Zona caliente</h3>
        <p>{proposal.hottestRoomName}</p>
      </section>
    </Modal>
  )
}

function ScoreFormulaModal({ proposal, onClose }: { proposal?: ArchitectureProposal; onClose: () => void }) {
  return (
    <Modal
      titleId="score-formula-title"
      title="Formula del score"
      subtitle="100 puntos menos penalizaciones operativas y arquitectónicas."
      onClose={onClose}
    >
      {proposal ? (
        <div className="score-penalty-list">
          <Penalty label="Bloqueos" value={proposal.score.blockedPenalty} />
          <Penalty label="Espera ED" value={proposal.score.waitPenalty} />
          <Penalty label="Traslado" value={proposal.score.travelPenalty} />
          <Penalty label="Vertical" value={proposal.score.verticalPenalty} />
          <Penalty label="Reglas" value={proposal.score.rulePenalty} />
          <Penalty label="m2" value={proposal.score.areaPenalty} />
        </div>
      ) : (
        <p className="modal-empty">Guarda una propuesta para ver su desglose.</p>
      )}
    </Modal>
  )
}

function Penalty({ label, value }: { label: string; value: number }) {
  return (
    <article className="penalty-row">
      <span>{label}</span>
      <strong>-{formatScore(value)}</strong>
    </article>
  )
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('es-ES').format(Math.round(value))
}
