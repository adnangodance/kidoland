import { app } from './index.js'

const port = Number(process.env.PORT) || 4000
app.listen(port, '127.0.0.1', () => {
  console.log(`Kidoland API on http://127.0.0.1:${port}`)
})
