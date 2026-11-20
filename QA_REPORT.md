# QA Report & Fixes

## How to run the checks
    cd backend  && npm install && npm test        # 24 backend checks (map providers are mocked)
    cd frontend && npm install && npm run lint && npm test   # lint + 25 UI tests

## 1. "Search nearby places to stay" - root causes and fixes
| Problem found | Fix |
|---|---|
| Hotel search used **Photon `q=hotel`** - a *name* search. Guest houses, resorts and hotels without "hotel" in the name (e.g. "Taj Palace") were never found. The proper category search (Overpass) only ran if Photon returned nothing. | Three independent methods now run together and are merged/de-duplicated: **Overpass** (category search, most complete), **Nominatim** (bounded box), **Photon** (last resort). |
| Overpass timeout was 6 s, but public servers often need longer, so it failed and users saw "providers unavailable". | 12 s timeout, 3 mirror servers, lighter `nwr ... out center` query. |
| No `User-Agent` header - Overpass/Nominatim frequently reject such requests. | Sent on every outgoing request (set `CONTACT_EMAIL` in `.env`). |
| Nothing found within 5 km (small towns) -> empty list. | Automatically widens 5 -> 10 -> 20 km and tells the user. |
| Empty results cached for 5 min (one hiccup = 5 min of "no hotels"). Cache key included the label, so it missed needlessly. | Empty results cached 30 s; key is location + radius only. |
| Safety-score failure could break the whole hotel list. | Safety is optional; hotels still show. |
| **Near Me page** called Overpass directly from the browser: 1 server, no fallback, nodes only (parks/large attractions missing), no places-to-stay. | New backend `/destinations/nearby-places` (multi-server, includes areas, nearest first). Near Me now has **Tourist places / Places to stay** tabs, GPS fallback to coarse location, clear permission errors, Retry button. |
| Planner "Find overnight stays" silently did nothing for stops typed by hand (no coordinates). | Stop is now geocoded first (new `/destinations/geocode`). |
| Destination page: a late hotel response could overwrite a newer one. | Stale-response guard. |

## 2. Other bugs fixed
- **Security:** `forgot-password` returned the reset token to anyone -> account takeover. Now dev-only.
- **Security:** `userId` could be overwritten via request body in history/notifications/packing (write into another user's data). Server now controls it.
- `/details` accepted invalid lat/lon; "nearby attractions" included hotels and info boards.
- Review ratings not validated (1-5); review update crashed on empty body; notification "mark read" returned `null` item for unknown id.
- Invalid ids / bad JSON returned HTTP 500 -> now 400/409/413. Production no longer leaks error internals.
- JWT secret: refuses to start in production with the default secret.
- Register: email format validated and trimmed.
- 49 garbled characters in `PlannerPage.jsx` (`â†’`, `â€”`, `â€¦`) repaired - visible on screen and in exported PDF/HTML.
- API client: clear message when backend is down; better messages for non-JSON server errors.
- Removed stray `cookie-parse` dependency (typo duplicate of `cookie-parser`); removed dead code in `PackingPage`; fixed all 10 ESLint errors.
- Rebuilt stale `frontend/dist`.

## 3. Not verifiable here - please check on your machine
- Live Overpass/Nominatim/Photon responses and real MongoDB (the test sandbox has no access to either). Logic is tested against mocked responses.
- `GEMINI_MODEL=gemini-3.8-flash` (default in `.env.example` / `aiService.js`) - I could not verify that model name exists. If AI planning errors with "model unavailable", set `GEMINI_MODEL` to a model your key supports.
- Hotel **prices and ratings are estimates** (OpenStreetMap has none); real prices need a hotel API (`HOTEL_API_KEY` is already reserved in `.env`).
