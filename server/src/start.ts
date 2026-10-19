import { app } from './index.js'
import { db } from './db.js'

const port = Number(process.env.PORT) || 4000
const host = process.env.HOST || '0.0.0.0'

const server = app.listen(port, host, () => {
  console.log(`Kidoland API listening on http://${host}:${port}`)
})

function shutdown(signal: string) {
  console.log(`Received ${signal}. Shutting down gracefully...`)
  server.close(() => {
    try {
      db.close()
      console.log('Database connection closed.')
    } catch (err) {
      console.error('Error closing database:', err)
    }
    process.exit(0)
  })

  // Force shutdown if connections do not close in time
  setTimeout(() => {
    console.error('Forced shutdown after timeout.')
    process.exit(1)
  }, 10000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

