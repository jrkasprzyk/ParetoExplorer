export const C = {
  bg: "#f7f8fa", surface: "#ffffff", surfaceAlt: "#eef1f6",
  border: "#d4dae4", borderLight: "#bcc6d6",
  text: "#1a2233", textMuted: "#5a6a85", textDim: "#8a96ab",
  accent: "#00875f", accentDim: "rgba(0,135,95,0.10)",
  front0: "#00875f", front1: "#2563eb", front2: "#9333ea",
  front3: "#ea580c", frontN: "#94a3b8",
  dominated: "#dc2626", dominatedDim: "rgba(220,38,38,0.08)",
  highlight: "#7c3aed", highlightDim: "rgba(124,58,237,0.10)",
};

export const FM = `'JetBrains Mono','Fira Code','SF Mono',monospace`;
export const FB = `'DM Sans','Segoe UI',system-ui,sans-serif`;

export const DEFAULT_CATEGORY_ORDER = ["solution", "decision", "objective", "constraint", "metric"];

export const CATEGORY_LABELS = {
  solution: "Solution ID",
  decision: "Decision Variables",
  objective: "Objectives",
  constraint: "Constraints",
  metric: "Metrics",
};

export const CATEGORY_COLORS = {
  solution: "#7c3aed",
  decision: "#2563eb",
  objective: "#00875f",
  constraint: "#dc2626",
  metric: "#5a6a85",
};

export function frontColor(f) {
  return [C.front0, C.front1, C.front2, C.front3][f] || C.frontN;
}

// Heatmap endpoints: C.dominated (#dc2626) → C.accent (#00875f), light-theme legible at low alpha.
export function cellBg(val, min, max, dir) {
  if (typeof val !== "number" || min === max) return "transparent";
  let t = (val - min) / (max - min);
  if (dir === "min") t = 1 - t;
  const r = Math.round(220 * (1 - t) + 0 * t);
  const g = Math.round(38 * (1 - t) + 135 * t);
  const b = Math.round(38 * (1 - t) + 95 * t);
  return `rgba(${r},${g},${b},0.18)`;
}
