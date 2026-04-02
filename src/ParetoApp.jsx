import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as d3 from "d3";
import _ from "lodash";

const C = {
  bg: "#0b1121", surface: "#111c32", surfaceAlt: "#162040",
  border: "#253560", borderLight: "#354a7a",
  text: "#e0e7f1", textMuted: "#8899b8", textDim: "#556688",
  accent: "#00e8a2", accentDim: "rgba(0,232,162,0.12)",
  front0: "#00e8a2", front1: "#5b8def", front2: "#c084fc",
  front3: "#fb923c", frontN: "#64748b",
  dominated: "#f43f5e", dominatedDim: "rgba(244,63,94,0.12)",
  highlight: "#a78bfa", highlightDim: "rgba(167,139,250,0.15)",
};
const FM = `'JetBrains Mono','Fira Code','SF Mono',monospace`;
const FB = `'DM Sans','Segoe UI',system-ui,sans-serif`;

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [], columnRoles: {} };

  const normalizeCell = (value) => String(value || "").replace(/^"|"$/g, '').trim();

  function split(line) {
    const r = []; let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { r.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    r.push(cur.trim());
    return r;
  }

  const inferRole = (value) => {
    const v = normalizeCell(value).toLowerCase();
    if (!v) return null;
    if (/(decision|decisions|policy|policies|variable|variables|input|inputs|lever|levers)/.test(v)) {
      return "decision";
    }
    if (/(objective|objectives|outcome|outcomes|metric|metrics|goal|goals|reliability)/.test(v)) {
      return "objective";
    }
    return null;
  };

  const isLikelyHeaderRow = (cells) => {
    if (!cells.length) return false;
    const cleaned = cells.map(normalizeCell);
    const nonEmpty = cleaned.filter(c => c !== "").length;
    if (!nonEmpty) return false;
    const numeric = cleaned.filter(c => c !== "" && !Number.isNaN(Number(c))).length;
    return nonEmpty >= Math.ceil(cells.length * 0.5) && numeric <= Math.floor(cells.length * 0.25);
  };

  const isLikelyRoleBandRow = (cells) => {
    if (!cells.length) return false;
    const cleaned = cells.map(normalizeCell);
    const roles = cleaned.map(inferRole).filter(Boolean);
    // Many dual-header exports use a sparse first row with only broad role labels
    // (e.g., "Decision Variables" and "Objectives") and blanks elsewhere.
    return roles.length > 0;
  };

  const isLikelyDataRow = (cells) => {
    if (!cells.length) return false;
    const cleaned = cells.map(normalizeCell);
    const nonEmpty = cleaned.filter(c => c !== "").length;
    if (!nonEmpty) return false;
    const numeric = cleaned.filter(c => c !== "" && !Number.isNaN(Number(c))).length;
    return numeric >= Math.ceil(nonEmpty * 0.4);
  };

  const makeUniqueHeaders = (candidateHeaders) => {
    const used = new Map();
    return candidateHeaders.map((rawHeader, idx) => {
      const base = normalizeCell(rawHeader) || `Column_${idx + 1}`;
      const count = used.get(base) || 0;
      used.set(base, count + 1);
      return count === 0 ? base : `${base}_${count + 1}`;
    });
  };

  const roleBandsForRow = (cells) => {
    const bands = [];
    let activeRole = null;
    cells.forEach((cell, idx) => {
      const inferred = inferRole(cell);
      if (inferred) activeRole = inferred;
      bands[idx] = activeRole;
    });
    return bands;
  };

  const parsedLines = lines.map(split);
  const first = parsedLines[0] || [];
  const second = parsedLines[1] || [];
  const third = parsedLines[2] || [];

  const hasDualHeader =
    parsedLines.length >= 3 &&
    (isLikelyHeaderRow(first) || isLikelyRoleBandRow(first)) &&
    isLikelyHeaderRow(second) &&
    isLikelyDataRow(third);

  let headers = [];
  let dataStart = 1;
  const columnRoles = {};

  if (hasDualHeader) {
    headers = makeUniqueHeaders(second);
    dataStart = 2;
    const roleBands = roleBandsForRow(first);
    headers.forEach((h, j) => {
      const inferred = roleBands[j] || inferRole(second[j]);
      if (inferred) columnRoles[h] = inferred;
    });
  } else {
    headers = makeUniqueHeaders(first);
    headers.forEach((h, j) => {
      const inferred = inferRole(first[j]);
      if (inferred) columnRoles[h] = inferred;
    });
  }

  const rows = lines.slice(dataStart).map((line, i) => {
    const vals = split(line);
    const row = { _id: i };
    headers.forEach((h, j) => {
      const raw = normalizeCell(vals[j] || "");
      const num = parseFloat(raw);
      row[h] = (raw !== "" && !isNaN(num)) ? num : raw;
    });
    return row;
  });

  return { headers, rows, columnRoles };
}

function epsilonDominates(a, b, objs, epsilons, dirs) {
  let dominated = false;
  for (const o of objs) {
    const dir = dirs[o] === "max" ? -1 : 1;
    const av = dir * (typeof a[o] === "number" ? a[o] : Infinity);
    const bv = dir * (typeof b[o] === "number" ? b[o] : Infinity);
    const e = Math.max(epsilons[o] ?? 0.1, 1e-12);
    const ab = Math.floor(av / e), bb = Math.floor(bv / e);
    if (ab > bb) return false;
    if (ab < bb) dominated = true;
  }
  return dominated;
}

function epsilonSort(rows, objs, epsilons, dirs) {
  if (!objs.length) return [];
  const fronts = [];
  let rem = rows.map(r => ({ ...r }));
  let fi = 0;
  while (rem.length > 0 && fi < 20) {
    const dom = new Set();
    for (let i = 0; i < rem.length; i++) {
      for (let j = 0; j < rem.length; j++) {
        if (i === j || dom.has(i)) continue;
        if (epsilonDominates(rem[j], rem[i], objs, epsilons, dirs)) { dom.add(i); break; }
      }
    }
    const front = [], next = [];
    for (let i = 0; i < rem.length; i++) {
      if (dom.has(i)) next.push(rem[i]);
      else front.push({ ...rem[i], _front: fi });
    }
    if (!front.length) { rem.forEach(r => front.push({ ...r, _front: fi })); fronts.push(front); break; }
    fronts.push(front);
    rem = next;
    fi++;
  }
  if (rem.length) fronts.push(rem.map(r => ({ ...r, _front: fi })));
  return fronts;
}

function wScore(row, objs, weights, dirs, stats) {
  let s = 0, tw = 0;
  for (const o of objs) {
    const w = weights[o] || 0;
    if (!w) continue;
    const v = typeof row[o] === "number" ? row[o] : 0;
    const st = stats[o];
    if (!st || st.max === st.min) continue;
    const norm = (v - st.min) / (st.max - st.min);
    s += w * (dirs[o] === "max" ? norm : 1 - norm);
    tw += w;
  }
  return tw > 0 ? s / tw : 0;
}

function frontColor(f) {
  return [C.front0, C.front1, C.front2, C.front3][f] || C.frontN;
}

function ParCoords({ data, axes, directions, highlightId, onHover }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 800, h: 370 });
  const brushesRef = useRef({});

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      for (const e of entries) setDims({ w: e.contentRect.width, h: Math.max(280, e.contentRect.height) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!svgRef.current || !data.length || !axes.length) return;
    const mg = { top: 44, right: 28, bottom: 18, left: 28 };
    const w = dims.w - mg.left - mg.right;
    const h = dims.h - mg.top - mg.bottom;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", dims.w).attr("height", dims.h);
    const g = svg.append("g").attr("transform", `translate(${mg.left},${mg.top})`);

    const x = d3.scalePoint().domain(axes).range([0, w]).padding(0.08);
    const yS = {};
    axes.forEach(ax => {
      const vals = data.map(d => typeof d[ax] === "number" ? d[ax] : null).filter(v => v !== null);
      const ext = d3.extent(vals);
      const pad = ((ext[1] || 0) - (ext[0] || 0)) * 0.1 || 1;
      yS[ax] = d3.scaleLinear().domain([ext[0] - pad, ext[1] + pad]).range([h, 0]);
    });

    axes.forEach(ax => {
      const xP = x(ax);
      const ag = g.append("g").attr("transform", `translate(${xP},0)`);
      ag.append("line").attr("y1", 0).attr("y2", h).attr("stroke", C.border).attr("stroke-width", 1);
      const aG = ag.call(d3.axisLeft(yS[ax]).ticks(5).tickSize(-5));
      aG.selectAll("text").attr("fill", C.textDim).attr("font-size", "8px").attr("font-family", FM);
      aG.selectAll("line").attr("stroke", C.border);
      aG.select(".domain").remove();
      const arrow = directions[ax] === "max" ? "▲" : "▼";
      const label = ax.length > 16 ? ax.slice(0, 14) + "…" : ax;
      ag.append("text").attr("y", -18).attr("text-anchor", "middle")
        .attr("fill", C.textMuted).attr("font-size", "10px").attr("font-family", FM)
        .text(`${arrow} ${label}`);

      const brush = d3.brushY().extent([[-12, 0], [12, h]])
        .on("brush end", (event) => {
          if (!event.selection) {
            delete brushesRef.current[ax];
          } else {
            const [y0, y1] = event.selection;
            brushesRef.current[ax] = [yS[ax].invert(y1), yS[ax].invert(y0)];
          }
          // Update line visibility
          svg.selectAll(".pc-line")
            .attr("stroke-opacity", d => {
              const brushKeys = Object.keys(brushesRef.current);
              if (!brushKeys.length) return d._front === 0 ? 0.85 : Math.max(0.06, 0.4 - (d._front ?? 5) * 0.08);
              const inBrush = brushKeys.every(k => {
                const [lo, hi] = brushesRef.current[k];
                const v = d[k];
                return typeof v === "number" && v >= lo && v <= hi;
              });
              return inBrush ? 0.9 : 0.03;
            })
            .attr("stroke-width", d => {
              const brushKeys = Object.keys(brushesRef.current);
              if (!brushKeys.length) return d._front === 0 ? 2.2 : 1;
              const inBrush = brushKeys.every(k => {
                const [lo, hi] = brushesRef.current[k];
                const v = d[k];
                return typeof v === "number" && v >= lo && v <= hi;
              });
              return inBrush ? 2.5 : 0.5;
            });
        });
      ag.append("g").attr("class", "brush").call(brush)
        .selectAll("rect").attr("fill", C.highlightDim).attr("rx", 3);
    });

    const line = d3.line().defined(d => d[1] !== null).x(d => d[0]).y(d => d[1]).curve(d3.curveMonotoneX);

    g.selectAll(".pc-line").data(data).enter()
      .append("path").attr("class", "pc-line")
      .attr("d", d => {
        const pts = axes.map(ax => {
          const v = typeof d[ax] === "number" ? d[ax] : null;
          return [x(ax), v !== null ? yS[ax](v) : null];
        });
        return line(pts);
      })
      .attr("fill", "none")
      .attr("stroke", d => frontColor(d._front ?? 999))
      .attr("stroke-width", d => d._front === 0 ? 2.2 : 1)
      .attr("stroke-opacity", d => d._front === 0 ? 0.85 : Math.max(0.06, 0.4 - (d._front ?? 5) * 0.08))
      .style("cursor", "pointer")
      .on("mouseenter", function (ev, d) {
        d3.select(this).attr("stroke", C.highlight).attr("stroke-width", 3).attr("stroke-opacity", 1).raise();
        onHover?.(d._id);
      })
      .on("mouseleave", function (ev, d) {
        d3.select(this)
          .attr("stroke", frontColor(d._front ?? 999))
          .attr("stroke-width", d._front === 0 ? 2.2 : 1)
          .attr("stroke-opacity", d._front === 0 ? 0.85 : Math.max(0.06, 0.4 - (d._front ?? 5) * 0.08));
        onHover?.(null);
      });

    if (highlightId !== null) {
      const hd = data.find(d => d._id === highlightId);
      if (hd) {
        const pts = axes.map(ax => {
          const v = typeof hd[ax] === "number" ? hd[ax] : null;
          return [x(ax), v !== null ? yS[ax](v) : null];
        });
        g.append("path").attr("d", line(pts)).attr("fill", "none")
          .attr("stroke", C.highlight).attr("stroke-width", 3.5).attr("stroke-opacity", 1)
          .style("pointer-events", "none");
      }
    }
  }, [data, axes, directions, highlightId, dims]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: 370 }}>
      <svg ref={svgRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

function Chip({ label, active, onClick, color }) {
  return (
    <button onClick={onClick} style={{
      padding: "4px 10px", borderRadius: 6, fontSize: 11, fontFamily: FM,
      border: `1px solid ${active ? (color || C.accent) : C.border}`,
      background: active ? (color ? color + "22" : C.accentDim) : "transparent",
      color: active ? (color || C.accent) : C.textMuted,
      cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",
    }}>
      {label}
    </button>
  );
}

function Slider({ label, value, onChange, min, max, step }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 10, color: C.textMuted, fontFamily: FM, minWidth: 20, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 70 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: C.accent, height: 3 }} />
      <span style={{ fontSize: 10, color: C.accent, fontFamily: FM, minWidth: 36, textAlign: "right" }}>
        {value.toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1)}
      </span>
    </div>
  );
}

function cellBg(val, min, max, dir) {
  if (typeof val !== "number" || min === max) return "transparent";
  let t = (val - min) / (max - min);
  if (dir === "min") t = 1 - t;
  const r = Math.round(244 * (1 - t) + 0 * t);
  const g = Math.round(63 * (1 - t) + 232 * t);
  const b = Math.round(94 * (1 - t) + 162 * t);
  return `rgba(${r},${g},${b},0.15)`;
}

const DEMO = `Decision,Cost,Performance,Reliability,Weight,Power
Alpha-1,45000,82,0.94,120,340
Beta-2,62000,95,0.97,145,520
Gamma-3,38000,71,0.89,98,280
Delta-4,55000,88,0.96,130,460
Epsilon-5,72000,97,0.99,160,580
Zeta-6,41000,75,0.91,105,300
Eta-7,48000,85,0.93,125,380
Theta-8,67000,93,0.98,150,540
Iota-9,35000,68,0.87,92,260
Kappa-10,58000,90,0.95,135,480
Lambda-11,43000,78,0.92,115,320
Mu-12,69000,96,0.98,155,560
Nu-13,37000,70,0.88,95,270
Xi-14,51000,86,0.94,128,420
Omicron-15,61000,92,0.97,142,500`;

export default function ParetoApp() {
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [columnRoleHints, setColumnRoleHints] = useState({});
  const [objectives, setObjectives] = useState([]);
  const [directions, setDirections] = useState({});
  const [epsilons, setEpsilons] = useState({});
  const [epsRanges, setEpsRanges] = useState({});
  const [weights, setWeights] = useState({});
  const [condFormat, setCondFormat] = useState(true);
  const [filterText, setFilterText] = useState({});
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [highlightId, setHighlightId] = useState(null);
  const [tab, setTab] = useState("table");
  const [showOnlyPareto, setShowOnlyPareto] = useState(false);
  const [decisionCol, setDecisionCol] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const fileRef = useRef(null);

  const numericCols = useMemo(() => headers.filter(h => rows.some(r => typeof r[h] === "number")), [headers, rows]);
  const stringCols = useMemo(() => headers.filter(h => rows.some(r => typeof r[h] === "string" && r[h] !== "")), [headers, rows]);

  const colStats = useMemo(() => {
    const s = {};
    numericCols.forEach(col => {
      const vals = rows.map(r => r[col]).filter(v => typeof v === "number");
      s[col] = { min: d3.min(vals) ?? 0, max: d3.max(vals) ?? 0 };
    });
    return s;
  }, [numericCols, rows]);

  useEffect(() => {
    if (!objectives.length || !rows.length) return;
    const newRanges = {};
    const newEps = { ...epsilons };
    objectives.forEach(o => {
      const s = colStats[o];
      const range = s ? s.max - s.min : 1;
      if (range <= 0) return;
      const step = Math.pow(10, Math.floor(Math.log10(range / 100)));
      newRanges[o] = { min: step, max: range * 0.5, step };
      if (newEps[o] === undefined || newEps[o] < step || newEps[o] > range * 0.5) {
        newEps[o] = range * 0.1;
      }
    });
    setEpsRanges(newRanges);
    setEpsilons(newEps);
  }, [objectives, rows, colStats]);

  const fronts = useMemo(() => {
    if (!objectives.length || !rows.length) return [];
    return epsilonSort(rows, objectives, epsilons, directions);
  }, [rows, objectives, epsilons, directions]);

  const sortedData = useMemo(() => {
    let all = fronts.flat();
    for (const col of headers) {
      const ft = (filterText[col] || "").toLowerCase();
      if (ft) all = all.filter(r => String(r[col]).toLowerCase().includes(ft));
    }
    if (showOnlyPareto) all = all.filter(r => r._front === 0);
    if (objectives.length) {
      all = all.map(r => ({ ...r, _score: wScore(r, objectives, weights, directions, colStats) }));
    }
    if (sortCol) {
      all.sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol];
        if (typeof av === "number" && typeof bv === "number") return sortAsc ? av - bv : bv - av;
        return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    }
    return all;
  }, [fronts, filterText, sortCol, sortAsc, showOnlyPareto, weights, objectives, directions, colStats, headers]);

  const loadData = useCallback((csvText) => {
    const { headers: h, rows: r, columnRoles } = parseCSV(csvText);
    setHeaders(h); setRows(r);
    setColumnRoleHints(columnRoles || {});
    const nc = h.filter(col => r.some(row => typeof row[col] === "number"));
    const sc = h.filter(col => r.some(row => typeof row[col] === "string" && row[col] !== ""));
    const decisionCandidates = h.filter(col => (columnRoles || {})[col] === "decision");
    const objectiveCandidates = h.filter(col => (columnRoles || {})[col] === "objective");
    const idLikeCol = h.find(col => /(^|\s)(solution\s*id|solutionid|id|name)(\s|$)/i.test(String(col)));

    const resolvedObjectives = objectiveCandidates.filter(col => nc.includes(col));
    const resolvedDecision =
      idLikeCol ||
      decisionCandidates.find(col => sc.includes(col)) ||
      decisionCandidates[0] ||
      sc[0] ||
      null;

    setDecisionCol(resolvedDecision);
    setObjectives(resolvedObjectives.length ? resolvedObjectives : nc);
    const dirs = {}; nc.forEach(c => dirs[c] = "min");
    setDirections(dirs);
    const w = {}; nc.forEach(c => w[c] = 1);
    setWeights(w);
    setFilterText({}); setSortCol(null); setLoaded(true); setTab("table");
  }, []);

  const handleFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => loadData(ev.target.result);
    reader.readAsText(file);
  }, [loadData]);

  const loadDemo = useCallback(() => {
    const d = { ...parseCSV(DEMO) };
    setHeaders(d.headers); setRows(d.rows);
    setColumnRoleHints(d.columnRoles || {});
    setDecisionCol("Decision");
    const nc = d.headers.filter(col => d.rows.some(row => typeof row[col] === "number"));
    setObjectives(nc);
    const dirs = {}; nc.forEach(c => dirs[c] = c === "Cost" || c === "Weight" ? "min" : "max");
    setDirections(dirs);
    const w = {}; nc.forEach(c => w[c] = 1);
    setWeights(w);
    setFilterText({}); setSortCol(null); setLoaded(true); setTab("table");
  }, []);

  const toggleObj = useCallback(col => setObjectives(p => p.includes(col) ? p.filter(c => c !== col) : [...p, col]), []);
  const toggleDir = useCallback(col => setDirections(p => ({ ...p, [col]: p[col] === "min" ? "max" : "min" })), []);
  const handleSort = useCallback(col => {
    if (sortCol === col) setSortAsc(p => !p);
    else { setSortCol(col); setSortAsc(true); }
  }, [sortCol]);

  const paretoCount = useMemo(() => fronts[0]?.length || 0, [fronts]);
  const hasScore = objectives.some(o => (weights[o] || 0) > 0);

  if (!loaded) {
    return (
      <div style={{ fontFamily: FB, background: C.bg, color: C.text, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", maxWidth: 500, padding: 40 }}>
          <div style={{ fontSize: 52, marginBottom: 8, filter: "hue-rotate(120deg)" }}>◇</div>
          <h1 style={{ fontFamily: FM, fontSize: 24, fontWeight: 700, color: C.accent, marginBottom: 4, letterSpacing: -0.5 }}>
            Pareto Explorer
          </h1>
          <p style={{ color: C.textMuted, fontSize: 13, marginBottom: 36, lineHeight: 1.7 }}>
            ε-nondominated sorting · interactive parallel coordinates · weighted preference scoring
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => fileRef.current?.click()} style={{
              padding: "14px 32px", borderRadius: 8, border: `1px solid ${C.accent}`,
              background: C.accentDim, color: C.accent, fontSize: 14, fontFamily: FM, cursor: "pointer",
            }}>Upload CSV</button>
            <button onClick={loadDemo} style={{
              padding: "14px 32px", borderRadius: 8, border: `1px solid ${C.border}`,
              background: "transparent", color: C.textMuted, fontSize: 14, fontFamily: FM, cursor: "pointer",
            }}>Demo Data</button>
          </div>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: "none" }} />
          <p style={{ color: C.textDim, fontSize: 11, marginTop: 28, lineHeight: 1.5 }}>
            CSV with columns for decisions, objectives, and metrics. Numeric columns auto-detected.
          </p>
        </div>
      </div>
    );
  }

  const displayCols = [
    ...(decisionCol ? [decisionCol] : []),
    ...objectives,
    ...headers.filter(h => h !== decisionCol && !objectives.includes(h)),
  ];

  return (
    <div style={{ fontFamily: FB, background: C.bg, color: C.text, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "8px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: FM, fontSize: 14, fontWeight: 700, color: C.accent }}>◇ Pareto Explorer</span>
        <div style={{ flex: 1 }} />
        {["table", "parallel", "config"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "4px 12px", borderRadius: 6, fontSize: 11, fontFamily: FM,
            border: `1px solid ${tab === t ? C.accent : C.border}`,
            background: tab === t ? C.accentDim : "transparent",
            color: tab === t ? C.accent : C.textMuted, cursor: "pointer",
          }}>
            {t === "table" ? "Table" : t === "parallel" ? "Parallel Coords" : "Setup"}
          </button>
        ))}
        <button onClick={() => fileRef.current?.click()} style={{
          padding: "4px 10px", borderRadius: 6, fontSize: 11, fontFamily: FM,
          border: `1px solid ${C.border}`, background: "transparent", color: C.textMuted, cursor: "pointer",
        }}>New CSV</button>
        <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: "none" }} />
      </div>

      {/* Stats */}
      <div style={{ background: C.surfaceAlt, borderBottom: `1px solid ${C.border}`, padding: "6px 16px", display: "flex", gap: 16, fontSize: 11, fontFamily: FM, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ color: C.textMuted }}>Rows <span style={{ color: C.text }}>{rows.length}</span></span>
        <span style={{ color: C.textMuted }}>Obj <span style={{ color: C.accent }}>{objectives.length}</span></span>
        <span style={{ color: C.textMuted }}>Pareto <span style={{ color: C.front0 }}>{paretoCount}</span></span>
        <span style={{ color: C.textMuted }}>Fronts <span style={{ color: C.text }}>{fronts.length}</span></span>
        <div style={{ flex: 1 }} />
        <Chip label={showOnlyPareto ? "Pareto Only ✓" : "Show All"} active={showOnlyPareto} onClick={() => setShowOnlyPareto(p => !p)} />
        <Chip label={condFormat ? "Heatmap ✓" : "Heatmap"} active={condFormat} onClick={() => setCondFormat(p => !p)} />
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Sidebar */}
        <div style={{ width: 260, minWidth: 260, background: C.surface, borderRight: `1px solid ${C.border}`, padding: 14, overflowY: "auto" }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, marginBottom: 6, letterSpacing: 1 }}>EPSILON (ε) PER OBJECTIVE</div>
            {objectives.map(o => {
              const er = epsRanges[o] || { min: 0.001, max: 1, step: 0.001 };
              return (
                <div key={o} style={{ marginBottom: 5 }}>
                  <Slider label={o.length > 8 ? o.slice(0, 6) + "…" : o}
                    value={epsilons[o] ?? er.min * 100}
                    onChange={v => setEpsilons(p => ({ ...p, [o]: v }))}
                    min={er.min} max={er.max} step={er.step} />
                </div>
              );
            })}
            {objectives.length === 0 && <p style={{ fontSize: 9, color: C.textDim }}>Select objectives first.</p>}
            <p style={{ fontSize: 9, color: C.textDim, marginTop: 3, lineHeight: 1.3 }}>
              Each objective gets its own grid resolution. Bigger ε = coarser = fewer Pareto solutions for that dimension.
            </p>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, marginBottom: 6, letterSpacing: 1 }}>OBJECTIVES</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {numericCols.map(col => (
                <div key={col} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <Chip label={col.length > 14 ? col.slice(0, 12) + "…" : col} active={objectives.includes(col)} onClick={() => toggleObj(col)} />
                  {objectives.includes(col) && (
                    <button onClick={() => toggleDir(col)} style={{
                      padding: "2px 5px", borderRadius: 4, fontSize: 9, fontFamily: FM,
                      border: `1px solid ${C.border}`, background: "transparent",
                      color: directions[col] === "min" ? C.dominated : C.front0, cursor: "pointer",
                    }}>{directions[col] === "min" ? "▼min" : "▲max"}</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, marginBottom: 6, letterSpacing: 1 }}>LABEL COLUMN</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {stringCols.map(col => (
                <Chip key={col} label={col} active={decisionCol === col} onClick={() => setDecisionCol(col === decisionCol ? null : col)} color={C.highlight} />
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, marginBottom: 6, letterSpacing: 1 }}>PREFERENCE WEIGHTS</div>
            {objectives.map(o => (
              <div key={o} style={{ marginBottom: 5 }}>
                <Slider label={o.length > 8 ? o.slice(0, 6) + "…" : o} value={weights[o] ?? 1}
                  onChange={v => setWeights(p => ({ ...p, [o]: v }))} min={0} max={5} step={0.1} />
              </div>
            ))}
            <p style={{ fontSize: 9, color: C.textDim, marginTop: 3, lineHeight: 1.3 }}>
              Direction-aware normalized aggregate. Higher weight = more important.
            </p>
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {tab === "config" && (
            <div style={{ padding: 20, maxWidth: 720 }}>
              <h2 style={{ fontFamily: FM, fontSize: 15, color: C.accent, marginBottom: 14 }}>Column Configuration</h2>
              <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 16, lineHeight: 1.5 }}>
                Toggle objectives, set optimization direction, and assign weights.
              </p>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: FM }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["Column", "Type", "Header Role", "Objective?", "Direction", "Weight"].map(h => (
                      <th key={h} style={{ textAlign: h === "Column" ? "left" : "center", padding: "6px 10px", color: C.textMuted }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {headers.map(h => {
                    const isNum = numericCols.includes(h), isObj = objectives.includes(h);
                    const roleHint = columnRoleHints[h] || "-";
                    return (
                      <tr key={h} style={{ borderBottom: `1px solid ${C.border}22` }}>
                        <td style={{ padding: "5px 10px", color: C.text }}>{h}</td>
                        <td style={{ padding: "5px 10px", textAlign: "center", color: isNum ? C.front1 : C.textDim }}>{isNum ? "numeric" : "text"}</td>
                        <td style={{ padding: "5px 10px", textAlign: "center", color: roleHint === "-" ? C.textDim : (roleHint === "objective" ? C.accent : C.highlight) }}>{roleHint}</td>
                        <td style={{ padding: "5px 10px", textAlign: "center" }}>
                          {isNum && <input type="checkbox" checked={isObj} onChange={() => toggleObj(h)} style={{ accentColor: C.accent }} />}
                        </td>
                        <td style={{ padding: "5px 10px", textAlign: "center" }}>
                          {isObj && (
                            <button onClick={() => toggleDir(h)} style={{
                              padding: "2px 8px", borderRadius: 4, fontSize: 10,
                              border: `1px solid ${C.border}`, background: "transparent",
                              color: directions[h] === "min" ? C.dominated : C.front0, cursor: "pointer", fontFamily: FM,
                            }}>{directions[h] === "min" ? "minimize" : "maximize"}</button>
                          )}
                        </td>
                        <td style={{ padding: "5px 10px", textAlign: "center" }}>
                          {isObj && (
                            <input type="number" min={0} max={10} step={0.1} value={weights[h] ?? 1}
                              onChange={e => setWeights(p => ({ ...p, [h]: parseFloat(e.target.value) || 0 }))}
                              style={{ width: 48, padding: "2px 4px", borderRadius: 4, border: `1px solid ${C.border}`, background: C.surfaceAlt, color: C.accent, fontFamily: FM, fontSize: 11, textAlign: "center" }} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {tab === "parallel" && (
            <div style={{ padding: 14 }}>
              <div style={{ background: C.surface, borderRadius: 10, border: `1px solid ${C.border}`, padding: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, marginBottom: 6 }}>
                  Drag on axes to brush/filter · Hover lines to inspect · Pareto-style linked interaction
                </div>
                {objectives.length > 0 ? (
                  <ParCoords data={sortedData} axes={objectives} directions={directions} highlightId={highlightId} onHover={setHighlightId} />
                ) : (
                  <div style={{ padding: 60, textAlign: "center", color: C.textDim, fontSize: 13 }}>Select at least one objective.</div>
                )}
              </div>
              <div style={{ display: "flex", gap: 14, padding: "6px 10px", fontSize: 10, fontFamily: FM, color: C.textMuted, flexWrap: "wrap" }}>
                {fronts.slice(0, 5).map((_, i) => (
                  <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 12, height: 3, background: frontColor(i), borderRadius: 2, display: "inline-block" }} />
                    Front {i}{i === 0 ? " (Pareto)" : ""}
                  </span>
                ))}
                {fronts.length > 5 && <span>+{fronts.length - 5} more</span>}
              </div>
            </div>
          )}

          {tab === "table" && (
            <div style={{ padding: 10 }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 11, fontFamily: FM }}>
                  <thead>
                    <tr>
                      <th style={{ position: "sticky", top: 0, zIndex: 2, padding: "6px 4px", textAlign: "center", background: C.surface, borderBottom: `2px solid ${C.border}`, color: C.textDim, fontSize: 9, width: 30 }}>#</th>
                      <th style={{ position: "sticky", top: 0, zIndex: 2, padding: "6px 4px", textAlign: "center", background: C.surface, borderBottom: `2px solid ${C.border}`, color: C.textDim, fontSize: 9, width: 44 }}>Front</th>
                      {displayCols.map(col => (
                        <th key={col} onClick={() => handleSort(col)} style={{
                          position: "sticky", top: 0, zIndex: 2, padding: "6px 6px",
                          textAlign: typeof rows[0]?.[col] === "number" ? "right" : "left",
                          background: C.surface, borderBottom: `2px solid ${C.border}`,
                          color: objectives.includes(col) ? C.accent : C.textMuted,
                          cursor: "pointer", fontSize: 9, whiteSpace: "nowrap", userSelect: "none",
                        }}>
                          {col} {sortCol === col ? (sortAsc ? "▲" : "▼") : ""}
                          {objectives.includes(col) && <span style={{ color: directions[col] === "min" ? C.dominated : C.front0, marginLeft: 3 }}>{directions[col] === "min" ? "↓" : "↑"}</span>}
                        </th>
                      ))}
                      {hasScore && (
                        <th onClick={() => handleSort("_score")} style={{
                          position: "sticky", top: 0, zIndex: 2, padding: "6px 6px", textAlign: "right",
                          background: C.surface, borderBottom: `2px solid ${C.border}`,
                          color: C.highlight, cursor: "pointer", fontSize: 9, whiteSpace: "nowrap",
                        }}>Score {sortCol === "_score" ? (sortAsc ? "▲" : "▼") : ""}</th>
                      )}
                    </tr>
                    <tr>
                      <td style={{ background: C.surfaceAlt, padding: 1, borderBottom: `1px solid ${C.border}` }} />
                      <td style={{ background: C.surfaceAlt, padding: 1, borderBottom: `1px solid ${C.border}` }} />
                      {displayCols.map(col => (
                        <td key={col} style={{ background: C.surfaceAlt, padding: "1px 3px", borderBottom: `1px solid ${C.border}` }}>
                          <input placeholder="…" value={filterText[col] || ""}
                            onChange={e => setFilterText(p => ({ ...p, [col]: e.target.value }))}
                            style={{ width: "100%", padding: "1px 3px", borderRadius: 3, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 9, fontFamily: FM, outline: "none", boxSizing: "border-box" }} />
                        </td>
                      ))}
                      {hasScore && <td style={{ background: C.surfaceAlt, padding: 1, borderBottom: `1px solid ${C.border}` }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedData.map((row, i) => {
                      const isHL = highlightId === row._id;
                      const isP = row._front === 0;
                      return (
                        <tr key={row._id} onMouseEnter={() => setHighlightId(row._id)} onMouseLeave={() => setHighlightId(null)}
                          style={{ background: isHL ? C.highlightDim : "transparent", transition: "background 0.1s" }}>
                          <td style={{ padding: "4px 4px", textAlign: "center", color: C.textDim, borderBottom: `1px solid ${C.border}11`, fontSize: 9 }}>{i + 1}</td>
                          <td style={{ padding: "4px 4px", textAlign: "center", borderBottom: `1px solid ${C.border}11` }}>
                            <span style={{
                              display: "inline-block", padding: "1px 5px", borderRadius: 4, fontSize: 9,
                              background: frontColor(row._front ?? 99) + "22", color: frontColor(row._front ?? 99),
                              fontWeight: isP ? 700 : 400,
                            }}>{row._front ?? "—"}</span>
                          </td>
                          {displayCols.map(col => {
                            const val = row[col];
                            const isNum = typeof val === "number";
                            const isObj = objectives.includes(col);
                            const bg = condFormat && isNum && isObj && colStats[col]
                              ? cellBg(val, colStats[col].min, colStats[col].max, directions[col])
                              : "transparent";
                            return (
                              <td key={col} style={{
                                padding: "4px 6px", textAlign: isNum ? "right" : "left",
                                borderBottom: `1px solid ${C.border}11`, background: bg,
                                color: isP && isObj ? C.text : C.textMuted,
                                fontWeight: isP && col === decisionCol ? 600 : 400,
                              }}>
                                {isNum ? val.toLocaleString(undefined, { maximumFractionDigits: 4 }) : val}
                              </td>
                            );
                          })}
                          {hasScore && (
                            <td style={{ padding: "4px 6px", textAlign: "right", borderBottom: `1px solid ${C.border}11`, color: C.highlight, fontWeight: 600 }}>
                              {(row._score ?? 0).toFixed(3)}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!sortedData.length && <div style={{ padding: 40, textAlign: "center", color: C.textDim, fontSize: 13 }}>No rows match filters.</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
