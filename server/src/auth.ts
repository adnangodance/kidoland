import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { db, type DbUser } from './db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'kidoland-dev-secret-change-me'

export type AuthUser = Pick<DbUser, 'id' | 'name' | 'email' | 'role'>

export function signToken(user: AuthUser) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' },
  )
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET)
    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      return res.status(401).json({ error: 'unauthorized' })
    }
    const current = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(payload.sub) as AuthUser | undefined
    if (!current || !['parent', 'teacher', 'director'].includes(current.role)) {
      return res.status(401).json({ error: 'unauthorized' })
    }
    ;(req as Request & { user: AuthUser }).user = current
    next()
  } catch {
    return res.status(401).json({ error: 'unauthorized' })
  }
}
