// Run with:  node tests/api.test.mjs
// Starts the real destinations router on a local port and calls it over HTTP (map providers are mocked).
import assert from 'node:assert/strict';
import express from 'express';

const realFetch = globalThis.fetch;
const LAT = 26.9124, LON = 75.7873;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(url, opts);
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  if (u.includes('overpass')) {
    const q = String(opts.body?.get?.('data') || '');
    if (q.includes('"amenity"')) return json({ elements: [{ type: 'node', id: 9, lat: LAT + 0.002, lon: LON, tags: { amenity: 'police', name: 'PS' } }] });
    if (q.includes('[historic]')) return json({ elements: [
      { type: 'way', id: 20, center: { lat: LAT + 0.01, lon: LON }, tags: { tourism: 'attraction', name: 'City Palace' } },
      { type: 'node', id: 21, lat: LAT + 0.001, lon: LON, tags: { leisure: 'park', name: 'Ram Niwas Garden' } },
      { type: 'node', id: 22, lat: LAT + 0.001, lon: LON, tags: { leisure: 'park', name: 'Ram Niwas Garden' } },
    ] });
    if (q.includes('"tourism"~')) return json({ elements: [{ type: 'node', id: 1, lat: LAT + 0.003, lon: LON, tags: { tourism: 'guest_house', name: 'Haveli Stay' } }] });
    return json({ elements: [
      { type: 'node', id: 2, lat: LAT, lon: LON, tags: { tourism: 'attraction', name: 'Hawa Mahal' } },
      { type: 'node', id: 3, lat: LAT, lon: LON, tags: { tourism: 'hotel', name: 'Some Hotel' } },
      { type: 'node', id: 4, lat: LAT, lon: LON, tags: { tourism: 'information', name: 'Info board' } },
      { type: 'way', id: 5, center: { lat: LAT, lon: LON }, tags: { amenity: 'restaurant', name: 'LMB' } },
    ] });
  }
  if (u.includes('nominatim')) return json([]);
  if (u.includes('photon') && u.includes('Hawa')) return json({ features: [{ geometry: { coordinates: [75.8267, 26.9239] }, properties: { name: 'Hawa Mahal', city: 'Jaipur', country: 'India', osm_key: 'tourism', osm_value: 'attraction' } }] });
  if (u.includes('photon')) return json({ features: [] });
  return json({}, 404);
};

const router = (await import('../routes/destinations.js')).default;
const app = express();
app.use(express.json());
app.use('/api/destinations', router);
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}/api/destinations`;
const get = async (path) => { const r = await realFetch(base + path); return { status: r.status, body: await r.json() }; };

let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log('PASS', name); } catch (e) { failed += 1; console.log('FAIL', name, '\n   ', e.message); } };

await test('nearby-hotels returns hotels + safety', async () => {
  const { status, body } = await get(`/nearby-hotels?lat=${LAT}&lon=${LON}&radius=5&name=Jaipur`);
  assert.equal(status, 200);
  assert.equal(body.hotels[0].name, 'Haveli Stay');
  assert.ok(body.hotels[0].priceLabel && body.hotels[0].mapUrl);
  assert.ok(body.safety);
});
await test('nearby-hotels rejects missing coordinates (400)', async () => assert.equal((await get('/nearby-hotels')).status, 400));
await test('nearby-hotels rejects empty-string coordinates (400)', async () => assert.equal((await get('/nearby-hotels?lat=&lon=')).status, 400));
await test('nearby-hotels rejects out-of-range coordinates (400)', async () => assert.equal((await get('/nearby-hotels?lat=999&lon=10')).status, 400));
await test('nearby-hotels rejects text coordinates (400)', async () => assert.equal((await get('/nearby-hotels?lat=abc&lon=xyz')).status, 400));
await test('nearby-hotels clamps huge radius', async () => {
  const { status, body } = await get(`/nearby-hotels?lat=${LAT}&lon=${LON}&radius=9999`);
  assert.equal(status, 200); assert.ok(body.area.radiusKm <= 20);
});
await test('details: attractions exclude hotels/info boards, restaurants separated', async () => {
  const { status, body } = await get(`/details?name=Jaipur&lat=${LAT}&lon=${LON}`);
  assert.equal(status, 200);
  assert.deepEqual(body.nearbyAttractions.map((p) => p.name), ['Hawa Mahal']);
  assert.deepEqual(body.nearbyRestaurants.map((p) => p.name), ['LMB']);   // way/center element handled
});
await test('details: invalid lat/lon falls back safely (no crash)', async () => {
  const { status, body } = await get('/details?name=Jaipur&lat=abc&lon=');
  assert.equal(status, 200); assert.equal(body.lat, null); assert.equal(body.maps, null);
});
await test('details: no name and no coords -> 400', async () => assert.equal((await get('/details')).status, 400));
await test('attraction: missing name -> 400', async () => assert.equal((await get('/attraction')).status, 400));

await test('nearby-places: includes areas, de-duplicates, sorted nearest first', async () => {
  const { status, body } = await get(`/nearby-places?lat=${LAT}&lon=${LON}&radius=5`);
  assert.equal(status, 200);
  assert.deepEqual(body.places.map((p) => p.name), ['Ram Niwas Garden', 'City Palace']);
  assert.ok(body.places[0].distanceKm < body.places[1].distanceKm);
});
await test('nearby-places: rejects bad coordinates (400)', async () => assert.equal((await get('/nearby-places?lat=x&lon=y')).status, 400));
await test('geocode: returns coordinates for a place name', async () => {
  const { status, body } = await get('/geocode?q=Hawa Mahal');
  assert.equal(status, 200);
  assert.equal(body.place.lat, 26.9239);
});
await test('geocode: unknown place -> 404, short query -> 400', async () => {
  assert.equal((await get('/geocode?q=Zzzzqqq')).status, 404);
  assert.equal((await get('/geocode?q=a')).status, 400);
});

server.close();
console.log(failed ? `\n${failed} TEST(S) FAILED` : '\nALL API TESTS PASSED');
process.exit(failed ? 1 : 0);
