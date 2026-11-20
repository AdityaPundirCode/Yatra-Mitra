// ------------------------------------------------------------
// routes/history.js   ->   /api/history
// The user's past travels (where they went, money spent, notes...).
// ------------------------------------------------------------
import express from 'express';
import { TravelHistory } from '../models/TravelHistory.js';
import { auth } from '../middleware/auth.js';
import { cleanBody } from '../utils/sanitize.js';

const router = express.Router();
router.use(auth);

// GET /api/history
router.get('/', async (req, res) => {
  const items = await TravelHistory.find({ userId: req.userId }).sort({ createdAt: -1 });
  res.json({ items });
});

// POST /api/history  -> add a past trip
router.post('/', async (req, res) => {
  const item = await TravelHistory.create({ ...cleanBody(req.body), userId: req.userId });
  res.status(201).json({ item });
});

// PUT /api/history/:id  -> edit a past trip
router.put('/:id', async (req, res) => {
  const item = await TravelHistory.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    cleanBody(req.body),
    { returnDocument: 'after' } // return the updated version
  );
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({ item });
});

// DELETE /api/history/:id
router.delete('/:id', async (req, res) => {
  await TravelHistory.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  res.json({ ok: true });
});

export default router;
