// ------------------------------------------------------------
// services/hotelService.js
// Finds hotels near a place, estimates their price/rating, and
// calculates a simple "safety score" from nearby police stations,
// hospitals, pharmacies and fire stations.
//
// NOTE: price and rating are ESTIMATES (OpenStreetMap has no real prices).
// ------------------------------------------------------------
import { overpassElements, distanceInKm, HTTP_HEADERS } from './placesApi.js';

const HOTEL_TYPES = ['hotel', 'hostel', 'guest_house', 'motel', 'apartment', 'resort', 'chalet'];
const HOTEL_CACHE_TTL_MS = 5 * 60 * 1000;
const HOTEL_STALE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const HOTEL_CACHE_MAX_ENTRIES = 200;
const hotelResultsCache = new Map();
const inFlightHotelSearches = new Map();

// Price range (in rupees) for each hotel type and star count.
const PRICE_RANGES = {
  hotel: { 1: [1200, 2200], 2: [2000, 3800], 3: [3500, 7000], 4: [6500, 12000], 5: [12000, 25000] },
  resort: { 4: [9000, 18000], 5: [18000, 40000] },
  hostel: { 0: [700, 1800] },
  guest_house: { 0: [1200, 3500] },
  motel: { 0: [1500, 3200] },
  chalet: { 0: [2500, 6500] },
  apartment: { 0: [2500, 7000] },
};

const STAR_RATINGS = { 5: 4.7, 4: 4.35, 3: 3.95, 2: 3.55, 1: 3.2 };
const TYPE_RATINGS = { chalet: 4.2, resort: 4.5, hotel: 4.0, guest_house: 4.2, apartment: 4.1, hostel: 4.0, motel: 3.75 };

// ---------- Estimation helpers ----------

// Turns a text into a fixed number. The same hotel name always gives the same number,
// so the estimated price does not change every time the page reloads.
function textToNumber(text) {
  let hash = 0;
  for (const char of String(text || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

// A repeatable "random" number between min and max for the given text.
function repeatableBetween(text, min, max) {
  const ratio = (textToNumber(text) % 1000) / 1000; // 0 to 0.999
  return min + ratio * (max - min);
}

function estimatePrice(type, stars, name) {
  const ranges = PRICE_RANGES[type] || PRICE_RANGES.hotel;
  const key = stars && ranges[String(stars)] ? String(stars) : Object.keys(ranges)[0];
  const [min, max] = ranges[key] || [2000, 5000];
  return Math.round(repeatableBetween(`${name}-price`, min, max) / 100) * 100; // round to nearest 100
}

function estimateRating(type, stars, name) {
  const base = (stars && STAR_RATINGS[stars]) || TYPE_RATINGS[type] || 3.9;
  const value = base + repeatableBetween(`${name}-rating`, -0.25, 0.25);
  return Number(Math.min(5, Math.max(2.8, value)).toFixed(1));
}

// Builds a list like ['Wi-Fi', 'Pool'] from the OpenStreetMap tags.
function findAmenities(tags) {
  const amenities = [];
  if (['wlan', 'yes'].includes(tags.internet_access) || tags.wifi === 'yes') amenities.push('Wi-Fi');
  if (tags.breakfast === 'yes') amenities.push('Breakfast');
  if (tags.swimming_pool === 'yes' || tags.leisure === 'swimming_pool') amenities.push('Pool');
  if (tags.parking === 'yes') amenities.push('Parking');
  if (tags.air_conditioning === 'yes') amenities.push('AC');
  if (tags.restaurant === 'yes') amenities.push('Restaurant');
  if (tags.bar === 'yes') amenities.push('Bar');
  if (tags.spa === 'yes') amenities.push('Spa');
  if (tags.wheelchair === 'yes') amenities.push('Wheelchair access');
  return amenities.slice(0, 6);
}

function getHotelImage(tags, name) {
  const image = String(tags.image || '').trim();
  if (/^https?:\/\//i.test(image)) {
    return { image, imageSource: 'listing' };
  }

  const commonsFile = String(tags.wikimedia_commons || '').trim();
  if (commonsFile) {
    if (/^https?:\/\//i.test(commonsFile)) {
      return { image: commonsFile, imageSource: 'listing' };
    }

    const filename = commonsFile.replace(/^(file|image):/i, '');
    return {
      image: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=900`,
      imageSource: 'listing',
    };
  }

  return {
    image: `https://picsum.photos/seed/${encodeURIComponent(`hotel-${name}`)}/900/600`,
    imageSource: 'illustrative',
  };
}

// ---------- Helpers shared by the search methods ----------
function boundingBox(lat, lon, radiusKm) {
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return { west: lon - lonDelta, south: lat - latDelta, east: lon + lonDelta, north: lat + latDelta };
}

const OSM_TYPE_NAMES = { N: 'node', W: 'way', R: 'relation', node: 'node', way: 'way', relation: 'relation' };

// ---------- Method 1: Overpass (OpenStreetMap category search - the most complete) ----------
// Asks OSM directly for every tourism=hotel/guest_house/... object around the point,
// so it finds places even when their name does not contain the word "hotel".
async function overpassHotels(lat, lon, radiusKm) {
  const radiusMeters = Math.round(radiusKm * 1000);
  const typeRegex = `^(${HOTEL_TYPES.join('|')})$`;
  const query =
    `[out:json][timeout:25];` +
    `nwr(around:${radiusMeters},${lat},${lon})["tourism"~"${typeRegex}"];` +
    `out center tags 120;`;
  return overpassElements(query);
}

// ---------- Method 2: Nominatim (OSM search engine, bounded to a box around the point) ----------
async function nominatimHotels(lat, lon, radiusKm) {
  const box = boundingBox(lat, lon, radiusKm);
  const viewbox = [box.west, box.north, box.east, box.south].map((n) => n.toFixed(6)).join(',');
  const terms = ['hotel', 'guest house'];
  const found = [];
  let anySucceeded = false;
  let lastError = null;

  // Nominatim's usage policy allows ~1 request per second, so these run one after the other.
  for (const [index, term] of terms.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1100));
    try {
      const params = new URLSearchParams({
        q: term, format: 'jsonv2', viewbox, bounded: '1', limit: '40', extratags: '1', addressdetails: '1',
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: HTTP_HEADERS,
        signal: AbortSignal.timeout(9000),
      });
      if (!response.ok) throw new Error(`Nominatim returned HTTP ${response.status}.`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('Nominatim returned an invalid response.');
      anySucceeded = true;

      for (const row of data) {
        const kind = row.type || row.addresstype;
        if (row.category !== 'tourism' || !HOTEL_TYPES.includes(kind)) continue;
        const address = row.address || {};
        found.push({
          type: OSM_TYPE_NAMES[row.osm_type] || 'node',
          id: row.osm_id,
          lat: Number(row.lat),
          lon: Number(row.lon),
          tags: {
            ...(row.extratags || {}),
            tourism: kind,
            name: row.name || address.tourism || '',
            'addr:housenumber': address.house_number,
            'addr:street': address.road,
            'addr:city': address.city || address.town || address.village || address.suburb || address.state_district,
          },
        });
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (!anySucceeded) throw lastError || new Error('Nominatim hotel search is unavailable.');
  return found;
}

// ---------- Method 3: Photon (name-based search, a last-resort extra source) ----------
async function photonHotels(lat, lon, radiusKm) {
  const box = boundingBox(lat, lon, radiusKm);
  const bbox = [box.west, box.south, box.east, box.north].join(',');
  const words = ['hotel', 'guest house'];

  const searches = await Promise.allSettled(
    words.map(async (word) => {
      const params = new URLSearchParams({ q: word, limit: '50', lang: 'en', lat: String(lat), lon: String(lon), bbox, osm_tag: 'tourism' });
      const response = await fetch(`https://photon.komoot.io/api/?${params}`, {
        headers: HTTP_HEADERS,
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`Photon returned HTTP ${response.status}.`);
      const data = await response.json();
      if (!Array.isArray(data.features)) throw new Error('Photon returned an invalid response.');
      return data.features;
    })
  );

  if (searches.every((result) => result.status === 'rejected')) {
    throw new Error('Photon hotel search is unavailable.');
  }

  const elements = [];
  for (const feature of searches.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))) {
    const p = feature.properties || {};
    if (p.osm_key !== 'tourism' || !HOTEL_TYPES.includes(p.osm_value)) continue;
    const [hotelLon, hotelLat] = feature.geometry?.coordinates || [];
    if (!Number.isFinite(hotelLat) || !Number.isFinite(hotelLon)) continue;

    elements.push({
      type: OSM_TYPE_NAMES[p.osm_type] || 'node',
      id: p.osm_id || `${hotelLat}-${hotelLon}`,
      lat: hotelLat,
      lon: hotelLon,
      tags: {
        ...(p.extra || {}),
        tourism: p.osm_value,
        name: p.name,
        stars: p.stars || p.extra?.stars,
        image: p.image || p.extra?.image,
        wikimedia_commons: p.wikimedia_commons || p.extra?.wikimedia_commons,
        'addr:housenumber': p.housenumber,
        'addr:street': p.street,
        'addr:city': p.city || p.state,
      },
    });
  }
  return elements;
}

// ---------- Run the methods and merge what they find ----------
// Group A: Overpass (tries several mirrors).  Group B: Nominatim, then Photon if Nominatim fails.
// They run at the same time, so a slow or blocked provider does not make the whole search fail.
function mergeElements(lists) {
  const unique = new Map();
  for (const element of lists.flat()) {
    const elementLat = element.lat ?? element.center?.lat;
    const elementLon = element.lon ?? element.center?.lon;
    if (!Number.isFinite(elementLat) || !Number.isFinite(elementLon)) continue;
    const tourism = element.tags?.tourism;
    if (!HOTEL_TYPES.includes(tourism)) continue;

    const byId = `${element.type}-${element.id}`;
    const byName = `${String(element.tags?.name || '').toLowerCase()}|${elementLat.toFixed(3)}|${elementLon.toFixed(3)}`;
    if (unique.has(byId) || (element.tags?.name && unique.has(byName))) continue;
    unique.set(byId, element);
    if (element.tags?.name) unique.set(byName, element);
  }
  return [...new Set(unique.values())];
}

async function searchHotelSources(lat, lon, radiusKm) {
  const sourcesUsed = [];
  const failures = [];

  const groupA = overpassHotels(lat, lon, radiusKm).then(
    (elements) => { sourcesUsed.push('OpenStreetMap/Overpass'); return elements; },
    (error) => { failures.push(`Overpass: ${error.message}`); return null; }
  );

  const groupB = nominatimHotels(lat, lon, radiusKm)
    .then((elements) => { sourcesUsed.push('Nominatim/OSM'); return elements; })
    .catch((error) => {
      failures.push(`Nominatim: ${error.message}`);
      return photonHotels(lat, lon, radiusKm).then(
        (elements) => { sourcesUsed.push('Photon/OSM'); return elements; },
        (photonError) => { failures.push(`Photon: ${photonError.message}`); return null; }
      );
    });

  const [overpassResult, secondaryResult] = await Promise.all([groupA, groupB]);
  const lists = [overpassResult, secondaryResult].filter(Array.isArray);

  if (!lists.length) {
    console.warn('All hotel providers failed:', failures.join(' | '));
    const failure = new Error('Nearby hotel data providers are temporarily unavailable. Please try again shortly.');
    failure.status = 502;
    throw failure;
  }

  const elements = mergeElements(lists).filter((item) => {
    const itemLat = item.lat ?? item.center?.lat;
    const itemLon = item.lon ?? item.center?.lon;
    return distanceInKm(lat, lon, itemLat, itemLon) <= radiusKm;
  });
  return { elements, source: sourcesUsed.join(' + ') };
}

// ---------- Format hotels for the frontend ----------
function formatHotels(elements, lat, lon, areaName) {
  const seen = new Set();
  const hotels = [];

  for (const item of elements) {
    const tags = item.tags || {};
    const hotelLat = item.lat ?? item.center?.lat;
    const hotelLon = item.lon ?? item.center?.lon;
    if (!Number.isFinite(hotelLat) || !Number.isFinite(hotelLon)) continue;

    const rawType = String(tags.tourism || 'hotel');
    const name = tags.name || tags.brand || `${rawType.replace(/_/g, ' ')} near ${areaName}`;

    // skip duplicates
    const key = `${name.toLowerCase()}|${hotelLat.toFixed(4)}|${hotelLon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const stars = Number(tags.stars) || 0;
    const pricePerNight = estimatePrice(rawType, stars, name);
    const rating = estimateRating(rawType, stars, name);
    const distanceKm = Number(distanceInKm(lat, lon, hotelLat, hotelLon).toFixed(2));

    hotels.push({
      id: `${item.type}-${item.id}`,
      name,
      ...getHotelImage(tags, name),
      type: rawType.replace(/_/g, ' '),
      rawType,
      stars: stars || null,
      rating,
      ratingSource: 'Estimated from listing details',
      pricePerNight,
      currency: 'INR',
      priceLabel: `${new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(pricePerNight)} / night (est.)`,
      distanceKm,
      address: [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(' '),
      lat: hotelLat,
      lon: hotelLon,
      mapUrl: `https://www.openstreetmap.org/${item.type}/${item.id}`,
      amenities: findAmenities(tags),
      // Higher score = better: good rating, low price, close by.
      bestScore: Number((rating * 2 - pricePerNight / 10000 - distanceKm * 0.15).toFixed(3)),
    });
  }

  return hotels.sort((a, b) => b.bestScore - a.bestScore);
}

// ---------- Safety score ----------
function calculateSafety(safetyElements, lat, lon, hotelCount) {
  // Turn the raw OpenStreetMap items into { name, amenity, distanceKm }
  const places = [];
  for (const item of safetyElements) {
    const tags = item.tags || {};
    const placeLat = item.lat ?? item.center?.lat;
    const placeLon = item.lon ?? item.center?.lon;
    if (!Number.isFinite(placeLat) || !Number.isFinite(placeLon)) continue;

    places.push({
      id: `${item.type}-${item.id}`,
      name: tags.name || String(tags.amenity || '').replace(/_/g, ' '),
      amenity: tags.amenity || '',
      distanceKm: Number(distanceInKm(lat, lon, placeLat, placeLon).toFixed(2)),
    });
  }

  // The closest place of one kind (or null)
  const nearest = (amenity) =>
    places.filter((place) => place.amenity === amenity).sort((a, b) => a.distanceKm - b.distanceKm)[0] || null;

  const police = nearest('police');
  const hospital = nearest('hospital');
  const pharmacy = nearest('pharmacy');
  const fireStation = nearest('fire_station');

  let score = 5.2; // starting score
  const factors = [];

  if (police) {
    score += police.distanceKm <= 1 ? 1.6 : police.distanceKm <= 2.5 ? 1 : 0.4;
    factors.push({ label: 'Police station', detail: `${police.distanceKm.toFixed(1)} km away` });
  } else {
    factors.push({ label: 'Police station', detail: 'None mapped within the search radius' });
  }

  if (hospital) {
    score += hospital.distanceKm <= 1.5 ? 1.4 : hospital.distanceKm <= 3 ? 0.8 : 0.3;
    factors.push({ label: 'Hospital', detail: `${hospital.distanceKm.toFixed(1)} km away` });
  } else {
    factors.push({ label: 'Hospital', detail: 'None mapped within the search radius' });
  }

  if (pharmacy) {
    score += pharmacy.distanceKm <= 1 ? 0.6 : 0.25;
    factors.push({ label: 'Pharmacy', detail: `${pharmacy.distanceKm.toFixed(1)} km away` });
  }
  if (fireStation) {
    score += 0.2;
    factors.push({ label: 'Fire station', detail: `${fireStation.distanceKm.toFixed(1)} km away` });
  }

  // More hotels nearby usually means a busier, more tourist-friendly area.
  if (hotelCount >= 5) score += 0.4;
  else if (hotelCount >= 2) score += 0.2;

  score = Math.min(9.5, Math.round(score * 10) / 10);
  const label = score >= 8 ? 'Very safe' : score >= 6.5 ? 'Safe' : score >= 5 ? 'Moderate' : 'Exercise caution';

  return {
    score,
    label,
    factors,
    nearestPolice: police,
    nearestHospital: hospital,
    note: 'Estimated from nearby police, hospitals, pharmacies, fire stations, and hotel density. Verify with local advice before booking.',
  };
}

// ---------- Main function used by the route ----------
const hotelCacheKey = ({ lat, lon, radiusKm }) => `${lat.toFixed(3)}:${lon.toFixed(3)}:${radiusKm}`;

export async function findNearbyHotels(params) {
  const { lat, lon, radiusKm, name } = params;
  const cacheKey = hotelCacheKey(params);
  const withName = (result) => ({ ...result, area: { ...result.area, name } });

  const cached = hotelResultsCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return withName(cached.result);
  if (cached && cached.staleUntil <= now) hotelResultsCache.delete(cacheKey);

  const inFlight = inFlightHotelSearches.get(cacheKey);
  if (inFlight) return withName(await inFlight);

  const search = findNearbyHotelsUncached(params);
  inFlightHotelSearches.set(cacheKey, search);
  try {
    const result = await search;
    if (hotelResultsCache.size >= HOTEL_CACHE_MAX_ENTRIES) {
      hotelResultsCache.delete(hotelResultsCache.keys().next().value);
    }
    // An empty answer may just be a hiccup in a public service, so keep it for 30 seconds only.
    const ttl = result.hotelCount > 0 ? HOTEL_CACHE_TTL_MS : 30 * 1000;
    const expiresAt = Date.now() + ttl;
    hotelResultsCache.set(cacheKey, {
      result,
      expiresAt,
      staleUntil: result.hotelCount > 0 ? expiresAt + HOTEL_STALE_CACHE_TTL_MS : expiresAt,
    });
    return withName(result);
  } catch (error) {
    if (!cached || cached.staleUntil <= now) throw error;
    console.warn('Nearby-hotel providers failed; returning cached results:', error.message);
    return withName({
      ...cached.result,
      note: `Live hotel data is temporarily unavailable; showing the last successful results. ${cached.result.note}`,
    });
  } finally {
    inFlightHotelSearches.delete(cacheKey);
  }
}

// Widen the search (5 km -> 10 km -> 20 km) when nothing is found, e.g. in small towns.
function radiiToTry(radiusKm) {
  return [radiusKm, 10, 20].filter((value, index, list) => value >= radiusKm && list.indexOf(value) === index);
}

async function findNearbyHotelsUncached({ lat, lon, radiusKm, name }) {
  let found = { elements: [], source: '' };
  let usedRadiusKm = radiusKm;

  for (const radius of radiiToTry(radiusKm)) {
    found = await searchHotelSources(lat, lon, radius);
    usedRadiusKm = radius;
    if (found.elements.length) break;
  }

  const hotels = formatHotels(found.elements, lat, lon, name).slice(0, 60);

  // Safety information is a nice extra - if it fails the hotels are still shown.
  let safety = null;
  if (hotels.length) {
    const safetyMeters = Math.round(radiusKm * 1000);
    const safetyQuery =
      `[out:json][timeout:20];` +
      `nwr(around:${safetyMeters},${lat},${lon})["amenity"~"^(police|hospital|pharmacy|fire_station)$"];` +
      `out center tags 80;`;
    try {
      safety = calculateSafety(await overpassElements(safetyQuery), lat, lon, hotels.length);
    } catch (error) {
      console.warn('Safety lookup failed:', error.message);
    }
  }

  const expandedNote =
    usedRadiusKm > radiusKm
      ? `No listings were found within ${radiusKm} km, so the search expanded to ${usedRadiusKm} km. `
      : '';

  return {
    area: { name, lat, lon, radiusKm: usedRadiusKm, safetyRadiusKm: radiusKm },
    hotelCount: hotels.length,
    hotels,
    safety,
    source: found.source,
    note: `${expandedNote}Hotel listings come from ${found.source || 'OpenStreetMap'}. Ratings and prices are estimates, not live availability.`,
  };
}
