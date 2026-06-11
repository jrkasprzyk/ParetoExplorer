import { C, FM } from "../theme.js";

export function Chip({ label, active, onClick, color }) {
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

export function Slider({ label, value, onChange, min, max, step }) {
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
