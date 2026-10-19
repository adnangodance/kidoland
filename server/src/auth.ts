import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { db, type DbUser } from './db.js'

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret === 'kidoland-dev-secret-change-me' || secret.length < 32) {
      throw new Error(
        'FATAL: In production, JWT_SECRET must be set as an environment variable and be at least 32 characters long.',
      )
    }
    return secret
  }
  return secret || 'kidoland-dev-secret-change-me'
}

export const JWT_SECRET = getJwtSecret()

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
    if (!current || !['parent', 'teacher', 'director', 'superadmin'].includes(current.role)) {
      return res.status(401).json({ error: 'unauthorized' })
    }
    ;(req as Request & { user: AuthUser }).user = current
    next()
  } catch {
    return res.status(401).json({ error: 'unauthorized' })
  }
}
