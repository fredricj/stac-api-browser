# STAC API Browser

A web-based browser for [STAC](https://stacspec.org/) APIs, built around
Lantmäteriet's Swedish geodata catalogs: search items on a map, select the areas
you want, and download the assets.

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

Browsing, searching and previewing thumbnails need no account.
To download files you need an account at lantmäteriet with the appropriate permissions — see [Geotorget access](#geotorget-access) below for
what downloading the actual files requires.

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

## Geotorget access

Browsing, searching, and previewing need **no credentials** — item metadata and
thumbnails are public on all three built-in catalogs, so the app is fully
useful before anyone signs in. Downloading the actual COG/vector assets is the
one thing that needs an account, because Lantmäteriet meters that per product:

1. Create an account at [geotorget.lantmateriet.se](https://geotorget.lantmateriet.se/)
   if you do not already have one.
2. Subscribe to the product behind the catalog you want to download from —
   each built-in catalog's card on the front page links to its product page
   (**Product page**), e.g.
   [Ortofoto Nedladdning](https://www.lantmateriet.se/sv/geodata/vara-produkter/produktlista/ortofoto-nedladdning/)
   for the aerial imagery catalog. Access is granted per product, not
   account-wide, and some products are free while others require a paid
   subscription — Lantmäteriet's own pages state which.
3. In the app, select something and press **Download selected**; the dialog
   prompts for your Geotorget username and password the first time a download
   needs them. They are sent as HTTP Basic auth straight from your browser to
   `dl1.lantmateriet.se` over HTTPS — see [Data handling](#data-handling)
   below for exactly what "straight from your browser" means.

If a download fails with a sign-in problem, the app distinguishes **invalid
credentials** (401 — the username or password is wrong) from **valid
credentials without access** (403 — the sign-in worked, but the account has no
subscription to that particular product), because they call for different
fixes and Geotorget's own error page does not make the difference obvious.

### Data handling

Credentials are held in memory only by default, live for the current page load,
and are never written to `localStorage` or put in the URL. An explicit
"remember for this tab" checkbox opts into `sessionStorage`, which is cleared
when the tab closes. Nothing here has a server of its own to send credentials
to or log them on — the disclosure the app itself shows before asking for a
password is the accurate one.

Data served by all three built-in catalogs is licensed CC BY 4.0 by
Lantmäteriet.

## Deployment

Deploying is copying `dist/` to any static host — there is no server-side
piece and nothing to configure by hand at build or deploy time:

```bash
npm run build
# → dist/, ready to upload as-is
```

- **Root-domain hosts** (Netlify, Cloudflare Pages, Vercel's static preset, a
  plain S3 bucket + CDN, …): no configuration needed. Point the host at
  `dist/` with `index.html` as the SPA fallback for unmatched paths — the
  router uses HTML5 history mode, so a host that does not serve `index.html`
  for e.g. `/api/lantmateriet-bild` on a hard refresh will 404 there.
- **GitHub Pages** (this repo's actual deployment target) is set up already:
  [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) builds and
  publishes on every push to `main`, or on demand from the Actions tab. Two
  things a plain static build needs that a project page specifically requires:
  - **A subpath base.** `user.github.io/repo-name/` is not `/`, so
    `vite.config.ts` sets `base` to `/stac-api-browser/` — but only when the
    workflow's `GITHUB_PAGES` env var is set, so `dev`/`build`/`preview` and
    the Playwright suite still assume the app is rooted at `/` locally. The
    router already reads the base from Vite's `import.meta.env.BASE_URL`
    (`src/router/index.ts`), so nothing else needed to change.
  - **An SPA fallback with no rewrite rules.** GitHub Pages, unlike the hosts
    above, cannot be told to serve `index.html` for an unmatched path — it
    just 404s. `public/404.html` is the standard workaround: it encodes the
    real path into a query string and redirects to the site root, where an
    inline script in `index.html`'s `<head>` decodes it and restores the URL
    with `history.replaceState` before Vue Router ever reads it. A no-op on
    every other host, since that query string is never produced any other way.

  The one manual step is enabling it once, in this repo's *Settings → Pages →
  Source: GitHub Actions*.
- **A third-party STAC catalog without CORS**, added later via *Add a
  catalog*: this only works when the browser can reach it directly. If one
  ever needs a proxy, `vite.config.ts` keeps a commented-out dev-server proxy
  as the shape such a fix would take; a production deployment would need an
  equivalent at the host level (a serverless function or edge rule), which is
  out of scope for a static host and deliberately not built speculatively.

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
- The browse route's JS chunk is ~1.18 MB (~323 kB gzipped) — that is
  MapLibre plus the app code that uses it, and it is confined to the
  lazily-loaded `/api/:apiId` route, so the front page never pays for it.
  MapLibre's own stylesheet (~85 kB) is imported from `StacMap.vue` rather
  than `main.ts` for the same reason — the front page's CSS is ~12 kB.
  Terra Draw (~220 kB) is a further dynamic import inside the browse route
  itself, loaded only if someone actually draws a box. The 500 kB build
  warning on the browse chunk is expected and not a regression to chase.
