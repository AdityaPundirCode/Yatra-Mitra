# Backend explained (for presenting to the teacher)

The backend is a **Node.js + Express** server that talks to a **MongoDB** database.
The React frontend sends requests like `GET /api/trips`, and the backend sends back JSON.

## Folder structure

```
backend/
├── server.js            <- START HERE. Creates the app, adds middleware, connects the routes
├── config/
│   └── db.js            <- connects to MongoDB
├── middleware/
│   └── auth.js          <- "guards": auth (must be logged in), requireAdmin (must be admin)
├── models/              <- the shape of our data (one file per MongoDB collection)
│   └── User, Trip, Wishlist, Review, Booking, ...
├── routes/              <- the URLs (API endpoints). One file per feature
│   └── auth, trips, wishlist, history, reviews, bookings, packing, ...
├── services/            <- bigger logic that routes call (so routes stay short)
│   └── aiService, destinationService, hotelService, placesApi, recentlyViewedService
├── utils/               <- small helper functions (tokens, destination helpers)
└── data/destinations.js <- built-in list of destinations
```

## How one request travels

Example: the user opens "My Trips" -> frontend calls `GET /api/trips`

```
Browser  ->  server.js  ->  middleware (cors, json, cookies, rate limit)
         ->  routes/trips.js  ->  auth guard checks the login token
         ->  Trip.find(...) asks MongoDB through the model (models/Trip.js)
         ->  res.json({ trips })  ->  Browser
```

## The 4 ideas to explain

1. **Route** = a URL + a function. `router.get('/', async (req, res) => { ... })`
   - `req` = what the user sent (body, URL parameters, cookies)
   - `res` = what we send back (`res.json(...)`, `res.status(400)...`)
2. **Middleware** = a function that runs before the route (login check, reading JSON, CORS).
3. **Model** = describes what we store in MongoDB (Mongoose schema).
4. **Service** = normal functions holding the heavy logic, so route files stay short and readable.

## Login system (routes/auth.js)

- Passwords are **hashed with bcrypt** (never stored as plain text).
- After login the server gives two JWT tokens:
  - *access token* (15 minutes) - proves who you are on every request
  - *refresh token* (7 days) - used to get a new access token
- `middleware/auth.js` reads the token, finds the user, and puts them in `req.user`.

## Error handling

Express 5 automatically catches errors thrown inside `async` routes and sends them to the
error handler at the bottom of `server.js`, which replies with `{ error: "message" }`.
That is why most routes do not need their own `try/catch`.

## List of API endpoints

| URL | What it does | Login needed? |
|---|---|---|
| `POST /api/auth/register`, `/login`, `/logout`, `/refresh` | account + tokens | no |
| `GET /api/auth/me`, `PUT /api/auth/profile`, `POST /api/auth/change-password` | profile | yes |
| `POST /api/auth/forgot-password`, `/reset-password` | password reset | no |
| `GET/POST/DELETE /api/trips` | saved trips | yes |
| `GET/POST/DELETE /api/wishlist` | wishlist | yes |
| `GET/POST/PUT/DELETE /api/history` | travel history | yes |
| `GET /api/reviews` (public), `POST/PUT/DELETE` | reviews | write = yes |
| `GET/POST /api/search-history` | past searches | yes |
| `GET/POST/PUT /api/notifications` | notifications | yes |
| `GET/POST/PUT/DELETE /api/packing`, `POST /api/packing/generate` | packing lists | yes |
| `GET /api/dashboard` | all dashboard data | yes |
| `GET/POST/DELETE /api/bookings` | hotel bookings | yes |
| `GET /api/admin/stats`, `/users`, `DELETE /api/admin/reviews/:id` | admin | admin only |
| `GET /api/destinations/search`, `/autocomplete`, `/categories`, `/filters`, `/popular`, `/trending` | find destinations | no |
| `GET /api/destinations/details`, `/attraction`, `/nearby-hotels`, `/:identifier` | place details | no |
| `GET/POST/DELETE /api/destinations/recently-viewed` | recently viewed | yes |
| `POST /api/routes/compare` | distance/time for car, bike, walking | yes |
| `POST /api/ai/plan` | AI suggests stops and transport | yes |
| `GET /api/health` | is the server (and AI key) OK? | no |

## What was simplified (nothing was removed)

- `server.js` was one long file with AI code mixed in -> AI code moved to `services/aiService.js` and `routes/ai.js`.
- One-line "compressed" routes were rewritten as normal, readable code with comments.
- Repeated `try { ... } catch { res.status(500)... }` removed (Express 5 handles it).
- The 685-line `routes/destinations.js` was split: routes stay in `routes/`, the hotel/safety logic is in `services/hotelService.js`, outside API calls are in `services/placesApi.js`.
- The 690-line destination service was split into `destinationService.js` and `recentlyViewedService.js`, with the small helpers in `utils/destinationHelpers.js`.
- Unused package `express-validator` removed.
- The API URLs and JSON responses are the same, so the React frontend works without changes.
