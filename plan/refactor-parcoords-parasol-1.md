---
goal: Refactor Pareto Explorer to use parasol-es for parallel coordinates, adopt a light color theme, and port parasol bundling/clustering features
version: 1.0
date_created: 2026-06-11
last_updated: 2026-06-11
owner: Joseph Kasprzyk (jrkasprzyk)
status: 'Planned'
tags: [refactor, feature, architecture, migration, ui]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Pareto Explorer currently renders its parallel coordinates view with a hand-rolled D3 v7 SVG component (`ParCoords` in `src/ParetoApp.jsx:200-376`). The original implementation avoided parasol-es because it was unmaintained; the `modernization` branch of `ParasolJS/parasol-es` (v2.0.0, D3 v7, Rollup 4, `@jrkasprzyk/parcoord-es` backend) is now nearly ready for npm publication. This plan replaces the custom `ParCoords` component with a parasol-es-backed React wrapper, converts the app from its dark theme to a light theme (matching parasol's default light styling), ports parasol's bundling and k-means clustering features into the UI, and optionally migrates the repository into the ParasolJS GitHub organization.

## 1. Requirements & Constraints

- **REQ-001**: The parallel coordinates view (tab `parallel` in `src/ParetoApp.jsx`) must be rendered by parasol-es, not the custom D3 `ParCoords` component.
- **REQ-002**: All existing parallel-coordinates feature parity must be preserved: axis brushing/filtering, hover highlight synced with the table view, ε-front line coloring, per-front visibility toggles, categorical (string) axes, category-colored axis labels, and the "Preferred @ Top / Bottom" objective axis orientation feature.
- **REQ-003**: The entire app (landing page, import setup, table, sidebar, config, parallel view) must use a light color theme. The theme must remain a single source of truth (the `C` constant object pattern) so future theme changes are one-file edits.
- **REQ-004**: Category colors (`CATEGORY_COLORS` in `src/ParetoApp.jsx:441-447`) must be re-derived for adequate contrast on light backgrounds (WCAG AA, contrast ratio >= 4.5:1 for text-sized elements).
- **REQ-005**: Expose parasol-es edge bundling controls in the parallel view: bundle dimension selector, bundling strength slider (0–1), smoothness slider (0–1), via `ps.bundleDimension()`, `ps.bundlingStrength()`, `ps.smoothness()`.
- **REQ-006**: Expose parasol-es k-means clustering in the UI: cluster count `k` (2–10), variable subset selection (numeric columns only), color-by toggle (front vs. cluster), via `ps.cluster({k, vars, palette, std})`.
- **REQ-007**: Brushing in the parasol chart must filter the React table view (linked selection), using parcoords `brush` events and `ps.state.brushed`.
- **REQ-008**: ε-nondominated sorting, weighted preference scoring, CSV import (including dual-header role detection), and the import setup wizard remain unchanged in behavior (functions `epsilonDominates`, `epsilonSort`, `wScore`, `parseCSV` in `src/ParetoApp.jsx:18-194`).
- **CON-001**: parasol-es v2.0.0 is not yet on npm. Until publication, install from git: `npm install github:ParasolJS/parasol-es#modernization` (verified: `dist/` is committed on that branch, so the build artifacts are present without a `prepare` script). Switch to the npm version (`parasol-es@^2.0.0`) once published.
- **CON-002**: parasol-es is an imperative, selector-based library (`Parasol(data)('.parcoords')`) that owns its DOM subtree and injects canvas/svg layers. All parasol interaction must be confined to one React wrapper component using refs; React must never reconcile inside the parasol container element.
- **CON-003**: parasol-es ESM build declares dependencies external; the app's d3 (`d3@^7.9.0`) is shared. Do not pin or downgrade d3 below v7.
- **CON-004**: parasol-es pulls `jquery` and `slickgrid-es6` transitively (grid feature). The app keeps its own React table and does NOT use `attachGrid`/SlickGrid. Accept the bundle weight in phase 1; a follow-up upstream issue may make the grid import lazy.
- **CON-005**: Vite 8 must pre-bundle parasol's CommonJS transitive deps (`ml-kmeans`, `slickgrid-es6`, `jquery`); add them to `optimizeDeps.include` in `vite.config.js` if dev-server import errors occur.
- **CON-006**: parasol-es requires its stylesheet (`parasol-es/dist/parcoords.css`) to be imported for axis/brush rendering; this stylesheet assumes a light background (dark text `#222` on transparent), which is compatible with REQ-003 only after the light theme lands. Therefore the light theme phase MUST precede or accompany the parasol integration phase.
- **GUD-001**: Keep analytics logic (Pareto sorting, scoring, CSV parsing) framework-free pure functions so they can later be unit tested or upstreamed.
- **GUD-002**: Split the 1366-line `src/ParetoApp.jsx` into modules along existing seams (theme constants, CSV parsing, Pareto math, plot wrapper) during this refactor rather than as a separate effort.
- **PAT-001**: React-wraps-imperative-lib pattern: `useRef` for container, `useEffect` for create/destroy keyed on data identity, separate `useEffect`s for cheap prop updates (color, alpha, highlight) that call parasol methods + `.render()` without re-instantiating.
- **PAT-002**: Theme tokens accessed only via the `C` object and `CATEGORY_COLORS`; no hard-coded hex values in component JSX.

## 2. Implementation Steps

### Implementation Phase 1 — Module extraction (no behavior change)

- GOAL-001: Split `src/ParetoApp.jsx` into single-responsibility modules so the theme swap and plot replacement are isolated diffs.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create `src/theme.js` exporting `C`, `FM`, `FB`, `CATEGORY_COLORS`, `CATEGORY_LABELS`, `DEFAULT_CATEGORY_ORDER`, `frontColor()`, `cellBg()` (moved verbatim from `src/ParetoApp.jsx:5-16, 196-198, 406-414, 433-447`). | | |
| TASK-002 | Create `src/lib/csv.js` exporting `parseCSV` (moved verbatim from `src/ParetoApp.jsx:18-138`) and the `DEMO` CSV string (`src/ParetoApp.jsx:416-431`). | | |
| TASK-003 | Create `src/lib/pareto.js` exporting `epsilonDominates`, `epsilonSort`, `wScore` (moved verbatim from `src/ParetoApp.jsx:140-194`). | | |
| TASK-004 | Create `src/components/ParCoords.jsx` containing the existing custom D3 component (`src/ParetoApp.jsx:200-376`) unchanged; update imports in `src/ParetoApp.jsx`. This file is deleted in Phase 3. | | |
| TASK-005 | Create `src/components/controls.jsx` exporting `Chip` and `Slider` (`src/ParetoApp.jsx:378-404`). | | |
| TASK-006 | Validate: `npm run build` succeeds; app renders identically (demo data smoke test: load demo, check table, parallel, config tabs). | | |

### Implementation Phase 2 — Light theme

- GOAL-002: Replace the dark palette with a light palette as the single `C` object, with category colors re-tuned for light backgrounds.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Replace `C` values in `src/theme.js` with light equivalents: `bg: "#f7f8fa"`, `surface: "#ffffff"`, `surfaceAlt: "#eef1f6"`, `border: "#d4dae4"`, `borderLight: "#bcc6d6"`, `text: "#1a2233"`, `textMuted: "#5a6a85"`, `textDim: "#8a96ab"`, `accent: "#00875f"`, `accentDim: "rgba(0,135,95,0.10)"`, `front0: "#00875f"`, `front1: "#2563eb"`, `front2: "#9333ea"`, `front3: "#ea580c"`, `frontN: "#94a3b8"`, `dominated: "#dc2626"`, `dominatedDim: "rgba(220,38,38,0.08)"`, `highlight: "#7c3aed"`, `highlightDim: "rgba(124,58,237,0.10)"`. | | |
| TASK-008 | Update `CATEGORY_COLORS` in `src/theme.js` for light-background contrast: `solution: "#7c3aed"`, `decision: "#2563eb"`, `objective: "#00875f"`, `constraint: "#dc2626"`, `metric: "#5a6a85"`. | | |
| TASK-009 | Update `index.html:11` body background from `#0b1121` to `#f7f8fa`. | | |
| TASK-010 | Update `cellBg()` heatmap interpolation endpoints in `src/theme.js` to light-theme red→green (`#dc2626` → `#00875f` at alpha 0.18) so table conditional formatting remains legible. | | |
| TASK-011 | Audit all JSX for hard-coded colors outside `theme.js` (search regex `#[0-9a-fA-F]{3,8}|rgba?\(` in `src/`); replace any stragglers with `C.*` tokens. | | |
| TASK-012 | Validate: visual smoke test of landing page, import setup, table (heatmap on/off, hover highlight), sidebar chips, config tab. Verify text contrast with browser devtools accessibility checker (>= AA per REQ-004). | | |

### Implementation Phase 3 — Replace custom ParCoords with parasol-es

- GOAL-003: Render the parallel view with parasol-es behind a React wrapper, with full feature parity (REQ-002, REQ-007).

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-013 | Add dependency: `npm install github:ParasolJS/parasol-es#modernization`. Record exact commit SHA in `package-lock.json`. Add CON-005 `optimizeDeps.include` entries to `vite.config.js` only if dev server errors on import. | | |
| TASK-014 | Import `parasol-es/dist/parcoords.css` once in `src/main.jsx`. Add app-level CSS overrides (new file `src/parasol-overrides.css`) scoped to `.parcoords` for font (`FM`) and axis text color (`C.textMuted`) so the chart matches the theme. | | |
| TASK-015 | Create `src/components/ParasolPlot.jsx`: React wrapper component with props `{ data, axes, directions, objectives, preferredObjectiveEdge, columnCategories, highlightId, colorBy, frontPalette, clusterConfig, bundling, onHover, onBrush }`. Instantiate with `Parasol(data, { chartOptions })('#parasol-chart')` inside `useEffect` keyed on `[data, axes]`; destroy by clearing the container on cleanup. Container `div` rendered by React with fixed `id="parasol-chart"` and `className="parcoords"`, height 370, width 100% (ResizeObserver triggers `ps.render()` on width change). | | |
| TASK-016 | Implement axis configuration in `ParasolPlot`: hide non-display columns via `ps.hideAxes(headers.filter(h => !axes.includes(h)))`; implement preferred-edge orientation by calling `ps.flipAxes(axesToFlip)` where `axesToFlip` reproduces the `invertForPreference` logic from `src/ParetoApp.jsx:235` (objective axes where `(dir === "min" && prefersTop) || (dir === "max" && !prefersTop)`). | | |
| TASK-017 | Implement line coloring: `ps.color(d => frontColor(d._front))` when `colorBy === "front"`. Update on prop change via a lightweight `useEffect` calling `ps.color(...).render()` without re-instantiating. | | |
| TASK-018 | Implement hover sync: subscribe to parcoords mouseover via `ps.charts[0].on("highlight", ...)` if available, else attach a `mousemove` handler using parcoords `getCentroids`/mark API; call `onHover(id)`. For inbound `highlightId` (table → chart), call `ps.mark([row])` / `ps.unmark()`. | | |
| TASK-019 | Implement brush → table linking (REQ-007): register `ps.charts[0].on("brush", () => onBrush(ps.state.brushed.map(d => d._id)))`; in `ParetoApp`, store `brushedIds` state and filter the table view when non-null. Add a "Clear Brush" button calling `ps.brushReset()`. | | |
| TASK-020 | Replace `<ParCoords .../>` usage in the parallel tab (`src/ParetoApp.jsx:1222-1231`) with `<ParasolPlot .../>`; pass `visibleData` so ε-front visibility toggles keep working (data filtered before parasol sees it). | | |
| TASK-021 | Reproduce category-colored axis labels: after `ps.render()`, post-process axis label text elements (`.parcoords .dimension .label`) setting `fill` from `CATEGORY_COLORS[columnCategories[axis]]`; re-run after any `render()`. Document this as a candidate upstream feature (`dimensionTitleColor` option). | | |
| TASK-022 | Delete `src/components/ParCoords.jsx` (custom D3 implementation) once parity checklist in TASK-023 passes. | | |
| TASK-023 | Validate parity checklist: (a) brush on numeric axis filters lines and table; (b) hover line highlights table row and vice versa; (c) front colors match table badges; (d) string columns render as categorical axes; (e) Preferred @ Top/Bottom flips objective axes; (f) front visibility chips add/remove lines; (g) `npm run build` clean. | | |

### Implementation Phase 4 — Port parasol features: bundling and k-means clustering

- GOAL-004: Surface parasol-es clutter-reduction features (REQ-005, REQ-006) in the sidebar.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-024 | Add sidebar section "RENDERING" with: smoothness `Slider` (0–0.25, step 0.01, default 0), bundling strength `Slider` (0–1, step 0.05, default 0), bundle dimension `Chip` selector (numeric columns, single-select, none = bundling off). Wire to `ParasolPlot` `bundling` prop → `ps.smoothness(v).render()`, `ps.bundleDimension(dim)`, `ps.bundlingStrength(v).render()`. Note: bundling requires a bundle dimension set first; disable strength slider until one is chosen. | | |
| TASK-025 | Add sidebar section "CLUSTERING" with: enable toggle, `k` slider (2–10, step 1, default 3), cluster variable multi-select chips (default: all objective columns), standardize toggle (default on). Wire to `ParasolPlot` `clusterConfig` prop → `ps.cluster({ k, vars, palette, std, hidden: true })`. | | |
| TASK-026 | Add "COLOR BY" toggle (Front | Cluster) to the sidebar; `cluster()` assigns its own palette, so when active, suppress TASK-017 front coloring; when switching back to Front, re-apply `ps.color(frontColor)` and `ps.resetSelections()` if needed. Use a light-theme-safe categorical palette (`d3.schemeTableau10`) for clusters. | | |
| TASK-027 | Add cluster legend below the chart (swatch + "Cluster n" per cluster, mirroring the existing front legend at `src/ParetoApp.jsx:1236-1244`). | | |
| TASK-028 | Add "Export brushed as CSV" button using `ps.exportData({ type: 'brushed' })` (falls back to all data when nothing brushed). | | |
| TASK-029 | Validate: cluster with demo data (k=3, objectives as vars) shows 3 distinct line colors; bundling strength visibly bundles lines; export downloads a CSV containing only brushed rows; toggling Color By restores front colors exactly. | | |

### Implementation Phase 5 — Dependency finalization and repository migration

- GOAL-005: Move from git dependency to published npm package; optionally transfer the repository to the ParasolJS organization.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-030 | After `parasol-es@2.0.0` is published to npm: replace the git dependency with `"parasol-es": "^2.0.0"` in `package.json`, run `npm install`, verify `npm run build` and the TASK-023 parity checklist. | | |
| TASK-031 | Update `README.md`: describe parasol-es as the plotting engine, cite the Parasol paper (Raseman, Jacobson, Kasprzyk 2019, EMS 116:153-163, doi:10.1016/j.envsoft.2019.03.005), document the light theme and new bundling/clustering controls. | | |
| TASK-032 | Delete `dev_notes.txt` (superseded by this plan) or update it to point at `plan/refactor-parcoords-parasol-1.md`. | | |
| TASK-033 | (Optional, requires ParasolJS org admin) Transfer `paretoexplorer` repo: GitHub Settings → Transfer ownership → ParasolJS. Pre-checks: no name collision in org, Vercel project re-linked to new repo slug post-transfer, local remote updated (`git remote set-url origin https://github.com/ParasolJS/paretoexplorer.git`). GitHub auto-redirects old URLs. | | |
| TASK-034 | (Optional, post-transfer) Update `package.json` `repository`/`homepage` fields and any badge URLs to the ParasolJS org path. | | |

## 3. Alternatives

- **ALT-001**: Keep the custom D3 `ParCoords` component and only restyle it light — rejected: duplicates maintained functionality (brushing, bundling, clustering) that parasol-es provides, and forgoes the dogfooding benefit of this app exercising the modernized parasol-es before/after its npm release.
- **ALT-002**: Use `@jrkasprzyk/parcoord-es` directly instead of parasol-es — rejected: loses parasol's multi-objective-specific API (cluster, weightedSum, keep/remove/export, linked charts) which is the point of the migration; parcoords alone is barely less integration work.
- **ALT-003**: Adopt parasol's SlickGrid (`attachGrid`) and drop the React table — rejected for this iteration: the existing React table has bespoke features (per-column filters with numeric operators, category-colored headers, conditional-format heatmap, column resize, preference score column) that SlickGrid would regress; revisit later if linked-grid behavior is wanted for free.
- **ALT-004**: Rewrite the app inside the parasol-es demo framework (plain JS, no React) — rejected: throws away working import wizard, ε-sorting UI, and state management for no functional gain.
- **ALT-005**: Theme via CSS custom properties (`var(--bg)`) instead of the JS `C` object — rejected for now: app styling is 100% inline-style JSX; converting to CSS variables is a larger orthogonal refactor. The `C` object remains the single source of truth (REQ-003).

## 4. Dependencies

- **DEP-001**: `parasol-es` v2.0.0 — from `github:ParasolJS/parasol-es#modernization` until npm publication (CON-001), then `^2.0.0` from npm (TASK-030). Brings transitive deps: `@jrkasprzyk/parcoord-es@^3.0.0`, `ml-kmeans@^4.2.1`, `slickgrid-es6`, `jquery`, `lodash-es`, `file-saver`.
- **DEP-002**: `d3@^7.9.0` — already present; shared instance with parasol-es ESM build (CON-003).
- **DEP-003**: `react@^18.3.1` / Vite 8 toolchain — unchanged.
- **DEP-004**: GitHub ParasolJS organization admin access — required only for TASK-033/034.
- **DEP-005**: Vercel deployment — must keep building after the dependency change (git-hosted deps require Vercel's npm install step to fetch from GitHub; public repo, no token needed).

## 5. Files

- **FILE-001**: `src/ParetoApp.jsx` — shrinks substantially: loses theme constants, CSV parser, Pareto math, ParCoords, Chip/Slider; gains brushedIds state, new sidebar sections (RENDERING, CLUSTERING, COLOR BY), ParasolPlot usage.
- **FILE-002**: `src/theme.js` (new) — light theme `C`, fonts, category colors/labels, `frontColor`, `cellBg`.
- **FILE-003**: `src/lib/csv.js` (new) — `parseCSV`, `DEMO`.
- **FILE-004**: `src/lib/pareto.js` (new) — `epsilonDominates`, `epsilonSort`, `wScore`.
- **FILE-005**: `src/components/ParasolPlot.jsx` (new) — React wrapper around parasol-es (PAT-001).
- **FILE-006**: `src/components/controls.jsx` (new) — `Chip`, `Slider`.
- **FILE-007**: `src/components/ParCoords.jsx` (new in Phase 1, deleted in Phase 3) — transitional home of the legacy D3 component.
- **FILE-008**: `src/parasol-overrides.css` (new) — theme-matching overrides for parasol's stylesheet.
- **FILE-009**: `src/main.jsx` — adds `parcoords.css` and override CSS imports.
- **FILE-010**: `index.html` — body background → light (TASK-009).
- **FILE-011**: `package.json` / `package-lock.json` — parasol-es dependency (TASK-013, TASK-030).
- **FILE-012**: `vite.config.js` — possible `optimizeDeps.include` additions (CON-005).
- **FILE-013**: `README.md`, `dev_notes.txt` — documentation updates (TASK-031, TASK-032).

## 6. Testing

- **TEST-001**: Build gate: `npm run build` exits 0 with no warnings after every phase (matches existing project validation practice in `dev_notes.txt`).
- **TEST-002**: Phase-1 regression: load demo data; verify table rows, front badges, parallel view, and config tab are pixel-equivalent to pre-refactor (no behavior change intended).
- **TEST-003**: Theme audit: automated grep for hard-coded color literals outside `src/theme.js` and `src/parasol-overrides.css` returns zero hits (TASK-011); manual AA contrast check on text/background pairs (REQ-004).
- **TEST-004**: Parity checklist from TASK-023 executed against demo data AND a real dual-header CSV from `example_data/` (exercises categorical axes and role inference).
- **TEST-005**: Clustering correctness: with demo data, k=3 over Cost/Performance/Reliability, verify every row receives a cluster assignment and chart colors equal legend colors; toggle std on/off changes assignments deterministically for a fixed seed (pass `options.seed` to ml-kmeans if nondeterminism observed).
- **TEST-006**: Bundling: set bundle dimension + strength 0.8, confirm lines visibly converge per bundle and brushing still works while bundled.
- **TEST-007**: Linked brush: brush one axis, confirm table shows exactly `ps.state.brushed` rows; clear brush restores full table.
- **TEST-008**: Export: brushed export CSV row count equals brushed count; columns equal visible headers.
- **TEST-009**: (Recommended, new) Add Vitest + unit tests for `src/lib/csv.js` (dual-header detection, quoted cells, unique header generation) and `src/lib/pareto.js` (known 2-objective ε-dominance fixtures), now that the logic is in pure modules (GUD-001).
- **TEST-010**: Post-publication re-validation (TASK-030): rerun TEST-001/004/007 against the npm-published package.

## 7. Risks & Assumptions

- **RISK-001**: parasol-es hover/highlight event surface may not expose a per-line mouseover API equivalent to the current custom implementation (`ParCoords` attaches per-path listeners). Mitigation: parcoords-es exposes `on("brush")` and mark/highlight methods; if per-line hover is unavailable, degrade hover sync to table→chart only (mark) and document chart→table hover as an upstream feature request.
- **RISK-002**: Brushing on parasol's canvas may not support categorical/string axes the way numeric axes do; current custom component only brushes numeric axes anyway, so parity holds, but verify string axes don't break rendering (TEST-004).
- **RISK-003**: Re-instantiating Parasol on every data change (front visibility toggles change `visibleData` identity) may cause flicker or leak listeners. Mitigation: PAT-001 separates expensive re-instantiation from cheap method-call updates; profile with the largest CSV in `example_data/`; if flicker is unacceptable, use `ps.keepData`/`ps.removeData` or `dimensions()` updates instead of remount.
- **RISK-004**: jquery/slickgrid in the production bundle (~100–200 kB min) despite the grid being unused (CON-004). Mitigation: accept initially; file upstream issue to lazy-import `attachGrid`.
- **RISK-005**: Git dependency installs are slower and pin to a branch head that can move. Mitigation: lockfile pins the SHA; TASK-030 moves to npm semver promptly after publication.
- **RISK-006**: `ml-kmeans@4` API (`kmeans(values, k, options)`) seeds randomly; cluster colors can shuffle between runs. Mitigation: pass fixed `options.seed` via cluster options if supported (TEST-005).
- **RISK-007**: Repo transfer (TASK-033) breaks Vercel's GitHub integration until the project is re-linked; brief deploy gap. Mitigation: do the transfer and re-link in one sitting; GitHub redirects git remotes automatically.
- **ASSUMPTION-001**: `parasol-es` modernization branch `dist/` artifacts are kept in sync with `src/` until publication (verified present as of 2026-06-11).
- **ASSUMPTION-002**: `@jrkasprzyk/parcoord-es@^3.0.0` is already published on npm and installable (README references it as the published fork).
- **ASSUMPTION-003**: The app's per-row `_id`/`_front` fields survive parasol's data handling (parasol stores row objects as-is; `cluster()` adds a `cluster` column via `add_column`). Verify `_front` is not clobbered and the synthetic `cluster` axis stays hidden (`hidden: true`).
- **ASSUMPTION-004**: No other consumers depend on this repo's current GitHub URL except Vercel (private project, no published forks).

## 8. Related Specifications / Further Reading

- [ParasolJS/parasol-es modernization branch](https://github.com/ParasolJS/parasol-es/tree/modernization)
- [Parasol API Reference (wiki)](https://github.com/ParasolJS/parasol-es/wiki/API-Reference)
- [@jrkasprzyk/parcoord-es on npm](https://www.npmjs.com/package/@jrkasprzyk/parcoord-es)
- [Raseman, W.J., Jacobson, J., Kasprzyk, J.R., 2019. Parasol: an open source, interactive parallel coordinates library for multi-objective decision making. Environmental Modelling & Software 116, 153–163.](https://doi.org/10.1016/j.envsoft.2019.03.005)
- [GitHub: Transferring a repository to an organization](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)
