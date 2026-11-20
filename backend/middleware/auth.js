// ------------------------------------------------------------
// middleware/auth.js  -  "guards" that protect routes
//
// A middleware is a function that runs BEFORE the route code.
// If it calls next() the request continues, otherwise it stops here.
// ------------------------------------------------------------
import { getTokenFromRequest, verifyAccessToken } from '../utils/tokens.js';
import { User } from '../models/User.js';

// Guard 1: the user must be logged in.
// After it runs, the route can use req.userId and req.user.
export async function auth(req, res, next) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Authentication required.' });

    const payload = verifyAccessToken(token); // throws an error if the token is bad/expired
    const user = await User.findById(payload.userId).select('_id role name email');
    if (!user) return res.status(401).json({ error: 'User not found.' });

    req.userId = payload.userId;
    req.userRole = payload.role;
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// Guard 2: the user must be an admin (use it AFTER auth).
export function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin' && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}
