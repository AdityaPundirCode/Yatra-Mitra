import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import DestinationDetailsPage from '../pages/DestinationDetailsPage.jsx';

const DEST = { slug: 'jaipur-india', name: 'Jaipur', city: 'Jaipur', country: 'India', category: 'heritage', lat: 26.9, lon: 75.8, description: 'Pink city', rating: 4.5, tags: [], highlights: [], attractions: [] };
const hotel = (id, name) => ({ id, name, type: 'guest house', rating: 4.1, pricePerNight: 2400, priceLabel: '₹2,400 / night (est.)', distanceKm: 0.8, lat: 26.9, lon: 75.8, amenities: ['Wi-Fi'], mapUrl: 'https://osm.org/x', image: '' });

let hotelBody, hotelStatus;
beforeEach(() => {
  hotelBody = { area: { name: 'Jaipur', radiusKm: 3 }, hotelCount: 1, note: 'Estimates only.', safety: null, hotels: [hotel('node-1', 'Haveli Stay')] };
  hotelStatus = 200;
  window.scrollTo = vi.fn();
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    const ok = (b, status = 200) => ({ ok: status < 400, status, json: async () => b });
    if (u.includes('nearby-hotels')) return ok(hotelBody, hotelStatus);
    if (u.includes('/auth/')) return ok({ user: { id: 'u' } });
    if (u.includes('/destinations/jaipur-india')) return ok({ destination: DEST });
    return ok({ items: [], reviews: [] });
  });
});

const renderPage = () => render(
  <MemoryRouter initialEntries={['/discover-places/jaipur-india']}>
    <Routes><Route path="/discover-places/:slug" element={<DestinationDetailsPage />} /></Routes>
  </MemoryRouter>
);

describe('Destination page - hotels nearby', () => {
  it('lists hotels with estimated price when the tab is opened', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /hotels nearby/i }));
    expect(await screen.findByText('Haveli Stay')).toBeInTheDocument();
    expect(screen.getAllByText(/₹2,400/).length).toBeGreaterThan(0);
    const url = globalThis.fetch.mock.calls.map((c) => String(c[0])).find((u) => u.includes('nearby-hotels'));
    expect(url).toContain('lat=26.9');
    expect(url).toContain('lon=75.8');
  });

  it('shows the provider error instead of an endless spinner', async () => {
    hotelStatus = 502;
    hotelBody = { error: 'Nearby hotel data providers are temporarily unavailable. Please try again shortly.' };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /hotels nearby/i }));
    expect(await screen.findByText(/temporarily unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/Finding nearby hotels/i)).not.toBeInTheDocument();
  });

  it('shows a helpful empty state when nothing is mapped nearby', async () => {
    hotelBody = { area: { name: 'Jaipur', radiusKm: 3 }, hotelCount: 0, note: '', safety: null, hotels: [] };
    renderPage();
    await userEvent.click(await screen.findByRole('tab', { name: /hotels nearby/i }));
    expect(await screen.findByText(/No named hotels were found/i)).toBeInTheDocument();
  });
});
