import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import type { DbUser } from './db.js'

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
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as {
      sub: string
      email: string
      name: string
      role: AuthUser['role']
    }
    ;(req as Request & { user: AuthUser }).user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    }
    next()
  } catch {
    return res.status(401).json({ error: 'unauthorized' })
  }
}
