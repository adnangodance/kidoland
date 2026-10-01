import { spawn, fork } from 'node:child_process'
import { access, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import Database from '../server/node_modules/better-sqlite3/lib/index.js'

const candidates = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chrome
for (const candidate of candidates) { try { await access(candidate); chrome = candidate; break } catch { /* Try next browser. */ } }
if (!chrome) throw new Error('Installed Chrome not found. Set CHROME_PATH.')
const directory = await mkdtemp(path.join(tmpdir(), 'kidoland-pilot-ui-'))
let api, browser, vite
try {
  api = fork(fileURLToPath(new URL('../server/tests/api-process.ts', import.meta.url)), [], { cwd: fileURLToPath(new URL('../server', import.meta.url)), execArgv: ['--import', 'tsx'], env: { ...process.env, KIDOLAND_DB_PATH: path.join(directory, 'test.sqlite') }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
  const port = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Isolated API startup timeout')), 15000); api.once('message', (message) => { clearTimeout(timer); resolve(message.port) }); api.once('error', reject); api.once('exit', (code) => { clearTimeout(timer); reject(new Error(`API exited ${code}`)) }) })
  const fixture = new Database(path.join(directory, 'test.sqlite'))
  fixture.prepare("UPDATE invoices SET due_date = '2026-99-99', currency = 'USD' WHERE id = 'inv-luan-sep'").run()
  fixture.prepare("UPDATE invoices SET currency = 'EURO' WHERE id = 'inv-arta-oct'").run()
  fixture.close()
  process.env.VITE_API_URL = `http://127.0.0.1:${port}`
  let report
  const done = new Promise((resolve, reject) => { report = (result) => result.ok ? resolve(result) : reject(new Error(result.output)) })
  vite = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error', plugins: [{ name: 'pilot-test-results', configureServer(server) { server.middlewares.use('/__pilot_results', (req, res) => { let body = ''; req.on('data', (data) => { body += data }); req.on('end', () => { report(JSON.parse(body)); res.end('ok') }) }) } }] })
  await vite.listen()
  const address = vite.httpServer.address()
  const width = process.env.PILOT_WIDTH || '320'
  browser = spawn(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${path.join(directory, 'chrome')}`, `--window-size=${width},1000`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' })
  let debugPort
  for (let attempt = 0; attempt < 100; attempt++) {
    try { debugPort = (await readFile(path.join(directory, 'chrome', 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await new Promise((resolve) => setTimeout(resolve, 50)) }
  }
  if (!debugPort) throw new Error('Chrome debugger did not start')
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()
  const socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0
  const pending = new Map()
  socket.onmessage = (event) => { const message = JSON.parse(event.data); if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id) } }
  const command = (method, params) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, (message) => message.error ? reject(new Error(message.error.message)) : resolve(message.result)); socket.send(JSON.stringify({ id, method, params })) })
  await command('Emulation.setDeviceMetricsOverride', { width: Number(width), height: 1000, deviceScaleFactor: 1, mobile: false })
  await command('Page.navigate', { url: `http://127.0.0.1:${address.port}/tests/pilot-ui.html?width=${width}` })
  let timer
  const result = await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Full app browser regression timed out')), 60000); browser.once('error', reject); browser.once('exit', (code) => reject(new Error(`Chrome exited ${code}`))) })]).finally(() => clearTimeout(timer))
  await command('Runtime.evaluate', { expression: "document.getElementById('results').style.display = 'none'; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))", awaitPromise: true })
  const capture = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const screenshot = path.join('/tmp', `kidoland-pilot-${width}.png`)
  await writeFile(screenshot, Buffer.from(capture.data, 'base64'))
  console.log(`Screenshot: ${screenshot}`)
  socket.close()
  console.log(result.output)
} finally {
  if (browser?.exitCode === null) { const closed = new Promise((resolve) => browser.once('exit', resolve)); browser.kill('SIGKILL'); await closed }
  await vite?.close()
  if (api?.exitCode === null) { const closed = new Promise((resolve) => api.once('exit', resolve)); api.kill('SIGTERM'); await closed }
  await rm(directory, { recursive: true, force: true })
}
