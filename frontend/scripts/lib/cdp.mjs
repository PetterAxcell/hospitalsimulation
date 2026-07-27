/**
 * Utilidades minimas de Chrome DevTools Protocol para los verificadores
 * headless. Sin dependencias: usa el WebSocket nativo de Node.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME_BINARY = process.env.CHROME_BINARY ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

export { sleep }

export function launchChrome({ port, profile, width = 1500, height = 940 }) {
  const chrome = spawn(CHROME_BINARY, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--window-size=${width},${height}`,
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  let stderr = ''
  chrome.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  return { process: chrome, getStderr: () => stderr }
}

export async function findPageTarget(port, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = await response.json()
      const page = list.find((item) => item.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      // Chrome aun no escucha en el puerto.
    }
    await sleep(250)
  }
  throw new Error('Chrome DevTools no respondio')
}

export function connect(url) {
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

/** Suscribe excepciones y console.error a los arrays del informe. */
export function collectPageErrors(cdp, report) {
  cdp.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      report.exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    }
    if (message.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(message.params.type)) {
      report.consoleErrors.push(message.params.args.map((arg) => arg.description ?? arg.value).join(' '))
    }
  })
}

export async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'evaluate error')
  return result.result.value
}

export async function screenshot(cdp, directory, name, report) {
  mkdirSync(directory, { recursive: true })
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const file = `${directory}/${name}.png`
  writeFileSync(file, Buffer.from(data, 'base64'))
  report?.screenshots.push(file)
  return file
}

export async function mouse(cdp, type, x, y, extra = {}) {
  await cdp.send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: extra.button ?? 'none',
    buttons: extra.buttons ?? 0,
    clickCount: extra.clickCount ?? 0,
    ...extra,
  })
}

export async function key(cdp, keyDef) {
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

export function createReport() {
  return { steps: [], consoleErrors: [], exceptions: [], screenshots: [] }
}

export function printReport(report) {
  const failures = report.steps.filter((step) => step.startsWith('FAIL'))
  // Los console.error de React (claves duplicadas, avisos de hooks) tambien
  // bloquean: son sintoma de un bug aunque la pagina siga funcionando.
  const blocking = [...failures, ...report.exceptions, ...report.consoleErrors]
  console.log('=== PASOS ===')
  report.steps.forEach((step) => console.log(step))
  console.log('\n=== EXCEPCIONES JS ===')
  console.log(report.exceptions.length ? report.exceptions.join('\n') : 'ninguna')
  console.log('\n=== CONSOLE ERROR ===')
  console.log(report.consoleErrors.length ? report.consoleErrors.join('\n') : 'ninguno')
  if (report.screenshots.length > 0) {
    console.log('\n=== CAPTURAS ===')
    report.screenshots.forEach((file) => console.log(file))
  }
  console.log(`\nRESULTADO: ${blocking.length === 0 ? 'PASS' : 'FAIL'}`)
  return blocking.length === 0
}
