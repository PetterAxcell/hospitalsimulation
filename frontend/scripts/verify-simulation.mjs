#!/usr/bin/env node
/**
 * Verificador headless de la vista de Simulacion.
 * Lanza Chrome sin interfaz, abre la pestana Simulacion y comprueba render,
 * reloj dia/noche, tooltip, zoom, pan, leyenda, atajos y vista isometrica.
 * Deja capturas en /tmp/simlab-shots y falla si hay excepciones JS.
 *
 * Uso: node scripts/verify-simulation.mjs [url]   (por defecto http://localhost:5173/)
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const URL_BASE = process.argv[2] ?? 'http://localhost:5173/'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9333
const OUT = '/tmp/simlab-shots'
mkdirSync(OUT, { recursive: true })

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/simlab-cdp-profile',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--window-size=1500,940',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

let chromeStderr = ''
chrome.stderr.on('data', (chunk) => { chromeStderr += chunk.toString() })

const report = { steps: [], consoleErrors: [], exceptions: [], screenshots: [] }
const fail = (message) => { report.steps.push(`FAIL ${message}`) }
const ok = (message) => { report.steps.push(`OK   ${message}`) }

async function targets() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await response.json()
      const page = list.find((item) => item.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      // Chrome aun no escucha.
    }
    await sleep(250)
  }
  throw new Error('Chrome DevTools no respondio')
}

function connect(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  const listeners = []
  let nextId = 1

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
      return
    }
    listeners.forEach((listener) => listener(message))
  })

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', reject)
  })

  return {
    ready,
    on: (listener) => listeners.push(listener),
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId += 1
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    }),
    close: () => socket.close(),
  }
}

async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const file = `${OUT}/${name}.png`
  writeFileSync(file, Buffer.from(data, 'base64'))
  report.screenshots.push(file)
  return file
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'evaluate error')
  return result.result.value
}

async function mouse(cdp, type, x, y, extra = {}) {
  await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: extra.button ?? 'none', buttons: extra.buttons ?? 0, clickCount: extra.clickCount ?? 0, ...extra })
}

async function key(cdp, keyDef) {
  const payload = {
    windowsVirtualKeyCode: keyDef.windowsVirtualKeyCode,
    nativeVirtualKeyCode: keyDef.windowsVirtualKeyCode,
    unmodifiedText: keyDef.text,
    location: 0,
    isKeypad: false,
    ...keyDef,
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...payload })
  await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: payload.text })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...payload })
}

try {
  const target = await targets()
  const cdp = connect(target.webSocketDebuggerUrl)
  await cdp.ready

  cdp.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      report.exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    }
    if (message.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(message.params.type)) {
      report.consoleErrors.push(message.params.args.map((arg) => arg.description ?? arg.value).join(' '))
    }
  })

  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Log.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 940, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.navigate', { url: URL_BASE })
  await sleep(3500)

  const title = await evaluate(cdp, 'document.title')
  ok(`carga inicial (title="${title}")`)
  await shot(cdp, '01-inicio')

  const clicked = await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('.workspace-tabs button')].find((item) => item.textContent.trim().startsWith('Simulaci'))
    if (!button) return false
    button.click()
    return true
  })()`)
  if (!clicked) fail('no se encontro la pestana Simulacion')
  else ok('pestana Simulacion abierta')
  await sleep(4000)

  const stage = await evaluate(cdp, `(() => {
    const host = document.querySelector('.phaser-stage')
    if (!host) return null
    const rect = host.getBoundingClientRect()
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, canvases: host.querySelectorAll('canvas').length }
  })()`)
  if (!stage || stage.canvases === 0) fail('no hay canvas de Phaser en .phaser-stage')
  else ok(`canvas Phaser presente (${Math.round(stage.w)}x${Math.round(stage.h)})`)

  const hud = await evaluate(cdp, `(() => {
    const clock = document.querySelector('.stage-hud-clock strong')
    const meta = [...document.querySelectorAll('.stage-hud-meta span')].map((item) => item.textContent)
    return clock ? { clock: clock.textContent, meta } : null
  })()`)
  if (!hud) fail('HUD de reloj ausente')
  else ok(`HUD reloj=${hud.clock} meta=${JSON.stringify(hud.meta)}`)
  await shot(cdp, '02-simulacion')

  // El reloj debe avanzar con el replay.
  const clockBefore = hud?.clock
  await sleep(2500)
  const clockAfter = await evaluate(cdp, "document.querySelector('.stage-hud-clock strong')?.textContent")
  if (clockBefore && clockAfter && clockBefore === clockAfter) fail(`el reloj no avanza (${clockBefore})`)
  else ok(`reloj avanza ${clockBefore} -> ${clockAfter}`)

  const cx = Math.round(stage.x + stage.w / 2)
  const cy = Math.round(stage.y + stage.h / 2)

  // Hover: tooltip de sala o agente.
  let tooltip = null
  for (const [dx, dy] of [[0, 0], [-120, -60], [140, 70], [-200, 90], [220, -90], [60, 160], [-60, -160]]) {
    await mouse(cdp, 'mouseMoved', cx + dx, cy + dy)
    await sleep(400)
    tooltip = await evaluate(cdp, `(() => {
      const node = document.querySelector('.stage-tooltip')
      return node ? node.innerText.replace(/\\n/g, ' | ') : null
    })()`)
    if (tooltip) break
  }
  if (!tooltip) fail('el tooltip de hover no aparecio en ninguna posicion probada')
  else ok(`tooltip hover: ${tooltip}`)
  await shot(cdp, '03-tooltip')

  // Zoom con rueda.
  const zoomBefore = await evaluate(cdp, 'window.devicePixelRatio')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -240, button: 'none', buttons: 0 })
  await sleep(700)
  await shot(cdp, '04-zoom-in')
  ok(`zoom con rueda ejecutado (dpr=${zoomBefore})`)

  // Detalle arquitectonico: varios pasos de zoom para revisar muros, suelos y puertas.
  for (let i = 0; i < 8; i += 1) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -240, button: 'none', buttons: 0 })
    await sleep(120)
  }
  await sleep(900)
  await shot(cdp, '04b-detalle-noche')

  // Salto a mediodia para comparar el ciclo dia/noche con el mismo encuadre.
  await evaluate(cdp, `(() => {
    const slider = document.querySelector('.sim-controls input[type=range]')
    if (!slider) return false
    const max = Number(slider.max)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(slider, String(Math.round(max * 0.5)))
    slider.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await sleep(1200)
  const dayClock = await evaluate(cdp, "document.querySelector('.stage-hud-clock strong')?.textContent")
  const dayPhase = await evaluate(cdp, "[...document.querySelectorAll('.stage-hud-meta span')].map((item) => item.textContent).join(' ')")
  ok(`salto temporal a ${dayClock} (${dayPhase})`)
  await shot(cdp, '04c-detalle-dia')

  // Pan arrastrando.
  await mouse(cdp, 'mousePressed', cx, cy, { button: 'left', buttons: 1, clickCount: 1 })
  for (let i = 1; i <= 6; i += 1) {
    await mouse(cdp, 'mouseMoved', cx - i * 18, cy - i * 9, { button: 'left', buttons: 1 })
    await sleep(60)
  }
  const dragging = await evaluate(cdp, "document.querySelector('.phaser-stage')?.classList.contains('is-dragging') ?? false")
  await mouse(cdp, 'mouseReleased', cx - 108, cy - 54, { button: 'left', buttons: 0, clickCount: 1 })
  if (!dragging) fail('el arrastre no activo el estado is-dragging')
  else ok('pan por arrastre activo')
  await shot(cdp, '05-pan')

  // Leyenda por teclado.
  await key(cdp, { key: 'l', code: 'KeyL', windowsVirtualKeyCode: 76, text: 'l' })
  await sleep(500)
  const legend = await evaluate(cdp, `(() => {
    const node = document.querySelector('.stage-legend')
    return node ? node.innerText.split('\\n').filter(Boolean).length : 0
  })()`)
  if (!legend) fail('la leyenda no se abrio con la tecla L')
  else ok(`leyenda abierta con ${legend} lineas`)
  await shot(cdp, '06-leyenda')

  // Encajar vista y pausa por teclado.
  await key(cdp, { key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, text: 'f' })
  await sleep(400)
  const playLabel = () => evaluate(cdp, "[...document.querySelectorAll('.sim-controls button')].map((item) => item.textContent.trim())[0]")
  const spaceKey = { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' }

  // Mover el slider deja el replay pausado: se reanuda antes de probar la pausa.
  if (await playLabel() === 'Play') {
    await key(cdp, spaceKey)
    await sleep(600)
  }
  const beforeSpace = await playLabel()
  if (beforeSpace !== 'Pausa') fail(`espacio no reanudo el replay (boton="${beforeSpace}")`)
  else ok('espacio reanuda el replay')

  await key(cdp, spaceKey)
  await sleep(900)
  const pausedLabel = await evaluate(cdp, "[...document.querySelectorAll('.sim-controls button')].map((item) => item.textContent.trim())[0]")
  if (pausedLabel !== 'Play') fail(`espacio no pauso el replay (boton="${pausedLabel}")`)
  else ok('espacio pausa el replay')

  const clockPaused = await evaluate(cdp, "document.querySelector('.stage-hud-clock strong')?.textContent")
  await sleep(1500)
  const clockStill = await evaluate(cdp, "document.querySelector('.stage-hud-clock strong')?.textContent")
  if (clockPaused !== clockStill) fail(`el reloj sigue corriendo en pausa (${clockPaused} -> ${clockStill})`)
  else ok(`reloj congelado en pausa (${clockStill})`)
  await shot(cdp, '07-pausa')

  // Vista 3D isometrica.
  await key(cdp, { key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, text: 'v' })
  await sleep(2500)
  const isometric = await evaluate(cdp, "document.querySelector('.phaser-stage')?.classList.contains('is-isometric') ?? false")
  if (!isometric) fail('la tecla V no cambio a vista isometrica')
  else ok('vista isometrica activada con V')
  await shot(cdp, '08-isometrico')

  // Tooltip en isometrico.
  let isoTooltip = null
  for (const [dx, dy] of [[0, 0], [-100, 40], [120, -30], [40, 120], [-140, -60]]) {
    await mouse(cdp, 'mouseMoved', cx + dx, cy + dy)
    await sleep(400)
    isoTooltip = await evaluate(cdp, "document.querySelector('.stage-tooltip')?.innerText.replace(/\\n/g, ' | ') ?? null")
    if (isoTooltip) break
  }
  if (!isoTooltip) fail('sin tooltip de sala en vista isometrica')
  else ok(`tooltip isometrico: ${isoTooltip}`)
  await shot(cdp, '09-iso-tooltip')

  // Vuelta a 2D y recorrido de plantas del selector lateral si existe.
  await key(cdp, { key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, text: 'v' })
  await sleep(1500)
  await key(cdp, { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' })
  await sleep(2500)
  await shot(cdp, '10-final-2d')

  const fps = await evaluate(cdp, `new Promise((resolve) => {
    let frames = 0
    const start = performance.now()
    function tick() {
      frames += 1
      if (performance.now() - start < 1500) requestAnimationFrame(tick)
      else resolve(Math.round((frames / (performance.now() - start)) * 1000))
    }
    requestAnimationFrame(tick)
  })`)
  ok(`frames por segundo aproximados en headless: ${fps}`)

  cdp.close()
} catch (error) {
  fail(`error del verificador: ${error.message}`)
} finally {
  chrome.kill('SIGTERM')
}

const failures = report.steps.filter((step) => step.startsWith('FAIL'))
const blocking = [...failures, ...report.exceptions]
console.log('=== PASOS ===')
report.steps.forEach((step) => console.log(step))
console.log('\n=== EXCEPCIONES JS ===')
console.log(report.exceptions.length ? report.exceptions.join('\n') : 'ninguna')
console.log('\n=== CONSOLE ERROR ===')
console.log(report.consoleErrors.length ? report.consoleErrors.join('\n') : 'ninguno')
console.log('\n=== CAPTURAS ===')
report.screenshots.forEach((file) => console.log(file))
if (chromeStderr.includes('ERROR:') && process.env.SIMLAB_VERBOSE) console.log('\n=== CHROME STDERR ===\n' + chromeStderr)
console.log(`\nRESULTADO: ${blocking.length === 0 ? 'PASS' : 'FAIL'}`)
process.exit(blocking.length === 0 ? 0 : 1)
