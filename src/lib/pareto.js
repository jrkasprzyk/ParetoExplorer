export function epsilonDominates(a, b, objs, epsilons, dirs) {
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

export function epsilonSort(rows, objs, epsilons, dirs) {
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

export function wScore(row, objs, weights, dirs, stats) {
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
