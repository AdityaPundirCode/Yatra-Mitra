// ------------------------------------------------------------
// routes/auth.js   ->   /api/auth/...
// Register, login, logout, profile, password change and reset.
// ------------------------------------------------------------
import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { User } from '../models/User.js';
import { auth } from '../middleware/auth.js';
import {
  signAccessToken, signRefreshToken, verifyRefreshToken, hashToken, cookieOptions,
} from '../utils/tokens.js';

const router = express.Router();

// ---------- helper functions ----------

// Send both tokens to the browser as cookies.
function setLoginCookies(res, accessToken, refreshToken) {
  res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
  res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

function clearLoginCookies(res) {
  res.clearCookie('accessToken', cookieOptions);
  res.clearCookie('refreshToken', cookieOptions);
}

// Only send safe fields to the frontend (never the password!).
function publicUser(user) {
  return { id: user._id, name: user.name, email: user.email, role: user.role, avatar: user.avatar || '' };
}

// Create both tokens for a user and remember the refresh token (hashed) in the database.
async function giveTokens(user, res) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  user.refreshTokens.push({ token: hashToken(refreshToken) });
  if (user.refreshTokens.length > 10) user.refreshTokens = user.refreshTokens.slice(-10); // keep the last 10 only
  await user.save();
  setLoginCookies(res, accessToken, refreshToken);
  return accessToken;
}

// ---------- POST /api/auth/register ----------
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body || {};

  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) return res.status(400).json({ error: 'Please enter a valid email address.' });

  const emailLower = String(email).trim().toLowerCase();
  const alreadyExists = await User.findOne({ email: emailLower });
  if (alreadyExists) return res.status(409).json({ error: 'Email already registered.' });

  const hashedPassword = await bcrypt.hash(String(password), 10);
  const user = await User.create({ name: String(name).trim(), email: emailLower, password: hashedPassword });

  const accessToken = await giveTokens(user, res);
  res.status(201).json({ user: publicUser(user), accessToken });
});

// ---------- POST /api/auth/login ----------
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const user = await User.findOne({ email: String(email).toLowerCase() });
  const passwordIsCorrect = user && (await bcrypt.compare(String(password), user.password));
  if (!passwordIsCorrect) return res.status(401).json({ error: 'Invalid email or password.' });

  const accessToken = await giveTokens(user, res);
  res.json({ user: publicUser(user), accessToken });
});

// ---------- POST /api/auth/refresh ----------
// Swaps an old refresh token for a brand new pair of tokens.
router.post('/refresh', async (req, res) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) return res.status(401).json({ error: 'No refresh token.' });

    const payload = verifyRefreshToken(token);
    const user = await User.findById(payload.userId);
    if (!user) return res.status(401).json({ error: 'User not found.' });

    // The refresh token must still be saved in the database (otherwise it was revoked).
    const hashed = hashToken(token);
    const isSaved = user.refreshTokens.some((t) => t.token === hashed);
    if (!isSaved) return res.status(401).json({ error: 'Refresh token revoked.' });

    // Remove the old one, then give new tokens ("rotation").
    user.refreshTokens = user.refreshTokens.filter((t) => t.token !== hashed);
    const accessToken = await giveTokens(user, res);
    res.json({ user: publicUser(user), accessToken });
  } catch {
    res.status(401).json({ error: 'Invalid refresh token.' });
  }
});

// ---------- POST /api/auth/logout ----------
router.post('/logout', async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await User.updateOne({ _id: payload.userId }, { $pull: { refreshTokens: { token: hashToken(token) } } });
    } catch {
      // bad token -> nothing to remove, we still log the user out
    }
  }
  clearLoginCookies(res);
  res.json({ ok: true });
});

// ---------- GET /api/auth/me ----------
router.get('/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// ---------- PUT /api/auth/profile ----------
router.put('/profile', auth, async (req, res) => {
  const { name, avatar } = req.body || {};
  if (name) req.user.name = String(name).trim();
  if (avatar !== undefined) req.user.avatar = String(avatar);
  await req.user.save();
  res.json({ user: publicUser(req.user) });
});

// ---------- POST /api/auth/change-password ----------
router.post('/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required.' });
  if (String(newPassword).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const user = await User.findById(req.userId);
  const oldIsCorrect = await bcrypt.compare(String(currentPassword), user.password);
  if (!oldIsCorrect) return res.status(400).json({ error: 'Current password incorrect.' });

  user.password = await bcrypt.hash(String(newPassword), 10);
  user.refreshTokens = []; // log the user out of every device
  await user.save();
  clearLoginCookies(res);
  res.json({ ok: true, message: 'Password changed. Please login again.' });
});

// ---------- POST /api/auth/forgot-password ----------
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  const message = 'If the email exists, a reset token was generated.';
  const user = email ? await User.findOne({ email: String(email).toLowerCase() }) : null;

  if (!user) return res.json({ ok: true, message });

  const rawToken = crypto.randomBytes(20).toString('hex');
  user.resetPasswordToken = hashToken(rawToken);
  user.resetPasswordExpires = new Date(Date.now() + 30 * 60 * 1000); // valid for 30 minutes
  await user.save();

  // A real app would e-mail this token. NEVER return it in production: anyone could then
  // reset any account's password. It is only returned while developing, so the flow can be tested.
  if (process.env.NODE_ENV === 'production') {
    console.warn(`Password reset requested for ${user.email}, but no e-mail service is configured.`);
    return res.json({ ok: true, message });
  }
  res.json({ ok: true, message, resetToken: rawToken });
});

// ---------- POST /api/auth/reset-password ----------
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required.' });
  if (String(newPassword).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const user = await User.findOne({
    resetPasswordToken: hashToken(String(token)),
    resetPasswordExpires: { $gt: new Date() }, // not expired yet
  });
  if (!user) return res.status(400).json({ error: 'Invalid or expired reset token.' });

  user.password = await bcrypt.hash(String(newPassword), 10);
  user.resetPasswordToken = null;
  user.resetPasswordExpires = null;
  user.refreshTokens = [];
  await user.save();
  res.json({ ok: true, message: 'Password reset successful. Please login.' });
});

export default router;
