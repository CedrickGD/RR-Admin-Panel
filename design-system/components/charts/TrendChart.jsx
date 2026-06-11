import React, { useEffect, useMemo, useRef, useState } from "react";

let trendUid = 0;

function catmullRomPath(pts) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function niceMax(value) {
  if (value <= 4) return 4;
  const mag = Math.pow(10, Math.floor(Math.log10(value)));
  const norm = value / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/**
 * Large time-series panel chart — smooth area lines + rounded bars over a
 * dashed grid, with the console's dark hover tooltip. Dependency-free SVG.
 * Colors default to the user-preset chart tokens (--chart-*), NOT the accent.
 */
export function TrendChart({ data, height = 280, areas = [], bars = [], yTicks = 4, minTickGap = 56 }) {
  const uid = useMemo(() => `trend-${++trendUid}`, []);
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { top: 14, right: 10, bottom: 22, left: 38 };
  const iw = Math.max(40, width - pad.left - pad.right);
  const ih = Math.max(40, height - pad.top - pad.bottom);
  const n = data.length;

  const allKeys = [...areas, ...bars].map((s) => s.key);
  const max = niceMax(Math.max(1, ...data.flatMap((d) => allKeys.map((k) => Number(d[k]) || 0))));

  const x = (i) => pad.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => pad.top + ih - (v / max) * ih;

  const labelEvery = Math.max(1, Math.ceil((n * minTickGap) / Math.max(1, iw)));
  const barW = Math.max(4, Math.min(18, (iw / Math.max(1, n)) * 0.4));

  const onMove = (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - pad.left) / Math.max(1, iw)) * (n - 1));
    if (i >= 0 && i < n) setHover(i);
    else setHover(null);
  };

  return (
    <div
      ref={wrapRef}
      style={{ position: "relative", width: "100%" }}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg width={width} height={height} style={{ display: "block" }}>
        <defs>
          {areas.map((s, si) => (
            <linearGradient key={s.key} id={`${uid}-fill-${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.01} />
            </linearGradient>
          ))}
        </defs>

        {/* grid + y labels */}
        {Array.from({ length: yTicks + 1 }, (_, t) => {
          const v = (max / yTicks) * t;
          return (
            <g key={t}>
              <line x1={pad.left} x2={pad.left + iw} y1={y(v)} y2={y(v)} stroke="var(--chart-grid)" strokeDasharray="3 6" />
              <text x={pad.left - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--chart-axis-soft)">
                {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v)}
              </text>
            </g>
          );
        })}

        {/* x labels */}
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10.5" fill="var(--chart-axis)">
              {d.label}
            </text>
          ) : null
        )}

        {/* bars */}
        {bars.map((s) => (
          <g key={s.key}>
            {data.map((d, i) => {
              const v = Number(d[s.key]) || 0;
              if (v <= 0) return null;
              const h = Math.max(2, (v / max) * ih);
              return (
                <rect
                  key={i}
                  x={x(i) - barW / 2}
                  y={pad.top + ih - h}
                  width={barW}
                  height={h}
                  rx={Math.min(6, barW / 2)}
                  fill={s.color}
                />
              );
            })}
          </g>
        ))}

        {/* areas + lines */}
        {areas.map((s, si) => {
          const pts = data.map((d, i) => [x(i), y(Number(d[s.key]) || 0)]);
          const line = catmullRomPath(pts);
          const area = `${line}L${x(n - 1)},${pad.top + ih}L${x(0)},${pad.top + ih}Z`;
          return (
            <g key={s.key}>
              <path d={area} fill={`url(#${uid}-fill-${si})`} />
              <path d={line} fill="none" stroke={s.color} strokeWidth={s.strokeWidth ?? 2.4} style={{ filter: "drop-shadow(0 0 4px rgba(255,255,255,0.18))" }} />
            </g>
          );
        })}

        {/* hover cursor + dots */}
        {hover !== null ? (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + ih} stroke="rgba(255,255,255,0.12)" />
            {areas.map((s) => (
              <circle
                key={s.key}
                cx={x(hover)}
                cy={y(Number(data[hover][s.key]) || 0)}
                r={4.5}
                fill={s.color}
                stroke="rgba(0,0,0,0.3)"
                strokeWidth={2}
                style={{ filter: `drop-shadow(0 0 4px ${s.color})` }}
              />
            ))}
          </g>
        ) : null}
      </svg>

      {/* tooltip */}
      {hover !== null ? (
        <div
          className="chart-tip"
          style={{
            position: "absolute",
            left: Math.min(Math.max(0, x(hover) + 12), width - 150),
            top: 8,
          }}
        >
          <p className="chart-tip-label">{data[hover].label}</p>
          {[...areas, ...bars].map((s) => (
            <div className="chart-tip-row" key={s.key}>
              <span className="chart-tip-name">
                <span className="chart-tip-dot" style={{ background: s.color }} />
                {s.name}
              </span>
              <span className="chart-tip-val">{(Number(data[hover][s.key]) || 0).toLocaleString()}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
