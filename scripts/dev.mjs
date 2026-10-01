import { spawn } from 'node:child_process'

// npm forwards terminal output while this parent owns both processes' lifetime.
const commands = [['run', 'dev:api'], ['run', 'dev:web']]
const children = commands.map((args) => spawn('npm', args, { stdio: 'inherit', env: process.env, detached: process.platform !== 'win32' }))
let stopping = false
function terminate(child, signal) {
  try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal) } catch (error) { if (error.code !== 'ESRCH') throw error }
}
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) if (child.exitCode === null) terminate(child, 'SIGTERM')
  // npm's descendants normally forward SIGTERM; the timeout prevents a hung launcher.
  const timer = setTimeout(() => { for (const child of children) if (child.exitCode === null) terminate(child, 'SIGKILL'); process.exit(code) }, 5000)
  Promise.all(children.map((child) => child.exitCode !== null ? Promise.resolve() : new Promise((resolve) => child.once('exit', resolve)))).then(() => { clearTimeout(timer); process.exit(code) })
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop())
for (const child of children) {
  child.once('error', (error) => { console.error(error.message); stop(1) })
  child.once('exit', (code, signal) => { if (!stopping) stop(code ?? (signal ? 1 : 0)) })
}
