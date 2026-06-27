import { verifyToken } from '../auth/tokens.js';

// Express middleware: only lets a request through if it carries a valid JWT
// cookie. Attaches req.user = { id, role } for the handler that follows.
export function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
