// ------------------------------------------------------------
// services/placesApi.js
// Talks to FREE outside websites (no key needed, except weather):
//   Photon      -> search places by name
//   Wikipedia   -> short description + picture
//   Overpass    -> OpenStreetMap data (restaurants, hospitals, hotels...)
//   OpenWeather -> weather (needs WEATHER_API_KEY)
// ------------------------------------------------------------

// Public OpenStreetMap services (Overpass, Nominatim, Photon) often reject requests
// that have no User-Agent, so every outgoing request identifies the app.
export const HTTP_HEADERS = {
  'User-Agent': `YatraMitra/1.0 (travel planner; ${process.env.CONTACT_EMAIL || 'contact: set CONTACT_EMAIL in .env'})`,
  'Accept-Language': 'en',
};

// ---------- Photon: search places by name ----------
export async function photonSearch(query, limit = 10) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${limit}&lang=en`;
  const response = await fetch(url, { headers: HTTP_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Search provider unavailable');

  const data = await response.json();
  const places = (data.features || []).map((feature) => {
    const p = feature.properties || {};
    const name = p.name || [p.street, p.city, p.country].filter(Boolean).join(', ') || 'Unknown place';
    const addressParts = [p.city, p.state, p.country].filter(Boolean);

    const description =
      p.extent || p.street
        ? `${name} near ${[p.street, p.city, p.country].filter(Boolean).join(', ')}`
        : `${name}${p.state ? ', ' + p.state : ''}${p.country ? ', ' + p.country : ''}`;

    return {
      placeId: `photon:${p.osm_type || ''}:${p.osm_id || ''}:${name}`,
      name,
      address: addressParts.join(', ') || p.country || '',
      country: p.country || '',
      city: p.city || p.state || '',
      region: p.state || '',
      category: p.osm_value || p.osm_key || 'place',
      lat: feature.geometry?.coordinates?.[1],
      lon: feature.geometry?.coordinates?.[0],
      description,
      data: p,
    };
  });

  return places.filter((place) => place.name && place.name !== 'Unknown place');
}

// ---------- Geocode: turn a place name into coordinates (Photon first, Nominatim as backup) ----------
export async function geocodePlace(query) {
  try {
    const places = await photonSearch(query, 5);
    const match = places.find((place) => Number.isFinite(place.lat) && Number.isFinite(place.lon));
    if (match) return { name: match.name, address: match.address, lat: match.lat, lon: match.lon, source: 'Photon/OSM' };
  } catch {
    // fall through to Nominatim
  }

  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', addressdetails: '0' });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: HTTP_HEADERS,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Geocoding providers are unavailable');
  const rows = await response.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;
  return { name: row.name || query, address: row.display_name || '', lat: Number(row.lat), lon: Number(row.lon), source: 'Nominatim/OSM' };
}

// ---------- Wikipedia: short summary of a place ----------
export async function fetchWikipediaSummary(name) {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&generator=search' +
    `&gsrsearch=${encodeURIComponent(name)}&gsrlimit=1` +
    '&prop=extracts|pageimages|info&inprop=url&exintro=1&explaintext=1&pithumbsize=640&format=json&origin=*';

  const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) return null;

  const data = await response.json();
  const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
  const page = pages[0];
  if (!page || !page.title) return null;

  return {
    title: page.title,
    extract: String(page.extract || '').trim(),
    thumbnail: page.thumbnail?.source || '',
    url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(String(page.title).replace(/ /g, '_'))}`,
  };
}

// ---------- Weather (optional) ----------
// Returns null when there is no API key or the request fails.
export async function fetchWeather(lat, lon) {
  const key = process.env.WEATHER_API_KEY;
  if (!key || lat == null || lon == null) return null;

  try {
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${key}`
    );
    if (!response.ok) return null;

    const data = await response.json();
    return {
      temp: data.main?.temp,
      feelsLike: data.main?.feels_like,
      description: data.weather?.[0]?.description,
      humidity: data.main?.humidity,
      wind: data.wind?.speed,
      source: 'OpenWeatherMap',
    };
  } catch {
    return null;
  }
}

// ---------- Overpass: points of interest around a visitor (Near Me page) ----------
// Includes nodes AND areas (parks, malls, big attractions are mapped as areas), nearest first.
export async function fetchPointsOfInterest(lat, lon, radiusMeters = 5000, limit = 40) {
  const around = `(around:${radiusMeters},${lat},${lon})`;
  const query =
    `[out:json][timeout:25];(` +
    `nwr${around}[tourism][tourism!~"^(hotel|hostel|guest_house|motel|apartment|chalet|resort|information|camp_site|caravan_site)$"][name];` +
    `nwr${around}[amenity~"^(theatre|cinema|marketplace|events_venue|arts_centre|community_centre)$"][name];` +
    `nwr${around}[leisure~"^(park|garden)$"][name];` +
    `nwr${around}[historic][name];` +
    `);out center tags 150;`;

  const elements = await overpassElements(query);
  const seen = new Set();
  const places = [];
  for (const element of elements) {
    const tags = element.tags || {};
    const placeLat = element.lat ?? element.center?.lat;
    const placeLon = element.lon ?? element.center?.lon;
    if (!tags.name || !Number.isFinite(placeLat) || !Number.isFinite(placeLon)) continue;

    const key = `${tags.name.toLowerCase()}|${placeLat.toFixed(3)}|${placeLon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    places.push({
      id: `${element.type}-${element.id}`,
      name: tags.name,
      type: tags.tourism || (tags.historic ? 'historic' : '') || tags.amenity || tags.leisure || 'place',
      lat: placeLat,
      lon: placeLon,
      distanceKm: Number(distanceInKm(lat, lon, placeLat, placeLon).toFixed(2)),
    });
  }
  return places.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, limit);
}

// ---------- Overpass with backup servers ----------
// If the first server fails we try the next one.
const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// ---------- Overpass: tourist places + restaurants within 3 km ----------
// Uses the multi-server helper below, so one slow server no longer returns an empty list.
export async function fetchNearbyPlaces(lat, lon) {
  try {
    const query =
      `[out:json][timeout:20];(` +
      `nwr(around:3000,${lat},${lon})[tourism][name];` +
      `nwr(around:3000,${lat},${lon})[amenity=restaurant][name];` +
      `);out center tags 40;`;
    const elements = await overpassElements(query);
    return elements
      .filter((element) => element.tags?.name)
      .map((element) => ({
        name: element.tags.name,
        type: element.tags.tourism || element.tags.amenity,
        lat: element.lat ?? element.center?.lat,
        lon: element.lon ?? element.center?.lon,
      }))
      .filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lon));
  } catch {
    return [];
  }
}

export async function overpassElements(query, servers = OVERPASS_SERVERS, timeoutMs = 12000) {
  const failures = [];

  for (const server of servers) {
    try {
      const response = await fetch(server, {
        method: 'POST',
        headers: { ...HTTP_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);

      const data = await response.json();
      if (!Array.isArray(data.elements)) throw new Error('Provider returned an invalid response.');
      return data.elements;
    } catch (error) {
      failures.push(error.message || 'Provider request failed.');
    }
  }

  throw new Error(`All OpenStreetMap providers failed: ${failures.join(' ')}`);
}

// ---------- Distance between two GPS points, in kilometres ----------
export function distanceInKm(lat1, lon1, lat2, lon2) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
