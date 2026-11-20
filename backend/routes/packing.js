// ------------------------------------------------------------
// routes/packing.js   ->   /api/packing
// Packing lists. "generate" builds a smart list from the trip type and weather.
// ------------------------------------------------------------
import express from 'express';
import { PackingList } from '../models/PackingList.js';
import { auth } from '../middleware/auth.js';
import { cleanBody } from '../utils/sanitize.js';

const router = express.Router();
router.use(auth);

// Extra items for each kind of trip.
const ITEMS_BY_CATEGORY = {
  mountain: ['Warm jacket', 'Hiking shoes', 'Gloves', 'Sunscreen', 'First-aid kit', 'Water bottle'],
  beach: ['Sunglasses', 'Sunscreen', 'Swimwear', 'Beach footwear', 'Waterproof bag', 'Hat'],
  cold: ['Thermal clothing', 'Winter jacket', 'Gloves', 'Woollen socks', 'Scarf', 'Moisturizer'],
  adventure: ['Sturdy shoes', 'First-aid kit', 'Flashlight', 'Snacks', 'Rain jacket'],
  religious: ['Modest clothing', 'Scarf/shawl', 'Comfortable footwear'],
};

// Builds the list of items: basics + trip-type items + weather items.
function makePackingItems(category, weather) {
  const basics = ['ID/passport', 'Wallet & cash/cards', 'Phone & charger', 'Power bank', 'Medications', 'Toiletries'];

  // Which trip type matches? (example: category "mountain trek" matches "mountain")
  const categoryText = String(category || '').toLowerCase();
  const matchedKey = Object.keys(ITEMS_BY_CATEGORY).find((key) => categoryText.includes(key));
  const categoryItems = matchedKey ? ITEMS_BY_CATEGORY[matchedKey] : [];

  // Weather based items
  const weatherText = String(weather || '').toLowerCase();
  const weatherItems = [];
  if (/rain|monsoon/.test(weatherText)) weatherItems.push('Umbrella', 'Raincoat');
  if (/hot|warm/.test(weatherText)) weatherItems.push('Light clothes', 'Sunscreen', 'Water bottle');
  if (/cold|snow/.test(weatherText)) weatherItems.push('Warm layers', 'Gloves');

  // "new Set" removes duplicates (e.g. Sunscreen appears twice)
  const allNames = [...new Set([...basics, ...categoryItems, ...weatherItems])];

  return allNames.map((name) => ({
    name,
    packed: false,
    category: categoryItems.includes(name) ? categoryText || 'activity' : 'general',
  }));
}

// GET /api/packing
router.get('/', async (req, res) => {
  const items = await PackingList.find({ userId: req.userId }).sort({ updatedAt: -1 });
  res.json({ items });
});

// POST /api/packing/generate  -> create a list automatically
router.post('/generate', async (req, res) => {
  const { destination = '', category = '', weather = '', tripId = null } = req.body || {};
  const items = makePackingItems(category, weather);
  const list = await PackingList.create({ userId: req.userId, tripId, destination, items });
  res.status(201).json({ item: list });
});

// POST /api/packing  -> save a list the user wrote themselves
router.post('/', async (req, res) => {
  const item = await PackingList.create({ ...cleanBody(req.body), userId: req.userId });
  res.status(201).json({ item });
});

// PUT /api/packing/:id  -> update (e.g. tick items as packed)
router.put('/:id', async (req, res) => {
  const item = await PackingList.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    cleanBody(req.body),
    { returnDocument: 'after' }
  );
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({ item });
});

// DELETE /api/packing/:id
router.delete('/:id', async (req, res) => {
  await PackingList.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  res.json({ ok: true });
});

export default router;
