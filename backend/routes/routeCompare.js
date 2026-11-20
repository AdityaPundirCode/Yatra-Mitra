// ------------------------------------------------------------
// routes/routeCompare.js   ->   POST /api/routes/compare
// Compares distance and time for car, bicycle and walking.
// (train, bus and flight only show a straight-line distance,
//  because we have no live timetable API.)
//
// For each road mode we try, in this order:
//   1. Google Routes API   (only if a key is in .env)
//   2. OSRM (free OpenStreetMap routing)
//   3. A simple estimate from the straight-line distance
// ------------------------------------------------------------
import express from 'express';
import { auth } from '../middleware/auth.js';

const router = express.Router();

// Free routing servers, one for each travel mode
const OSRM_SERVERS = {
  car: 'https://router.project-osrm.org',
  bicycle: 'https://routing.openstreetmap.de/routed-bike',
  walking: 'https://routing.openstreetmap.de/routed-foot',
};

// Average speeds in metres per second (used only for the estimate)
const SPEEDS = { car: 13.9, bicycle: 4.2, walking: 1.4 };

const MODE_LABELS = { car: 'Car/Driving', bicycle: 'Bicycle', walking: 'Walking' };

// ---------- Straight-line distance between two points (Haversine formula) ----------
function straightDistance(a, b) {
  const EARTH_RADIUS = 6371000; // metres
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

// ---------- Option 1: Google Routes API ----------
async function googleRoute(origin, destination, mode) {
  const key = process.env.GOOGLE_ROUTES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null; // no key -> skip Google

  try {
    const travelMode = mode === 'bicycle' ? 'BICYCLE' : mode === 'walking' ? 'WALK' : 'DRIVE';
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lon } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lon } } },
        travelMode,
      }),
    });
    if (!response.ok) return null;

    const data = await response.json();
    const route = data.routes?.[0];
    if (!route) return null;

    // Google sends the time like "1234s" -> we want the number 1234
    const seconds = route.duration ? parseInt(String(route.duration).replace('s', ''), 10) : null;
    return { distance: route.distanceMeters, duration: seconds, source: 'Google Routes' };
  } catch {
    return null;
  }
}

// ---------- Option 2: OSRM (OpenStreetMap) ----------
async function osrmRoute(mode, coordinates) {
  const server = OSRM_SERVERS[mode] || OSRM_SERVERS.car;
  const response = await fetch(`${server}/route/v1/driving/${coordinates}?overview=false`);
  if (!response.ok) throw new Error('OSRM unavailable');

  const data = await response.json();
  if (data.code !== 'Ok' || !data.routes?.[0]) throw new Error('No OSRM route');

  return { distance: data.routes[0].distance, duration: data.routes[0].duration, source: 'OSRM (OpenStreetMap)' };
}

// ---------- Option 3: simple estimate ----------
function estimateRoute(mode, straightMeters) {
  const roadDistance = straightMeters * 1.3; // roads are longer than a straight line
  return {
    distance: roadDistance,
    duration: roadDistance / SPEEDS[mode],
    source: 'Estimated (routing unavailable)',
    estimated: true,
  };
}

// ---------- The route ----------
router.post('/compare', auth, async (req, res) => {
  const { origin, destination, stops = [] } = req.body || {};
  if (!origin?.lat || !destination?.lat) {
    return res.status(400).json({ error: 'origin and destination with lat/lon required' });
  }

  // Build the list of points: start -> stops -> end (keeping only valid coordinates)
  const points = [origin, ...(Array.isArray(stops) ? stops : []), destination]
    .filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))
    .map((p) => ({ lat: Number(p.lat), lon: Number(p.lon), name: p.name }));
  if (points.length < 2) return res.status(400).json({ error: 'At least two valid points required' });

  // OSRM wants coordinates as "lon,lat;lon,lat;..."
  const coordinates = points.map((p) => `${p.lon},${p.lat}`).join(';');

  // Total straight-line distance through all points
  let straightMeters = 0;
  for (let i = 1; i < points.length; i++) {
    straightMeters += straightDistance(points[i - 1], points[i]);
  }

  // Road modes: try Google, then OSRM, then estimate
  const modes = [];
  for (const mode of ['car', 'bicycle', 'walking']) {
    let result = await googleRoute(points[0], points[points.length - 1], mode);
    if (!result) {
      try {
        result = await osrmRoute(mode, coordinates);
      } catch {
        result = estimateRoute(mode, straightMeters);
      }
    }
    modes.push({
      mode,
      label: MODE_LABELS[mode],
      distanceMeters: Math.round(result.distance),
      durationSeconds: Math.round(result.duration),
      source: result.source,
      estimated: !!result.estimated,
    });
  }

  // Train / bus / flight: no live data, so we only give the distance and a hint.
  modes.push({
    mode: 'train', label: 'Train (rail)', distanceMeters: Math.round(straightMeters), durationSeconds: null,
    source: 'External schedule/fares required', external: true,
    note: 'Check live schedules and fares via rail providers/Google Maps.',
  });
  modes.push({
    mode: 'bus', label: 'Bus', distanceMeters: Math.round(straightMeters * 1.15), durationSeconds: null,
    source: 'External schedule/fares required', external: true,
    note: 'Check live bus routes and fares via providers/Google Maps.',
  });
  modes.push({
    mode: 'flight', label: 'Flight', distanceMeters: Math.round(straightMeters), durationSeconds: null,
    source: 'External schedule/fares required', external: true,
    note: 'Check live flight times and fares via airline/search providers.',
  });

  const googleConfigured = !!(process.env.GOOGLE_ROUTES_API_KEY || process.env.GOOGLE_MAPS_API_KEY);
  res.json({
    modes,
    pointsCount: points.length,
    providers: {
      road: googleConfigured ? 'Google Routes (preferred) with OSRM fallback' : 'OSRM (Google Routes key not configured)',
      transit: 'External lookup (no live transit API configured)',
    },
    note: 'Distances/times for road modes are route estimates; transit/flight require external live checks.',
  });
});

export default router;
