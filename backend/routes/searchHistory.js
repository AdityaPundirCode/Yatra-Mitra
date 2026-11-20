// ------------------------------------------------------------
// routes/searchHistory.js   ->   /api/search-history
// Remembers what the user searched for.
// ------------------------------------------------------------
import express from 'express';
import { SearchHistory } from '../models/SearchHistory.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();
router.use(auth);

// GET /api/search-history  -> last 20 searches
router.get('/', async (req, res) => {
  const items = await SearchHistory.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(20);
  res.json({ items });
});

// POST /api/search-history  -> save one search
router.post('/', async (req, res) => {
  const { query, filters = {} } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query required' });

  const item = await SearchHistory.create({ userId: req.userId, query, filters });
  res.json({ item });
});

export default router;
