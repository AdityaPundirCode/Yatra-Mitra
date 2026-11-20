// Run with:  node tests/hotelService.test.mjs
// Mocks the public map providers so the hotel search logic can be tested offline.
import assert from 'node:assert/strict';

const LAT = 26.9124, LON = 75.7873; // Jaipur
const near = (d) => ({ lat: LAT + d, lon: LON + d });

const overpassHotel = (id, name, tourism, d, extra = {}) => ({ type: 'node', id, ...near(d), tags: { tourism, name, ...extra } });
const OVERPASS = [
  overpassHotel(1, 'Taj Palace Residency', 'hotel', 0.004, { stars: '5' }),       // NO word "hotel" in the name
  overpassHotel(2, 'Pink City Guest House', 'guest_house', 0.006),
  overpassHotel(3, 'Zostel Jaipur', 'hostel', 0.008),
];
const SAFETY = [
  { type: 'node', id: 90, ...near(0.003), tags: { amenity: 'police', name: 'Kotwali' } },
  { type: 'node', id: 91, ...near(0.005), tags: { amenity: 'hospital', name: 'SMS Hospital' } },
];
const NOMINATIM = [
  { osm_type: 'node', osm_id: 1, lat: String(LAT + 0.004), lon: String(LON + 0.004), category: 'tourism', type: 'hotel', name: 'Taj Palace Residency', address: { road: 'MI Road', city: 'Jaipur' }, extratags: { stars: '5' } },
  { osm_type: 'way', osm_id: 77, lat: String(LAT + 0.01), lon: String(LON + 0.01), category: 'tourism', type: 'resort', name: 'Rambagh Retreat', address: { city: 'Jaipur' }, extratags: {} },
  { osm_type: 'node', osm_id: 5, lat: String(LAT), lon: String(LON), category: 'amenity', type: 'restaurant', name: 'Not a hotel' },
];
const PHOTON = { features: [
  { geometry: { coordinates: [LON + 0.002, LAT + 0.002] }, properties: { osm_key: 'tourism', osm_value: 'hotel', osm_type: 'N', osm_id: 300, name: 'Photon Only Hotel' } },
  { geometry: { coordinates: [LON, LAT] }, properties: { osm_key: 'amenity', osm_value: 'cafe', osm_type: 'N', osm_id: 301, name: 'Cafe' } },
] };

let mode = {};
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ u, ua: opts.headers?.['User-Agent'] });
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  if (u.includes('overpass')) {
    if (mode.overpass === 'fail') return json({}, 504);
    const q = String(opts.body?.get?.('data') || '');
    if (q.includes('"amenity"')) return json({ elements: mode.safetyFail ? undefined : SAFETY });
    const radius = Number(/around:(\d+)/.exec(q)?.[1]);
    if (mode.overpassOnlyAbove && radius < mode.overpassOnlyAbove * 1000) return json({ elements: [] });
    return json({ elements: mode.overpassEmpty ? [] : OVERPASS });
  }
  if (u.includes('nominatim')) {
    if (mode.nominatim === 'fail') return json({}, 429);
    return json(mode.nominatimEmpty ? [] : NOMINATIM);
  }
  if (u.includes('photon')) {
    if (mode.photon === 'fail') return json({}, 500);
    return json(PHOTON);
  }
  throw new Error('unexpected url ' + u);
};

const { findNearbyHotels } = await import('../services/hotelService.js');
// Each scenario uses a different radius so it gets its own cache entry.
let scenario = 0;
const search = async (m, radiusKm) => {
  mode = m; calls.length = 0; scenario += 1;
  try { return { res: await findNearbyHotels({ lat: LAT, lon: LON, radiusKm: radiusKm ?? 3 + scenario * 0.25, name: 'Jaipur' }), calls: [...calls] }; }
  catch (error) { return { error, calls: [...calls] }; }
};

// 1. everything healthy -> merged, de-duplicated, finds hotels WITHOUT "hotel" in the name
{
  const { res, calls: c } = await search({});
  const names = res.hotels.map((h) => h.name);
  assert.ok(names.includes('Taj Palace Residency'), 'finds hotel without the word hotel');
  assert.ok(names.includes('Pink City Guest House') && names.includes('Zostel Jaipur'));
  assert.ok(names.includes('Rambagh Retreat'), 'merges Nominatim-only result');
  assert.equal(names.filter((x) => x === 'Taj Palace Residency').length, 1, 'de-duplicates across providers');
  assert.ok(!names.includes('Not a hotel'), 'ignores non-lodging');
  assert.ok(res.safety && res.safety.nearestPolice, 'safety score present');
  assert.ok(c.every((x) => x.ua && x.ua.startsWith('YatraMitra')), 'User-Agent sent on every request');
  console.log('PASS 1  healthy providers  ->', res.hotelCount, 'hotels via', res.source);
}
// 2. Overpass down -> Nominatim still answers
{
  const { res } = await search({ overpass: 'fail' });
  assert.ok(res.hotelCount >= 2 && /Nominatim/.test(res.source));
  console.log('PASS 2  Overpass down      ->', res.hotelCount, 'hotels via', res.source);
}
// 3. Overpass + Nominatim down -> Photon fallback
{
  const { res } = await search({ overpass: 'fail', nominatim: 'fail' });
  assert.deepEqual(res.hotels.map((h) => h.name), ['Photon Only Hotel']);
  console.log('PASS 3  Overpass+Nominatim ->', res.hotelCount, 'hotel via', res.source);
}
// 4. every provider down -> clear 502, not a crash
{
  const { error } = await search({ overpass: 'fail', nominatim: 'fail', photon: 'fail' });
  assert.equal(error.status, 502);
  console.log('PASS 4  all providers down ->', error.status, error.message);
}
// 5. nothing within 5 km -> automatically widens
{
  const { res } = await search({ overpassOnlyAbove: 10, nominatimEmpty: true, photon: 'fail' }, 5);
  assert.equal(res.area.radiusKm, 10);
  assert.ok(res.hotelCount >= 3 && /expanded to 10 km/.test(res.note));
  console.log('PASS 5  radius expansion   ->', res.hotelCount, 'hotels,', res.note.split('.')[0]);
}
// 6. safety lookup failing must not break the hotel list
{
  const { res } = await search({ safetyFail: true });
  assert.ok(res.hotelCount > 0 && res.safety === null);
  console.log('PASS 6  safety API failure ->', res.hotelCount, 'hotels, safety=null (graceful)');
}
// 7. cache: same place with a different label is served from cache with the new label
{
  mode = {}; calls.length = 0;
  const a = await findNearbyHotels({ lat: LAT + 0.2, lon: LON, radiusKm: 3, name: 'A' });
  const before = calls.length;
  const b = await findNearbyHotels({ lat: LAT + 0.2, lon: LON, radiusKm: 3, name: 'B' });
  assert.equal(calls.length, before, 'no extra network calls');
  assert.equal(b.area.name, 'B');
  console.log('PASS 7  cache + new label  -> served without network calls');
}
console.log('\nALL HOTEL SERVICE TESTS PASSED');
