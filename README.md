# Pareto Explorer

Multi-objective decision analysis tool with ε-nondominated sorting, interactive parallel coordinates, and weighted preference scoring.

## What it does

- **Upload a CSV** with decisions, objectives, and metrics
- **ε-nondominated sorting** with per-objective epsilon control
- **Parallel coordinates** with axis brushing and hover-linked data table
- **Spreadsheet view** with conditional formatting, column filters, and sorting
- **Weighted scoring** with direction-aware normalized aggregation

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
