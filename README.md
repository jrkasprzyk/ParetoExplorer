# Pareto Explorer

Multi-objective decision analysis tool with ε-nondominated sorting, interactive parallel coordinates, and weighted preference scoring.

The parallel coordinates view is rendered by [parasol-es](https://github.com/ParasolJS/parasol-es), the open-source parallel coordinates library for multi-objective decision making (Raseman, Jacobson, and Kasprzyk, 2019). Pareto Explorer wraps parasol-es in a React component and adds ε-sorting, an import wizard, and a linked spreadsheet view on top.

## What it does

- **Upload a CSV** with decisions, objectives, and metrics (single or dual-header role rows)
- **ε-nondominated sorting** with per-objective epsilon control
- **Parallel coordinates** (parasol-es) with axis brushing linked to the table, table-hover line highlighting, and objective-axis orientation ("Preferred @ Top / Bottom")
- **Edge bundling and curve smoothing** to reduce clutter on dense datasets
- **k-means clustering** (2–10 clusters over chosen variables, optional standardization) with cluster coloring and legend
- **Export** brushed solutions to CSV
- **Spreadsheet view** with conditional formatting, column filters, and sorting
- **Weighted scoring** with direction-aware normalized aggregation

The app uses a light theme defined as a single token object in `src/theme.js`.

## Getting started

You can either run locally or use the version deployed on vercel.

### Run locally

You need:

1. **Node.js** (version 18 or newer) — download from https://nodejs.org
2. **Git** — download from https://git-scm.com

To check if you already have them, open a terminal (PowerShell on Windows) and run:

```bash
node --version
git --version
```

If both print version numbers, you're good.

Then, use these commands:

```bash
# 1. Open a terminal and navigate to the project folder
cd pareto-explorer

# 2. Install dependencies (only needed once)
npm install

# 3. Start the dev server
npm run dev
```

The tool will run in your browser: `http://localhost:5173`.

### Use the version deployed on Vercel

Visit [Pareto Explorer on Vercel](https://pareto-explorer.vercel.app/).

## Dependency notes

- `parasol-es` is currently installed from the `modernization` branch of the GitHub repo (`github:ParasolJS/parasol-es#modernization`); once v2.0.0 is published to npm, switch `package.json` to `"parasol-es": "^2.0.0"`.
- `patches/` contains [patch-package](https://www.npmjs.com/package/patch-package) fixes for d3 v7 brush-event handling, a brush-sync recursion, and a bundling centroid crash; these are applied automatically by the `postinstall` script and should be upstreamed to `@jrkasprzyk/parcoord-es` and `parasol-es` (see `plan/refactor-parcoords-parasol-1.md`).

## Reference

Raseman, W.J., Jacobson, J., Kasprzyk, J.R., 2019. Parasol: an open source, interactive parallel coordinates library for multi-objective decision making. *Environmental Modelling & Software* 116, 153–163. https://doi.org/10.1016/j.envsoft.2019.03.005
