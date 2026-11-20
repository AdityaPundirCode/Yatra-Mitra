// ------------------------------------------------------------
// routes/notifications.js   ->   /api/notifications
// ------------------------------------------------------------
import express from 'express';
import { Notification } from '../models/Notification.js';
import { auth } from '../middleware/auth.js';
import { cleanBody } from '../utils/sanitize.js';

const router = express.Router();
router.use(auth);

// GET /api/notifications  -> latest 50
router.get('/', async (req, res) => {
  const items = await Notification.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(50);
  res.json({ items });
});

// POST /api/notifications  -> create a notification
router.post('/', async (req, res) => {
  const item = await Notification.create({ ...cleanBody(req.body), userId: req.userId });
  res.status(201).json({ item });
});

// PUT /api/notifications/:id/read  -> mark as read
router.put('/:id/read', async (req, res) => {
  const item = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { read: true },
    { returnDocument: 'after' }
  );
  if (!item) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ item });
});

export default router;
