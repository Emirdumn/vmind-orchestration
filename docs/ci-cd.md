# CI / Preview Deploy Pipeline

- **CI** (`.github/workflows/ci.yml`): runs on every push (any branch) and every PR — `npm ci`, `lint`, `build`, `test`. This is the build verification gate.
- **PR previews** (`.github/workflows/pr-preview.yml`): builds the app and publishes it to the `gh-pages` branch under `pr-preview/pr-<number>/` using `rossjrw/pr-preview-action`. GitHub posts the preview URL as a PR comment; the preview is auto-removed when the PR closes.
- **Staging deploy** (`.github/workflows/staging-deploy.yml`): on push to `main`, builds and publishes to the root of `gh-pages` (`https://emirdumn.github.io/vmind-orchestration/`) as a staging/preview URL — **not** a production release.

## Deploy strategy
Static SPA (Vite + React, client-side routed, no server rendering needed) → static hosting is sufficient. Using GitHub Pages (`gh-pages` branch) keeps the pipeline entirely within the existing GitHub repo/token — no new third-party accounts, secrets, or costs to approve.

## Guardrails
- No destructive actions: preview cleanup only removes the PR's own preview folder.
- No production release: the `main`/staging deploy target is the `gh-pages` site, a staging URL — actual production domain publish still requires explicit CEO approval.
- No permission/access changes beyond enabling GitHub Pages (Settings → Pages → Deploy from branch → `gh-pages` / root), which must be turned on once in repo settings.

## Known limitation
`BrowserRouter` currently assumes root-relative paths, so deep-linking directly to a non-root route under a `pr-preview/pr-N/` subpath may 404 on GitHub Pages (no SPA fallback). The root URL of each preview loads correctly. Fixing this (e.g. adding a `basename` or switching to hash routing) is an app-routing change, tracked separately from this CI/deploy task.
