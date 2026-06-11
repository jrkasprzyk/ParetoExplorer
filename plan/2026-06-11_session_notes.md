# Session notes — 2026-06-11: parasol-es migration implemented

Implements phases 1–4 of `refactor-parcoords-parasol-1.md` plus README/plan doc updates.
**Work is in the working tree on branch `refactor-parasol`, NOT yet committed.**

## What was done

- **Phase 1 — module extraction**: `src/ParetoApp.jsx` (1366 → ~990 lines) split into
  `src/theme.js`, `src/lib/csv.js`, `src/lib/pareto.js`, `src/components/controls.jsx`.
  Transitional `src/components/ParCoords.jsx` created then deleted in Phase 3 as planned.
- **Phase 2 — light theme**: plan's palette applied in `theme.js` + `index.html`;
  `cellBg()` heatmap endpoints re-tuned; zero hard-coded colors outside
  `theme.js`/`parasol-overrides.css` (grep-verified).
- **Phase 3 — parasol-es**: dep `github:ParasolJS/parasol-es#modernization` (SHA pinned in
  lockfile). New `src/components/ParasolPlot.jsx` React wrapper: re-instantiates on
  structural changes (data/axes/flips/bundle dim/cluster/width), cheap method calls for
  highlight/color/strength/smoothness. Brush → table linking, Clear Brush, category-colored
  axis labels, Preferred @ Top/Bottom via `flipAxes`.
- **Phase 4 — features**: sidebar RENDERING (smoothness, bundle dimension, strength),
  CLUSTERING (k 2–10, variable chips, standardize), COLOR BY (Front | Cluster), cluster
  legend, Export CSV (brushed, falls back to all).
- `lodash` removed from deps (unused). README rewritten (parasol engine, paper citation,
  dependency notes).

## Upstream bugs — patched locally, MUST upstream before npm publish (TASK-030)

`patches/` via patch-package (`postinstall` applies). Details in the "Implementation notes"
blockquote at the top of `refactor-parcoords-parasol-1.md` and in Claude memory:

1. parcoord-es `brush/1d/brushFor.js` — `convertBrushArguments` uses pre-d3v6 listener args;
   programmatic brushReset crashed. Also `sourceEvent !== null` → `!= null`.
2. parasol-es `util/sync.js` — brushReset ↔ 'brush' event recursion → stack overflow.
3. parcoord-es `util/computeCentroids.js` — bundling centroid Map miss after axis flip → crash.
4. (worked around in ParasolPlot, not patched) `autoscale()` `config.flipAxes` branch produces
   garbage domains — flips always applied last, centroids recomputed after.

## Verified (Playwright, demo data, zero console errors)

Light theme; brush filters table (4/15) and clears; bundling; clustering k=3 legend;
axis flips; color-by toggle; re-import clears stale brush; chart re-creates correctly when
data changes while tab hidden; k > row-count doesn't crash. `npm run build` exit 0
(798 kB bundle — unused slickgrid/jquery, accepted RISK-004).

## Known limitations / next steps

- Chart→table hover not available (RISK-001 confirmed: parcoords has no per-line mouseover
  event). Table→chart highlight works.
- TASK-030: when parasol-es 2.0.0 is on npm, switch dep to `^2.0.0`, drop patches after
  upstreaming fixes, re-run parity checklist.
- TASK-033/034 (repo transfer to ParasolJS org): optional, untouched.
- Worth filing upstream: lazy-import the grid feature to drop jquery/slickgrid bundle weight.
