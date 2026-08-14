# STAC API Browser — Implementation Plan

A web-based browser for STAC APIs, with first-class support for Lantmäteriet's Swedish
geodata catalogs. Front page lists available STAC APIs; each API gets a browse page with a
map of item footprints, click-to-select, a selection basket, coordinate search, and
bounding-box drawing.

---

## 0. Research findings (verified against the live APIs, 2026-08-14)

These findings drive most of the decisions below, so they come first.

### The three Lantmäteriet STAC APIs

| Catalog | Base URL | Collections | Contents |
|---|---|---|---|
| Ortofoto (imagery) | `https://api.lantmateriet.se/stac-bild/v1/` | **731** | Orthophotos, 1960s–2025 |
| Höjddata (elevation) | `https://api.lantmateriet.se/stac-hojd/v1/` | **78** | Ground elevation model (1 m grid), `dsm-skoglig-copc` laser data |
| Vektordata | `https://api.lantmateriet.se/stac-vektor/v1/` | **6** | Buildings, addresses, place names, land cover, property division, admin boundaries |

All three are STAC 1.0.0 and advertise the same conformance classes:
`item-search` (+ `#fields`, `#query`, `#sort`, `#filter`), `collections`, `ogcapi-features`,
CQL2 (`basic-cql2`, `cql2-json`, `cql2-text`). Each exposes `/queryables`,
`/collections/{id}/queryables`, and OpenAPI at `/api` + `/api.html`.

### CORS — the decisive finding

| Endpoint | CORS result |
|---|---|
| STAC API (`api.lantmateriet.se`), GET + POST | `access-control-allow-origin: *` |
| Asset host `dl1.lantmateriet.se`, `/pub/` paths (thumbnails, metadata) | `200`, origin echoed, `allow-credentials: true` |
| Asset host `dl1.lantmateriet.se`, `/data/` paths (the actual COGs) | `401` + `WWW-Authenticate: Basic realm="Authorization Server"` |
| `OPTIONS` preflight on a `/data/` COG with `Access-Control-Request-Headers: authorization` | **`204`**, `allow-headers: … Authorization … Range`, `expose-headers: Content-Length, Content-Range, …` |

**Conclusion: no backend is required.** The browser may fetch protected assets directly with
an `Authorization: Basic …` header — the preflight explicitly permits it, and `Range` +
`Content-Length` are exposed, so streaming and progress reporting both work. This is the
single most important architectural fact in this plan: the app can be a **purely static SPA**.

> Note: downloads use **HTTP Basic** against the asset host, *not* the OAuth2 client-credentials
> flow used by Lantmäteriet's other Geotorget APIs. Credentials come from a Geotorget
> subscription to the relevant product.

### Item and asset shape

Sample from `stac-bild`:

```jsonc
{
  "id": "o65700_6825_25_mr25",
  "collection": "orto-o2-2025",
  "geometry": { "type": "Polygon", … },          // WGS84 lon/lat
  "properties": {
    "datetime": "2025-05-31T09:21:07Z",
    "start_datetime": "…", "end_datetime": "…",
    "proj:bbox": [682500, 6570000, 685000, 6572500],
    "proj:code": "EPSG:3006",                     // SWEREF99 TM
    "flygar": 2025, "flyghojd": 3000,
    "upplosning": 0.16, "spektraltyp": "rgbi"
  },
  "assets": {
    "data":      { "type": "image/tiff; application=geotiff; profile=cloud-optimized",
                   "href": "https://dl1.lantmateriet.se/bild/data/…/o65700_6825_25_mr25.tif",
                   "roles": ["data"] },                              // 🔒 Basic auth
    "metadata":  { "type": "application/geo+json", "roles": ["metadata"] },   // 🔓 public
    "thumbnail": { "type": "image/jpeg", "roles": ["thumbnail","overview"] }  // 🔓 public
  }
}
```

Consequences worth designing around:

- **Thumbnails and metadata are public.** Previews work with zero authentication — the app is
  fully useful in read-only mode, and auth is only needed at the moment of download.
- **Assets are COGs on a 2.5 km grid.** A 2.5 km tile at 0.16 m/px × 4 bands is on the order of
  100 MB+. Bulk selections reach tens of gigabytes.
- **`proj:code` differs per catalog** — `EPSG:3006` (bild) vs `EPSG:5845` (höjd).
- **Property names are Swedish** (`flygar`, `flyghojd`, `upplosning`, `spektraltyp`) and need a
  label map for the UI.

### Search API behaviour

- `GET /search?bbox=…&limit=…&collections=…` and `POST /search` with `intersects` both work.
- **`numberMatched` is `null`.** There is no result total. Pagination is opaque-token based:
  `links[rel=next].href` carries `?token=next:orto-o2-2025:o65650_6825_25_mr25`.
  → The UI must say "1 240 items loaded" and offer *Load more*, never "page 3 of 57".
- `/queryables` returns JSON Schema for the filterable properties, including numeric
  `minimum`/`maximum` bounds (e.g. `upplosning` 0.16–1.0, `flygar` 1950–2050). This is enough to
  **generate the filter UI dynamically** rather than hardcoding it per API.

---

## 1. Recommended tech stack

| Concern | Choice | Rationale |
|---|---|---|
| Framework | **Vue 3** (`<script setup>`, TS) | Decided. Already scaffolded. |
| Build | **Vite 8** | Decided. Already scaffolded. |
| Language | **TypeScript** | Already configured; STAC payloads are deeply nested and benefit from types. |
| Routing | **Vue Router 5** | Two routes; URL is the shareable state container. |
| State | **Pinia 4** | Selection basket and credentials are cross-component state. |
| Map | **MapLibre GL JS 6** | WebGL renders thousands of footprints on the GPU; `feature-state` gives free hover/select styling; keyless vector basemaps available. Leaflet would need a canvas plugin and its draw plugin is unmaintained (last release 2018). |
| Drawing | **Terra Draw** (`terra-draw` + `terra-draw-maplibre-gl-adapter`) | Actively maintained, adapter-based, has a rectangle mode. `mapbox-gl-draw` carries Mapbox licensing lineage. |
| Projections | **proj4js** | SWEREF99 TM (EPSG:3006) ↔ WGS84 for the coordinate search box. Swedish users think in SWEREF. |
| HTTP | **native `fetch`** | No axios needed. Requires `AbortController` for search cancellation and `ReadableStream` for download progress. |
| Downloads | **File System Access API** + streamed `fetch` | `showDirectoryPicker()` writes straight to disk, bypassing memory. See §4. |
| Zip | **none** | Deliberate. Files are ~100 MB each; client-side zipping tens of GB is not viable. |
| Basemap | **OpenFreeMap** (`https://tiles.openfreemap.org/styles/positron`) | Verified `200` + `access-control-allow-origin: *`, keyless, no usage caps. Fallback: `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json` (also verified). |
| Styling | **Plain CSS + custom properties** | Small surface; a framework would outweigh the app. Dark mode via `prefers-color-scheme`. |
| i18n | **vue-i18n** (sv + en) | Data and property names are Swedish; the UI should not be. |
| Virtual list | **`@tanstack/vue-virtual`** | 731 collections and thousands of items must not become 731 DOM nodes. |
| Testing | **Vitest** + **@vue/test-utils**; **Playwright** for E2E | Vitest is already implied by Vite. |
| Lint/format | **ESLint 9 flat config** + **Prettier** | Standard. |
| Deploy | **Static host** (GitHub Pages / Cloudflare Pages / Netlify) | Enabled by the CORS finding. |

**Deliberately not chosen:**

- *A backend proxy.* Unnecessary given the preflight result, and it would turn a static site
  into a service that handles user credentials. Keep an optional Vite dev proxy as an escape
  hatch only.
- *`stac-browser` (radiantearth).* It is a general-purpose Vue catalog browser, but the required
  UX here — map-first selection basket and bulk download — is not its model. Its `stac-js`
  library is worth reading; vendoring the whole app is not.
- *`@geomatico/maplibre-cog-protocol`.* Genuinely interesting for previewing COGs in-map with
  custom auth headers, and it would work here. Deferred to §5 as a stretch goal; thumbnails
  cover the core need.

---

## 2. File structure

```
stac-api-browser/
├─ index.html
├─ vite.config.ts                    # + optional dev proxy escape hatch
├─ tsconfig*.json
├─ plan.md
├─ README.md
├─ public/
│  └─ favicon.svg
└─ src/
   ├─ main.ts                        # createApp + router + pinia + i18n
   ├─ App.vue                        # shell: header, <RouterView>, toasts
   ├─ router/
   │  └─ index.ts                    # '/' and '/api/:apiId'
   │
   ├─ config/
   │  └─ registry.ts                 # built-in STAC API list (the 3 Lantmäteriet catalogs)
   │
   ├─ types/
   │  ├─ stac.ts                      # Catalog, Collection, Item, Asset, Link, ItemCollection
   │  ├─ search.ts                    # SearchParams, SearchResultPage, Queryables
   │  └─ registry.ts                  # StacApiEntry
   │
   ├─ services/
   │  ├─ stacClient.ts                # fetch wrapper: root, collections, search, next-page
   │  ├─ queryables.ts                # fetch + parse JSON Schema -> filter field descriptors
   │  ├─ auth.ts                      # in-memory Basic credential store, probe/validate
   │  ├─ downloader.ts                # queue, concurrency, streaming, progress, retry
   │  ├─ fsAccess.ts                  # File System Access API wrapper + capability detection
   │  └─ manifest.ts                  # export aria2c / curl / wget / CSV / GeoJSON
   │
   ├─ stores/
   │  ├─ registryStore.ts             # built-in + user-added APIs (localStorage)
   │  ├─ searchStore.ts               # params, results, pagination token, loading, abort
   │  ├─ selectionStore.ts            # Map<"collection/id", StacItem> basket
   │  └─ authStore.ts                 # credentials per API host (in memory by default)
   │
   ├─ composables/
   │  ├─ useMapLibre.ts               # map lifecycle, style, resize observer
   │  ├─ useFootprintLayer.ts         # GeoJSON source + fill/line layers + feature-state
   │  ├─ useBboxDraw.ts               # Terra Draw rectangle mode <-> bbox
   │  ├─ useUrlState.ts               # two-way sync of search state <-> query string
   │  └─ useDebounce.ts
   │
   ├─ utils/
   │  ├─ projections.ts               # proj4 defs: EPSG:3006, 5845; parse coordinate strings
   │  ├─ bbox.ts                      # bbox <-> polygon, area, validity, clamping
   │  ├─ format.ts                    # bytes, dates, resolution
   │  └─ propertyLabels.ts            # flygar -> "Flight year" / "Flygår", etc.
   │
   ├─ views/
   │  ├─ HomeView.vue                 # page 1: registry of STAC APIs
   │  └─ ApiBrowserView.vue           # page 2: map + search + results + basket
   │
   ├─ components/
   │  ├─ common/                      # AppHeader, LoadingSpinner, ErrorBanner, EmptyState,
   │  │                               #   ToastHost, VirtualList
   │  ├─ home/                        # StacApiCard, AddCustomApiDialog
   │  ├─ map/                         # StacMap, MapToolbar, FootprintPopup, BboxOverlay,
   │  │                               #   BasemapSwitcher, ScaleBar
   │  ├─ search/                      # SearchPanel, CoordinateSearchBox, BboxInput,
   │  │                               #   CollectionFilter, DateRangeFilter,
   │  │                               #   QueryableFilters, ActiveFilterChips
   │  ├─ results/                     # ResultsList, ResultItemRow, ItemDetailDrawer,
   │  │                               #   AssetList, ResultsToolbar
   │  └─ download/                    # SelectionBasket, CredentialsDialog, DownloadDialog,
   │                                  #   DownloadProgressPanel, ManifestExportDialog
   │
   ├─ assets/
   │  └─ styles/                      # base.css, tokens.css, map.css
   └─ locales/
      ├─ sv.json
      └─ en.json
```

---

## 3. Design considerations

### 3.1 Scale is the central problem

Three numbers define the UX:

1. **731 collections** in `stac-bild`.
2. **No result count** — `numberMatched` is `null`.
3. **~100 MB per asset**, on a 2.5 km grid.

They lead to three rules:

- **Do not build a catalog tree.** A 731-node browse tree is unusable. The primary interaction
  is *cross-collection item search constrained by geography*. Collections are a **filter**
  (searchable, virtualized, multi-select, grouped by year/region parsed from the ID), not a
  navigation hierarchy.
- **Never claim a total.** Show "1 240 loaded" + *Load more*, and mark the list "complete" only
  once `rel=next` is absent. Infinite scroll is acceptable but must have an explicit stop.
- **Guard the search area.** Compute bbox area before searching. Above a threshold (~50×50 km),
  warn and require confirmation; the item count grows quadratically. Cap auto-loading at N pages
  and require an explicit action to continue.

### 3.2 Map rendering

- **One GeoJSON source, not N features/markers.** Load all footprints into a single source with
  a `fill` layer, a `line` layer, and a `fill` layer for the selected state. Style by
  `feature-state` (`hover`, `selected`) so selection changes never re-serialize the source.
- **Set `promoteId`** to a stable composite `collection/id` so `feature-state` survives updates
  and matches basket keys.
- **Footprints overlap heavily** — many years cover the same ground. A click at one point may hit
  10+ items. Use `queryRenderedFeatures` and, on multi-hit, show a **disambiguation popup listing
  all items under the cursor** rather than arbitrarily picking the topmost. This is the single
  most important map-interaction detail for this dataset.
- **Fit bounds on new results**, but never fight the user: skip the auto-fit if they have panned
  since the search was issued.
- **Bidirectional hover** between the results list and the map, both directions driven through
  `feature-state`.

### 3.3 Search inputs

Three entry paths, all producing the same internal bbox/geometry:

1. **Coordinate box.** Must accept, and auto-detect:
   - WGS84 decimal (`59.33, 18.07`), with lat/lon order tolerated in either direction
   - WGS84 DMS (`59°19'48"N 18°04'12"E`)
   - **SWEREF99 TM / EPSG:3006** (`6580822, 674032`) — this is what Swedish users actually have
   - a pasted bbox (`17.9,59.2,18.2,59.4`)

   Detect by magnitude: SWEREF northings are ~6–7.5 M, eastings ~200–900 k, so they cannot be
   confused with degrees. Show the parsed interpretation back to the user before searching, and
   let them override the detected CRS. A point search buffers to a small box (configurable, e.g.
   1 km) since a point rarely lands meaningfully.

2. **Draw a bbox.** Terra Draw rectangle mode. The drawn box is editable by dragging handles, and
   its numeric bounds appear in an editable field — draw and type stay in sync.

3. **Map viewport.** A *Search this area* button using the current view bounds. Cheap to build,
   and in practice the most-used control.

### 3.4 Selection model

- Keyed by `` `${collection}/${id}` `` — item IDs are only unique within a collection.
- **Selection survives new searches, filter changes, and pagination.** A user assembling a
  download across several years must not lose their basket by re-searching. Show clearly when
  the basket contains items not in the current result set ("12 selected, 4 not in current
  results").
- Bulk actions: *select all loaded*, *select all in current bbox*, *invert*, *clear*, and
  *select by collection*.
- Persist the basket to `sessionStorage` so a refresh is not catastrophic.
- Show a **running total estimate** — item count, and byte total where `file:size` is available
  (fall back to a per-collection average with a clear "estimated" label).

### 3.5 Authentication and credential handling

This deserves care, because the app asks for real Geotorget credentials.

- **Read-only by default.** Browsing, searching, thumbnails, and metadata need no credentials at
  all. Only prompt at the moment of download.
- **In-memory by default.** Credentials live in a Pinia store, not `localStorage`. Offer an
  explicit, clearly-labelled "remember for this tab" that uses `sessionStorage`. Never
  `localStorage`, and never as a URL parameter.
- **Scope credentials per asset host**, not per STAC API — assets may live on a different origin
  from the catalog, as they do here (`dl1.lantmateriet.se` vs `api.lantmateriet.se`).
- **Validate before bulk work** with a single `HEAD` against one selected asset. Distinguish
  `401` (bad credentials) from `403` (valid credentials, no subscription to *this product*) —
  they are very different user problems, and Geotorget access is granted per product.
- Never log credentials; redact `Authorization` from any error surface.
- State plainly in the UI that credentials are sent directly from the browser to Lantmäteriet
  and pass through no server.

### 3.6 URL as state

`/api/:apiId` carries `bbox`, `collections`, `datetime`, `filter`, and map view in the query
string. Searches become shareable and bookmarkable. Debounce history writes and use `replace`
for map movement so the back button stays useful. Selection is *not* in the URL — it grows
unbounded.

### 3.7 Errors, resilience, accessibility

- Distinguish network failure, CORS failure, `4xx`, and `5xx`; each has a different remedy and
  should read differently.
- Abort in-flight searches with `AbortController` when parameters change.
- Retry transient failures (`429`, `5xx`) with exponential backoff and jitter; respect
  `Retry-After`.
- The map is not the only way to work: every map action has a keyboard-accessible equivalent
  (results list is fully navigable, bbox is typeable). Announce result counts via an ARIA live
  region. Do not encode selection by colour alone — use a border and a checkbox in the list.

### 3.8 Generality vs. Lantmäteriet specifics

The core is spec-generic — anything conforming to `item-search` should work, which is why the
filter UI is generated from `/queryables` rather than hardcoded. Lantmäteriet specifics
(Swedish property labels, EPSG:3006 default, Basic-auth asset host) are isolated behind an
optional per-entry `quirks` block in the registry, so adding Element84, Planetary Computer, or
a private catalog later needs no core changes.

---

## 4. The download problem

The hard part of this app. Assets are ~100 MB each and a realistic selection is 10–100 GB.

**Rejected:** client-side zip (`fflate`/JSZip). Memory-bound, and offers nothing over separate
files.

**Rejected:** `<a download>` per item. The Artifact/browser sandbox aside, a plain link cannot
carry an `Authorization` header, so it would simply 401.

**Tier 1 — File System Access API (Chrome, Edge, Opera).**
`showDirectoryPicker()` once, then per item:

```ts
const res = await fetch(asset.href, { headers: { Authorization: basic } })
const handle = await dir.getFileHandle(filename, { create: true })
const writable = await handle.createWritable()
await res.body.pipeTo(writable)     // streams to disk, never buffered in memory
```

Real progress comes from `Content-Length`, which the asset host exposes via
`Access-Control-Expose-Headers`. Concurrency 2–3 (be a good citizen against a public service),
a proper queue with pause/resume/cancel, per-file retry, and a final summary of successes and
failures. Skip files already present in the target directory so an interrupted run resumes
cheaply.

**Tier 2 — sequential single-file save (Firefox, Safari).**
No directory handle available. Fetch with auth to a `Blob`, save via an object-URL anchor, one
at a time with a clear "keep this tab open" notice. Warn on selections above a size threshold.

**Tier 3 — manifest export (always available, and the honest answer for very large jobs).**
Generate and download:

- `aria2c` input file (`aria2c -i list.txt -x4 --http-user=… --http-passwd=…`)
- a `curl`/`wget` shell script and a PowerShell equivalent
- plain URL list, CSV of items, and a GeoJSON `FeatureCollection` of the selection

**Never embed credentials in generated scripts** — emit placeholders and let the user supply
them via environment variables or a prompt.

For 50 GB, tier 3 is genuinely the right tool, and the UI should say so rather than pretending
the browser is a download manager. Recommend it proactively above a threshold.

---

## 5. Step-by-step implementation plan

### Phase 0 — Foundation
1. Install: `vue-router`, `pinia`, `maplibre-gl`, `terra-draw`, `terra-draw-maplibre-gl-adapter`, `proj4`, `@types/proj4`, `vue-i18n`, `@tanstack/vue-virtual`.
2. Dev deps: `vitest`, `@vue/test-utils`, `jsdom`, `eslint`, `prettier`, `@playwright/test`.
3. Remove template leftovers (`HelloWorld.vue`, `assets/hero.png`, `vue.svg`).
4. Set up router, Pinia, i18n in `main.ts`; design tokens and dark mode in `assets/styles/`.
5. Add path alias `@ -> src` in `vite.config.ts` and `tsconfig.app.json`.

**Milestone:** app boots with two empty routes.

### Phase 1 — Types and STAC client
6. Write `types/stac.ts` from the STAC 1.0.0 spec (Catalog, Collection, Item, Asset, Link, ItemCollection).
7. Build `services/stacClient.ts`: `getRoot`, `getCollections`, `getCollection`, `search(params, signal)`, `searchNext(nextLink, signal)`. GET for simple bbox queries, POST for `intersects`/CQL2. Follow `rel=next`; never assume `numberMatched`.
8. Add retry/backoff and typed error classes (`StacHttpError`, `StacNetworkError`).
9. Unit-test against **recorded fixtures** captured from the live API (real 731-collection payload, a search page with a `next` token, an item with all three asset types).

**Milestone:** `stacClient` typed, tested, and proven against real payloads.

### Phase 2 — Front page
10. `config/registry.ts` with the three Lantmäteriet catalogs: id, title, description, base URL, asset host, auth type (`basic`), default CRS, licence, docs link.
11. `registryStore` merging built-ins with user-added APIs from `localStorage`.
12. `HomeView` + `StacApiCard`: title, description and license.
13. `AddCustomApiDialog`: paste a STAC root URL, validate `conformsTo` for `item-search`, warn explicitly if the API lacks it or fails CORS (the most likely failure for third-party APIs), then persist.

**Milestone:** front page lists the three APIs, live status, custom APIs can be added.

### Phase 3 — Map
14. `useMapLibre` — init, style, `NavigationControl`, `ScaleControl`, cleanup on unmount, `ResizeObserver`. Map instance held in a non-reactive `shallowRef`; **never wrap the MapLibre instance in `reactive()`**, which would proxy it and break internals.
15. `useFootprintLayer` — single GeoJSON source with `promoteId: 'key'`, plus `fill` / `line` / selected-fill layers styled by `feature-state`.
16. Hover and click handlers; `queryRenderedFeatures` with the multi-hit disambiguation popup (§3.2).
17. `BasemapSwitcher` (OpenFreeMap positron / a dark style / an aerial option), preserving camera across style changes.

**Milestone:** hardcoded fixture footprints render, hover, and select correctly.

### Phase 4 — Search
18. `searchStore`: params, pages, accumulated items, `nextLink`, loading, error, `AbortController`.
19. `SearchPanel` shell with `ActiveFilterChips`.
20. `CoordinateSearchBox` + `utils/projections.ts`: proj4 defs for EPSG:3006 and EPSG:5845, format auto-detection, and a visible read-back of the parsed interpretation.
21. `useBboxDraw` with Terra Draw rectangle mode, two-way bound to an editable numeric `BboxInput`.
22. *Search this area* from the current viewport, plus the large-area warning.
23. `CollectionFilter`: virtualized, searchable, multi-select, grouped by parsed year/region — this must stay fast at 731 entries.
24. `DateRangeFilter` producing a STAC `datetime` interval.
25. `QueryableFilters` generated from `/queryables`: numeric ranges honouring schema `minimum`/`maximum`, enums as multi-selects, emitted as CQL2 JSON.
26. `useUrlState` — two-way sync with the query string.

**Milestone:** all three search paths work end to end and hit the live API.

### Phase 5 — Results and selection
27. `ResultsList` (virtualized) + `ResultItemRow`: public thumbnail, ID, collection, date, resolution, selection checkbox.
28. Bidirectional hover/selection sync with the map.
29. `selectionStore` keyed by `collection/id`, persisted to `sessionStorage`, with bulk operations.
30. `SelectionBasket`: count, size estimate, out-of-current-results indicator, clear.
31. `ItemDetailDrawer`: full properties with Swedish→English label mapping, asset list, larger thumbnail, raw-JSON view.
32. *Load more* / bounded infinite scroll, with an explicit "all results loaded" terminal state.

**Milestone:** search → inspect → select → basket works fully, no auth needed.

### Phase 6 — Authentication
33. `authStore` — per-asset-host credentials, in memory, opt-in `sessionStorage`.
34. `CredentialsDialog` with the plain-language explanation from §3.5.
35. `services/auth.ts` — `HEAD` validation against a selected asset, distinguishing 401 from 403.

**Milestone:** credentials can be entered and validated against a real asset.

### Phase 7 — Download
36. `services/fsAccess.ts` — capability detection and directory-handle management.
37. `services/downloader.ts` — queue, concurrency 2–3, streamed writes, `Content-Length` progress, pause/resume/cancel, per-file retry, skip-existing.
38. `DownloadDialog` — choose tier, show size estimate, recommend tier 3 above the threshold.
39. `DownloadProgressPanel` — per-file and aggregate progress, failure list, retry-failed.
40. Tier 2 sequential fallback for Firefox/Safari.
41. `services/manifest.ts` — aria2c, curl, wget, PowerShell, URL list, CSV, GeoJSON; credentials as placeholders only.

**Milestone:** a real multi-file authenticated download completes to disk.

### Phase 8 — Polish
42. i18n pass; Swedish property labels in `utils/propertyLabels.ts`.
43. Accessibility audit: keyboard paths, focus management in dialogs, ARIA live regions, contrast.
44. Error and empty states throughout; toast host.
45. Loading skeletons; debounce and cancel tuning.
46. Playwright E2E: registry → search by bbox → select → manifest export.
47. Bundle check — MapLibre is large; lazy-load the map route and confirm tree-shaking.
48. README: setup, Geotorget access instructions, deployment.

### Stretch goals
- **In-map COG preview** via `@geomatico/maplibre-cog-protocol`, which supports custom auth headers — preview a selected orthophoto at full resolution without downloading it.
- Elevation hillshade preview for `stac-hojd` using the same protocol.
- COPC/laser point-cloud preview for `dsm-skoglig-copc`.
- Saved searches and shareable selection permalinks (server-free, via compressed URL fragment).
- PWA/offline shell for the catalog listing.

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Lantmäteriet tightens CORS on the asset host | High — kills serverless downloads | Isolate all asset access in `downloader.ts`; manifest export (tier 3) keeps working regardless; a proxy could be added behind the same interface |
| File System Access API unsupported (Firefox, Safari) | Medium | Tiers 2 and 3, with capability detection up front |
| Huge bbox → runaway pagination | Medium | Area guard, page cap, explicit continue |
| Users lack Geotorget product access (403) | Medium | Distinguish 401/403 and link to the product page |
| 731 collections make the filter sluggish | Medium | Virtualization + indexed client-side search |
| Overlapping footprints make clicking ambiguous | Medium | Multi-hit disambiguation popup |
| Users paste credentials into a static site | High (trust) | In-memory default, explicit disclosure, no `localStorage`, never in generated scripts |

---

## 7. Sources

- [Lantmäteriet STAC-bild (Swagger)](https://api.lantmateriet.se/stac-bild/v1/api.html)
- [Ortofoto Nedladdning — Lantmäteriet](https://www.lantmateriet.se/sv/geodata/vara-produkter/produktlista/ortofoto-nedladdning/)
- [Åtkomst och leverans — Ortofoto Nedladdning (Geotorget)](https://geotorget.lantmateriet.se/dokumentation/GEODOK/44/latest/atkomst-och-leverans.html)
- [STAC Index — Lantmäteriet ortofoto catalog](https://www.stacindex.org/catalogs/ortofoto-nedladdning-lantmateriet)
- [STAC Index — Lantmäteriet höjddata catalog](https://stacindex.org/catalogs/markhojdmodell-nedladdning-lantmateriet)
- [radiantearth/stac-browser](https://github.com/radiantearth/stac-browser)
- [MapLibre GL JS plugins](https://maplibre.org/maplibre-gl-js/docs/plugins/)
- [MapLibre GL JS vs Leaflet — Jawg](https://blog.jawg.io/maplibre-gl-vs-leaflet-choosing-the-right-tool-for-your-interactive-map/)
- [geomatico/maplibre-cog-protocol](https://github.com/geomatico/maplibre-cog-protocol)
- [Serverless rasters in MapLibre: the COG protocol extension](https://geomatico.es/en/serverless-rasters-in-maplibre-the-cog-protocol-extension/)
- [API Nedladdning Geotorget v1.0](https://geotorget.lantmateriet.se/dokumentation/GEODOK/OD/api-nedladdning-geotorget-v1-0.html)
