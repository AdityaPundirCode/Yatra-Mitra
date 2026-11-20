// Mounts every route with a logged-in user and mocked API data.
// A page that throws while rendering/loading fails here instead of showing a white screen to users.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext.jsx';
import App from '../App.jsx';

vi.mock('../MapView.jsx', () => ({ default: () => <div data-testid="map" /> }));

const USER = { id: 'u1', name: 'Asha', email: 'a@x.com', role: 'user' };
const DEST = { slug: 'jaipur-india', name: 'Jaipur', city: 'Jaipur', country: 'India', category: 'heritage', lat: 26.9, lon: 75.8, description: 'Pink city', image: '', rating: 4.5, tags: [], highlights: [], attractions: [] };
const HOTELS = { area: { radiusKm: 3 }, hotelCount: 1, note: 'n', safety: null, hotels: [{ id: 'node-1', name: 'Haveli', type: 'hotel', rating: 4, pricePerNight: 2000, priceLabel: '₹2,000 / night (est.)', distanceKm: 0.5, lat: 26.9, lon: 75.8, amenities: [], mapUrl: 'https://osm.org', image: '' }] };

function api(url) {
  const u = String(url);
  const body = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
  if (u.includes('/auth/refresh')) return body({ user: USER, accessToken: 't' });
  if (u.includes('/auth/me')) return body({ user: USER });
  if (u.includes('nearby-hotels')) return body(HOTELS);
  if (u.includes('/destinations/search')) return body({ results: [DEST], total: 1, page: 1, pages: 1, sortOptions: [], budgetOptions: [] });
  if (u.includes('/destinations/categories')) return body({ categories: [] });
  if (u.includes('/destinations/filters')) return body({ countries: [], cities: [], categories: [], budgets: [] });
  if (u.includes('/destinations/popular') || u.includes('/destinations/trending') || u.includes('recently-viewed')) return body({ items: [DEST] });
  if (u.match(/\/destinations\/[a-z-]+$/)) return body({ destination: DEST });
  if (u.includes('/dashboard')) return body({ stats: {}, analytics: {}, trips: [], wishlist: [], history: [], searches: [], notifications: [], user: USER });
  if (u.includes('/notifications')) return body({ items: [] });
  return body({ items: [], trips: [], results: [], reviews: [], suggestions: [], destination: DEST });
}

const routes = ['/', '/dashboard', '/planner', '/adventure-prep', '/discover-places', '/discover-places/jaipur-india',
  '/near-me', '/safety-alerts', '/emergency-sos', '/saved-trips', '/wishlist', '/travel-history', '/profile', '/packing', '/nonexistent'];

beforeEach(() => {
  globalThis.fetch = vi.fn(async (url) => api(url));
  Object.defineProperty(globalThis.navigator, 'geolocation', { value: { getCurrentPosition: vi.fn() }, configurable: true });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  globalThis.ResizeObserver = globalThis.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
});

describe('every route mounts without crashing', () => {
  for (const path of routes) {
    it(path, async () => {
      const errors = [];
      const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.map(String).join(' ')));
      const { container } = render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
      await waitFor(() => expect(container.querySelector('main')).not.toBeNull(), { timeout: 4000 });
      await new Promise((r) => setTimeout(r, 150)); // let effects/fetches settle
      spy.mockRestore();
      const fatal = errors.filter((e) => /Uncaught|The above error occurred|Cannot read|is not a function|is not defined|Objects are not valid/i.test(e));
      expect(fatal, fatal.join('\n')).toEqual([]);
      expect(container.querySelector('main').textContent.length).toBeGreaterThan(0);
    });
  }
});
