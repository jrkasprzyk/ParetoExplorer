export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [], columnRoles: {} };

  const normalizeCell = (value) => String(value || "").replace(/^"|"$/g, '').trim();

  function split(line) {
    const r = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = !inQ; }
      } else if (ch === ',' && !inQ) {
        r.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
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

export const DEMO = `Name,Decision Group,Decision Mode,Cost,Performance,Reliability,Weight,Power
Alpha-1,Group-A,Conservative,45000,82,0.94,120,340
Beta-2,Group-B,Aggressive,62000,95,0.97,145,520
Gamma-3,Group-A,Conservative,38000,71,0.89,98,280
Delta-4,Group-C,Balanced,55000,88,0.96,130,460
Epsilon-5,Group-B,Aggressive,72000,97,0.99,160,580
Zeta-6,Group-A,Balanced,41000,75,0.91,105,300
Eta-7,Group-A,Balanced,48000,85,0.93,125,380
Theta-8,Group-C,Aggressive,67000,93,0.98,150,540
Iota-9,Group-A,Conservative,35000,68,0.87,92,260
Kappa-10,Group-C,Balanced,58000,90,0.95,135,480
Lambda-11,Group-B,Conservative,43000,78,0.92,115,320
Mu-12,Group-C,Aggressive,69000,96,0.98,155,560
Nu-13,Group-A,Conservative,37000,70,0.88,95,270
Xi-14,Group-B,Balanced,51000,86,0.94,128,420
Omicron-15,Group-C,Aggressive,61000,92,0.97,142,500`;
