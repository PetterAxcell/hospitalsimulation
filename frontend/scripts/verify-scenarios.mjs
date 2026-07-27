#!/usr/bin/env node
/**
 * Verificador headless de escenarios y de la importacion de mezcla clinica.
 *
 * Comprueba en un navegador real que: se puede guardar un escenario desde el
 * planificador, que aparece en el listado y en el ranking del Top, que se puede
 * relanzar y cargar, que sobrevive a recargar la pagina y que un YAML de casos
 * generado desde MIMIC se aplica a la simulacion.
 *
 * Uso: node scripts/verify-scenarios.mjs [url] [--cases <fichero.yaml>]
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  collectPageErrors,
  connect,
  createReport,
  evaluate,
  findPageTarget,
  launchChrome,
  printReport,
  screenshot,
  sleep,
} from './lib/cdp.mjs'

const args = process.argv.slice(2)
const url = args.find((arg) => arg.startsWith('http')) ?? 'http://localhost:5173/'
const casesIndex = args.indexOf('--cases')
const casesFile = casesIndex >= 0 ? resolve(args[casesIndex + 1]) : null
const PORT = 9334
const SHOTS = '/tmp/simlab-shots'

const report = createReport()
const ok = (message) => report.steps.push(`OK   ${message}`)
const fail = (message) => report.steps.push(`FAIL ${message}`)

const chrome = launchChrome({ port: PORT, profile: '/tmp/simlab-cdp-scenarios' })

try {
  const target = await findPageTarget(PORT)
  const cdp = connect(target.webSocketDebuggerUrl)
  await cdp.ready
  collectPageErrors(cdp, report)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('DOM.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 940, deviceScaleFactor: 1, mobile: false })

  // Se parte de un almacenamiento limpio para que el conteo sea predecible.
  await cdp.send('Page.navigate', { url })
  await sleep(2500)
  await evaluate(cdp, "localStorage.removeItem('simlab.scenarios.v1')")
  await cdp.send('Page.reload')
  await sleep(3000)

  await openTab(cdp, 'Escenario')
  await sleep(1500)
  const panelPresent = await evaluate(cdp, "Boolean(document.querySelector('.scenario-dashboard .scenario-panel'))")
  if (!panelPresent) fail('el panel de escenarios guardados no aparece en la pestana Escenario')
  else ok('biblioteca de escenarios visible en la pestana Escenario')

  await saveScenario(cdp, 'Base urgencias')
  const afterFirst = await scenarioCount(cdp)
  if (afterFirst !== 1) fail(`tras guardar hay ${afterFirst} escenarios, se esperaba 1`)
  else ok('primer escenario guardado')

  // Se cambia la demanda desde la propia pestana Escenario.
  const arrivalsChanged = await evaluate(cdp, `(() => {
    const input = document.querySelector('.scenario-params-grid input[type=range], .scenario-params-grid input[type=number]')
    if (!input) return false
    const max = Number(input.max || 60)
    const next = Math.min(max, Number(input.value || 9) + Math.max(2, Math.round(max * 0.25)))
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, String(next))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return next
  })()`)
  if (!arrivalsChanged) fail('no se pudo cambiar la demanda en la pestana Escenario')
  else ok(`demanda modificada a ${arrivalsChanged} llegadas/h`)
  await sleep(1500)

  await saveScenario(cdp, 'Mas demanda')
  const afterSecond = await scenarioCount(cdp)
  if (afterSecond !== 2) fail(`tras guardar hay ${afterSecond} escenarios, se esperaba 2`)
  else ok('segundo escenario guardado')

  // Listado: ranking, chips y acciones.
  await clickByText(cdp, '.scenario-panel button', 'Abrir escenarios')
  await sleep(800)
  const listInfo = await evaluate(cdp, `(() => {
    const rows = [...document.querySelectorAll('.scenario-row')]
    return {
      rows: rows.length,
      names: rows.map((row) => row.querySelector('h4')?.textContent ?? ''),
      scores: rows.map((row) => row.querySelector('header strong')?.textContent ?? ''),
      stale: rows.filter((row) => row.querySelector('.scenario-chip.is-stale')).length,
    }
  })()`)
  if (listInfo.rows !== 2) fail(`el modal muestra ${listInfo.rows} escenarios`)
  else ok(`modal con ${listInfo.rows} escenarios: ${listInfo.names.join(' | ')}`)
  if (listInfo.scores.some((score) => !score || score === '-')) fail(`hay escenarios sin score: ${JSON.stringify(listInfo.scores)}`)
  else ok(`scores calculados al guardar: ${listInfo.scores.join(' / ')}`)
  if (listInfo.stale !== 0) fail(`${listInfo.stale} escenarios quedaron sin relanzar tras guardarse`)
  else ok('ningun escenario queda pendiente tras guardarse')
  await screenshot(cdp, SHOTS, '20-escenarios-lista', report)

  await clickByText(cdp, '.scenario-row-actions button', 'Relanzar')
  await sleep(900)
  const relaunched = await evaluate(cdp, "document.querySelectorAll('.scenario-row .scenario-chip.is-stale').length")
  if (relaunched !== 0) fail('relanzar dejo escenarios pendientes')
  else ok('relanzado individual sin pendientes')

  await clickByText(cdp, '.scenario-row-actions button', 'Cargar')
  await sleep(1200)
  const activeRows = await evaluate(cdp, "document.querySelectorAll('.scenario-row.is-active').length")
  if (activeRows !== 1) fail(`cargar no marco el escenario activo (${activeRows})`)
  else ok('cargar marca el escenario activo')

  // Un escenario guardado esta congelado: editar el plano no debe alterarlo.
  const scoresBeforeEdit = await scenarioScores(cdp)
  await clickByText(cdp, '.script-modal-header button', 'Cerrar')
  await sleep(400)
  await openTab(cdp, 'Planificador')
  await sleep(1500)
  const roomsAdded = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.left-panel button')].find((item) => item.textContent.trim().startsWith('Añadir a planta'))
    if (!button) return false
    button.click()
    button.click()
    return true
  })()`)
  if (!roomsAdded) fail('no se pudo anadir un bloque al plano')
  await sleep(1500)
  await openTab(cdp, 'Escenario')
  await sleep(1500)
  await clickByText(cdp, '.scenario-panel button', 'Abrir escenarios')
  await sleep(800)
  const scoresAfterEdit = await scenarioScores(cdp)
  const staleAfterEdit = await evaluate(cdp, "document.querySelectorAll('.scenario-row .scenario-chip.is-stale').length")
  if (JSON.stringify(scoresBeforeEdit) !== JSON.stringify(scoresAfterEdit)) {
    fail(`editar el plano cambio los escenarios guardados (${JSON.stringify(scoresBeforeEdit)} -> ${JSON.stringify(scoresAfterEdit)})`)
  } else {
    ok(`los escenarios guardados no cambian al editar el plano (${scoresAfterEdit.join(' / ')})`)
  }
  if (staleAfterEdit !== 0) fail(`editar el plano marco ${staleAfterEdit} escenarios como obsoletos`)
  else ok('editar el plano no invalida escenarios congelados')

  // La actualizacion explicita si reescribe el escenario y lo deja pendiente.
  await clickByText(cdp, '.scenario-row-actions button', 'Actualizar')
  await sleep(1200)
  const staleAfterUpdate = await evaluate(cdp, "document.querySelectorAll('.scenario-row .scenario-chip.is-stale').length")
  if (staleAfterUpdate !== 1) fail(`actualizar dejo ${staleAfterUpdate} escenarios pendientes, se esperaba 1`)
  else ok('actualizar reescribe el escenario y lo deja pendiente de relanzar')
  await clickByText(cdp, '.scenario-row-actions button', 'Relanzar')
  await sleep(1200)
  const staleAfterRelaunch = await evaluate(cdp, "document.querySelectorAll('.scenario-row .scenario-chip.is-stale').length")
  if (staleAfterRelaunch !== 0) fail('relanzar tras actualizar dejo escenarios pendientes')
  else ok('relanzar tras actualizar limpia el pendiente')
  await screenshot(cdp, SHOTS, '20b-escenarios-actualizado', report)
  await clickByText(cdp, '.script-modal-header button', 'Cerrar')
  await sleep(400)

  // Ranking del Top alimentado por escenarios reales.
  await openTab(cdp, 'Top')
  await sleep(1500)
  const topInfo = await evaluate(cdp, `(() => {
    const cards = [...document.querySelectorAll('.proposal-card')]
    return {
      cards: cards.length,
      titles: cards.map((card) => card.querySelector('h4')?.textContent ?? ''),
      subtitles: cards.map((card) => card.querySelector('p')?.textContent ?? ''),
    }
  })()`)
  const scenarioCards = topInfo.subtitles.filter((text) => text.includes('escenario')).length
  if (scenarioCards < 2) fail(`el ranking del Top no muestra los escenarios (${JSON.stringify(topInfo.subtitles)})`)
  else ok(`ranking del Top con ${scenarioCards} escenarios: ${topInfo.titles.join(' | ')}`)
  await screenshot(cdp, SHOTS, '21-top-ranking', report)

  // Las herramientas del Top viven en el modal contextual de la seccion.
  await evaluate(cdp, "document.querySelector('.section-modal-trigger')?.click() ?? null")
  await sleep(900)
  const scenarioMetrics = await evaluate(cdp, `(() => {
    const metrics = [...document.querySelectorAll('.section-modal-body .metric')]
    const comparados = metrics.find((metric) => metric.textContent.includes('Comparados'))
    return comparados ? comparados.querySelector('strong')?.textContent : null
  })()`)
  if (scenarioMetrics !== '2') fail(`el Top no muestra los escenarios comparados (${scenarioMetrics})`)
  else ok('el Top informa de 2 escenarios comparados')
  const relaunchAll = await clickByText(cdp, '.section-modal-body button', 'Relanzar escenarios')
  if (!relaunchAll) fail('no se encontro el boton de relanzar escenarios en el Top')
  else ok('relanzado global disponible en el Top')
  await sleep(1200)
  await clickByText(cdp, '.section-modal button, .app-modal button', 'Cerrar')
  await sleep(400)

  // Persistencia entre recargas.
  await cdp.send('Page.reload')
  await sleep(3200)
  const persisted = await evaluate(cdp, `(() => {
    const raw = localStorage.getItem('simlab.scenarios.v1')
    if (!raw) return 0
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed.scenarios) ? parsed.scenarios.length : 0
  })()`)
  if (persisted !== 2) fail(`tras recargar quedan ${persisted} escenarios guardados`)
  else ok('los escenarios sobreviven a recargar la pagina')

  await openTab(cdp, 'Top')
  await sleep(1500)
  const persistedCards = await evaluate(cdp, "[...document.querySelectorAll('.proposal-card p')].filter((node) => node.textContent.includes('escenario')).length")
  if (persistedCards < 2) fail('el ranking no recupera los escenarios tras recargar')
  else ok('el ranking recupera los escenarios tras recargar')

  // Importacion de la mezcla clinica generada desde MIMIC.
  if (casesFile && existsSync(casesFile)) {
    await openTab(cdp, 'Simulación')
    await sleep(2000)
    const uploaded = await setCaseFile(cdp, casesFile)
    if (!uploaded) {
      fail('no se pudo adjuntar el YAML de casos')
    } else {
      await sleep(1500)
      const saved = await clickByText(cdp, '.script-modal-footer button', 'Guardar casos')
      if (!saved) fail('no se encontro el boton de guardar del editor de casos')
      await sleep(2500)
      const caseInfo = await evaluate(cdp, `(() => {
        const select = document.querySelector('.sim-controls select[aria-label="Caso clínico visible"]')
        const options = select ? [...select.options].map((option) => option.textContent) : []
        return { options, modalOpen: Boolean(document.querySelector('.app-modal')) }
      })()`)
      const mimicOptions = caseInfo.options.filter((label) => label.includes('MIMIC'))
      if (mimicOptions.length === 0) fail(`la simulacion no aplico los casos MIMIC (${JSON.stringify(caseInfo.options)})`)
      else ok(`casos MIMIC aplicados: ${mimicOptions.length} cohortes (${mimicOptions.slice(0, 3).join(' | ')})`)
      await screenshot(cdp, SHOTS, '22-casos-mimic', report)
    }
  } else {
    report.steps.push('INFO sin --cases: no se probo la importacion de mezcla clinica')
  }

  cdp.close()
} catch (error) {
  fail(`error del verificador: ${error.message}`)
} finally {
  chrome.process.kill('SIGTERM')
}

process.exit(printReport(report) ? 0 : 1)

async function openTab(cdp, label) {
  return evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.workspace-tabs button')].find((item) => item.textContent.trim().startsWith(${JSON.stringify(label.slice(0, 6))}))
    if (!button) return false
    button.click()
    return true
  })()`)
}

async function clickByText(cdp, selector, text) {
  return evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => item.textContent.trim().startsWith(${JSON.stringify(text)}))
    if (!button || button.disabled) return false
    button.click()
    return true
  })()`)
}

async function saveScenario(cdp, name) {
  await evaluate(cdp, `(() => {
    const input = document.querySelector('.scenario-panel input')
    if (!input) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(name)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(300)
  await clickByText(cdp, '.scenario-panel button', 'Guardar escenario actual')
  await sleep(1500)
}

async function scenarioScores(cdp) {
  return evaluate(cdp, "[...document.querySelectorAll('.scenario-row header strong')].map((node) => node.textContent)")
}

async function scenarioCount(cdp) {
  return evaluate(cdp, `(() => {
    const metrics = [...document.querySelectorAll('.scenario-panel .metric')]
    const guardados = metrics.find((metric) => metric.textContent.includes('Guardados'))
    return guardados ? Number.parseInt(guardados.querySelector('strong')?.textContent ?? '0', 10) : -1
  })()`)
}

async function setCaseFile(cdp, file) {
  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.case-yaml-actions input[type=file]' })
  if (!nodeId) return false
  await cdp.send('DOM.setFileInputFiles', { files: [file], nodeId })
  return true
}
