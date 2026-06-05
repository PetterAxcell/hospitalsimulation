export function formatNumber(value: number) {
  return new Intl.NumberFormat('es-ES').format(Math.round(value))
}

export function floorLabel(floor: number) {
  if (floor < 0) return `S${Math.abs(floor)}`
  if (floor === 0) return 'PB'
  return `P${floor}`
}
