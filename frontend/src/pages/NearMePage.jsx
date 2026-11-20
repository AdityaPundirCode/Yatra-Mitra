import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { destinationsApi } from '../api/client';
import '../Pages.css';

const GEO_ERRORS = {
  1: 'Location permission denied. Allow location access in your browser settings to use Near Me.',
  2: 'Your device could not determine its location. Check that GPS / location services are on.',
  3: 'Getting your location timed out. Please try again.',
};

// Asks the browser for the position. Tries high accuracy first, then falls back to a
// coarse (network/Wi-Fi) position, which works on laptops and in buildings.
function getPosition() {
  const ask = (options) =>
    new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
  return ask({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }).catch((error) => {
    if (error.code === 1) throw error; // permission denied - retrying will not help
    return ask({ enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  });
}

const mapLink = (lat, lon) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;

export default function NearMePage() {
  const [tab, setTab] = useState('places'); // 'places' | 'stay'
  const [coords, setCoords] = useState(null);
  const [places, setPlaces] = useState([]);
  const [stays, setStays] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [searched, setSearched] = useState({ places: false, stay: false });
  const navigate = useNavigate();

  async function search(kind, position = coords) {
    if (!position) return;
    setLoading(true);
    setError('');
    setStatus(kind === 'stay' ? 'Searching for places to stay near you...' : 'Searching nearby tourist places...');
    try {
      if (kind === 'stay') {
        const data = await destinationsApi.nearbyHotels({ lat: position.lat, lon: position.lon, name: 'your location', radius: 5 });
        const list = Array.isArray(data.hotels) ? data.hotels : [];
        setStays(list);
        setStatus(
          list.length
            ? `Found ${list.length} places to stay within ${data.area?.radiusKm || 5} km. ${data.note || ''}`.trim()
            : 'No hotels or guest houses are mapped near you. Try again from a bigger town.'
        );
      } else {
        const data = await destinationsApi.nearbyPlaces({ lat: position.lat, lon: position.lon, radius: 5 });
        const list = Array.isArray(data.places) ? data.places : [];
        setPlaces(list);
        setStatus(
          list.length
            ? `Found ${list.length} places near you (OpenStreetMap), nearest first.`
            : 'No named places found nearby. Try again later or move to a busier area.'
        );
      }
      setSearched((current) => ({ ...current, [kind]: true }));
    } catch (e) {
      setStatus('');
      setError(e.message || 'Could not fetch nearby results. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function locate() {
    setError('');
    setPlaces([]);
    setStays([]);
    setSearched({ places: false, stay: false });
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.');
      return;
    }
    setLoading(true);
    setStatus('Requesting location permission...');
    try {
      const pos = await getPosition();
      const position = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      setCoords(position);
      await search(tab, position);
    } catch (e) {
      setLoading(false);
      setStatus('');
      setError(GEO_ERRORS[e.code] || 'Could not get your location.');
    }
  }

  function switchTab(next) {
    setTab(next);
    setError('');
    if (coords && !searched[next] && !loading) search(next);
    else setStatus('');
  }

  const rows = tab === 'stay' ? stays : places;

  return (
    <main className="main-content">
      <div className="page-heading">
        <div>
          <p className="section-kicker">Live nearby</p>
          <h1>Places &amp; stays near me</h1>
          <p>Allow location access to discover tourist places and hotels or guest houses around you.</p>
        </div>
        <button type="button" className="nav-cta" onClick={locate} disabled={loading}>
          {loading ? 'Searching...' : coords ? 'Refresh my location' : 'Use my location'}
        </button>
      </div>

      <section className="planner-card">
        <div className="card-heading">
          <div>
            <p className="section-kicker">Your location</p>
            <h2>Nearby results</h2>
            {coords && <p>Lat {coords.lat.toFixed(4)}, Lon {coords.lon.toFixed(4)}</p>}
          </div>
        </div>

        <div className="chip-row" role="tablist" aria-label="Nearby result type">
          <button type="button" role="tab" aria-selected={tab === 'places'} className={`chip${tab === 'places' ? ' is-active' : ''}`} onClick={() => switchTab('places')}>
            Tourist places
          </button>
          <button type="button" role="tab" aria-selected={tab === 'stay'} className={`chip${tab === 'stay' ? ' is-active' : ''}`} onClick={() => switchTab('stay')}>
            Places to stay
          </button>
        </div>

        {error && (
          <p className="error-message" role="alert">
            {error}{' '}
            {coords && (
              <button type="button" className="small-primary-button" onClick={() => search(tab)} disabled={loading}>Retry</button>
            )}
          </p>
        )}
        {status && <p className="ai-status" role="status">{status}</p>}

        {rows.length > 0 && (
          <div className="table-list">
            {rows.map((p) => (
              <article className="alert-row" key={p.id}>
                <div className="alert-body">
                  <strong>{p.name}</strong>
                  <p>
                    Type: {p.type}
                    {tab === 'stay' && p.priceLabel ? ` · ${p.priceLabel}` : ''}
                    {tab === 'stay' && p.rating ? ` · ${p.rating}★ (est.)` : ''}
                  </p>
                  <span className="alert-meta">
                    {p.distanceKm != null ? `${p.distanceKm} km away · ` : ''}
                    {Number(p.lat).toFixed(4)}, {Number(p.lon).toFixed(4)}
                  </span>
                </div>
                <div className="form-actions">
                  <a className="small-primary-button" href={mapLink(p.lat, p.lon)} target="_blank" rel="noreferrer">View on map</a>
                  {tab === 'places' && (
                    <button type="button" className="nav-cta" onClick={() => navigate('/planner', { state: { destination: { name: p.name } } })}>
                      Plan trip
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {!loading && !error && !coords && (
          <p className="empty-note">Click &quot;Use my location&quot; and allow permission to see nearby tourist places and stays.</p>
        )}
      </section>
    </main>
  );
}
