import clinicLogoUrl from '../assets/clinic-barcelona-logo.svg'
import { Metric } from './ui/Metric'

interface AppHeaderProps {
  planName: string
  targetAreaSqm: number
  modeledAreaSqm: number
  floorCount: number
  roomCount: number
}

export function AppHeader({ planName, targetAreaSqm, modeledAreaSqm, floorCount, roomCount }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="brand-title">
        <img src={clinicLogoUrl} alt="Clinic Barcelona" className="brand-logo" />
        <div className="brand-copy">
          <h1>{planName}</h1>
        </div>
      </div>
      <div className="header-metrics" aria-label="Resumen del programa funcional">
        <Metric label="m2 objetivo" value={formatHeaderNumber(targetAreaSqm)} />
        <Metric label="m2 modelados" value={formatHeaderNumber(modeledAreaSqm)} />
        <Metric label="Plantas" value={String(floorCount)} />
        <Metric label="Estancias" value={String(roomCount)} />
      </div>
    </header>
  )
}

function formatHeaderNumber(value: number) {
  return new Intl.NumberFormat('es-ES').format(Math.round(value))
}
