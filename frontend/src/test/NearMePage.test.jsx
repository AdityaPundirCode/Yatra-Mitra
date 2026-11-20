import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import NearMePage from '../pages/NearMePage.jsx';

const PLACES = {
  area: { lat: 26.9, lon: 75.8, radiusKm: 5 }, count: 2, source: 'OpenStreetMap/Overpass',
  places: [
    { id: 'way-1', name: 'Hawa Mahal', type: 'attraction', lat: 26.9239, lon: 75.8267, distanceKm: 0.4 },
    { id: 'node-2', name: 'Central Park', type: 'park', lat: 26.9124, lon: 75.8, distanceKm: 1.2 },
  ],
};
const HOTELS = {
  area: { radiusKm: 5 }, hotelCount: 1, note: 'Prices are estimates.',
  hotels: [{ id: 'node-9', name: 'Haveli Stay', type: 'guest house', rating: 4.1, priceLabel: '₹2,400 / night (est.)', distanceKm: 0.8, lat: 26.92, lon: 75.81 }],
};

let routes;
function mockApi() {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    const hit = Object.entries(routes).find(([key]) => u.includes(key));
    if (!hit) return { ok: false, status: 404, json: async () => ({ error: 'not mocked ' + u }) };
    const [, value] = hit;
    if (value instanceof Error) throw value;
    return { ok: value.status < 400, status: value.status, json: async () => value.body };
  });
}
function mockGeolocation(...results) {
  const queue = [...results];
  const getCurrentPosition = vi.fn((ok, fail) => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next.code) fail({ code: next.code }); else ok({ coords: next });
  });
  Object.defineProperty(globalThis.navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
  return getCurrentPosition;
}
const renderPage = () => render(<MemoryRouter><NearMePage /></MemoryRouter>);

beforeEach(() => {
  routes = {
    '/nearby-places': { status: 200, body: PLACES },
    '/nearby-hotels': { status: 200, body: HOTELS },
  };
  mockApi();
});

describe('NearMePage', () => {
  it('shows nearby tourist places, nearest first, after allowing location', async () => {
    mockGeolocation({ latitude: 26.9, longitude: 75.8 });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByText('Hawa Mahal')).toBeInTheDocument();
    expect(screen.getByText(/0.4 km away/)).toBeInTheDocument();
    expect(screen.getByText(/Found 2 places near you/)).toBeInTheDocument();
    // the browser must call OUR backend, not Overpass directly
    const calledUrls = globalThis.fetch.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.every((u) => u.startsWith('/api/'))).toBe(true);
  });

  it('"Places to stay" tab searches hotels near the same location', async () => {
    mockGeolocation({ latitude: 26.9, longitude: 75.8 });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    await screen.findByText('Hawa Mahal');
    await userEvent.click(screen.getByRole('tab', { name: /places to stay/i }));
    expect(await screen.findByText('Haveli Stay')).toBeInTheDocument();
    expect(screen.getByText(/₹2,400/)).toBeInTheDocument();
    expect(screen.queryByText('Hawa Mahal')).not.toBeInTheDocument();
    const hotelCall = globalThis.fetch.mock.calls.map((c) => String(c[0])).find((u) => u.includes('nearby-hotels'));
    expect(hotelCall).toContain('lat=26.9');
    // stays do not offer "Plan trip"
    expect(screen.queryByRole('button', { name: /plan trip/i })).not.toBeInTheDocument();
  });

  it('explains a denied location permission', async () => {
    mockGeolocation({ code: 1 });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/permission denied/i);
  });

  it('falls back to a coarse position when high accuracy fails (laptops, indoors)', async () => {
    const spy = mockGeolocation({ code: 2 }, { latitude: 26.9, longitude: 75.8 });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByText('Hawa Mahal')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('shows a clear error and a working Retry when the provider is down', async () => {
    routes['/nearby-places'] = { status: 502, body: { error: 'Nearby place data providers are temporarily unavailable. Please try again shortly.' } };
    mockGeolocation({ latitude: 26.9, longitude: 75.8 });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily unavailable/i);

    routes['/nearby-places'] = { status: 200, body: PLACES };   // provider recovers
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Hawa Mahal')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('tells the user when the backend is not running', async () => {
    routes['/nearby-places'] = new TypeError('Failed to fetch');
    mockGeolocation({ latitude: 26.9, longitude: 75.8 });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot reach the server/i);
  });

  it('handles a browser without geolocation', async () => {
    Object.defineProperty(globalThis.navigator, 'geolocation', { value: undefined, configurable: true });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /use my location/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not supported/i);
  });
});
