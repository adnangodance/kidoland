import { spawn } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'

const candidates = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)
let chrome
for (const candidate of candidates) {
  try { await access(candidate); chrome = candidate; break } catch { /* Try the next installed browser. */ }
}
if (!chrome) throw new Error('Installed Chrome not found. Set CHROME_PATH to its executable.')

const profile = await mkdtemp(path.join(tmpdir(), 'kidoland-ui-chrome-'))
let server
let child
try {
  server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false }, logLevel: 'error' })
  await server.listen()
  const address = server.httpServer.address()
  if (!address || typeof address === 'string') throw new Error('Could not determine isolated Vite port')
  const url = `http://127.0.0.1:${address.port}/tests/attendance-ui.html`
  let stdout = ''
  let stderr = ''
  child = spawn(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--dump-dom', '--virtual-time-budget=10000', url], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr.on('data', (data) => { stderr += data })
  await new Promise((resolve, reject) => {
    let finished = false
    const finish = (error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => finish(new Error(`Attendance UI browser timed out after 30 seconds. ${stdout.slice(-1500)} ${stderr.slice(-1500)}`)), 30000)
    child.stdout.on('data', (data) => {
      stdout += data
      const marker = stdout.match(/<pre\b[^>]*id="results"[^>]*data-result="(passed|failed)"[^>]*>([\s\S]*?)<\/pre>/)
      if (marker) finish(marker[1] === 'passed' ? undefined : new Error(marker[2]))
    })
    child.once('error', finish)
    child.once('exit', (code) => { if (code !== 0) finish(new Error(`Chrome exited ${code}: ${stderr.slice(-1500)}`)) })
    child.once('close', () => finish(new Error('Chrome closed without a completed results marker')))
  })
  const result = stdout.match(/<pre\b[^>]*id="results"[^>]*>([\s\S]*?)<\/pre>/)
  if (!result || !/data-result="passed"/.test(result[0])) throw new Error(result ? result[1] : `No completed attendance results marker: ${stderr.slice(-1500)}`)
  console.log(result[1].replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&'))
} finally {
  if (child && child.exitCode === null) child.kill('SIGKILL')
  await server?.close()
  await rm(profile, { recursive: true, force: true })
}
