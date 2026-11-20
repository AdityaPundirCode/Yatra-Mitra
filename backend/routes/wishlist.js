// ------------------------------------------------------------
// routes/wishlist.js   ->   /api/wishlist
// Places the user wants to visit later.
// ------------------------------------------------------------
import express from 'express';
import { Wishlist } from '../models/Wishlist.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();
router.use(auth);

// GET /api/wishlist  -> all saved places, newest first
router.get('/', async (req, res) => {
  const items = await Wishlist.find({ userId: req.userId }).sort({ createdAt: -1 });
  res.json({ items });
});

// POST /api/wishlist  -> add a place (a duplicate is not added twice)
router.post('/', async (req, res) => {
  const { destinationName, placeId = '', location = '', image = '', rating = 0, notes = '', data = {} } = req.body || {};
  if (!destinationName) return res.status(400).json({ error: 'destinationName required' });

  // Is this place already in the user's wishlist? (same placeId or same name)
  const sameUser = { userId: req.userId };
  const duplicateFilter = placeId
    ? { ...sameUser, $or: [{ placeId }, { destinationName }] }
    : { ...sameUser, destinationName };
  const existing = await Wishlist.findOne(duplicateFilter);
  if (existing) return res.json({ item: existing, duplicate: true });

  const item = await Wishlist.create({ userId: req.userId, destinationName, placeId, location, image, rating, notes, data });
  res.status(201).json({ item });
});

// DELETE /api/wishlist/:id
router.delete('/:id', async (req, res) => {
  await Wishlist.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  res.json({ ok: true });
});

export default router;
