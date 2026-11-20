const API_BASE = '/api';

let accessToken = localStorage.getItem('token') || '';

export function setAccessToken(token) {
  accessToken = token || '';
  if (token) localStorage.setItem('token', token);
  else localStorage.removeItem('token');
}
export function getAccessToken() { return accessToken; }

function expireSession() {
  setAccessToken('');
  window.dispatchEvent(new Event('auth:expired'));
  throw new Error('Your session expired. Please sign in again.');
}

async function rawRequest(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...options, headers });
  } catch {
    throw new Error('Cannot reach the server. Check your internet connection and that the backend is running (npm start in /backend).');
  }
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function request(path, options = {}, retry = true) {
  let { res, data } = await rawRequest(path, options);
  if (res.status === 401 && retry && path !== '/auth/refresh' && path !== '/auth/login' && path !== '/auth/register') {
    const r = await rawRequest('/auth/refresh', { method: 'POST' });
    if (r.res.ok && r.data.accessToken) {
      setAccessToken(r.data.accessToken);
      ({ res, data } = await rawRequest(path, options));
      if (res.status === 401) expireSession();
    } else if (r.res.status === 401) {
      expireSession();
    } else if (r.res.ok) {
      throw new Error('The session refresh did not return a valid access token.');
    }
  }
  if (!res.ok) {
    const fallback = res.status >= 500
      ? `The server had a problem (HTTP ${res.status}). Please try again in a moment.`
      : `Request failed (HTTP ${res.status}).`;
    throw new Error(data.error || fallback);
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: (path) => request(path, { method: 'DELETE' }),
};

export const authApi = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (name, email, password) => api.post('/auth/register', { name, email, password }),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout', {}),
  refresh: () => api.post('/auth/refresh', {}),
  profile: (body) => api.put('/auth/profile', body),
  changePassword: (body) => api.post('/auth/change-password', body),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token, newPassword) => api.post('/auth/reset-password', { token, newPassword }),
};

export const tripsApi = {
  list: () => api.get('/trips'),
  create: (trip) => api.post('/trips', trip),
  remove: (id) => api.del(`/trips/${id}`),
};

export const wishlistApi = {
  list: () => api.get('/wishlist'),
  add: (item) => api.post('/wishlist', item),
  remove: (id) => api.del(`/wishlist/${id}`),
};
export const historyApi = {
  list: () => api.get('/history'),
  add: (item) => api.post('/history', item),
  update: (id, item) => api.put(`/history/${id}`, item),
  remove: (id) => api.del(`/history/${id}`),
};
export const reviewsApi = {
  list: (destinationKey) => api.get(`/reviews${destinationKey ? `?destinationKey=${encodeURIComponent(destinationKey)}` : ''}`),
  add: (item) => api.post('/reviews', item),
  update: (id, item) => api.put(`/reviews/${id}`, item),
  remove: (id) => api.del(`/reviews/${id}`),
};
export const searchHistoryApi = {
  list: () => api.get('/search-history'),
  add: (query, filters) => api.post('/search-history', { query, filters }),
};
export const packingApi = {
  list: () => api.get('/packing'),
  generate: (payload) => api.post('/packing/generate', payload),
  save: (item) => api.post('/packing', item),
  update: (id, item) => api.put(`/packing/${id}`, item),
  remove: (id) => api.del(`/packing/${id}`),
};
export const notificationsApi = {
  list: () => api.get('/notifications'),
  read: (id) => api.put(`/notifications/${id}/read`, {}),
};
export const dashboardApi = { get: () => api.get('/dashboard') };

export const bookingsApi = {
  list: () => api.get('/bookings'),
  create: (item) => api.post('/bookings', item),
  cancel: (id) => api.del(`/bookings/${id}`),
};

function toQuery(params = {}) {
  return new URLSearchParams(
    Object.entries(params).filter(([, value]) => value != null && value !== '')
  ).toString();
}

export const destinationsApi = {
  search: (params = {}) => api.get(`/destinations/search?${toQuery(params)}`),
  autocomplete: (q, limit = 8) => api.get(`/destinations/autocomplete?${toQuery({ q, limit })}`),
  categories: () => api.get('/destinations/categories'),
  filters: () => api.get('/destinations/filters'),
  popular: (limit = 8) => api.get(`/destinations/popular?${toQuery({ limit })}`),
  trending: (limit = 8) => api.get(`/destinations/trending?${toQuery({ limit })}`),
  get: (identifier) => api.get(`/destinations/${encodeURIComponent(identifier)}`),
  details: (params = {}) => api.get(`/destinations/details?${toQuery(params)}`),
  attractionDetails: (params = {}) => api.get(`/destinations/attraction?${toQuery(params)}`),
  geocode: (q) => api.get(`/destinations/geocode?${toQuery({ q })}`),
  nearbyPlaces: (params = {}) => api.get(`/destinations/nearby-places?${toQuery(params)}`),
  nearbyHotels: (params = {}) => api.get(`/destinations/nearby-hotels?${toQuery(params)}`),
};

export const recentlyViewedApi = {
  list: (limit = 12) => api.get(`/destinations/recently-viewed?${toQuery({ limit })}`),
  record: (slug) => api.post('/destinations/recently-viewed', { slug }),
  remove: (id) => api.del(`/destinations/recently-viewed/${id}`),
  clear: () => api.del('/destinations/recently-viewed'),
};


export const routesApi = {
  compare: (body) => api.post('/routes/compare', body),
};
