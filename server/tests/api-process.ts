import { app } from '../src/index.js'
import { db } from '../src/db.js'

const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address()
  if (address && typeof address !== 'string') process.send?.({ port: address.port })
})
process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(0) }))
