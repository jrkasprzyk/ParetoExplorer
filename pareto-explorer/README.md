# Pareto Explorer

Multi-objective decision analysis tool with ε-nondominated sorting, interactive parallel coordinates, and weighted preference scoring.

## What it does

- **Upload a CSV** with decisions, objectives, and metrics
- **ε-nondominated sorting** with per-objective epsilon control
- **Parallel coordinates** with axis brushing and hover-linked data table
- **Spreadsheet view** with conditional formatting, column filters, and sorting
- **Weighted scoring** with direction-aware normalized aggregation

## Prerequisites

You need two things installed on your machine:

1. **Node.js** (version 18 or newer) — download from https://nodejs.org
2. **Git** — download from https://git-scm.com

To check if you already have them, open a terminal (PowerShell on Windows) and run:

```bash
node --version
git --version
```

If both print version numbers, you're good.

## Run locally (just to try it out)

```bash
# 1. Open a terminal and navigate to the project folder
cd pareto-explorer

# 2. Install dependencies (only needed once)
npm install

# 3. Start the dev server
npm run dev
```

This prints a URL like `http://localhost:5173` — open that in your browser and you're running.

## Deploy to Vercel (free, public URL)

This is the easiest way to get a live URL anyone can visit.

### One-time setup

1. **Create a GitHub account** if you don't have one: https://github.com/signup
2. **Create a Vercel account** using your GitHub login: https://vercel.com/signup

### Push to GitHub

```bash
# 1. Navigate into the project folder
cd pareto-explorer

# 2. Initialize a git repository
git init

# 3. Stage all files
git add .

# 4. Make the first commit
git commit -m "Initial commit - Pareto Explorer"

# 5. Create a new repo on GitHub:
#    Go to https://github.com/new
#    Name it "pareto-explorer" (or whatever you want)
#    Leave it public or private — your choice
#    Do NOT check "Add a README" (we already have one)
#    Click "Create repository"

# 6. GitHub will show you commands. Run the two lines that look like:
git remote add origin https://github.com/YOUR_USERNAME/pareto-explorer.git
git branch -M main
git push -u origin main
```

### Connect Vercel

1. Go to https://vercel.com/new
2. Click **"Import Git Repository"**
3. Select your `pareto-explorer` repo
4. Vercel auto-detects it's a Vite project — all defaults are correct
5. Click **Deploy**
6. In ~60 seconds you get a URL like `https://pareto-explorer-abc123.vercel.app`

That's it. Every time you `git push` to main, Vercel automatically rebuilds and deploys.

### Custom domain (optional)

In Vercel dashboard → your project → Settings → Domains → add your domain and follow the DNS instructions.

## Alternative: Deploy to GitHub Pages (also free)

If you prefer GitHub Pages over Vercel:

```bash
# Install the gh-pages package
npm install --save-dev gh-pages

# Add to package.json scripts:
#   "deploy": "vite build && gh-pages -d dist"

# Then run:
npm run deploy
```

Then enable GitHub Pages in your repo settings (Settings → Pages → Source: `gh-pages` branch).

**Note:** For GitHub Pages, add `base: '/pareto-explorer/'` to `vite.config.js`:

```js
export default defineConfig({
  plugins: [react()],
  base: '/pareto-explorer/',
})
```

## Project structure

```
pareto-explorer/
├── index.html          ← HTML shell
├── package.json        ← Dependencies and scripts
├── vite.config.js      ← Build config
├── .gitignore          ← Files git should ignore
└── src/
    ├── main.jsx        ← React entry point
    └── ParetoApp.jsx   ← The entire app
```

## Making changes

Edit `src/ParetoApp.jsx`, save, and the dev server hot-reloads instantly. When you're happy, `git add . && git commit -m "description" && git push` and Vercel deploys automatically.
