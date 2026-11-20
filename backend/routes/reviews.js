// ------------------------------------------------------------
// routes/reviews.js   ->   /api/reviews
// Anyone can READ reviews. You must log in to write/edit/delete.
// ------------------------------------------------------------
import express from 'express';
import { Review } from '../models/Review.js';
import { auth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/reviews?destinationKey=...   (public - no login needed)
router.get('/', async (req, res) => {
  const { destinationKey } = req.query;
  const filter = destinationKey ? { destinationKey } : {};

  // populate() replaces userId with the user's name
  const reviews = await Review.find(filter).sort({ createdAt: -1 }).limit(100).populate('userId', 'name');

  const items = reviews.map((r) => ({
    id: r._id,
    destinationKey: r.destinationKey,
    destinationName: r.destinationName,
    rating: r.rating,
    comment: r.comment,
    photos: r.photos,
    source: r.source,
    userName: r.userId?.name || 'User',
    userId: r.userId?._id,
    createdAt: r.createdAt,
  }));
  res.json({ items });
});

// Everything below this line needs a logged-in user.
router.use(auth);

// POST /api/reviews  -> write a review (one per destination per user)
router.post('/', async (req, res) => {
  const { destinationKey, destinationName = '', rating, comment = '', photos = [] } = req.body || {};
  if (!destinationKey || !rating) return res.status(400).json({ error: 'destinationKey and rating required' });
  if (!Number.isFinite(Number(rating)) || Number(rating) < 1 || Number(rating) > 5) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
  }

  const alreadyReviewed = await Review.findOne({ userId: req.userId, destinationKey, source: 'user' });
  if (alreadyReviewed) return res.status(409).json({ error: 'You already reviewed this destination.' });

  const item = await Review.create({
    userId: req.userId, destinationKey, destinationName, rating: Number(rating), comment, photos, source: 'user',
  });
  res.status(201).json({ item });
});

// PUT /api/reviews/:id  -> edit your own review
router.put('/:id', async (req, res) => {
  const { rating, comment, photos } = req.body || {};
  if (rating !== undefined && (!Number.isFinite(Number(rating)) || Number(rating) < 1 || Number(rating) > 5)) {
    return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
  }
  const changes = {};
  if (rating !== undefined) changes.rating = Number(rating);
  if (comment !== undefined) changes.comment = comment;
  if (photos !== undefined) changes.photos = photos;
  const item = await Review.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    changes,
    { returnDocument: 'after' }
  );
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({ item });
});

// DELETE /api/reviews/:id  -> delete your own review
router.delete('/:id', async (req, res) => {
  await Review.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  res.json({ ok: true });
});

export default router;
