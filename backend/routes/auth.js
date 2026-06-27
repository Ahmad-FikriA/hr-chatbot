import { Router } from 'express';
import { createUser, findUserByEmail, findUserById } from '../db/users.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signToken } from '../auth/tokens.js';
import { requireAuth } from '../middleware/requireAuth.js';

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',  // true only in prod (HTTPS)
  maxAge: 7 * 24 * 60 * 60 * 1000,                // 7 days in ms
};

// Only ever send these fields to the browser — never password_hash.
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

const router = Router();

router.post('/register', async (req, res) => {
  const { email, password, name } = req.body ?? {};
  if (typeof email !== 'string' || !email.includes('@') ||
      typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Valid email and 8+ char password required' });
  }
  if (await findUserByEmail(email)) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  const user = await createUser({ email, passwordHash: await hashPassword(password), name });
  res.cookie('token', signToken({ sub: user.id, role: user.role }), COOKIE_OPTS);
  res.json(publicUser(user));
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = await findUserByEmail(email ?? '');
  // Same generic error whether email is unknown or password is wrong.
  if (!user || !(await verifyPassword(password ?? '', user.password_hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.cookie('token', signToken({ sub: user.id, role: user.role }), COOKIE_OPTS);
  res.json(publicUser(user));
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await findUserById(req.user.id);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(publicUser(user));
});

export default router;