// ------------------------------------------------------------
// routes/destinations.js   ->   /api/destinations/...
//
// IMPORTANT: the order of routes matters in Express.
// "/:identifier" matches ANY text, so it must stay at the very bottom.
// ------------------------------------------------------------
import express from 'express';
import { auth } from '../middleware/auth.js';
import { getTokenFromRequest, verifyAccessToken } from '../utils/tokens.js';
import { SearchHistory } from '../models/SearchHistory.js';
import {
  searchDestinations, autocompleteDestinations, getCategories, getFilterOptions,
  getPopularDestinations, getTrendingDestinations, getDestinationByIdentifier,
} from '../services/destinationService.js';
import {
  listRecentlyViewed, recordRecentlyViewed, removeRecentlyViewed, clearRecentlyViewed,
} from '../services/recentlyViewedService.js';
import { photonSearch, fetchWikipediaSummary, fetchWeather, fetchNearbyPlaces, fetchPointsOfInterest, geocodePlace } from '../services/placesApi.js';
import { findNearbyHotels } from '../services/hotelService.js';

const router = express.Router();

// OpenStreetMap "tourism" values that are not sights (places to sleep, signs, etc.).
const NOT_ATTRACTIONS = new Set([
  'hotel', 'hostel', 'guest_house', 'motel', 'apartment', 'chalet', 'resort',
  'information', 'camp_site', 'caravan_site', 'picnic_site',
]);

// Search is public, but if the user IS logged in we save their search.
// This returns the user id, or null when nobody is logged in.
function getUserIdIfLoggedIn(req) {
  try {
    const token = getTokenFromRequest(req);
    return token ? verifyAccessToken(token).userId : null;
  } catch {
    return null;
  }
}

// Small map links for OpenStreetMap. "zoom" decides how big the area is.
function makeMapLinks(lat, lon, boxSize, zoom) {
  return {
    embed: `https://www.openstreetmap.org/export/embed.html?bbox=${lon - boxSize}%2C${lat - boxSize}%2C${lon + boxSize}%2C${lat + boxSize}&layer=mapnik&marker=${lat}%2C${lon}`,
    link: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`,
  };
}

// ============================================================
// Search and lists
// ============================================================

// GET /api/destinations/search?q=goa&category=beach&sort=rating&page=1
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const filters = {
    country: String(req.query.country || '').trim(),
    city: String(req.query.city || '').trim(),
    category: String(req.query.category || '').trim(),
    budget: String(req.query.budget || '').trim(),
    minBudget: req.query.minBudget,
    maxBudget: req.query.maxBudget,
    minRating: req.query.minRating,
  };

  const data = await searchDestinations({
    q,
    ...filters,
    sort: String(req.query.sort || '').trim(),
    page: req.query.page,
    limit: req.query.limit,
    includeExternal: req.query.includeExternal,
  });

  // Save the search for logged-in users (we don't wait for it to finish).
  const userId = getUserIdIfLoggedIn(req);
  if (userId && q) {
    SearchHistory.create({ userId, query: q, filters }).catch(() => {});
  }

  res.json(data);
});

// GET /api/destinations/autocomplete?q=jai
router.get('/autocomplete', async (req, res) => {
  const suggestions = await autocompleteDestinations(req.query.q, req.query.limit);
  res.json({ suggestions });
});

// GET /api/destinations/categories
router.get('/categories', async (req, res) => {
  res.json(await getCategories());
});

// GET /api/destinations/filters
router.get('/filters', async (req, res) => {
  res.json(await getFilterOptions());
});

// GET /api/destinations/popular
router.get('/popular', async (req, res) => {
  res.json({ items: await getPopularDestinations(req.query.limit) });
});

// GET /api/destinations/trending
router.get('/trending', async (req, res) => {
  res.json({ items: await getTrendingDestinations(req.query.limit) });
});

// ============================================================
// Recently viewed (login required)
// ============================================================

// GET /api/destinations/recently-viewed
router.get('/recently-viewed', auth, async (req, res) => {
  res.json({ items: await listRecentlyViewed(req.userId, req.query.limit) });
});

// POST /api/destinations/recently-viewed   body: { slug }
router.post('/recently-viewed', auth, async (req, res) => {
  const slug = String(req.body?.slug || '').trim();
  if (!slug) return res.status(400).json({ error: 'A destination slug is required.' });

  const item = await recordRecentlyViewed(req.userId, slug);
  if (!item) return res.status(404).json({ error: 'Destination not found.' });
  res.status(201).json({ item });
});

// DELETE /api/destinations/recently-viewed  -> clear all
router.delete('/recently-viewed', auth, async (req, res) => {
  await clearRecentlyViewed(req.userId);
  res.json({ ok: true });
});

// DELETE /api/destinations/recently-viewed/:id  -> remove one
router.delete('/recently-viewed/:id', auth, async (req, res) => {
  const removed = await removeRecentlyViewed(req.userId, req.params.id);
  if (!removed) return res.status(404).json({ error: 'Recently viewed item not found.' });
  res.json({ ok: true });
});

// ============================================================
// Details of a place (weather, nearby places, costs)
// ============================================================

// GET /api/destinations/details?name=...&lat=...&lon=...
router.get('/details', async (req, res) => {
  const name = String(req.query.name || '').trim();
  const hasValue = (value) => value != null && String(value).trim() !== '';
  const lat = hasValue(req.query.lat) ? Number(req.query.lat) : NaN;
  const lon = hasValue(req.query.lon) ? Number(req.query.lon) : NaN;
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

  if (!name && !hasCoordinates) return res.status(400).json({ error: 'name or valid lat/lon required' });

  const weather = hasCoordinates ? await fetchWeather(lat, lon) : null;
  const nearby = hasCoordinates ? await fetchNearbyPlaces(lat, lon) : [];

  res.json({
    name,
    lat: hasCoordinates ? lat : null,
    lon: hasCoordinates ? lon : null,
    description: `${name} - explore details, nearby attractions, and plan your visit.`,
    bestTimeToVisit: 'Best time varies by season and weather; check local forecasts before travel.',
    estimatedDailyExpenses: {
      budget: 'Rs 1,500 - 3,000 (estimate)',
      mid: 'Rs 3,000 - 7,000 (estimate)',
      premium: 'Rs 7,000+ (estimate)',
      note: 'Estimates vary widely by season, location, and choices.',
    },
    weather: weather || {
      unavailable: true,
      note: 'Weather API key not configured. Check a weather service for current conditions.',
    },
    nearbyAttractions: nearby.filter((p) => p.type && p.type !== 'restaurant' && !NOT_ATTRACTIONS.has(p.type)).slice(0, 8),
    nearbyRestaurants: nearby.filter((p) => p.type === 'restaurant').slice(0, 8),
    maps: hasCoordinates ? makeMapLinks(lat, lon, 0.05, 13) : null,
    source: 'OpenStreetMap/Overpass' + (weather ? ' + OpenWeatherMap' : ''),
  });
});

// GET /api/destinations/attraction?name=Hawa Mahal&city=Jaipur
router.get('/attraction', async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Attraction name is required.' });

  const city = String(req.query.city || '').trim();
  const country = String(req.query.country || '').trim();
  let category = String(req.query.category || '').trim();
  let address = [city, country].filter(Boolean).join(', ');
  let lat = req.query.lat != null && req.query.lat !== '' ? Number(req.query.lat) : null;
  let lon = req.query.lon != null && req.query.lon !== '' ? Number(req.query.lon) : null;
  let osmCategory = '';

  // No coordinates given? Find them by searching the name.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    lat = null;
    lon = null;
    try {
      const places = await photonSearch([name, city, country].filter(Boolean).join(', '), 3);
      const lowerName = name.toLowerCase();
      const match =
        places.find((p) => p.name.toLowerCase().includes(lowerName)) ||
        places.find((p) => lowerName.includes(p.name.toLowerCase())) ||
        places[0];
      if (match) {
        lat = Number(match.lat);
        lon = Number(match.lon);
        if (match.address) address = match.address;
        osmCategory = match.category || '';
      }
    } catch {
      // Finding coordinates is optional.
    }
  }

  // Wikipedia gives the description and picture (also optional).
  let wiki = null;
  try {
    wiki = await fetchWikipediaSummary([name, city || country].filter(Boolean).join(' '));
  } catch {
    wiki = null;
  }

  category = category || osmCategory || 'attraction';
  const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon);

  res.json({
    attraction: {
      name,
      description: wiki?.extract || `${name} is a popular ${category} attraction${address ? ` in ${address}` : ''}.`,
      category,
      address,
      lat: hasCoordinates ? lat : null,
      lon: hasCoordinates ? lon : null,
      image: wiki?.thumbnail || `https://picsum.photos/seed/${encodeURIComponent(`${name}-attraction`)}/900/600`,
      wikipedia: wiki,
      maps: hasCoordinates ? makeMapLinks(lat, lon, 0.01, 16) : null,
      source: [wiki ? 'Wikipedia' : '', hasCoordinates ? 'OpenStreetMap' : ''].filter(Boolean).join(' + ') || 'Trip planner',
    },
  });
});

// GET /api/destinations/geocode?q=Hawa Mahal, Jaipur   (name -> coordinates, nothing is saved)
router.get('/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.status(400).json({ error: 'Enter at least 2 characters to look up a place.' });
  try {
    const place = await geocodePlace(q);
    if (!place) return res.status(404).json({ error: `No map location found for "${q}".` });
    res.json({ place });
  } catch (error) {
    console.warn('Geocode failed:', error.message);
    res.status(502).json({ error: 'Place lookup is temporarily unavailable. Please try again shortly.' });
  }
});

// GET /api/destinations/nearby-places?lat=..&lon=..&radius=5   (tourist places around a visitor)
router.get('/nearby-places', async (req, res) => {
  const hasValue = (value) => value != null && String(value).trim() !== '';
  const lat = hasValue(req.query.lat) ? Number(req.query.lat) : NaN;
  const lon = hasValue(req.query.lon) ? Number(req.query.lon) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'Valid lat and lon are required.' });
  }
  const radiusKm = Math.min(20, Math.max(1, Number(req.query.radius) || 5));

  try {
    const places = await fetchPointsOfInterest(lat, lon, Math.round(radiusKm * 1000));
    res.json({ area: { lat, lon, radiusKm }, count: places.length, places, source: 'OpenStreetMap/Overpass' });
  } catch (error) {
    console.warn('Nearby places lookup failed:', error.message);
    res.status(502).json({ error: 'Nearby place data providers are temporarily unavailable. Please try again shortly.' });
  }
});

// GET /api/destinations/nearby-hotels?lat=..&lon=..&radius=3&name=...
router.get('/nearby-hotels', async (req, res) => {
  const hasValue = (value) => value != null && String(value).trim() !== '';
  const lat = hasValue(req.query.lat) ? Number(req.query.lat) : NaN;
  const lon = hasValue(req.query.lon) ? Number(req.query.lon) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return res.status(400).json({ error: 'Valid lat and lon are required.' });
  }

  const radiusKm = Math.min(20, Math.max(1, Number(req.query.radius) || 3));
  const name = String(req.query.name || 'this attraction').trim();

  res.json(await findNearbyHotels({ lat, lon, radiusKm, name }));
});

// ============================================================
// One destination  (KEEP THIS LAST - it matches any text)
// ============================================================

// GET /api/destinations/jaipur-india
router.get('/:identifier', async (req, res) => {
  const destination = await getDestinationByIdentifier(req.params.identifier);
  if (!destination) return res.status(404).json({ error: 'Destination not found.' });
  res.json({ destination });
});

export default router;
