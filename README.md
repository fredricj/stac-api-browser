# STAC API Browser

A web-based browser for [STAC](https://stacspec.org/) APIs, built around
Lantmäteriet's Swedish geodata catalogs: search items on a map, select the areas
you want, and download the assets.

Implementation is tracked in [`plan.md`](./plan.md). **Phases 0–3 are complete** —
the app shell boots, the STAC client is typed and tested, the front page lists
the catalogs and lets you add your own, and the browse page renders item
footprints on a MapLibre map with hover, click-to-select and basemap switching.
Search and download arrive in later phases.

## Testing against real payloads

`src/services/__fixtures__/` holds responses recorded from
`api.lantmateriet.se/stac-bild/v1` — including the full 731-collection listing
and consecutive search pages. The client's tests run against those rather than
hand-written mocks, so they catch real-world quirks: `numberMatched` arriving as
`null`, and paging links that switch between GET (token in the query string) and
POST (token in a body). Re-record them with `curl` if the API changes.

## Requirements

- Node.js — see the note on versions below
- npm

## Getting started

```bash
npm install
npm run dev
```

## Scripts

| Script                 | Purpose                                           |
|------------------------|---------------------------------------------------|
| `npm run dev`          | Vite dev server                                   |
| `npm run build`        | Typecheck, then production build to `dist/`       |
| `npm run preview`      | Serve the production build on port 4173           |
| `npm run typecheck`    | `vue-tsc` project build, no emit                  |
| `npm run lint`         | ESLint with `--fix`                               |
| `npm run lint:check`   | ESLint, no writes (use in CI)                     |
| `npm run format`       | Prettier write                                    |
| `npm run format:check` | Prettier check (use in CI)                        |
| `npm test`             | Vitest, single run                                |
| `npm run test:watch`   | Vitest in watch mode                              |
| `npm run test:e2e`     | Playwright — needs `npx playwright install` first |

## Architecture in one paragraph

The app is a **fully static SPA with no backend**. The Lantmäteriet STAC APIs
send `access-control-allow-origin: *`, and the asset host `dl1.lantmateriet.se`
permits the `Authorization` header on preflight while exposing `Content-Length`
and `Content-Range`. That means the browser can search the catalogs and stream
authenticated asset downloads directly, so the whole thing deploys to any static
host. `vite.config.ts` keeps a commented-out dev proxy as an escape hatch for
third-party catalogs that lack CORS.

## Data access

Browsing, searching, and previewing need **no credentials** — item metadata and
thumbnails are public. Downloading the actual COG assets requires HTTP Basic
credentials from a [Geotorget](https://geotorget.lantmateriet.se/) subscription
to the relevant product. Credentials are held in memory only and are sent
straight from your browser to Lantmäteriet; they never pass through a server and
are never written to `localStorage`.

Data is licensed CC BY 4.0 by Lantmäteriet.

## Notes on tooling

- Node 24.7.0 is in use locally, but Vite 8 asks for `^22.18.0 || >=24.11.0`.
  It builds and tests fine, though npm prints an `EBADENGINE` warning; bump Node
  to 24.11+ to silence it.
- ESLint 10 needs `jiti` to load the TypeScript flat config (`eslint.config.ts`);
  it is installed as a dev dependency.
- Playwright's browser binaries are **not** downloaded by `npm install`. Run
  `npx playwright install chromium` before `npm run test:e2e`.
- MapLibre needs WebGL, which jsdom does not provide, so component tests
  substitute `src/test/maplibreMock.ts` for the real module. It records
  sources, layers, feature-state and handlers, so the tests still assert on
  behaviour rather than merely "it did not throw".
- The map chunk is ~958 kB (249 kB gzipped) — that is MapLibre, and it is
  confined to the lazily-loaded browse route, so the catalog list never pays
  for it. The 500 kB build warning is expected.
