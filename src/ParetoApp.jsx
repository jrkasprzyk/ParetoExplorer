import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as d3 from "d3";
import { C, FM, FB, CATEGORY_COLORS, CATEGORY_LABELS, DEFAULT_CATEGORY_ORDER, frontColor, cellBg } from "./theme.js";
import { parseCSV, DEMO } from "./lib/csv.js";
import { epsilonSort, wScore } from "./lib/pareto.js";
import ParasolPlot, { CLUSTER_PALETTE } from "./components/ParasolPlot.jsx";
import { Chip, Slider } from "./components/controls.jsx";

export default function ParetoApp() {
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [columnRoleHints, setColumnRoleHints] = useState({});
  const [objectives, setObjectives] = useState([]);
  const [directions, setDirections] = useState({});
  const [epsilons, setEpsilons] = useState({});
  const [epsRanges, setEpsRanges] = useState({});
  const [weights, setWeights] = useState({});
  const [colWidths, setColWidths] = useState({});
  const [condFormat, setCondFormat] = useState(true);
  const [filterText, setFilterText] = useState({});
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [highlightId, setHighlightId] = useState(null);
  const [tab, setTab] = useState("table");
  const [showOnlyPareto, setShowOnlyPareto] = useState(false);
  const [decisionCol, setDecisionCol] = useState(null);
  const [decisionCols, setDecisionCols] = useState([]);
  const [columnCategories, setColumnCategories] = useState({});
  const [categoryOrder, setCategoryOrder] = useState(DEFAULT_CATEGORY_ORDER);
  const [visibleFronts, setVisibleFronts] = useState({});
  const [sourceLabel, setSourceLabel] = useState("Uploaded CSV");
  const [importDraft, setImportDraft] = useState(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showEpsilonControls, setShowEpsilonControls] = useState(false);
  const [showPreferenceControls, setShowPreferenceControls] = useState(false);
  const [preferredObjectiveEdge, setPreferredObjectiveEdge] = useState("top");
  const [loaded, setLoaded] = useState(false);
  const [brushedIds, setBrushedIds] = useState(null);
  const [colorBy, setColorBy] = useState("front");
  const [clusterEnabled, setClusterEnabled] = useState(false);
  const [clusterK, setClusterK] = useState(3);
  const [clusterVars, setClusterVars] = useState([]);
  const [clusterStd, setClusterStd] = useState(true);
  const [bundleDim, setBundleDim] = useState(null);
  const [bundleStrength, setBundleStrength] = useState(0);
  const [smoothness, setSmoothness] = useState(0);
  const fileRef = useRef(null);
  const parasolRef = useRef(null);

  const numericCols = useMemo(() => headers.filter(h => rows.some(r => typeof r[h] === "number")), [headers, rows]);
  const stringCols = useMemo(() => headers.filter(h => rows.some(r => typeof r[h] === "string" && r[h] !== "")), [headers, rows]);
  const columnsByCategory = useMemo(() => {
    const grouped = {};
    headers.forEach(h => {
      const cat = columnCategories[h] || "metric";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(h);
    });
    return grouped;
  }, [headers, columnCategories]);
  const solutionCols = columnsByCategory.solution || [];
  const decisionCategoryCols = columnsByCategory.decision || [];
  const objectiveCategoryCols = columnsByCategory.objective || [];
  const constraintCols = columnsByCategory.constraint || [];
  const metricCols = columnsByCategory.metric || [];
  const customCategoryEntries = useMemo(() => {
    return categoryOrder
      .filter(cat => !DEFAULT_CATEGORY_ORDER.includes(cat))
      .map(cat => ({ category: cat, columns: columnsByCategory[cat] || [] }))
      .filter(entry => entry.columns.length > 0);
  }, [categoryOrder, columnsByCategory]);
  const labelCols = useMemo(() => {
    if (solutionCols.length) return solutionCols;
    const idLikeNumericCols = numericCols.filter(col => /(^|\s)(solution\s*id|solutionid|id|name|label)(\s|$)/i.test(String(col)));
    return Array.from(new Set([...stringCols, ...idLikeNumericCols]));
  }, [solutionCols, stringCols, numericCols]);

  const suggestCategory = useCallback((header, roleHint) => {
    const h = String(header || "").toLowerCase();
    if (/(solution\s*id|solutionid|^id$|\bname\b|label)/.test(h)) return "solution";
    if (roleHint === "decision" || /(decision|policy|input|lever|variable)/.test(h)) return "decision";
    if (roleHint === "objective" || /(objective|reliability|outcome|goal|benefit)/.test(h)) return "objective";
    if (/(constraint|bound|limit|cap|threshold|feasible|violation)/.test(h)) return "constraint";
    return "metric";
  }, []);

  const inferColumnType = useCallback((col, dataRows) => {
    const vals = dataRows.map(r => r[col]).filter(v => v !== "" && v !== null && v !== undefined);
    if (!vals.length) return "empty";
    const numCount = vals.filter(v => typeof v === "number" && Number.isFinite(v)).length;
    if (numCount === vals.length) return "numeric";
    if (numCount === 0) return "text";
    return "mixed";
  }, []);

  const suggestObjectiveSense = useCallback((header) => {
    const h = String(header || "").toLowerCase();
    if (/(performance|reliability|benefit|profit|yield|accuracy|score|success)/.test(h)) return "max";
    if (/(cost|weight|power|time|risk|penalty|loss|error|emission|violation)/.test(h)) return "min";
    return "min";
  }, []);

  const colStats = useMemo(() => {
    const s = {};
    numericCols.forEach(col => {
      const vals = rows.map(r => r[col]).filter(v => typeof v === "number");
      s[col] = { min: d3.min(vals) ?? 0, max: d3.max(vals) ?? 0 };
    });
    return s;
  }, [numericCols, rows]);

  const matchesFilter = useCallback((value, filterValue) => {
    const ft = String(filterValue || "").trim();
    if (!ft) return true;

    const rangeCmp = ft.match(/^(-?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*\.\.\s*(-?\d*\.?\d+(?:[eE][+-]?\d+)?)$/);
    if (rangeCmp && typeof value === "number" && Number.isFinite(value)) {
      const a = Number.parseFloat(rangeCmp[1]);
      const b = Number.parseFloat(rangeCmp[2]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        return value >= lo && value <= hi;
      }
    }

    const numericCmp = ft.match(/^(>=|<=|!=|=|>|<)\s*(-?\d*\.?\d+(?:[eE][+-]?\d+)?)$/);
    if (numericCmp && typeof value === "number" && Number.isFinite(value)) {
      const op = numericCmp[1];
      const target = Number.parseFloat(numericCmp[2]);
      if (!Number.isFinite(target)) return true;
      if (op === ">") return value > target;
      if (op === "<") return value < target;
      if (op === ">=") return value >= target;
      if (op === "<=") return value <= target;
      if (op === "=") return value === target;
      if (op === "!=") return value !== target;
    }

    return String(value ?? "").toLowerCase().includes(ft.toLowerCase());
  }, []);

  const categoryColorForColumn = useCallback((col) => {
    const category = columnCategories[col] || "metric";
    return CATEGORY_COLORS[category] || C.textMuted;
  }, [columnCategories]);

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
      const ft = (filterText[col] || "").trim();
      if (ft) all = all.filter(r => matchesFilter(r[col], ft));
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
  }, [fronts, filterText, sortCol, sortAsc, showOnlyPareto, weights, objectives, directions, colStats, headers, matchesFilter]);

  const availableFronts = useMemo(() => {
    return Array.from(new Set(fronts.flat().map(r => r._front).filter(f => f !== undefined))).sort((a, b) => a - b);
  }, [fronts]);

  useEffect(() => {
    setVisibleFronts(prev => {
      const next = {};
      availableFronts.forEach(f => {
        next[f] = prev[f] !== undefined ? prev[f] : true;
      });
      return next;
    });
  }, [availableFronts]);

  const visibleData = useMemo(() => {
    return sortedData.filter(row => {
      if (row._front === undefined) return true;
      return visibleFronts[row._front] !== false;
    });
  }, [sortedData, visibleFronts]);

  // Brush in the parasol chart filters the table view (REQ-007); the chart
  // itself renders the brush natively, so only the table consumes this.
  const tableData = useMemo(() => {
    if (!brushedIds) return visibleData;
    const set = new Set(brushedIds);
    return visibleData.filter(r => set.has(r._id));
  }, [visibleData, brushedIds]);

  const handleBrush = useCallback(ids => setBrushedIds(ids), []);

  // Cluster variable default: numeric objective columns (TASK-025).
  useEffect(() => {
    setClusterVars(objectives.filter(o => numericCols.includes(o)));
  }, [objectives, numericCols]);

  const startImportSetup = useCallback((csvText, sourceName = "Uploaded CSV") => {
    const { headers: h, rows: r, columnRoles } = parseCSV(csvText);
    const inferredCategories = {};
    const inferredTypes = {};
    const inferredObjectiveSense = {};
    h.forEach(col => {
      inferredCategories[col] = suggestCategory(col, (columnRoles || {})[col] || null);
      inferredTypes[col] = inferColumnType(col, r);
      inferredObjectiveSense[col] = suggestObjectiveSense(col);
    });
    setImportDraft({
      headers: h,
      rows: r,
      columnRoles: columnRoles || {},
      sourceName,
      assignments: inferredCategories,
      columnTypes: inferredTypes,
      objectiveSense: inferredObjectiveSense,
      categories: [...DEFAULT_CATEGORY_ORDER],
    });
    setLoaded(false);
  }, [suggestCategory, inferColumnType, suggestObjectiveSense]);

  const applyImportSetup = useCallback(() => {
    if (!importDraft) return;
    const h = importDraft.headers;
    const r = importDraft.rows;
    const assignments = importDraft.assignments || {};
    const objectiveSense = importDraft.objectiveSense || {};
    const categories = importDraft.categories?.length ? importDraft.categories : [...DEFAULT_CATEGORY_ORDER];

    setHeaders(h); setRows(r);
    setSourceLabel(importDraft.sourceName || "Uploaded CSV");
    setColumnRoleHints(importDraft.columnRoles || {});
    setColumnCategories(assignments);
    setCategoryOrder(categories);

    const nc = h.filter(col => r.some(row => typeof row[col] === "number"));
    const resolvedSolutionCols = h.filter(col => assignments[col] === "solution");
    const resolvedDecision = resolvedSolutionCols[0] || h.find(col => /(^|\s)(solution\s*id|solutionid|id|name|label)(\s|$)/i.test(String(col))) || null;
    const resolvedDecisionCols = h.filter(col => assignments[col] === "decision" && col !== resolvedDecision);
    const resolvedObjectives = h.filter(col => assignments[col] === "objective" && nc.includes(col));

    setDecisionCol(resolvedDecision);
    setDecisionCols(resolvedDecisionCols);
    setObjectives(resolvedObjectives);
    const dirs = {};
    nc.forEach(c => {
      if (resolvedObjectives.includes(c)) dirs[c] = objectiveSense[c] === "max" ? "max" : "min";
      else dirs[c] = "min";
    });
    setDirections(dirs);
    const w = {}; nc.forEach(c => w[c] = 1);
    setWeights(w);
    setFilterText({}); setSortCol(null); setBrushedIds(null); setBundleDim(null);
    setLoaded(true); setTab("table");
    setImportDraft(null);
  }, [importDraft]);

  const handleFile = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => startImportSetup(ev.target.result, file.name);
    reader.readAsText(file);
  }, [startImportSetup]);

  const loadDemo = useCallback(() => {
    const { headers: h, rows: r, columnRoles } = parseCSV(DEMO);
    const demoAssignments = {};
    const demoObjectives = new Set(["Cost", "Performance", "Reliability"]);
    const demoDecisions = new Set(["Decision Group", "Decision Mode"]);

    h.forEach(col => {
      if (col === "Name") demoAssignments[col] = "solution";
      else if (demoDecisions.has(col)) demoAssignments[col] = "decision";
      else if (demoObjectives.has(col)) demoAssignments[col] = "objective";
      else demoAssignments[col] = "metric";
    });

    setImportDraft({
      headers: h,
      rows: r,
      columnRoles: columnRoles || {},
      sourceName: "Demo Data",
      assignments: demoAssignments,
      columnTypes: Object.fromEntries(h.map(col => [col, inferColumnType(col, r)])),
      objectiveSense: Object.fromEntries(h.map(col => [col, demoObjectives.has(col) ? suggestObjectiveSense(col) : "min"])),
      categories: [...DEFAULT_CATEGORY_ORDER],
    });
    setLoaded(false);
  }, [inferColumnType, suggestObjectiveSense]);

  const toggleDir = useCallback(col => setDirections(p => ({ ...p, [col]: p[col] === "min" ? "max" : "min" })), []);
  const handleSort = useCallback(col => {
    if (sortCol === col) setSortAsc(p => !p);
    else { setSortCol(col); setSortAsc(true); }
  }, [sortCol]);

  const paretoCount = useMemo(() => fronts[0]?.length || 0, [fronts]);
  const shownCount = useMemo(() => visibleData.length, [visibleData]);
  const shownParetoCount = useMemo(() => visibleData.filter(r => r._front === 0).length, [visibleData]);
  const visibleFrontCount = useMemo(() => availableFronts.filter(f => visibleFronts[f] !== false).length, [availableFronts, visibleFronts]);
  const hasScore = objectives.some(o => (weights[o] || 0) > 0);

  const getColWidth = useCallback((col) => {
    if (colWidths[col] !== undefined) return colWidths[col];
    return typeof rows[0]?.[col] === "number" ? 84 : 116;
  }, [colWidths, rows]);

  const startColumnResize = useCallback((col, ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const th = ev.currentTarget.parentElement;
    const startX = ev.clientX;
    const startWidth = th?.getBoundingClientRect().width || getColWidth(col);

    const onMove = (moveEv) => {
      const delta = moveEv.clientX - startX;
      const next = Math.max(70, Math.round(startWidth + delta));
      setColWidths(prev => ({ ...prev, [col]: next }));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [getColWidth]);

  if (importDraft) {
    return (
      <div style={{ fontFamily: FB, background: C.bg, color: C.text, minHeight: "100vh", padding: 20 }}>
        <div style={{ maxWidth: 1080, margin: "0 auto" }}>
          <h2 style={{ fontFamily: FM, fontSize: 18, color: C.accent, marginBottom: 8 }}>Import Setup</h2>
          <p style={{ color: C.textMuted, fontSize: 12, marginBottom: 12 }}>
            Review each column and confirm its category before loading the analysis views.
          </p>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ color: C.textMuted, fontFamily: FM, fontSize: 11 }}>Source</span>
            <span style={{ color: C.highlight, fontFamily: FM, fontSize: 11 }}>{importDraft.sourceName}</span>
            <div style={{ flex: 1 }} />
            <input
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              placeholder="new category"
              style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: FM, fontSize: 11 }}
            />
            <button
              onClick={() => {
                const raw = newCategoryName.trim().toLowerCase();
                const normalized = raw.replace(/\s+/g, "_");
                if (!normalized || importDraft.categories.includes(normalized)) return;
                setImportDraft(prev => ({ ...prev, categories: [...prev.categories, normalized] }));
                setNewCategoryName("");
              }}
              style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.surfaceAlt, color: C.accent, fontFamily: FM, fontSize: 11, cursor: "pointer" }}
            >
              Add Category
            </button>
          </div>
          <div style={{ maxWidth: 860, margin: "0 auto", overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 8, background: C.surface }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: FM }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th style={{ textAlign: "left", padding: "8px 10px", color: C.textMuted }}>Column</th>
                  <th style={{ textAlign: "center", padding: "8px 10px", color: C.textMuted }}>Category</th>
                    <th style={{ textAlign: "center", padding: "8px 10px", color: C.textMuted }}>Objective Sense</th>
                  <th style={{ textAlign: "center", padding: "8px 10px", color: C.textMuted }}>Detected Type</th>
                </tr>
              </thead>
              <tbody>
                {importDraft.headers.map(col => (
                  <tr key={col} style={{ borderBottom: `1px solid ${C.border}22` }}>
                    <td style={{ padding: "6px 10px", color: C.text }}>{col}</td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>
                      <select
                        value={importDraft.assignments[col] || "metric"}
                        onChange={e => {
                          const next = e.target.value;
                          setImportDraft(prev => ({
                            ...prev,
                            assignments: { ...prev.assignments, [col]: next },
                            objectiveSense: {
                              ...(prev.objectiveSense || {}),
                              [col]: next === "objective" ? (prev.objectiveSense?.[col] || "min") : (prev.objectiveSense?.[col] || "min"),
                            },
                          }));
                        }}
                        style={{ padding: "2px 6px", borderRadius: 4, border: `1px solid ${C.border}`, background: C.surfaceAlt, color: C.text, fontFamily: FM, fontSize: 11 }}
                      >
                        {importDraft.categories.map(cat => (
                          <option key={cat} value={cat}>{CATEGORY_LABELS[cat] || cat}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: "6px 10px", textAlign: "center" }}>
                      <select
                        value={importDraft.objectiveSense?.[col] || "min"}
                        disabled={(importDraft.assignments[col] || "metric") !== "objective"}
                        onChange={e => {
                          const next = e.target.value;
                          setImportDraft(prev => ({
                            ...prev,
                            objectiveSense: { ...(prev.objectiveSense || {}), [col]: next },
                          }));
                        }}
                        style={{ padding: "2px 6px", borderRadius: 4, border: `1px solid ${C.border}`, background: C.surfaceAlt, color: C.text, fontFamily: FM, fontSize: 11, opacity: (importDraft.assignments[col] || "metric") === "objective" ? 1 : 0.6 }}
                      >
                        <option value="min">minimize</option>
                        <option value="max">maximize</option>
                      </select>
                    </td>
                    <td style={{ padding: "6px 10px", textAlign: "center", color: C.textMuted }}>{importDraft.columnTypes[col]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button
              onClick={() => setImportDraft(null)}
              style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.textMuted, fontFamily: FM, fontSize: 11, cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              onClick={applyImportSetup}
              style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${C.accent}`, background: C.accentDim, color: C.accent, fontFamily: FM, fontSize: 11, cursor: "pointer" }}
            >
              Apply Categories
            </button>
          </div>
        </div>
      </div>
    );
  }

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

  const displayCols = Array.from(new Set([
    ...(decisionCol ? [decisionCol] : []),
    ...decisionCols,
    ...objectives,
    ...constraintCols,
    ...metricCols,
    ...customCategoryEntries.flatMap(entry => entry.columns),
  ])).filter(col => headers.includes(col));

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
        <span style={{ color: C.textMuted }}>Total Solutions <span style={{ color: C.text }}>{rows.length}</span></span>
        <span style={{ color: C.textMuted }}>Shown <span style={{ color: C.accent }}>{shownCount}</span><span style={{ color: C.textDim }}> / {rows.length}</span></span>
        <span style={{ color: C.textMuted }}>Pareto <span style={{ color: C.front0 }}>{shownParetoCount}</span><span style={{ color: C.textDim }}> / {paretoCount}</span></span>
        <span style={{ color: C.textMuted }}>Fronts <span style={{ color: C.text }}>{visibleFrontCount}</span><span style={{ color: C.textDim }}> / {fronts.length}</span></span>
        <span style={{ color: C.textMuted }}>Obj <span style={{ color: C.accent }}>{objectives.length}</span></span>
        {brushedIds && <span style={{ color: C.highlight }}>Brushed {brushedIds.length}</span>}
        <span style={{ color: C.textMuted }}>Source <span style={{ color: C.highlight }}>{sourceLabel}</span></span>
        <div style={{ flex: 1 }} />
        <Chip label={showOnlyPareto ? "Pareto Only ✓" : "Show All"} active={showOnlyPareto} onClick={() => setShowOnlyPareto(p => !p)} />
        <Chip label={condFormat ? "Heatmap ✓" : "Heatmap"} active={condFormat} onClick={() => setCondFormat(p => !p)} />
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Sidebar */}
        <div style={{ width: 260, minWidth: 260, background: C.surface, borderRight: `1px solid ${C.border}`, padding: 14, overflowY: "auto" }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, marginBottom: 6, letterSpacing: 1 }}>LABEL COLUMN</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {labelCols.map(col => (
                <Chip key={col} label={col} active={decisionCol === col} onClick={() => setDecisionCol(col === decisionCol ? null : col)} color={CATEGORY_COLORS.solution} />
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, marginBottom: 6, letterSpacing: 1 }}>DECISIONS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {decisionCols.map(col => (
                <Chip key={col} label={col.length > 14 ? col.slice(0, 12) + "…" : col} active={true} onClick={() => {}} color={CATEGORY_COLORS.decision} />
              ))}
              {decisionCols.length === 0 && <span style={{ fontSize: 9, color: C.textDim }}>No decision variables assigned.</span>}
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 13, fontFamily: FM, color: CATEGORY_COLORS.objective, marginBottom: 8, fontWeight: 700, letterSpacing: 0.6 }}>
              OBJECTIVE CONTROLS
            </div>
            <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, marginBottom: 6, letterSpacing: 1 }}>PARALLEL ORIENTATION</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              <Chip
                label="Preferred @ Top"
                active={preferredObjectiveEdge === "top"}
                onClick={() => setPreferredObjectiveEdge("top")}
                color={C.highlight}
              />
              <Chip
                label="Preferred @ Bottom"
                active={preferredObjectiveEdge === "bottom"}
                onClick={() => setPreferredObjectiveEdge("bottom")}
                color={C.highlight}
              />
            </div>
            <p style={{ fontSize: 9, color: CATEGORY_COLORS.objective, marginTop: 4, lineHeight: 1.3 }}>
              Objective axes flip automatically so the preferred direction (min/max) points toward the selected edge.
            </p>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, marginBottom: 6, letterSpacing: 1 }}>OBJECTIVES</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {objectives.map(col => (
                <div key={col} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <Chip label={col.length > 14 ? col.slice(0, 12) + "…" : col} active={true} onClick={() => {}} color={CATEGORY_COLORS.objective} />
                  <button onClick={() => toggleDir(col)} style={{
                    padding: "2px 5px", borderRadius: 4, fontSize: 9, fontFamily: FM,
                    border: `1px solid ${C.border}`, background: "transparent",
                    color: directions[col] === "min" ? C.dominated : C.front0, cursor: "pointer",
                  }}>{directions[col] === "min" ? "▼min" : "▲max"}</button>
                </div>
              ))}
              {objectives.length === 0 && <span style={{ fontSize: 9, color: C.textDim }}>No objectives assigned.</span>}
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, letterSpacing: 1 }}>EPSILON (ε) PER OBJECTIVE</div>
              <button
                onClick={() => setShowEpsilonControls(p => !p)}
                style={{ padding: "2px 7px", borderRadius: 5, border: `1px solid ${showEpsilonControls ? C.accent : C.border}`, background: showEpsilonControls ? C.accentDim : "transparent", color: showEpsilonControls ? C.accent : C.textMuted, fontFamily: FM, fontSize: 9, cursor: "pointer" }}
              >
                {showEpsilonControls ? "On" : "Off"}
              </button>
            </div>
            {showEpsilonControls && (
              <>
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
              </>
            )}
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, letterSpacing: 1 }}>PREFERENCE WEIGHTS</div>
              <button
                onClick={() => setShowPreferenceControls(p => !p)}
                style={{ padding: "2px 7px", borderRadius: 5, border: `1px solid ${showPreferenceControls ? C.accent : C.border}`, background: showPreferenceControls ? C.accentDim : "transparent", color: showPreferenceControls ? C.accent : C.textMuted, fontFamily: FM, fontSize: 9, cursor: "pointer" }}
              >
                {showPreferenceControls ? "On" : "Off"}
              </button>
            </div>
            {showPreferenceControls && (
              <>
                {objectives.map(o => (
                  <div key={o} style={{ marginBottom: 5 }}>
                    <Slider label={o.length > 8 ? o.slice(0, 6) + "…" : o} value={weights[o] ?? 1}
                      onChange={v => setWeights(p => ({ ...p, [o]: v }))} min={0} max={5} step={0.1} />
                  </div>
                ))}
                <p style={{ fontSize: 9, color: C.textDim, marginTop: 3, lineHeight: 1.3 }}>
                  Direction-aware normalized aggregate. Higher weight = more important.
                </p>
              </>
            )}
          </div>

          {!!constraintCols.length && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, marginBottom: 6, letterSpacing: 1 }}>CONSTRAINTS</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {constraintCols.map(col => (
                  <Chip key={col} label={col.length > 14 ? col.slice(0, 12) + "…" : col} active={true} onClick={() => {}} color={CATEGORY_COLORS.constraint} />
                ))}
              </div>
            </div>
          )}

          {!!metricCols.length && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, marginBottom: 6, letterSpacing: 1 }}>METRICS</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {metricCols.map(col => (
                  <Chip key={col} label={col.length > 14 ? col.slice(0, 12) + "…" : col} active={true} onClick={() => {}} color={CATEGORY_COLORS.metric} />
                ))}
              </div>
            </div>
          )}

          {customCategoryEntries.map(entry => (
            <div key={entry.category} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, marginBottom: 6, letterSpacing: 1 }}>{String(entry.category).toUpperCase()}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                {entry.columns.map(col => (
                  <Chip key={col} label={col.length > 14 ? col.slice(0, 12) + "…" : col} active={true} onClick={() => {}} color={CATEGORY_COLORS[entry.category] || C.highlight} />
                ))}
              </div>
            </div>
          ))}

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, marginBottom: 6, letterSpacing: 1 }}>VISIBLE FRONTS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {availableFronts.map(f => (
                <Chip
                  key={f}
                  label={`F${f}`}
                  active={visibleFronts[f] !== false}
                  onClick={() => setVisibleFronts(p => ({ ...p, [f]: p[f] === false }))}
                  color={frontColor(f)}
                />
              ))}
              {availableFronts.length > 0 && (
                <Chip
                  label="All"
                  active={availableFronts.every(f => visibleFronts[f] !== false)}
                  onClick={() => {
                    const allOn = availableFronts.every(f => visibleFronts[f] !== false);
                    const next = {};
                    availableFronts.forEach(f => { next[f] = !allOn; });
                    setVisibleFronts(next);
                  }}
                  color={C.accent}
                />
              )}
            </div>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, marginBottom: 6, letterSpacing: 1 }}>RENDERING</div>
            <div style={{ marginBottom: 5 }}>
              <Slider label="smooth" value={smoothness} onChange={setSmoothness} min={0} max={0.25} step={0.01} />
            </div>
            <div style={{ fontSize: 9, fontFamily: FM, color: C.textDim, marginBottom: 4 }}>Bundle dimension</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 5 }}>
              {numericCols.filter(col => displayCols.includes(col)).map(col => (
                <Chip
                  key={col}
                  label={col.length > 14 ? col.slice(0, 12) + "…" : col}
                  active={bundleDim === col}
                  onClick={() => setBundleDim(bundleDim === col ? null : col)}
                  color={C.highlight}
                />
              ))}
            </div>
            <div style={{ marginBottom: 5, opacity: bundleDim ? 1 : 0.45, pointerEvents: bundleDim ? "auto" : "none" }}>
              <Slider label="bundle" value={bundleStrength} onChange={setBundleStrength} min={0} max={1} step={0.05} />
            </div>
            <p style={{ fontSize: 9, color: C.textDim, lineHeight: 1.3 }}>
              Bundling groups lines by the selected dimension; pick one to enable the strength slider.
            </p>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, letterSpacing: 1 }}>CLUSTERING</div>
              <button
                onClick={() => setClusterEnabled(p => !p)}
                style={{ padding: "2px 7px", borderRadius: 5, border: `1px solid ${clusterEnabled ? C.accent : C.border}`, background: clusterEnabled ? C.accentDim : "transparent", color: clusterEnabled ? C.accent : C.textMuted, fontFamily: FM, fontSize: 9, cursor: "pointer" }}
              >
                {clusterEnabled ? "On" : "Off"}
              </button>
            </div>
            {clusterEnabled && (
              <>
                <div style={{ marginBottom: 5 }}>
                  <Slider label="k" value={clusterK} onChange={v => setClusterK(Math.round(v))} min={2} max={10} step={1} />
                </div>
                <div style={{ fontSize: 9, fontFamily: FM, color: C.textDim, marginBottom: 4 }}>Cluster variables</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 5 }}>
                  {numericCols.map(col => (
                    <Chip
                      key={col}
                      label={col.length > 14 ? col.slice(0, 12) + "…" : col}
                      active={clusterVars.includes(col)}
                      onClick={() => setClusterVars(p => p.includes(col) ? p.filter(c => c !== col) : [...p, col])}
                      color={CATEGORY_COLORS.objective}
                    />
                  ))}
                </div>
                <Chip
                  label={clusterStd ? "Standardize ✓" : "Standardize"}
                  active={clusterStd}
                  onClick={() => setClusterStd(p => !p)}
                />
                {clusterVars.length === 0 && (
                  <p style={{ fontSize: 9, color: C.dominated, marginTop: 4 }}>Select at least one variable to cluster.</p>
                )}
                <p style={{ fontSize: 9, color: C.textDim, marginTop: 4, lineHeight: 1.3 }}>
                  k-means over the selected variables; standardize converts values to z-scores for unbiased clusters.
                </p>
              </>
            )}
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontFamily: FM, color: C.textDim, marginBottom: 6, letterSpacing: 1 }}>COLOR BY</div>
            <div style={{ display: "flex", gap: 5 }}>
              <Chip label="Front" active={colorBy === "front"} onClick={() => setColorBy("front")} color={C.front0} />
              <Chip
                label="Cluster"
                active={colorBy === "cluster"}
                onClick={() => setColorBy("cluster")}
                color={clusterEnabled && clusterVars.length > 0 ? C.highlight : C.textDim}
              />
            </div>
            {colorBy === "cluster" && (!clusterEnabled || clusterVars.length === 0) && (
              <p style={{ fontSize: 9, color: C.textDim, marginTop: 4 }}>Enable clustering to see cluster colors.</p>
            )}
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {tab === "config" && (
            <div style={{ padding: 20, maxWidth: 720 }}>
              <h2 style={{ fontFamily: FM, fontSize: 15, color: C.accent, marginBottom: 14 }}>Column Configuration</h2>
              <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 16, lineHeight: 1.5 }}>
                Categories are set during import setup. Use this view for objective direction and weight tuning.
              </p>
              <button
                onClick={() => setImportDraft({
                  headers,
                  rows,
                  columnRoles: columnRoleHints,
                  sourceName: sourceLabel,
                  assignments: { ...columnCategories },
                  columnTypes: Object.fromEntries(headers.map(h => [h, inferColumnType(h, rows)])),
                  objectiveSense: Object.fromEntries(headers.map(h => [h, directions[h] === "max" ? "max" : "min"])),
                  categories: [...categoryOrder],
                })}
                style={{ marginBottom: 12, padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.surfaceAlt, color: C.accent, fontFamily: FM, fontSize: 11, cursor: "pointer" }}
              >
                Reopen Import Setup
              </button>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: FM }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {["Column", "Type", "Category", "Direction", "Weight"].map(h => (
                      <th key={h} style={{ textAlign: h === "Column" ? "left" : "center", padding: "6px 10px", color: C.textMuted }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {headers.map(h => {
                    const isNum = numericCols.includes(h), isObj = objectives.includes(h);
                    const category = columnCategories[h] || "metric";
                    return (
                      <tr key={h} style={{ borderBottom: `1px solid ${C.border}22` }}>
                        <td style={{ padding: "5px 10px", color: C.text }}>{h}</td>
                        <td style={{ padding: "5px 10px", textAlign: "center", color: isNum ? C.front1 : C.textDim }}>{isNum ? "numeric" : "text"}</td>
                        <td style={{ padding: "5px 10px", textAlign: "center", color: CATEGORY_COLORS[category] || C.textDim }}>{CATEGORY_LABELS[category] || category}</td>
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

          {/* Parallel view stays mounted (display toggle) so the parasol chart
              and its brushes survive tab switches. */}
          {loaded && (
            <div style={{ padding: 14, display: tab === "parallel" ? "block" : "none" }}>
              <div style={{ background: C.surface, borderRadius: 10, border: `1px solid ${C.border}`, padding: 10, marginBottom: 10 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                  <span style={{ fontSize: 10, fontFamily: FM, color: C.textDim }}>
                    Drag on axes to brush · Brushing filters the table · Hover table rows to highlight lines
                  </span>
                  <div style={{ flex: 1 }} />
                  {brushedIds && (
                    <span style={{ fontSize: 10, fontFamily: FM, color: C.highlight }}>
                      {brushedIds.length} brushed
                    </span>
                  )}
                  <button
                    onClick={() => parasolRef.current?.clearBrush()}
                    disabled={!brushedIds}
                    style={{ padding: "3px 9px", borderRadius: 5, border: `1px solid ${brushedIds ? C.highlight : C.border}`, background: brushedIds ? C.highlightDim : "transparent", color: brushedIds ? C.highlight : C.textDim, fontFamily: FM, fontSize: 10, cursor: brushedIds ? "pointer" : "default" }}
                  >
                    Clear Brush
                  </button>
                  <button
                    onClick={() => parasolRef.current?.exportBrushed()}
                    style={{ padding: "3px 9px", borderRadius: 5, border: `1px solid ${C.border}`, background: "transparent", color: C.textMuted, fontFamily: FM, fontSize: 10, cursor: "pointer" }}
                    title="Download brushed rows as CSV (all rows when nothing is brushed)"
                  >
                    Export CSV
                  </button>
                </div>
                <div style={{ fontSize: 9, fontFamily: FM, color: C.textDim, marginBottom: 8 }}>
                  Axes reflect categorized columns from Label, Decisions, Objectives, Constraints, Metrics, and custom groups.
                </div>
                <div style={{ fontSize: 9, fontFamily: FM, color: CATEGORY_COLORS.objective, marginBottom: 8 }}>
                  Orientation: preferred objective direction is toward the {preferredObjectiveEdge === "top" ? "top" : "bottom"} edge.
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8, fontSize: 9, fontFamily: FM }}>
                  {["solution", "decision", "objective", "constraint", "metric"].map(cat => (
                    <span key={cat} style={{ display: "flex", alignItems: "center", gap: 4, color: CATEGORY_COLORS[cat] || C.textMuted }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: CATEGORY_COLORS[cat] || C.textMuted, display: "inline-block" }} />
                      {CATEGORY_LABELS[cat] || cat}
                    </span>
                  ))}
                </div>
                {displayCols.length > 0 && visibleData.length > 0 ? (
                  <ParasolPlot
                    ref={parasolRef}
                    data={visibleData}
                    axes={displayCols}
                    directions={directions}
                    objectives={objectives}
                    preferredObjectiveEdge={preferredObjectiveEdge}
                    columnCategories={columnCategories}
                    highlightId={highlightId}
                    colorBy={colorBy}
                    clusterConfig={{ enabled: clusterEnabled && clusterVars.length > 0, k: clusterK, vars: clusterVars, std: clusterStd }}
                    bundling={{ dimension: bundleDim, strength: bundleStrength, smoothness }}
                    onBrush={handleBrush}
                  />
                ) : (
                  <div style={{ padding: 60, textAlign: "center", color: C.textDim, fontSize: 13 }}>
                    {displayCols.length === 0 ? "Select at least one decision or objective column." : "No rows match filters or visible fronts."}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 14, padding: "6px 10px", fontSize: 10, fontFamily: FM, color: C.textMuted, flexWrap: "wrap" }}>
                {colorBy === "cluster" && clusterEnabled && clusterVars.length > 0 ? (
                  Array.from({ length: clusterK }, (_, i) => (
                    <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ width: 12, height: 3, background: CLUSTER_PALETTE[i % CLUSTER_PALETTE.length], borderRadius: 2, display: "inline-block" }} />
                      Cluster {i}
                    </span>
                  ))
                ) : (
                  <>
                    {availableFronts.slice(0, 8).map((i) => (
                      <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 12, height: 3, background: frontColor(i), borderRadius: 2, display: "inline-block" }} />
                        Front {i}{i === 0 ? " (Pareto)" : ""}{visibleFronts[i] === false ? " (hidden)" : ""}
                      </span>
                    ))}
                    {availableFronts.length > 8 && <span>+{availableFronts.length - 8} more</span>}
                  </>
                )}
              </div>
            </div>
          )}

          {tab === "table" && (
            <div style={{ padding: 10 }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "max-content", borderCollapse: "separate", borderSpacing: 0, fontSize: 11, fontFamily: FM }}>
                  <colgroup>
                    <col style={{ width: 34 }} />
                    <col style={{ width: 48 }} />
                    {displayCols.map(col => (
                      <col key={col} style={{ width: getColWidth(col) }} />
                    ))}
                    {hasScore && <col style={{ width: getColWidth("_score") }} />}
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={{ position: "sticky", top: 0, zIndex: 2, padding: "6px 4px", textAlign: "center", background: C.surface, borderBottom: `2px solid ${C.border}`, color: C.textDim, fontSize: 9, width: 30 }}>#</th>
                      <th style={{ position: "sticky", top: 0, zIndex: 2, padding: "6px 4px", textAlign: "center", background: C.surface, borderBottom: `2px solid ${C.border}`, color: C.textDim, fontSize: 9, width: 44 }}>Front</th>
                      {displayCols.map(col => (
                        <th key={col} onClick={() => handleSort(col)} style={{
                          position: "sticky", top: 0, zIndex: 2, padding: "6px 6px",
                          textAlign: typeof rows[0]?.[col] === "number" ? "right" : "left",
                          background: C.surface, borderBottom: `2px solid ${C.border}`,
                          color: categoryColorForColumn(col),
                          cursor: "pointer", fontSize: 9, whiteSpace: "nowrap", userSelect: "none", position: "sticky",
                        }}>
                          {col} {sortCol === col ? (sortAsc ? "▲" : "▼") : ""}
                          {objectives.includes(col) && <span style={{ color: directions[col] === "min" ? C.dominated : C.front0, marginLeft: 3 }}>{directions[col] === "min" ? "↓" : "↑"}</span>}
                          <span
                            onMouseDown={(e) => startColumnResize(col, e)}
                            title="Drag to resize column"
                            style={{ position: "absolute", top: 0, right: 0, width: 6, height: "100%", cursor: "col-resize", background: "transparent" }}
                          />
                        </th>
                      ))}
                      {hasScore && (
                        <th onClick={() => handleSort("_score")} style={{
                          position: "sticky", top: 0, zIndex: 2, padding: "6px 6px", textAlign: "right",
                          background: C.surface, borderBottom: `2px solid ${C.border}`,
                          color: C.highlight, cursor: "pointer", fontSize: 9, whiteSpace: "nowrap", position: "sticky",
                        }}>
                          Preference Score {sortCol === "_score" ? (sortAsc ? "▲" : "▼") : ""}
                          <span
                            onMouseDown={(e) => startColumnResize("_score", e)}
                            title="Drag to resize column"
                            style={{ position: "absolute", top: 0, right: 0, width: 6, height: "100%", cursor: "col-resize", background: "transparent" }}
                          />
                        </th>
                      )}
                    </tr>
                    <tr>
                      <td style={{ background: C.surfaceAlt, padding: "1px 3px", borderBottom: `1px solid ${C.border}`, color: C.textDim, fontSize: 9, textAlign: "center" }} title="Row index (not a filter)">
                        Row #
                      </td>
                      <td style={{ background: C.surfaceAlt, padding: "1px 3px", borderBottom: `1px solid ${C.border}`, color: C.textDim, fontSize: 9, textAlign: "center" }} title="Front badge column (not a text filter)">
                        Front
                      </td>
                      {displayCols.map(col => (
                        <td key={col} style={{ background: C.surfaceAlt, padding: "1px 3px", borderBottom: `1px solid ${C.border}` }}>
                          <input placeholder={`filter ${col}`} value={filterText[col] || ""}
                            title={`Filter ${col}. Text uses contains match (e.g. alpha, 649). Numeric columns support >, <, >=, <=, =, != (e.g. > 3.4) and inclusive ranges like 3.4..5.0.`}
                            onChange={e => setFilterText(p => ({ ...p, [col]: e.target.value }))}
                            style={{ width: "100%", padding: "1px 3px", borderRadius: 3, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 9, fontFamily: FM, outline: "none", boxSizing: "border-box" }} />
                        </td>
                      ))}
                      {hasScore && <td style={{ background: C.surfaceAlt, padding: 1, borderBottom: `1px solid ${C.border}` }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.map((row, i) => {
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
              {!tableData.length && <div style={{ padding: 40, textAlign: "center", color: C.textDim, fontSize: 13 }}>No rows match filters, visible fronts, or the active brush.</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
