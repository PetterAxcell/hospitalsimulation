export type ProposalOwner = string

export interface ArchitectureScore {
  value: number
  blockedPenalty: number
  waitPenalty: number
  travelPenalty: number
  verticalPenalty: number
  rulePenalty: number
  areaPenalty: number
}

export interface ArchitectureProposal {
  id: string
  owner: ProposalOwner
  title: string
  score: ArchitectureScore
  completed: number
  blocked: number
  edP90: number
  averageTravel: number
  verticalMoves: number
  ruleIssues: number
  modeledArea: number
  roomCount: number
  hottestRoomName: string
  createdAt: string
  source: 'demo' | 'submitted'
}
