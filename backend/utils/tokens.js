// ------------------------------------------------------------
// utils/tokens.js  -  everything about login tokens (JWT)
//
// Two tokens are used:
//   access token  -> short life (15 minutes), sent with every request
//   refresh token -> long life (7 days), used to get a new access token
// ------------------------------------------------------------
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change_this_secret')) {
  throw new Error('Set a strong JWT_SECRET in backend/.env before running in production.');
}
const ACCESS_SECRET = process.env.JWT_SECRET || 'dev_secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'dev_refresh';

export function signAccessToken(user) {
  return jwt.sign({ userId: user._id, role: user.role }, ACCESS_SECRET, { expiresIn: '15m' });
}

export function signRefreshToken(user) {
  return jwt.sign({ userId: user._id, type: 'refresh' }, REFRESH_SECRET, { expiresIn: '7d' });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

// We never store a raw token in the database, only its hash (like a password).
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Finds the access token in the request: first the cookie, then the
// "Authorization: Bearer <token>" header. Returns null if there is none.
export function getTokenFromRequest(req) {
  if (req.cookies?.accessToken) return req.cookies.accessToken;
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// Settings used for the login cookies.
export const cookieOptions = {
  httpOnly: true, // JavaScript in the browser cannot read this cookie
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};
