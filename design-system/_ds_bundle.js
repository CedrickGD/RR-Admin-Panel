/* @ds-bundle: {"format":3,"namespace":"RazorReaperConsoleDesignSystem_40e0a6","components":[{"name":"TrendChart","sourcePath":"components/charts/TrendChart.jsx"},{"name":"Button","sourcePath":"components/controls/Button.jsx"},{"name":"IconButton","sourcePath":"components/controls/Button.jsx"},{"name":"Dropdown","sourcePath":"components/controls/Dropdown.jsx"},{"name":"SearchInput","sourcePath":"components/controls/SearchInput.jsx"},{"name":"SegmentedControl","sourcePath":"components/controls/SegmentedControl.jsx"},{"name":"Icon","sourcePath":"components/icons/Icon.jsx"},{"name":"ICON_PATHS","sourcePath":"components/icons/iconPaths.js"},{"name":"Badge","sourcePath":"components/indicators/Badge.jsx"},{"name":"LiveBadge","sourcePath":"components/indicators/Badge.jsx"},{"name":"StatusBadge","sourcePath":"components/indicators/StatusBadge.jsx"},{"name":"Tag","sourcePath":"components/indicators/Tag.jsx"},{"name":"Spinner","sourcePath":"components/indicators/Tag.jsx"},{"name":"KpiTile","sourcePath":"components/metrics/KpiTile.jsx"},{"name":"RadialGauge","sourcePath":"components/metrics/RadialGauge.jsx"},{"name":"RankList","sourcePath":"components/metrics/RankList.jsx"},{"name":"Sparkline","sourcePath":"components/metrics/Sparkline.jsx"},{"name":"EmptyState","sourcePath":"components/panels/EmptyState.jsx"},{"name":"Modal","sourcePath":"components/panels/Modal.jsx"},{"name":"TimespanGrid","sourcePath":"components/panels/Modal.jsx"},{"name":"BreakdownList","sourcePath":"components/panels/Modal.jsx"},{"name":"Panel","sourcePath":"components/panels/Panel.jsx"},{"name":"PageHeader","sourcePath":"components/shell/PageHeader.jsx"},{"name":"MetaRow","sourcePath":"components/shell/PageHeader.jsx"},{"name":"TopNav","sourcePath":"components/shell/TopNav.jsx"},{"name":"DataTable","sourcePath":"components/tables/DataTable.jsx"},{"name":"DetailGrid","sourcePath":"components/tables/DataTable.jsx"},{"name":"Feed","sourcePath":"components/tables/Feed.jsx"},{"name":"KvList","sourcePath":"components/tables/KvList.jsx"},{"name":"ConsoleApp","sourcePath":"ui_kits/console/ConsoleApp.jsx"},{"name":"NAV_GROUPS","sourcePath":"ui_kits/console/ConsoleData.jsx"},{"name":"HOURS","sourcePath":"ui_kits/console/ConsoleData.jsx"},{"name":"LIVE_SESSIONS","sourcePath":"ui_kits/console/ConsoleData.jsx"},{"name":"RECENT_ERRORS","sourcePath":"ui_kits/console/ConsoleData.jsx"},{"name":"ACTIVITY","sourcePath":"ui_kits/console/ConsoleData.jsx"},{"name":"VERSIONS","sourcePath":"ui_kits/console/ConsoleData.jsx"},{"name":"COUNTRIES","sourcePath":"ui_kits/console/ConsoleData.jsx"},{"name":"ACCENT_PRESETS","sourcePath":"ui_kits/console/ConsoleData.jsx"},{"name":"SESSION_SPARK","sourcePath":"ui_kits/console/ConsoleData.jsx"},{"name":"ERROR_SPARK","sourcePath":"ui_kits/console/ConsoleData.jsx"},{"name":"ErrorsScreen","sourcePath":"ui_kits/console/ErrorsScreen.jsx"},{"name":"LiveScreen","sourcePath":"ui_kits/console/LiveScreen.jsx"},{"name":"OverviewScreen","sourcePath":"ui_kits/console/OverviewScreen.jsx"},{"name":"PlaceholderScreen","sourcePath":"ui_kits/console/OverviewScreen.jsx"},{"name":"SettingsScreen","sourcePath":"ui_kits/console/SettingsScreen.jsx"},{"name":"VersionsScreen","sourcePath":"ui_kits/console/VersionsScreen.jsx"}],"sourceHashes":{"components/charts/TrendChart.jsx":"dac48f21a4f8","components/controls/Button.jsx":"0bcc05c12f13","components/controls/Dropdown.jsx":"d985bee25301","components/controls/SearchInput.jsx":"a228a78d692a","components/controls/SegmentedControl.jsx":"1fd1341da905","components/icons/Icon.jsx":"94a0dba5d2e8","components/icons/iconPaths.js":"b32d3e35e5aa","components/indicators/Badge.jsx":"046877cca6aa","components/indicators/StatusBadge.jsx":"c90fa2231814","components/indicators/Tag.jsx":"7c47d6e069a0","components/metrics/KpiTile.jsx":"4accff055e58","components/metrics/RadialGauge.jsx":"065efc72c190","components/metrics/RankList.jsx":"259de531a896","components/metrics/Sparkline.jsx":"7b48fbb5fa75","components/panels/EmptyState.jsx":"e05efebaf552","components/panels/Modal.jsx":"d00a3beed79c","components/panels/Panel.jsx":"a5905af21270","components/shell/PageHeader.jsx":"c1cbc1d6bc03","components/shell/TopNav.jsx":"bc375a0d03b7","components/tables/DataTable.jsx":"a477efebdaa0","components/tables/Feed.jsx":"0816b95ab54f","components/tables/KvList.jsx":"4ef98a2f6ab7","ui_kits/console/ConsoleApp.jsx":"82438776542e","ui_kits/console/ConsoleData.jsx":"8754e801092f","ui_kits/console/ErrorsScreen.jsx":"2453c5839a2c","ui_kits/console/LiveScreen.jsx":"088be3b2c7e9","ui_kits/console/OverviewScreen.jsx":"47cea467fb89","ui_kits/console/SettingsScreen.jsx":"e616fea39598","ui_kits/console/VersionsScreen.jsx":"4b5013fac75d"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.RazorReaperConsoleDesignSystem_40e0a6 = window.RazorReaperConsoleDesignSystem_40e0a6 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/charts/TrendChart.jsx
try { (() => {
const {
  useEffect,
  useMemo,
  useRef,
  useState
} = React;
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
function TrendChart({
  data,
  height = 280,
  areas = [],
  bars = [],
  yTicks = 4,
  minTickGap = 56
}) {
  const uid = useMemo(() => `trend-${++trendUid}`, []);
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pad = {
    top: 14,
    right: 10,
    bottom: 22,
    left: 38
  };
  const iw = Math.max(40, width - pad.left - pad.right);
  const ih = Math.max(40, height - pad.top - pad.bottom);
  const n = data.length;
  const allKeys = [...areas, ...bars].map(s => s.key);
  const max = niceMax(Math.max(1, ...data.flatMap(d => allKeys.map(k => Number(d[k]) || 0))));
  const x = i => pad.left + (n <= 1 ? iw / 2 : i / (n - 1) * iw);
  const y = v => pad.top + ih - v / max * ih;
  const labelEvery = Math.max(1, Math.ceil(n * minTickGap / Math.max(1, iw)));
  const barW = Math.max(4, Math.min(18, iw / Math.max(1, n) * 0.4));
  const onMove = e => {
    const rect = wrapRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round((px - pad.left) / Math.max(1, iw) * (n - 1));
    if (i >= 0 && i < n) setHover(i);else setHover(null);
  };
  return /*#__PURE__*/React.createElement("div", {
    ref: wrapRef,
    style: {
      position: "relative",
      width: "100%"
    },
    onMouseMove: onMove,
    onMouseLeave: () => setHover(null)
  }, /*#__PURE__*/React.createElement("svg", {
    width: width,
    height: height,
    style: {
      display: "block"
    }
  }, /*#__PURE__*/React.createElement("defs", null, areas.map((s, si) => /*#__PURE__*/React.createElement("linearGradient", {
    key: s.key,
    id: `${uid}-fill-${si}`,
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: s.color,
    stopOpacity: 0.22
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: s.color,
    stopOpacity: 0.01
  })))), Array.from({
    length: yTicks + 1
  }, (_, t) => {
    const v = max / yTicks * t;
    return /*#__PURE__*/React.createElement("g", {
      key: t
    }, /*#__PURE__*/React.createElement("line", {
      x1: pad.left,
      x2: pad.left + iw,
      y1: y(v),
      y2: y(v),
      stroke: "var(--chart-grid)",
      strokeDasharray: "3 6"
    }), /*#__PURE__*/React.createElement("text", {
      x: pad.left - 8,
      y: y(v) + 3.5,
      textAnchor: "end",
      fontSize: "10.5",
      fill: "var(--chart-axis-soft)"
    }, v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v)));
  }), data.map((d, i) => i % labelEvery === 0 ? /*#__PURE__*/React.createElement("text", {
    key: i,
    x: x(i),
    y: height - 6,
    textAnchor: "middle",
    fontSize: "10.5",
    fill: "var(--chart-axis)"
  }, d.label) : null), bars.map(s => /*#__PURE__*/React.createElement("g", {
    key: s.key
  }, data.map((d, i) => {
    const v = Number(d[s.key]) || 0;
    if (v <= 0) return null;
    const h = Math.max(2, v / max * ih);
    return /*#__PURE__*/React.createElement("rect", {
      key: i,
      x: x(i) - barW / 2,
      y: pad.top + ih - h,
      width: barW,
      height: h,
      rx: Math.min(6, barW / 2),
      fill: s.color
    });
  }))), areas.map((s, si) => {
    const pts = data.map((d, i) => [x(i), y(Number(d[s.key]) || 0)]);
    const line = catmullRomPath(pts);
    const area = `${line}L${x(n - 1)},${pad.top + ih}L${x(0)},${pad.top + ih}Z`;
    return /*#__PURE__*/React.createElement("g", {
      key: s.key
    }, /*#__PURE__*/React.createElement("path", {
      d: area,
      fill: `url(#${uid}-fill-${si})`
    }), /*#__PURE__*/React.createElement("path", {
      d: line,
      fill: "none",
      stroke: s.color,
      strokeWidth: s.strokeWidth ?? 2.4,
      style: {
        filter: "drop-shadow(0 0 4px rgba(255,255,255,0.18))"
      }
    }));
  }), hover !== null ? /*#__PURE__*/React.createElement("g", null, /*#__PURE__*/React.createElement("line", {
    x1: x(hover),
    x2: x(hover),
    y1: pad.top,
    y2: pad.top + ih,
    stroke: "rgba(255,255,255,0.12)"
  }), areas.map(s => /*#__PURE__*/React.createElement("circle", {
    key: s.key,
    cx: x(hover),
    cy: y(Number(data[hover][s.key]) || 0),
    r: 4.5,
    fill: s.color,
    stroke: "rgba(0,0,0,0.3)",
    strokeWidth: 2,
    style: {
      filter: `drop-shadow(0 0 4px ${s.color})`
    }
  }))) : null), hover !== null ? /*#__PURE__*/React.createElement("div", {
    className: "chart-tip",
    style: {
      position: "absolute",
      left: Math.min(Math.max(0, x(hover) + 12), width - 150),
      top: 8
    }
  }, /*#__PURE__*/React.createElement("p", {
    className: "chart-tip-label"
  }, data[hover].label), [...areas, ...bars].map(s => /*#__PURE__*/React.createElement("div", {
    className: "chart-tip-row",
    key: s.key
  }, /*#__PURE__*/React.createElement("span", {
    className: "chart-tip-name"
  }, /*#__PURE__*/React.createElement("span", {
    className: "chart-tip-dot",
    style: {
      background: s.color
    }
  }), s.name), /*#__PURE__*/React.createElement("span", {
    className: "chart-tip-val"
  }, (Number(data[hover][s.key]) || 0).toLocaleString())))) : null);
}
Object.assign(__ds_scope, { TrendChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/TrendChart.jsx", error: String((e && e.message) || e) }); }

// components/controls/SegmentedControl.jsx
try { (() => {
/**
 * Segmented range control — the console's standard time-range switcher
 * (24 h / 7 d / 30 d / 90 d / All). Inset pill row, accent ring on active.
 */
function SegmentedControl({
  options,
  value,
  onChange,
  className = ""
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: `seg-control${className ? ` ${className}` : ""}`
  }, options.map(option => {
    const key = typeof option === "string" ? option : option.key;
    const label = typeof option === "string" ? option : option.label;
    return /*#__PURE__*/React.createElement("button", {
      key: key,
      type: "button",
      className: `seg-btn${value === key ? " active" : ""}`,
      onClick: () => onChange && onChange(key)
    }, label);
  }));
}
Object.assign(__ds_scope, { SegmentedControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/SegmentedControl.jsx", error: String((e && e.message) || e) }); }

// components/icons/iconPaths.js
try { (() => {
// Lucide icon geometry, copied verbatim from lucide-icons/lucide (ISC license).
// 24x24 viewBox, stroke="currentColor", stroke-width 2.
const ICON_PATHS = {
  "activity": "<path d=\"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2\"></path>",
  "arrow-down-right": "<path d=\"m7 7 10 10\"></path> <path d=\"M17 7v10H7\"></path>",
  "arrow-up-right": "<path d=\"M7 7h10v10\"></path> <path d=\"M7 17 17 7\"></path>",
  "bell": "<path d=\"M10.268 21a2 2 0 0 0 3.464 0\"></path> <path d=\"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326\"></path>",
  "calendar": "<path d=\"M8 2v4\"></path> <path d=\"M16 2v4\"></path> <rect width=\"18\" height=\"18\" x=\"3\" y=\"4\" rx=\"2\"></rect> <path d=\"M3 10h18\"></path>",
  "chart-no-axes-column": "<path d=\"M5 21v-6\"></path> <path d=\"M12 21V3\"></path> <path d=\"M19 21V9\"></path>",
  "check": "<path d=\"M20 6 9 17l-5-5\"></path>",
  "chevron-down": "<path d=\"m6 9 6 6 6-6\"></path>",
  "chevron-left": "<path d=\"m15 18-6-6 6-6\"></path>",
  "chevron-right": "<path d=\"m9 18 6-6-6-6\"></path>",
  "chevron-up": "<path d=\"m18 15-6-6-6 6\"></path>",
  "circle-check": "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle> <path d=\"m9 12 2 2 4-4\"></path>",
  "clock": "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle> <path d=\"M12 6v6l4 2\"></path>",
  "clock-3": "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle> <path d=\"M12 6v6h4\"></path>",
  "copy": "<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\"></rect> <path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\"></path>",
  "cpu": "<path d=\"M12 20v2\"></path> <path d=\"M12 2v2\"></path> <path d=\"M17 20v2\"></path> <path d=\"M17 2v2\"></path> <path d=\"M2 12h2\"></path> <path d=\"M2 17h2\"></path> <path d=\"M2 7h2\"></path> <path d=\"M20 12h2\"></path> <path d=\"M20 17h2\"></path> <path d=\"M20 7h2\"></path> <path d=\"M7 20v2\"></path> <path d=\"M7 2v2\"></path> <rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"2\"></rect> <rect x=\"8\" y=\"8\" width=\"8\" height=\"8\" rx=\"1\"></rect>",
  "database": "<ellipse cx=\"12\" cy=\"5\" rx=\"9\" ry=\"3\"></ellipse> <path d=\"M3 5V19A9 3 0 0 0 21 19V5\"></path> <path d=\"M3 12A9 3 0 0 0 21 12\"></path>",
  "download": "<path d=\"M12 15V3\"></path> <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\"></path> <path d=\"m7 10 5 5 5-5\"></path>",
  "earth": "<path d=\"M21.54 15H17a2 2 0 0 0-2 2v4.54\"></path> <path d=\"M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17\"></path> <path d=\"M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05\"></path> <circle cx=\"12\" cy=\"12\" r=\"10\"></circle>",
  "ellipsis": "<circle cx=\"12\" cy=\"12\" r=\"1\"></circle> <circle cx=\"19\" cy=\"12\" r=\"1\"></circle> <circle cx=\"5\" cy=\"12\" r=\"1\"></circle>",
  "external-link": "<path d=\"M15 3h6v6\"></path> <path d=\"M10 14 21 3\"></path> <path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\"></path>",
  "eye": "<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\"></path> <circle cx=\"12\" cy=\"12\" r=\"3\"></circle>",
  "funnel-x": "<path d=\"M12.531 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14v6a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341l.427-.473\"></path> <path d=\"m16.5 3.5 5 5\"></path> <path d=\"m21.5 3.5-5 5\"></path>",
  "gauge": "<path d=\"m12 14 4-4\"></path> <path d=\"M3.34 19a10 10 0 1 1 17.32 0\"></path>",
  "git-branch": "<path d=\"M15 6a9 9 0 0 0-9 9V3\"></path> <circle cx=\"18\" cy=\"6\" r=\"3\"></circle> <circle cx=\"6\" cy=\"18\" r=\"3\"></circle>",
  "globe": "<circle cx=\"12\" cy=\"12\" r=\"10\"></circle> <path d=\"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20\"></path> <path d=\"M2 12h20\"></path>",
  "hard-drive": "<path d=\"M10 16h.01\"></path> <path d=\"M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z\"></path> <path d=\"M21.946 12.013H2.054\"></path> <path d=\"M6 16h.01\"></path>",
  "history": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"></path> <path d=\"M3 3v5h5\"></path> <path d=\"M12 7v5l4 2\"></path>",
  "inbox": "<polyline points=\"22 12 16 12 14 15 10 15 8 12 2 12\"></polyline> <path d=\"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z\"></path>",
  "key-round": "<path d=\"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z\"></path> <circle cx=\"16.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"></circle>",
  "layers": "<path d=\"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z\"></path> <path d=\"M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12\"></path> <path d=\"M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17\"></path>",
  "list-filter": "<path d=\"M2 5h20\"></path> <path d=\"M6 12h12\"></path> <path d=\"M9 19h6\"></path>",
  "locate-fixed": "<line x1=\"2\" x2=\"5\" y1=\"12\" y2=\"12\"></line> <line x1=\"19\" x2=\"22\" y1=\"12\" y2=\"12\"></line> <line x1=\"12\" x2=\"12\" y1=\"2\" y2=\"5\"></line> <line x1=\"12\" x2=\"12\" y1=\"19\" y2=\"22\"></line> <circle cx=\"12\" cy=\"12\" r=\"7\"></circle> <circle cx=\"12\" cy=\"12\" r=\"3\"></circle>",
  "log-out": "<path d=\"m16 17 5-5-5-5\"></path> <path d=\"M21 12H9\"></path> <path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\"></path>",
  "map": "<path d=\"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z\"></path> <path d=\"M15 5.764v15\"></path> <path d=\"M9 3.236v15\"></path>",
  "map-pin": "<path d=\"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0\"></path> <circle cx=\"12\" cy=\"10\" r=\"3\"></circle>",
  "maximize-2": "<path d=\"M15 3h6v6\"></path> <path d=\"m21 3-7 7\"></path> <path d=\"m3 21 7-7\"></path> <path d=\"M9 21H3v-6\"></path>",
  "message-square": "<path d=\"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z\"></path>",
  "minus": "<path d=\"M5 12h14\"></path>",
  "monitor": "<rect width=\"20\" height=\"14\" x=\"2\" y=\"3\" rx=\"2\"></rect> <line x1=\"8\" x2=\"16\" y1=\"21\" y2=\"21\"></line> <line x1=\"12\" x2=\"12\" y1=\"17\" y2=\"21\"></line>",
  "package": "<path d=\"M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z\"></path> <path d=\"M12 22V12\"></path> <polyline points=\"3.29 7 12 12 20.71 7\"></polyline> <path d=\"m7.5 4.27 9 5.15\"></path>",
  "palette": "<path d=\"M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z\"></path> <circle cx=\"13.5\" cy=\"6.5\" r=\".5\" fill=\"currentColor\"></circle> <circle cx=\"17.5\" cy=\"10.5\" r=\".5\" fill=\"currentColor\"></circle> <circle cx=\"6.5\" cy=\"12.5\" r=\".5\" fill=\"currentColor\"></circle> <circle cx=\"8.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"></circle>",
  "plus": "<path d=\"M5 12h14\"></path> <path d=\"M12 5v14\"></path>",
  "radio": "<path d=\"M16.247 7.761a6 6 0 0 1 0 8.478\"></path> <path d=\"M19.075 4.933a10 10 0 0 1 0 14.134\"></path> <path d=\"M4.925 19.067a10 10 0 0 1 0-14.134\"></path> <path d=\"M7.753 16.239a6 6 0 0 1 0-8.478\"></path> <circle cx=\"12\" cy=\"12\" r=\"2\"></circle>",
  "refresh-cw": "<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\"></path> <path d=\"M21 3v5h-5\"></path> <path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\"></path> <path d=\"M8 16H3v5\"></path>",
  "rotate-ccw": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"></path> <path d=\"M3 3v5h5\"></path>",
  "search": "<path d=\"m21 21-4.34-4.34\"></path> <circle cx=\"11\" cy=\"11\" r=\"8\"></circle>",
  "server": "<rect width=\"20\" height=\"8\" x=\"2\" y=\"2\" rx=\"2\" ry=\"2\"></rect> <rect width=\"20\" height=\"8\" x=\"2\" y=\"14\" rx=\"2\" ry=\"2\"></rect> <line x1=\"6\" x2=\"6.01\" y1=\"6\" y2=\"6\"></line> <line x1=\"6\" x2=\"6.01\" y1=\"18\" y2=\"18\"></line>",
  "settings-2": "<path d=\"M14 17H5\"></path> <path d=\"M19 7h-9\"></path> <circle cx=\"17\" cy=\"17\" r=\"3\"></circle> <circle cx=\"7\" cy=\"7\" r=\"3\"></circle>",
  "shield-check": "<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\"></path> <path d=\"m9 12 2 2 4-4\"></path>",
  "sliders-horizontal": "<path d=\"M10 5H3\"></path> <path d=\"M12 19H3\"></path> <path d=\"M14 3v4\"></path> <path d=\"M16 17v4\"></path> <path d=\"M21 12h-9\"></path> <path d=\"M21 19h-5\"></path> <path d=\"M21 5h-7\"></path> <path d=\"M8 10v4\"></path> <path d=\"M8 12H3\"></path>",
  "terminal": "<path d=\"M12 19h8\"></path> <path d=\"m4 17 6-6-6-6\"></path>",
  "timer": "<line x1=\"10\" x2=\"14\" y1=\"2\" y2=\"2\"></line> <line x1=\"12\" x2=\"15\" y1=\"14\" y2=\"11\"></line> <circle cx=\"12\" cy=\"14\" r=\"8\"></circle>",
  "trending-up": "<path d=\"M16 7h6v6\"></path> <path d=\"m22 7-8.5 8.5-5-5L2 17\"></path>",
  "triangle-alert": "<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\"></path> <path d=\"M12 9v4\"></path> <path d=\"M12 17h.01\"></path>",
  "user": "<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\"></path> <circle cx=\"12\" cy=\"7\" r=\"4\"></circle>",
  "users": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"></path> <path d=\"M16 3.128a4 4 0 0 1 0 7.744\"></path> <path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"></path> <circle cx=\"9\" cy=\"7\" r=\"4\"></circle>",
  "wifi": "<path d=\"M12 20h.01\"></path> <path d=\"M2 8.82a15 15 0 0 1 20 0\"></path> <path d=\"M5 12.859a10 10 0 0 1 14 0\"></path> <path d=\"M8.5 16.429a5 5 0 0 1 7 0\"></path>",
  "x": "<path d=\"M18 6 6 18\"></path> <path d=\"m6 6 12 12\"></path>",
  "zap": "<path d=\"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z\"></path>"
};
Object.assign(__ds_scope, { ICON_PATHS });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/icons/iconPaths.js", error: String((e && e.message) || e) }); }

// components/icons/Icon.jsx
try { (() => {
/**
 * Lucide icon, inlined from the official SVG set (the console's icon system).
 * Renders stroke icons in currentColor — color via CSS `color` on a parent.
 */
function Icon({
  name,
  size = 16,
  strokeWidth = 2,
  className,
  style,
  title
}) {
  const inner = __ds_scope.ICON_PATHS[name];
  if (!inner) {
    console.warn(`[Icon] unknown icon "${name}" — see components/icons/iconPaths.js for the available set`);
    return null;
  }
  return /*#__PURE__*/React.createElement("svg", {
    className: className,
    style: style,
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": title ? undefined : true,
    role: title ? "img" : undefined,
    dangerouslySetInnerHTML: {
      __html: title ? `<title>${title}</title>${inner}` : inner
    }
  });
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/icons/Icon.jsx", error: String((e && e.message) || e) }); }

// components/controls/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const VARIANT_CLASS = {
  primary: "btn-primary",
  ghost: "btn-ghost",
  accent: "btn-accent-ghost",
  danger: "btn-danger"
};
const SIZE_CLASS = {
  md: "",
  sm: " btn-sm",
  xs: " btn-xs"
};

/** Console button. Ghost is the workhorse; primary is reserved for the one true action. */
function Button({
  variant = "ghost",
  size = "md",
  icon,
  children,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: `btn ${VARIANT_CLASS[variant] ?? VARIANT_CLASS.ghost}${SIZE_CLASS[size] ?? ""}${className ? ` ${className}` : ""}`
  }, rest), icon ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: size === "xs" ? 12 : 14
  }) : null, children);
}

/** Square icon-only button for table rows and panel chrome. */
function IconButton({
  icon,
  size = 14,
  className = "",
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    className: `btn-icon${className ? ` ${className}` : ""}`
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: size
  }));
}
Object.assign(__ds_scope, { Button, IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/Button.jsx", error: String((e && e.message) || e) }); }

// components/controls/Dropdown.jsx
try { (() => {
const {
  useEffect,
  useMemo,
  useRef,
  useState
} = React;
/**
 * Custom select replacement — native dropdowns can't be themed and look foreign
 * in the console. Trigger pill + anchored dark popover with type-to-filter.
 * NEVER use a native <select> in this design system.
 */
function Dropdown({
  placeholder,
  options,
  value,
  onChange,
  renderOption,
  searchThreshold = 8,
  align = "right"
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const label = option => renderOption ? renderOption(option) : option;
  const searchable = options.length > searchThreshold;
  const visibleOptions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return options;
    return options.filter(o => label(o).toLowerCase().includes(trimmed) || o.toLowerCase().includes(trimmed));
  }, [options, query, renderOption]);
  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    if (searchRef.current) searchRef.current.focus();
    const onPointerDown = event => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = event => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const select = next => {
    if (onChange) onChange(next);
    setOpen(false);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: `gdrop${value ? " gdrop-active" : ""}`,
    ref: rootRef
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "gdrop-trigger",
    onClick: () => setOpen(c => !c),
    "aria-expanded": open
  }, /*#__PURE__*/React.createElement("span", {
    className: "gdrop-trigger-label"
  }, value ? label(value) : placeholder), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 14,
    className: `gdrop-chevron${open ? " gdrop-chevron-open" : ""}`
  })), open ? /*#__PURE__*/React.createElement("div", {
    className: "gdrop-menu",
    role: "listbox",
    style: align === "left" ? {
      right: "auto",
      left: 0
    } : undefined
  }, searchable ? /*#__PURE__*/React.createElement("div", {
    className: "gdrop-search"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "search",
    size: 14
  }), /*#__PURE__*/React.createElement("input", {
    ref: searchRef,
    value: query,
    onChange: e => setQuery(e.target.value),
    placeholder: "Filter\u2026",
    spellCheck: false
  })) : null, /*#__PURE__*/React.createElement("div", {
    className: "gdrop-list"
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: `gdrop-item${value === null ? " gdrop-item-selected" : ""}`,
    onClick: () => select(null),
    role: "option",
    "aria-selected": value === null
  }, /*#__PURE__*/React.createElement("span", null, placeholder), value === null ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "check",
    size: 14
  }) : null), visibleOptions.map(option => /*#__PURE__*/React.createElement("button", {
    key: option,
    type: "button",
    className: `gdrop-item${value === option ? " gdrop-item-selected" : ""}`,
    onClick: () => select(option),
    role: "option",
    "aria-selected": value === option
  }, /*#__PURE__*/React.createElement("span", null, label(option)), value === option ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "check",
    size: 14
  }) : null)), visibleOptions.length === 0 ? /*#__PURE__*/React.createElement("p", {
    className: "gdrop-empty"
  }, "No matches.") : null)) : null);
}
Object.assign(__ds_scope, { Dropdown });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/Dropdown.jsx", error: String((e && e.message) || e) }); }

// components/controls/SearchInput.jsx
try { (() => {
/** Search field with leading icon — session/user directory filtering. */
function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  style,
  className = ""
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: `search-wrap${className ? ` ${className}` : ""}`,
    style: style
  }, /*#__PURE__*/React.createElement("span", {
    className: "search-icon"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "search",
    size: 14
  })), /*#__PURE__*/React.createElement("input", {
    className: "glass-input",
    value: value,
    onChange: e => onChange && onChange(e.target.value),
    placeholder: placeholder,
    spellCheck: false
  }));
}
Object.assign(__ds_scope, { SearchInput });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/controls/SearchInput.jsx", error: String((e && e.message) || e) }); }

// components/indicators/Badge.jsx
try { (() => {
const TONE_CLASS = {
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
  info: "badge-info",
  accent: "badge-accent",
  muted: "badge-muted"
};

/** Pill badge for counts and states. Fixed status colors — never accent-derived. */
function Badge({
  tone = "muted",
  children,
  title,
  className = ""
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `badge ${TONE_CLASS[tone] ?? TONE_CLASS.muted}${className ? ` ${className}` : ""}`,
    title: title
  }, children);
}

/** Green pulsing-dot pill — only for genuinely realtime things ("3 live"). */
function LiveBadge({
  children,
  title
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "badge-live",
    title: title
  }, children);
}
Object.assign(__ds_scope, { Badge, LiveBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/indicators/Badge.jsx", error: String((e && e.message) || e) }); }

// components/indicators/StatusBadge.jsx
try { (() => {
const PRESENCE_STYLES = {
  online: {
    tone: "badge badge-success",
    label: "Online",
    dot: "status-dot pulse"
  },
  idle: {
    tone: "badge badge-warning",
    label: "Idle",
    dot: "status-dot warn pulse-warn"
  },
  unreachable: {
    tone: "badge badge-danger",
    label: "Unreachable",
    dot: "status-dot err pulse-err"
  },
  ended: {
    tone: "badge badge-muted",
    label: "Ended",
    dot: "status-dot idle"
  }
};

/** Session presence badge with pulsing dot — Online / Idle / Unreachable / Ended. */
function StatusBadge({
  presence = "ended",
  showDot = true,
  label
}) {
  const style = PRESENCE_STYLES[presence] ?? PRESENCE_STYLES.ended;
  return /*#__PURE__*/React.createElement("span", {
    className: style.tone
  }, showDot ? /*#__PURE__*/React.createElement("span", {
    className: style.dot
  }) : null, label ?? style.label);
}
Object.assign(__ds_scope, { StatusBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/indicators/StatusBadge.jsx", error: String((e && e.message) || e) }); }

// components/indicators/Tag.jsx
try { (() => {
/** Small squared chip for config values in headers and kv rows. */
function Tag({
  accent = false,
  children,
  title
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `kv-tag${accent ? " kv-tag-accent" : ""}`,
    title: title
  }, children);
}

/** Loading spinner. */
function Spinner({
  small = false
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `spinner${small ? " spinner-sm" : ""}`,
    style: {
      display: "inline-block"
    }
  });
}
Object.assign(__ds_scope, { Tag, Spinner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/indicators/Tag.jsx", error: String((e && e.message) || e) }); }

// components/metrics/RadialGauge.jsx
try { (() => {
/** Donut gauge with the percentage in the center — accent stroke with soft glow. */
function RadialGauge({
  ratio,
  title,
  sub,
  size = 64
}) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return /*#__PURE__*/React.createElement("div", {
    className: "gauge"
  }, /*#__PURE__*/React.createElement("svg", {
    className: "gauge-svg",
    width: size,
    height: size,
    viewBox: `0 0 ${size} ${size}`
  }, /*#__PURE__*/React.createElement("circle", {
    className: "gauge-track",
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    strokeWidth: stroke
  }), /*#__PURE__*/React.createElement("circle", {
    className: "gauge-fill",
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeDasharray: c,
    strokeDashoffset: c * (1 - clamped),
    transform: `rotate(-90 ${size / 2} ${size / 2})`
  }), /*#__PURE__*/React.createElement("text", {
    className: "gauge-num",
    x: "50%",
    y: "50%",
    dominantBaseline: "central",
    textAnchor: "middle"
  }, Math.round(clamped * 100), "%")), /*#__PURE__*/React.createElement("div", {
    className: "gauge-meta"
  }, /*#__PURE__*/React.createElement("span", {
    className: "gauge-title"
  }, title), sub ? /*#__PURE__*/React.createElement("span", {
    className: "gauge-sub"
  }, sub) : null));
}
Object.assign(__ds_scope, { RadialGauge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/metrics/RadialGauge.jsx", error: String((e && e.message) || e) }); }

// components/metrics/RankList.jsx
try { (() => {
/** Ranked share bars — versions, countries, platforms. Accent-gradient fills grow in. */
function RankList({
  items
}) {
  if (!items || items.length === 0) {
    return /*#__PURE__*/React.createElement("p", {
      style: {
        padding: "10px 0",
        fontSize: "0.8125rem",
        color: "var(--text-2)",
        margin: 0
      }
    }, "No data.");
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "rank"
  }, items.map(item => /*#__PURE__*/React.createElement("div", {
    className: "rank-row",
    key: item.label
  }, /*#__PURE__*/React.createElement("span", {
    className: "rank-label",
    title: item.label
  }, item.label), /*#__PURE__*/React.createElement("span", {
    className: "rank-track"
  }, /*#__PURE__*/React.createElement("span", {
    className: "rank-fill",
    style: {
      width: `${Math.min(100, Math.max(2, Math.round(item.share * 100)))}%`
    }
  })), /*#__PURE__*/React.createElement("span", {
    className: "rank-value"
  }, item.value))));
}
Object.assign(__ds_scope, { RankList });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/metrics/RankList.jsx", error: String((e && e.message) || e) }); }

// components/metrics/Sparkline.jsx
try { (() => {
let sparkUid = 0;

/** Tiny inline area sparkline for KPI tiles. */
function Sparkline({
  values,
  width = 64,
  height = 26,
  color = "var(--accent)"
}) {
  const gid = React.useMemo(() => `spk-${++sparkUid}`, []);
  if (!values || values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(1, max - min);
  const step = width / (values.length - 1);
  const points = values.map((v, i) => [i * step, height - 2 - (v - min) / span * (height - 5)]);
  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const area = `${line}L${width},${height}L0,${height}Z`;
  return /*#__PURE__*/React.createElement("svg", {
    className: "tile-spark",
    width: width,
    height: height,
    viewBox: `0 0 ${width} ${height}`,
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: gid,
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: color,
    stopOpacity: 0.3
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: color,
    stopOpacity: 0
  }))), /*#__PURE__*/React.createElement("path", {
    d: area,
    fill: `url(#${gid})`
  }), /*#__PURE__*/React.createElement("path", {
    d: line,
    fill: "none",
    stroke: color,
    strokeWidth: 1.5,
    strokeLinecap: "round"
  }));
}
Object.assign(__ds_scope, { Sparkline });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/metrics/Sparkline.jsx", error: String((e && e.message) || e) }); }

// components/panels/EmptyState.jsx
try { (() => {
/**
 * Empty states. Default: neutral icon well + title + line.
 * `allClear` variant: glowing green ring — good news is shown proudly.
 */
function EmptyState({
  allClear = false,
  icon = "inbox",
  title,
  children
}) {
  if (allClear) {
    return /*#__PURE__*/React.createElement("div", {
      className: "empty-state",
      style: {
        padding: "26px 16px 28px"
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "empty-ring"
    }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "check",
      size: 18,
      strokeWidth: 2.4
    })), /*#__PURE__*/React.createElement("p", {
      className: "empty-title"
    }, title ?? "All clear"), children ? /*#__PURE__*/React.createElement("p", {
      style: {
        fontSize: "0.71875rem",
        color: "var(--text-3)",
        maxWidth: 240,
        margin: "4px auto 0",
        lineHeight: 1.5
      }
    }, children) : null);
  }
  return /*#__PURE__*/React.createElement("div", {
    className: "empty-state"
  }, /*#__PURE__*/React.createElement("div", {
    className: "empty-state-icon"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 20
  })), title ? /*#__PURE__*/React.createElement("strong", null, title) : null, children ? /*#__PURE__*/React.createElement("p", null, children) : null);
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/panels/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/panels/Modal.jsx
try { (() => {
const {
  useEffect
} = React;
/**
 * Drill-down modal — opaque dark floating surface over a blurred scrim.
 * Used by KPI tiles and any detail view. Escape / scrim click closes.
 */
function Modal({
  open,
  onClose,
  kicker,
  title,
  sub,
  children
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = event => {
      if (event.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "kpi-overlay",
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-modal",
    onClick: event => event.stopPropagation()
  }, /*#__PURE__*/React.createElement("div", {
    className: "kpi-modal-head"
  }, /*#__PURE__*/React.createElement("div", null, kicker ? /*#__PURE__*/React.createElement("p", {
    className: "kicker"
  }, kicker) : null, title ? /*#__PURE__*/React.createElement("h2", {
    className: "section-title"
  }, title) : null, sub ? /*#__PURE__*/React.createElement("p", {
    className: "section-sub"
  }, sub) : null), /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "x",
    title: "Close",
    onClick: onClose
  })), children));
}

/** Timespan comparison grid for drill-downs (Today / 7 d / 30 d / Lifetime). */
function TimespanGrid({
  spans
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "kpi-timespan-grid"
  }, spans.map(span => /*#__PURE__*/React.createElement("div", {
    className: "kpi-timespan-cell",
    key: span.label
  }, /*#__PURE__*/React.createElement("span", {
    className: "kpi-timespan-label"
  }, span.label), /*#__PURE__*/React.createElement("strong", {
    className: "kpi-timespan-value"
  }, span.value), span.hint ? /*#__PURE__*/React.createElement("span", {
    className: "kpi-timespan-hint"
  }, span.hint) : null)));
}

/** Ranked breakdown rows with share bars for drill-downs. */
function BreakdownList({
  title,
  rows
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "kpi-breakdown"
  }, title ? /*#__PURE__*/React.createElement("p", {
    className: "kicker"
  }, title) : null, rows.map(row => /*#__PURE__*/React.createElement("div", {
    className: "kpi-breakdown-row",
    key: row.label
  }, /*#__PURE__*/React.createElement("span", {
    className: "kpi-breakdown-label"
  }, row.label), typeof row.share === "number" ? /*#__PURE__*/React.createElement("span", {
    className: "kpi-breakdown-track"
  }, /*#__PURE__*/React.createElement("span", {
    className: "kpi-breakdown-fill",
    style: {
      width: `${Math.min(100, Math.max(2, Math.round(row.share * 100)))}%`
    }
  })) : null, /*#__PURE__*/React.createElement("strong", {
    className: "kpi-breakdown-value"
  }, row.value))));
}
Object.assign(__ds_scope, { Modal, TimespanGrid, BreakdownList });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/panels/Modal.jsx", error: String((e && e.message) || e) }); }

// components/metrics/KpiTile.jsx
try { (() => {
const {
  useState
} = React;
const TONE_CLASS = {
  primary: "",
  success: " tone-success",
  warning: " tone-warning",
  danger: " tone-danger"
};

/**
 * KPI stat tile: label / display value / one-line sub on the left,
 * sparkline or icon well on the right, accent tick on the left edge.
 * Pass `drilldown` to make it clickable with a detail modal.
 */
function KpiTile({
  label,
  value,
  sub,
  icon = "activity",
  tone = "primary",
  delta,
  spark,
  sparkColor,
  drilldown
}) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(drilldown && ((drilldown.timespans?.length ?? 0) > 0 || (drilldown.breakdown?.length ?? 0) > 0 || drilldown.note));
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("article", {
    className: `stat-card${TONE_CLASS[tone] ?? ""}${expandable ? " kpi-card-clickable" : ""}`,
    onClick: expandable ? () => setOpen(true) : undefined,
    role: expandable ? "button" : undefined,
    tabIndex: expandable ? 0 : undefined,
    onKeyDown: expandable ? event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setOpen(true);
      }
    } : undefined
  }, /*#__PURE__*/React.createElement("div", {
    className: "tile-main"
  }, /*#__PURE__*/React.createElement("span", {
    className: "stat-label"
  }, label), /*#__PURE__*/React.createElement("strong", {
    className: "stat-value tile-value-pop",
    key: String(value)
  }, value, delta !== undefined && delta !== null ? /*#__PURE__*/React.createElement("span", {
    className: `stat-card-delta ${Number(delta) >= 0 ? "stat-card-delta-positive" : "stat-card-delta-negative"}`
  }, Number(delta) >= 0 ? "+" : "", delta, "%") : null), /*#__PURE__*/React.createElement("p", {
    className: "stat-sub"
  }, sub, expandable ? /*#__PURE__*/React.createElement("span", {
    className: "kpi-card-chevron"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-right",
    size: 12
  })) : null)), /*#__PURE__*/React.createElement("div", {
    className: "tile-side"
  }, spark && spark.length > 1 ? /*#__PURE__*/React.createElement(__ds_scope.Sparkline, {
    values: spark,
    color: sparkColor ?? "var(--accent)"
  }) : /*#__PURE__*/React.createElement("span", {
    className: "tile-icon"
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 14
  })))), expandable ? /*#__PURE__*/React.createElement(__ds_scope.Modal, {
    open: open,
    onClose: () => setOpen(false),
    kicker: label,
    title: String(value),
    sub: sub
  }, drilldown.timespans && drilldown.timespans.length > 0 ? /*#__PURE__*/React.createElement(__ds_scope.TimespanGrid, {
    spans: drilldown.timespans
  }) : null, drilldown.breakdown && drilldown.breakdown.length > 0 ? /*#__PURE__*/React.createElement(__ds_scope.BreakdownList, {
    title: drilldown.breakdownTitle,
    rows: drilldown.breakdown
  }) : null, drilldown.note ? /*#__PURE__*/React.createElement("p", {
    className: "kpi-modal-note"
  }, drilldown.note) : null) : null);
}
Object.assign(__ds_scope, { KpiTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/metrics/KpiTile.jsx", error: String((e && e.message) || e) }); }

// components/panels/Panel.jsx
try { (() => {
const {
  useState
} = React;
/**
 * Core surface: flat panel with hairline border, kicker + section title head.
 * Optional collapse (animated grid-rows technique) and header-right slot.
 */
function Panel({
  kicker,
  title,
  sub,
  right,
  collapsible = false,
  defaultCollapsed = false,
  padding = "body",
  children,
  style,
  className = ""
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const hasHead = kicker || title || sub || right || collapsible;
  const bodyClass = padding === "flush" ? "panel-body-flush" : padding === "tight" ? "panel-body-tight" : "panel-body";
  const body = /*#__PURE__*/React.createElement("div", {
    className: bodyClass
  }, children);
  return /*#__PURE__*/React.createElement("section", {
    className: `panel${collapsed ? " panel-collapsed" : ""}${className ? ` ${className}` : ""}`,
    style: style
  }, hasHead ? /*#__PURE__*/React.createElement("div", {
    className: `panel-head${collapsible ? " panel-head-clickable" : ""}`,
    onClick: collapsible ? () => setCollapsed(c => !c) : undefined
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel-head-left"
  }, kicker ? /*#__PURE__*/React.createElement("p", {
    className: "kicker"
  }, kicker) : null, title ? /*#__PURE__*/React.createElement("h2", {
    className: "section-title"
  }, title) : null, sub ? /*#__PURE__*/React.createElement("p", {
    className: "section-sub"
  }, sub) : null), /*#__PURE__*/React.createElement("div", {
    className: "panel-head-right"
  }, right, collapsible ? /*#__PURE__*/React.createElement("span", {
    className: `panel-collapse-chevron${collapsed ? " panel-collapse-chevron-closed" : ""}`
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 15
  })) : null)) : null, collapsible ? /*#__PURE__*/React.createElement("div", {
    className: "panel-body-clip"
  }, /*#__PURE__*/React.createElement("div", {
    className: "panel-body-inner"
  }, body)) : body);
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/panels/Panel.jsx", error: String((e && e.message) || e) }); }

// components/shell/PageHeader.jsx
try { (() => {
/**
 * Compact command-bar page header: kicker over title on the left,
 * filters/meta on the right. One per page, above the first panel row.
 */
function PageHeader({
  kicker,
  title,
  right
}) {
  return /*#__PURE__*/React.createElement("section", {
    className: "page-header"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    className: "page-title"
  }, kicker ? /*#__PURE__*/React.createElement("span", {
    className: "kicker"
  }, kicker) : null, title)), right ? /*#__PURE__*/React.createElement("div", {
    className: "page-header-right"
  }, right) : null);
}

/** Right-aligned label/value stat pairs for page or panel headers. */
function MetaRow({
  items
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "meta-row"
  }, items.map(m => /*#__PURE__*/React.createElement("div", {
    className: "meta-item",
    key: m.label
  }, /*#__PURE__*/React.createElement("span", null, m.label), /*#__PURE__*/React.createElement("strong", null, m.value))));
}
Object.assign(__ds_scope, { PageHeader, MetaRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/shell/PageHeader.jsx", error: String((e && e.message) || e) }); }

// components/shell/TopNav.jsx
try { (() => {
/**
 * TopNav — frosted glass top navbar shell. Brand block left, horizontal
 * nav with a glowing accent tick on the navbar's bottom edge, live-status
 * + meta + actions cluster right. Sticky; content scrolls beneath it.
 */
function TopNav({
  logoSrc,
  brand = "RazorReaper",
  brandSub = "Operations Console",
  items,
  active,
  onNavigate,
  live = true,
  liveLabel,
  meta,
  actions
}) {
  return /*#__PURE__*/React.createElement("header", {
    className: "topnav"
  }, /*#__PURE__*/React.createElement("div", {
    className: "tn-brand"
  }, logoSrc ? /*#__PURE__*/React.createElement("img", {
    src: logoSrc,
    alt: `${brand} logo`,
    className: "tn-brand-img"
  }) : /*#__PURE__*/React.createElement("span", {
    className: "tn-brand-img",
    style: {
      display: "grid",
      placeItems: "center",
      color: "var(--accent)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "zap",
    size: 15
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "tn-brand-name"
  }, brand), brandSub ? /*#__PURE__*/React.createElement("span", {
    className: "tn-brand-sub"
  }, brandSub) : null)), /*#__PURE__*/React.createElement("nav", {
    className: "tn-nav",
    "aria-label": "Primary"
  }, items.map(item => /*#__PURE__*/React.createElement("button", {
    key: item.key,
    type: "button",
    className: `tn-item${active === item.key ? " active" : ""}`,
    onClick: () => onNavigate && onNavigate(item.key)
  }, item.icon ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: item.icon,
    size: 16
  }) : null, /*#__PURE__*/React.createElement("span", null, item.label)))), /*#__PURE__*/React.createElement("div", {
    className: "tn-right"
  }, /*#__PURE__*/React.createElement("div", {
    className: `tn-live${live ? "" : " offline"}`
  }, /*#__PURE__*/React.createElement("span", {
    className: "tn-live-dot"
  }), liveLabel ?? (live ? "Ingest online" : "Ingest offline")), meta ? /*#__PURE__*/React.createElement("div", {
    className: "tn-meta"
  }, meta) : null, actions ? /*#__PURE__*/React.createElement("div", {
    className: "tn-actions"
  }, actions) : null));
}
Object.assign(__ds_scope, { TopNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/shell/TopNav.jsx", error: String((e && e.message) || e) }); }

// components/tables/DataTable.jsx
try { (() => {
/**
 * Console data table — uppercase hairline header, row hover, optional
 * expandable rows. Pure presentation; pass renderers per column.
 */
function DataTable({
  columns,
  rows,
  rowKey,
  expandedKey = null,
  renderExpanded,
  flush = false
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "data-table-wrap",
    style: flush ? {
      borderRadius: 0,
      border: "none"
    } : undefined
  }, /*#__PURE__*/React.createElement("table", {
    className: "data-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, columns.map(col => /*#__PURE__*/React.createElement("th", {
    key: col.key,
    style: col.width ? {
      width: col.width
    } : undefined
  }, col.header)))), /*#__PURE__*/React.createElement("tbody", null, rows.map((row, i) => {
    const key = rowKey ? rowKey(row, i) : i;
    const expanded = expandedKey !== null && expandedKey === key;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: key
    }, /*#__PURE__*/React.createElement("tr", {
      className: expanded ? "row-expanded" : ""
    }, columns.map(col => /*#__PURE__*/React.createElement("td", {
      key: col.key,
      className: [col.mono ? "mono" : "", col.muted ? "muted" : ""].join(" ").trim() || undefined
    }, col.render ? col.render(row, i) : row[col.key]))), expanded && renderExpanded ? /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
      colSpan: columns.length,
      className: "row-expand-panel"
    }, /*#__PURE__*/React.createElement("div", {
      className: "row-expand-inner"
    }, renderExpanded(row, i)))) : null);
  }))));
}

/** Labeled mono-value cells for expanded row detail grids. */
function DetailGrid({
  items
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
      gap: 10
    }
  }, items.map(({
    k,
    v
  }) => /*#__PURE__*/React.createElement("div", {
    key: k,
    className: "glass-inset",
    style: {
      padding: "8px 12px"
    }
  }, /*#__PURE__*/React.createElement("p", {
    className: "label-sm",
    style: {
      marginBottom: 3
    }
  }, k), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "0.75rem",
      color: "var(--text-1)",
      wordBreak: "break-all",
      margin: 0
    }
  }, v))));
}
Object.assign(__ds_scope, { DataTable, DetailGrid });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/tables/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/tables/Feed.jsx
try { (() => {
const DOT_CLASS = {
  ok: " ok",
  bad: " bad",
  accent: " accent",
  neutral: ""
};

/** Activity/error feed — threaded timeline rows with status dots and mono timestamps. */
function Feed({
  items
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "feed"
  }, items.map((item, i) => /*#__PURE__*/React.createElement("div", {
    className: "feed-row",
    key: item.id ?? i
  }, /*#__PURE__*/React.createElement("span", {
    className: `feed-dot${DOT_CLASS[item.tone ?? "neutral"]}`
  }), /*#__PURE__*/React.createElement("div", {
    className: "feed-body"
  }, /*#__PURE__*/React.createElement("p", {
    className: "feed-title"
  }, item.title), item.meta ? /*#__PURE__*/React.createElement("p", {
    className: "feed-meta"
  }, item.meta) : null), item.time ? /*#__PURE__*/React.createElement("span", {
    className: "feed-time"
  }, item.time) : null)));
}
Object.assign(__ds_scope, { Feed });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/tables/Feed.jsx", error: String((e && e.message) || e) }); }

// components/tables/KvList.jsx
try { (() => {
/** Key-value rows — system context, account identity, backend status. */
function KvList({
  items
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "kv-list"
  }, items.map(item => /*#__PURE__*/React.createElement("div", {
    className: "kv-row",
    key: item.k
  }, /*#__PURE__*/React.createElement("span", {
    className: "kv-key"
  }, item.k), item.tag ? /*#__PURE__*/React.createElement(__ds_scope.Tag, {
    accent: item.tag === "accent"
  }, item.v) : /*#__PURE__*/React.createElement("span", {
    className: "kv-val"
  }, item.v))));
}
Object.assign(__ds_scope, { KvList });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/tables/KvList.jsx", error: String((e && e.message) || e) }); }

// ui_kits/console/ConsoleData.jsx
try { (() => {
// Fake telemetry for the console UI kit — plausible, ~220-user scale.
// (Compiled into the bundle; screens import from here.)

const NAV_GROUPS = [{
  label: "Monitor",
  items: [{
    key: "overview",
    label: "Overview",
    icon: "chart-no-axes-column"
  }, {
    key: "traffic",
    label: "Traffic",
    icon: "clock-3"
  }, {
    key: "versions",
    label: "Versions",
    icon: "layers"
  }, {
    key: "heatmap",
    label: "Heatmap",
    icon: "map"
  }]
}, {
  label: "Operations",
  items: [{
    key: "live",
    label: "Live",
    icon: "radio"
  }, {
    key: "sessions",
    label: "Sessions",
    icon: "history"
  }, {
    key: "errors",
    label: "Errors",
    icon: "triangle-alert"
  }, {
    key: "settings",
    label: "Settings",
    icon: "settings-2"
  }]
}];
const HOURS = Array.from({
  length: 24
}, (_, i) => {
  const wave = 4 + 5 * Math.sin((i - 4) / 3.2);
  const users = Math.max(0, Math.round(wave + (i % 5 === 0 ? 2 : 0)));
  return {
    label: `${String(i).padStart(2, "0")}:00`,
    users,
    started: i % 3 === 0 ? Math.max(1, Math.round(users / 3)) : i % 2,
    errors: i === 9 ? 2 : i === 17 ? 1 : 0
  };
});
const LIVE_SESSIONS = [{
  id: "s_9f2e81c4",
  user: "wraith",
  discord: "wraith#2041",
  rpc: true,
  location: "Berlin, BE, Germany",
  version: "1.6.2",
  platform: "Windows 11",
  duration: "42m 18s",
  lastEvent: "Dino scan",
  presence: "online",
  started: "2026-06-10 13:02",
  timezone: "Europe/Berlin",
  ip: "84.•••.•••.12",
  events: 214,
  errors: 0
}, {
  id: "s_77ab03d9",
  user: "kestrel",
  discord: "kestrel",
  rpc: true,
  location: "Austin, TX, United States",
  version: "1.6.2",
  platform: "Windows 11",
  duration: "1h 12m",
  lastEvent: "Map overlay",
  presence: "online",
  started: "2026-06-10 12:31",
  timezone: "America/Chicago",
  ip: "97.•••.•••.88",
  events: 451,
  errors: 1
}, {
  id: "s_c41d22f0",
  user: "9A4F-D201",
  discord: "",
  rpc: false,
  location: "São Paulo, SP, Brazil",
  version: "1.5.3",
  platform: "Windows 10",
  duration: "open",
  lastEvent: "Session start",
  presence: "idle",
  started: "2026-06-10 13:39",
  timezone: "America/Sao_Paulo",
  ip: "186.•••.•••.4",
  events: 12,
  errors: 0
}];
const RECENT_ERRORS = [{
  id: "e1",
  title: "NullReferenceException",
  meta: "overlay_renderer · Object reference not set to an instance",
  time: "2m",
  tone: "bad"
}, {
  id: "e2",
  title: "TimeoutException",
  meta: "ark_rcon_client · Handshake exceeded 5000ms",
  time: "41m",
  tone: "bad"
}, {
  id: "e3",
  title: "JsonReaderException",
  meta: "config_loader · Unexpected token at line 14",
  time: "3h",
  tone: "bad"
}];
const ACTIVITY = [{
  id: "a1",
  title: "Session started",
  meta: "wraith#2041 · 1.6.2 · Germany",
  time: "9m",
  tone: "ok"
}, {
  id: "a2",
  title: "NullReferenceException",
  meta: "overlay_renderer · kestrel",
  time: "2m",
  tone: "bad"
}, {
  id: "a3",
  title: "Version 1.6.2 released",
  meta: "44% adoption in 48h",
  time: "2d",
  tone: "accent"
}, {
  id: "a4",
  title: "Session ended",
  meta: "9A4F-77F0 · 28m 02s",
  time: "16m",
  tone: "neutral"
}];
const VERSIONS = [{
  label: "1.6.2",
  users: 144,
  share: 1
}, {
  label: "1.6.1",
  users: 38,
  share: 0.26
}, {
  label: "1.6.0",
  users: 14,
  share: 0.1
}, {
  label: "1.5.3",
  users: 21,
  share: 0.15
}, {
  label: "Legacy (pre-1.4)",
  users: 12,
  share: 0.08
}];
const COUNTRIES = [{
  label: "Germany",
  users: 64,
  share: 1
}, {
  label: "United States",
  users: 51,
  share: 0.8
}, {
  label: "Brazil",
  users: 27,
  share: 0.42
}, {
  label: "Poland",
  users: 19,
  share: 0.3
}, {
  label: "Australia",
  users: 14,
  share: 0.22
}];
const ACCENT_PRESETS = [{
  label: "Pink",
  hue: 335
}, {
  label: "Purple",
  hue: 262
}, {
  label: "Blue",
  hue: 221
}, {
  label: "Cyan",
  hue: 186
}, {
  label: "Teal",
  hue: 160
}, {
  label: "Green",
  hue: 142
}, {
  label: "Orange",
  hue: 25
}, {
  label: "Red",
  hue: 4
}, {
  label: "Indigo",
  hue: 240
}, {
  label: "Gold",
  hue: 45
}];
const SESSION_SPARK = [4, 7, 5, 9, 8, 12, 10, 14, 11, 16, 13, 18];
const ERROR_SPARK = [0, 1, 0, 0, 2, 1, 0, 3, 1, 0, 1, 0];
Object.assign(__ds_scope, { NAV_GROUPS, HOURS, LIVE_SESSIONS, RECENT_ERRORS, ACTIVITY, VERSIONS, COUNTRIES, ACCENT_PRESETS, SESSION_SPARK, ERROR_SPARK });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/console/ConsoleData.jsx", error: String((e && e.message) || e) }); }

// ui_kits/console/ErrorsScreen.jsx
try { (() => {
const ERROR_ROWS = [{
  id: "g1",
  type: "NullReferenceException",
  msg: "Object reference not set to an instance of an object",
  source: "overlay_renderer",
  count: 4,
  last: "2m ago"
}, {
  id: "g2",
  type: "TimeoutException",
  msg: "RCON handshake exceeded 5000ms",
  source: "ark_rcon_client",
  count: 2,
  last: "41m ago"
}, {
  id: "g3",
  type: "JsonReaderException",
  msg: "Unexpected token at line 14, position 9",
  source: "config_loader",
  count: 1,
  last: "3h ago"
}];

/** Errors — recent real application failures only, grouped by exception type. */
function ErrorsScreen() {
  const [range, setRange] = React.useState("today");
  const [source, setSource] = React.useState(null);
  const [cleared, setCleared] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    className: "page-content page-stack-lg"
  }, /*#__PURE__*/React.createElement(__ds_scope.PageHeader, {
    kicker: "Failures",
    title: "Errors",
    right: /*#__PURE__*/React.createElement("div", {
      className: "filter-bar-right"
    }, /*#__PURE__*/React.createElement(__ds_scope.SegmentedControl, {
      options: [{
        key: "today",
        label: "24 h"
      }, {
        key: "7d",
        label: "7 d"
      }, {
        key: "30d",
        label: "30 d"
      }, {
        key: "all",
        label: "All"
      }],
      value: range,
      onChange: setRange
    }), /*#__PURE__*/React.createElement(__ds_scope.Dropdown, {
      placeholder: "All sources",
      options: ["overlay_renderer", "ark_rcon_client", "config_loader"],
      value: source,
      onChange: setSource
    }))
  }), /*#__PURE__*/React.createElement("div", {
    className: "stat-grid stat-grid-4 v2-stagger"
  }, /*#__PURE__*/React.createElement(__ds_scope.KpiTile, {
    label: "Errors In Range",
    value: "7",
    sub: "Across 3 exception types",
    tone: "danger",
    spark: __ds_scope.ERROR_SPARK,
    sparkColor: "var(--chart-errors)"
  }), /*#__PURE__*/React.createElement(__ds_scope.KpiTile, {
    label: "Affected Users",
    value: "2",
    sub: "Of 3 active in range",
    icon: "users"
  }), /*#__PURE__*/React.createElement(__ds_scope.KpiTile, {
    label: "Top Source",
    value: "overlay_renderer",
    sub: "4 of 7 errors",
    icon: "terminal"
  }), /*#__PURE__*/React.createElement(__ds_scope.KpiTile, {
    label: "Last Failure",
    value: "2m ago",
    sub: "NullReferenceException",
    tone: "warning",
    icon: "activity"
  })), /*#__PURE__*/React.createElement(__ds_scope.Panel, {
    kicker: "Grouped",
    title: "Recent Failures",
    sub: "Real application failures only \u2014 heartbeats and noise are filtered at ingest.",
    padding: "flush",
    right: /*#__PURE__*/React.createElement(__ds_scope.Button, {
      size: "sm",
      icon: "rotate-ccw",
      onClick: () => setCleared(!cleared)
    }, cleared ? "Restore" : "Clear list")
  }, cleared ? /*#__PURE__*/React.createElement(__ds_scope.EmptyState, {
    allClear: true
  }, "No failures in the selected range. New errors surface here within seconds of ingest.") : /*#__PURE__*/React.createElement(__ds_scope.DataTable, {
    flush: true,
    columns: [{
      key: "type",
      header: "Exception",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: "0.8125rem"
        }
      }, r.type)
    }, {
      key: "msg",
      header: "Message",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          color: "var(--text-2)",
          fontSize: "0.8125rem"
        }
      }, r.msg)
    }, {
      key: "source",
      header: "Source",
      mono: true,
      muted: true
    }, {
      key: "count",
      header: "Count",
      render: r => /*#__PURE__*/React.createElement(__ds_scope.Badge, {
        tone: "warning"
      }, r.count, "\xD7")
    }, {
      key: "last",
      header: "Last Seen",
      muted: true
    }],
    rows: ERROR_ROWS,
    rowKey: r => r.id
  })));
}
Object.assign(__ds_scope, { ErrorsScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/console/ErrorsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/console/LiveScreen.jsx
try { (() => {
/** Live — only genuinely active sessions (last 6 minutes), stable sort. */
function LiveScreen() {
  const [openId, setOpenId] = React.useState(null);
  return /*#__PURE__*/React.createElement("div", {
    className: "page-content page-stack-lg"
  }, /*#__PURE__*/React.createElement(__ds_scope.PageHeader, {
    kicker: "Realtime",
    title: "Live Sessions",
    right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(__ds_scope.LiveBadge, null, __ds_scope.LIVE_SESSIONS.length, " live"), /*#__PURE__*/React.createElement(__ds_scope.Badge, {
      tone: "accent",
      title: "2 active sessions report Discord Rich Presence on"
    }, "Discord RPC \xB7 2"), /*#__PURE__*/React.createElement(__ds_scope.MetaRow, {
      items: [{
        label: "Live Errors",
        value: "1"
      }, {
        label: "Last Ingest",
        value: "2m ago"
      }, {
        label: "Updated",
        value: "8s ago"
      }]
    }))
  }), /*#__PURE__*/React.createElement(__ds_scope.Panel, {
    kicker: "Active",
    title: "Open Sessions",
    sub: "Showing sessions active within the last 6 minutes.",
    padding: "flush",
    right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(__ds_scope.LiveBadge, null, __ds_scope.LIVE_SESSIONS.length), /*#__PURE__*/React.createElement(__ds_scope.Badge, {
      tone: "danger"
    }, "1 errors"))
  }, /*#__PURE__*/React.createElement(__ds_scope.DataTable, {
    flush: true,
    columns: [{
      key: "user",
      header: "User",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 6
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-display)",
          fontWeight: 600,
          fontSize: "0.8125rem"
        }
      }, r.user), r.discord ? /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: "0.6875rem",
          color: "var(--text-2)"
        },
        title: `Discord: ${r.discord}`
      }, "@", r.discord) : null, r.rpc ? /*#__PURE__*/React.createElement(__ds_scope.Badge, {
        tone: "accent",
        title: "Discord Rich Presence on"
      }, "RPC") : null)
    }, {
      key: "location",
      header: "Location",
      muted: true
    }, {
      key: "version",
      header: "Version",
      render: r => /*#__PURE__*/React.createElement(__ds_scope.Badge, {
        tone: "muted"
      }, r.version)
    }, {
      key: "platform",
      header: "Platform",
      muted: true
    }, {
      key: "duration",
      header: "Duration",
      muted: true
    }, {
      key: "lastEvent",
      header: "Last Event",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: "0.75rem",
          color: "var(--text-2)"
        }
      }, r.lastEvent)
    }, {
      key: "status",
      header: "Status",
      render: r => /*#__PURE__*/React.createElement(__ds_scope.StatusBadge, {
        presence: r.presence
      })
    }, {
      key: "actions",
      header: "",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          display: "inline-flex",
          gap: 4
        }
      }, /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
        icon: "globe",
        title: "View on map"
      }), /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
        icon: openId === r.id ? "chevron-up" : "chevron-down",
        title: openId === r.id ? "Collapse" : "Expand",
        onClick: () => setOpenId(openId === r.id ? null : r.id)
      }))
    }],
    rows: __ds_scope.LIVE_SESSIONS,
    rowKey: r => r.id,
    expandedKey: openId,
    renderExpanded: r => /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
      className: "label-sm",
      style: {
        marginBottom: 8
      }
    }, "Session Timeline"), /*#__PURE__*/React.createElement("div", {
      className: "timeline-track",
      style: {
        marginBottom: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "timeline-fill",
      style: {
        width: "100%"
      }
    }), r.errors > 0 ? /*#__PURE__*/React.createElement("div", {
      className: "timeline-marker is-error",
      style: {
        left: "62%"
      },
      title: "NullReferenceException at 13:18"
    }) : null), /*#__PURE__*/React.createElement(__ds_scope.DetailGrid, {
      items: [{
        k: "Install ID",
        v: `install:${r.id.slice(2, 6)}-91bb`
      }, {
        k: "Session ID",
        v: r.id
      }, {
        k: "Client IP",
        v: r.ip
      }, {
        k: "Started",
        v: r.started
      }, {
        k: "Events",
        v: String(r.events)
      }, {
        k: "Error Count",
        v: String(r.errors)
      }, {
        k: "Discord RPC",
        v: r.rpc ? "On" : "Off"
      }, {
        k: "Discord User",
        v: r.discord || "—"
      }, {
        k: "Timezone",
        v: r.timezone
      }, {
        k: "Geo Source",
        v: "IP (precise)"
      }]
    }))
  })));
}
Object.assign(__ds_scope, { LiveScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/console/LiveScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/console/OverviewScreen.jsx
try { (() => {
/** Overview — summary-only: KPI row, traffic chart, system context + recent errors. */
function OverviewScreen() {
  const [range, setRange] = React.useState("today");
  const [version, setVersion] = React.useState(null);
  const [win, setWin] = React.useState("24h");
  return /*#__PURE__*/React.createElement("div", {
    className: "page-content page-stack-lg"
  }, /*#__PURE__*/React.createElement(__ds_scope.PageHeader, {
    kicker: "Production Operations",
    title: "Overview",
    right: /*#__PURE__*/React.createElement("div", {
      className: "filter-bar-right"
    }, /*#__PURE__*/React.createElement(__ds_scope.SegmentedControl, {
      options: [{
        key: "today",
        label: "24 h"
      }, {
        key: "7d",
        label: "7 d"
      }, {
        key: "30d",
        label: "30 d"
      }, {
        key: "90d",
        label: "90 d"
      }, {
        key: "all",
        label: "All"
      }],
      value: range,
      onChange: setRange
    }), /*#__PURE__*/React.createElement(__ds_scope.Dropdown, {
      placeholder: "All versions",
      options: ["1.6.2", "1.6.1", "1.6.0", "1.5.3", "legacy"],
      value: version,
      onChange: setVersion,
      renderOption: o => o === "legacy" ? "Legacy (pre-1.4)" : o
    }))
  }), /*#__PURE__*/React.createElement("div", {
    className: "main-side main-side-stretch"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "stat-grid stat-grid-6 v2-stagger"
  }, /*#__PURE__*/React.createElement(__ds_scope.KpiTile, {
    label: "Active Users",
    value: "3",
    sub: "3 sessions open",
    icon: "users"
  }), /*#__PURE__*/React.createElement(__ds_scope.KpiTile, {
    label: "Sessions",
    value: "1,284",
    sub: "In range \xB7 5,931 all-time",
    spark: __ds_scope.SESSION_SPARK,
    drilldown: {
      timespans: [{
        label: "Today",
        value: "18"
      }, {
        label: "7 d",
        value: "124"
      }, {
        label: "30 d",
        value: "486"
      }, {
        label: "Lifetime",
        value: "5,931"
      }],
      breakdown: [{
        label: "Windows 11",
        value: "912",
        share: 0.71
      }, {
        label: "Windows 10",
        value: "367",
        share: 0.29
      }],
      breakdownTitle: "Sessions by platform"
    }
  }), /*#__PURE__*/React.createElement(__ds_scope.KpiTile, {
    label: "Avg Session",
    value: "38m 12s",
    sub: "In range \xB7 legacy excluded",
    icon: "clock",
    drilldown: {
      timespans: [{
        label: "Avg duration",
        value: "38m 12s",
        hint: "selected range"
      }, {
        label: "Sessions in range",
        value: "1,284"
      }, {
        label: "Lifetime events",
        value: "182,409"
      }],
      note: "Computed server-side over the full session history. Legacy install-scoped pseudo-sessions (install:*) are excluded from the average."
    }
  }), /*#__PURE__*/React.createElement(__ds_scope.KpiTile, {
    label: "Errors",
    value: "3",
    sub: "Last 24 hours",
    tone: "danger",
    spark: __ds_scope.ERROR_SPARK,
    sparkColor: "var(--chart-errors)"
  }), /*#__PURE__*/React.createElement(__ds_scope.KpiTile, {
    label: "Primary Region",
    value: "Germany",
    sub: "64 users",
    icon: "earth",
    drilldown: {
      breakdown: [{
        label: "Germany",
        value: "64",
        share: 0.29
      }, {
        label: "United States",
        value: "51",
        share: 0.23
      }, {
        label: "Brazil",
        value: "27",
        share: 0.12
      }],
      breakdownTitle: "Users by country"
    }
  }), /*#__PURE__*/React.createElement(__ds_scope.KpiTile, {
    label: "Latest Error",
    value: "2m ago",
    sub: "NullReferenceException",
    tone: "danger",
    icon: "activity"
  })), /*#__PURE__*/React.createElement(__ds_scope.Panel, {
    kicker: "Traffic",
    title: "Last 24 Hours",
    sub: "Scroll inside chart to zoom in",
    collapsible: true,
    right: /*#__PURE__*/React.createElement(__ds_scope.MetaRow, {
      items: [{
        label: "Peak Users/h",
        value: "11"
      }, {
        label: "Sessions",
        value: "27"
      }, {
        label: "Errors",
        value: "3"
      }]
    })
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      paddingBottom: 6
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.SegmentedControl, {
    options: ["1h", "3h", "6h", "12h", "24h"],
    value: win,
    onChange: setWin
  })), /*#__PURE__*/React.createElement("div", {
    className: "chart-wrap chart-wrap-tall"
  }, /*#__PURE__*/React.createElement(__ds_scope.TrendChart, {
    data: __ds_scope.HOURS,
    height: 280,
    areas: [{
      key: "users",
      name: "Active users",
      color: "var(--chart-users)"
    }, {
      key: "errors",
      name: "Errors",
      color: "var(--chart-errors)",
      strokeWidth: 1.8
    }],
    bars: [{
      key: "started",
      name: "New sessions",
      color: "var(--chart-sessions)"
    }]
  })))), /*#__PURE__*/React.createElement("div", {
    className: "side-stack"
  }, /*#__PURE__*/React.createElement(__ds_scope.Panel, {
    kicker: "System",
    title: "Context",
    padding: "tight"
  }, /*#__PURE__*/React.createElement(__ds_scope.KvList, {
    items: [{
      k: "Traffic Clock",
      v: "UTC fixed",
      tag: "default"
    }, {
      k: "Geography Source",
      v: "Active-first",
      tag: "accent"
    }, {
      k: "Storage Backend",
      v: "D1",
      tag: "default"
    }, {
      k: "Last Ingest",
      v: "2m ago"
    }, {
      k: "Generated",
      v: "8s ago"
    }]
  })), /*#__PURE__*/React.createElement(__ds_scope.Panel, {
    kicker: "Failures",
    title: "Recent Errors",
    padding: "tight",
    right: /*#__PURE__*/React.createElement(__ds_scope.Badge, {
      tone: "danger"
    }, "3"),
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "8px 0 4px"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Feed, {
    items: __ds_scope.RECENT_ERRORS
  }))))));
}

/** Pages that exist in production but are intentionally not recreated in this kit. */
function PlaceholderScreen({
  title,
  kicker,
  note,
  icon = "map"
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "page-content page-stack-lg"
  }, /*#__PURE__*/React.createElement(__ds_scope.PageHeader, {
    kicker: kicker,
    title: title
  }), /*#__PURE__*/React.createElement(__ds_scope.Panel, {
    padding: "body"
  }, /*#__PURE__*/React.createElement(__ds_scope.EmptyState, {
    icon: icon,
    title: `${title} is not recreated in this kit`
  }, note)));
}
Object.assign(__ds_scope, { OverviewScreen, PlaceholderScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/console/OverviewScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/console/SettingsScreen.jsx
try { (() => {
const CHART_PRESETS = [{
  label: "Default",
  users: "#6b8de3",
  errors: "#e06b6b"
}, {
  label: "Emerald",
  users: "#34d399",
  errors: "#f87171"
}, {
  label: "Amber",
  users: "#fbbf24",
  errors: "#ef4444"
}, {
  label: "Rose",
  users: "#fb7185",
  errors: "#a78bfa"
}, {
  label: "Cyan",
  users: "#22d3ee",
  errors: "#f472b6"
}, {
  label: "Violet",
  users: "#a78bfa",
  errors: "#fb923c"
}];

/** Settings — account identity, backend status, accent + chart appearance. */
function SettingsScreen({
  hue,
  onHueChange
}) {
  const [chartPreset, setChartPreset] = React.useState("Default");
  const activePreset = __ds_scope.ACCENT_PRESETS.find(p => p.hue === hue) ?? null;
  const applyChartPreset = preset => {
    setChartPreset(preset.label);
    const root = document.documentElement;
    root.style.setProperty("--chart-users", preset.users);
    root.style.setProperty("--chart-errors", preset.errors);
    root.style.setProperty("--chart-sessions", preset.users.startsWith("#") ? `${preset.users}40` : preset.users);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "page-content page-stack-lg"
  }, /*#__PURE__*/React.createElement(__ds_scope.PageHeader, {
    kicker: "Configuration",
    title: "Settings",
    right: /*#__PURE__*/React.createElement(__ds_scope.MetaRow, {
      items: [{
        label: "Auth Mode",
        value: "Zero Trust"
      }, {
        label: "Storage",
        value: "D1"
      }, {
        label: "API",
        value: "Online"
      }]
    })
  }), /*#__PURE__*/React.createElement("div", {
    className: "two-col"
  }, /*#__PURE__*/React.createElement(__ds_scope.Panel, {
    kicker: "Account",
    title: "Identity",
    padding: "tight"
  }, /*#__PURE__*/React.createElement(__ds_scope.KvList, {
    items: [{
      k: "Email",
      v: "ops@razorreaper.app"
    }, {
      k: "Role",
      v: "admin"
    }, {
      k: "Auth Mode",
      v: "Cloudflare Access (Zero Trust)"
    }]
  })), /*#__PURE__*/React.createElement(__ds_scope.Panel, {
    kicker: "Backend",
    title: "System Status",
    padding: "tight",
    right: /*#__PURE__*/React.createElement(__ds_scope.Badge, {
      tone: "success"
    }, "Online")
  }, /*#__PURE__*/React.createElement(__ds_scope.KvList, {
    items: [{
      k: "Storage",
      v: "D1"
    }, {
      k: "API",
      v: "Alive"
    }, {
      k: "Commit",
      v: "d4f81c2"
    }, {
      k: "Branch",
      v: "main"
    }, {
      k: "Environment",
      v: "production"
    }]
  }))), /*#__PURE__*/React.createElement(__ds_scope.Panel, {
    kicker: "Appearance",
    title: "Accent Color",
    sub: "Pick any accent hue \u2014 all interface highlights, buttons, and glows update instantly. Saved to your browser.",
    right: /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 28,
        height: 28,
        borderRadius: 8,
        background: `hsl(${hue} 83% 62%)`,
        border: "2px solid rgba(255,255,255,0.15)",
        boxShadow: `0 0 16px hsl(${hue} 83% 62% / 0.5)`
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: "0.75rem",
        color: "var(--text-2)"
      }
    }, "hsl(", hue, "\xB0)"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("p", {
    className: "label-sm",
    style: {
      marginBottom: 10
    }
  }, "Presets"), /*#__PURE__*/React.createElement("div", {
    className: "accent-picker-swatches"
  }, __ds_scope.ACCENT_PRESETS.map(preset => /*#__PURE__*/React.createElement("button", {
    key: preset.hue,
    type: "button",
    className: `accent-swatch${preset.hue === hue ? " active" : ""}`,
    style: {
      background: `hsl(${preset.hue} 83% 62%)`
    },
    onClick: () => onHueChange(preset.hue),
    title: preset.label,
    "aria-label": `Set accent to ${preset.label}`
  })))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    className: "label-sm",
    style: {
      marginBottom: 10
    }
  }, "Custom Hue", /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 8,
      fontFamily: "var(--font-mono)",
      color: "var(--text-2)",
      fontWeight: 400,
      textTransform: "none",
      letterSpacing: 0
    }
  }, hue, "\xB0", activePreset ? ` — ${activePreset.label}` : "")), /*#__PURE__*/React.createElement("input", {
    type: "range",
    min: 0,
    max: 360,
    step: 1,
    value: hue,
    onChange: e => onHueChange(Number(e.target.value)),
    className: "accent-hue-slider"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20,
      display: "flex",
      gap: 10,
      flexWrap: "wrap",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("p", {
    className: "label-sm",
    style: {
      width: "100%",
      marginBottom: 2
    }
  }, "Preview"), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "primary",
    size: "sm"
  }, "Primary Button"), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    size: "sm"
  }, "Ghost Button"), /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: "accent"
  }, "Accent Badge"), /*#__PURE__*/React.createElement("span", {
    className: "badge-live"
  }, "Live"))), /*#__PURE__*/React.createElement(__ds_scope.Panel, {
    kicker: "Charts",
    title: "Chart Colors",
    sub: "Choose a color theme for traffic and analytics charts. Saved to your browser."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }
  }, CHART_PRESETS.map(preset => {
    const isActive = chartPreset === preset.label;
    return /*#__PURE__*/React.createElement("button", {
      key: preset.label,
      type: "button",
      onClick: () => applyChartPreset(preset),
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderRadius: 10,
        border: isActive ? "1px solid var(--line-hi)" : "1px solid var(--line)",
        cursor: "pointer",
        background: isActive ? "var(--surface-3)" : "var(--surface-1)",
        transition: "all 0.15s"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: "flex",
        gap: 4
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: preset.users,
        boxShadow: isActive ? `0 0 8px ${preset.users}` : "none"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: preset.errors,
        boxShadow: isActive ? `0 0 8px ${preset.errors}` : "none"
      }
    })), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: "0.8rem",
        color: isActive ? "var(--text-1)" : "var(--text-2)",
        fontWeight: isActive ? 500 : 400
      }
    }, preset.label));
  }))));
}
Object.assign(__ds_scope, { SettingsScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/console/SettingsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/console/VersionsScreen.jsx
try { (() => {
/** Versions — adoption funnel: rank bars, gauges, release context. */
function VersionsScreen() {
  return /*#__PURE__*/React.createElement("div", {
    className: "page-content page-stack-lg"
  }, /*#__PURE__*/React.createElement(__ds_scope.PageHeader, {
    kicker: "Adoption",
    title: "Versions",
    right: /*#__PURE__*/React.createElement(__ds_scope.Badge, {
      tone: "accent"
    }, "Latest \xB7 1.6.2")
  }), /*#__PURE__*/React.createElement("div", {
    className: "stat-grid stat-grid-4 v2-stagger"
  }, /*#__PURE__*/React.createElement(__ds_scope.KpiTile, {
    label: "Latest Version",
    value: "1.6.2",
    sub: "Released 2 days ago",
    icon: "package"
  }), /*#__PURE__*/React.createElement(__ds_scope.KpiTile, {
    label: "On Latest",
    value: "144",
    sub: "63% of lifetime users",
    tone: "success",
    icon: "circle-check"
  }), /*#__PURE__*/React.createElement(__ds_scope.KpiTile, {
    label: "Outdated",
    value: "73",
    sub: "Including 12 on legacy",
    tone: "warning",
    icon: "layers"
  }), /*#__PURE__*/React.createElement(__ds_scope.KpiTile, {
    label: "Update Velocity",
    value: "44%",
    sub: "Adoption within 48h of release",
    icon: "trending-up"
  })), /*#__PURE__*/React.createElement("div", {
    className: "main-side"
  }, /*#__PURE__*/React.createElement(__ds_scope.Panel, {
    kicker: "Distribution",
    title: "Users by Version",
    sub: "Lifetime users, current version reported at last ingest."
  }, /*#__PURE__*/React.createElement(__ds_scope.RankList, {
    items: __ds_scope.VERSIONS.map(v => ({
      label: v.label,
      value: String(v.users),
      share: v.share
    }))
  })), /*#__PURE__*/React.createElement("div", {
    className: "side-stack"
  }, /*#__PURE__*/React.createElement(__ds_scope.Panel, {
    kicker: "Health",
    title: "Coverage"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.RadialGauge, {
    ratio: 0.74,
    title: "On 1.6.x",
    sub: "162 of 220 users"
  }), /*#__PURE__*/React.createElement(__ds_scope.RadialGauge, {
    ratio: 0.41,
    title: "Discord RPC on",
    sub: "90 of 220 reporting"
  }))), /*#__PURE__*/React.createElement(__ds_scope.Panel, {
    kicker: "Geography",
    title: "Top Countries",
    padding: "body"
  }, /*#__PURE__*/React.createElement(__ds_scope.RankList, {
    items: __ds_scope.COUNTRIES.map(c => ({
      label: c.label,
      value: String(c.users),
      share: c.share
    }))
  })))));
}
Object.assign(__ds_scope, { VersionsScreen });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/console/VersionsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/console/ConsoleApp.jsx
try { (() => {
const HUE_KEY = "rr-kit-accent-hue";

/**
 * RazorReaper Operations Console — interactive UI-kit recreation.
 * Frosted top-navbar shell + Overview / Versions / Live / Errors / Settings.
 * Traffic, Heatmap and Sessions are intentionally placeholders (see notes).
 */
function ConsoleApp({
  logoSrc = "../../assets/logo.ico"
}) {
  const [page, setPage] = React.useState("overview");
  const [hue, setHue] = React.useState(() => {
    try {
      const stored = Number(localStorage.getItem(HUE_KEY));
      return Number.isFinite(stored) && stored > 0 ? stored : 262;
    } catch {
      return 262;
    }
  });
  React.useEffect(() => {
    document.documentElement.style.setProperty("--ah", String(hue));
    try {
      localStorage.setItem(HUE_KEY, String(hue));
    } catch {/* ignore */}
  }, [hue]);
  return /*#__PURE__*/React.createElement("div", {
    className: "v2-shell"
  }, /*#__PURE__*/React.createElement(__ds_scope.TopNav, {
    logoSrc: logoSrc,
    active: page,
    onNavigate: setPage,
    items: __ds_scope.NAV_GROUPS.flatMap(g => g.items),
    live: true,
    liveLabel: "Ingest online",
    meta: /*#__PURE__*/React.createElement("span", null, "d1 \xB7 v1.6.2 \xB7 ingest 2m ago"),
    actions: /*#__PURE__*/React.createElement(__ds_scope.Button, {
      size: "sm",
      icon: "refresh-cw"
    }, "Refresh")
  }), /*#__PURE__*/React.createElement("main", {
    className: "v2-main"
  }, page === "overview" ? /*#__PURE__*/React.createElement(__ds_scope.OverviewScreen, null) : null, page === "versions" ? /*#__PURE__*/React.createElement(__ds_scope.VersionsScreen, null) : null, page === "live" ? /*#__PURE__*/React.createElement(__ds_scope.LiveScreen, null) : null, page === "errors" ? /*#__PURE__*/React.createElement(__ds_scope.ErrorsScreen, null) : null, page === "settings" ? /*#__PURE__*/React.createElement(__ds_scope.SettingsScreen, {
    hue: hue,
    onHueChange: setHue
  }) : null, page === "traffic" ? /*#__PURE__*/React.createElement(__ds_scope.PlaceholderScreen, {
    kicker: "Hourly Patterns",
    title: "Traffic",
    icon: "clock-3",
    note: "Production shows hourly/timezone usage charts \u2014 same TrendChart + Panel patterns as Overview, omitted here to avoid inventing data."
  }) : null, page === "heatmap" ? /*#__PURE__*/React.createElement(__ds_scope.PlaceholderScreen, {
    kicker: "Geography",
    title: "Heatmap",
    icon: "map",
    note: "Production renders a MapLibre world map with pulsing accent session nodes (.map-node-*) over dark tiles. Left blank here \u2014 a static recreation would misrepresent it."
  }) : null, page === "sessions" ? /*#__PURE__*/React.createElement(__ds_scope.PlaceholderScreen, {
    kicker: "Archive",
    title: "Sessions",
    icon: "history",
    note: "The searchable session archive uses the exact table pattern shown on Live, plus SearchInput and a .txt export Button."
  }) : null));
}
Object.assign(__ds_scope, { ConsoleApp });
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/console/ConsoleApp.jsx", error: String((e && e.message) || e) }); }

__ds_ns.TrendChart = __ds_scope.TrendChart;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Dropdown = __ds_scope.Dropdown;

__ds_ns.SearchInput = __ds_scope.SearchInput;

__ds_ns.SegmentedControl = __ds_scope.SegmentedControl;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.ICON_PATHS = __ds_scope.ICON_PATHS;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.LiveBadge = __ds_scope.LiveBadge;

__ds_ns.StatusBadge = __ds_scope.StatusBadge;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Spinner = __ds_scope.Spinner;

__ds_ns.KpiTile = __ds_scope.KpiTile;

__ds_ns.RadialGauge = __ds_scope.RadialGauge;

__ds_ns.RankList = __ds_scope.RankList;

__ds_ns.Sparkline = __ds_scope.Sparkline;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.Modal = __ds_scope.Modal;

__ds_ns.TimespanGrid = __ds_scope.TimespanGrid;

__ds_ns.BreakdownList = __ds_scope.BreakdownList;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.PageHeader = __ds_scope.PageHeader;

__ds_ns.MetaRow = __ds_scope.MetaRow;

__ds_ns.TopNav = __ds_scope.TopNav;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.DetailGrid = __ds_scope.DetailGrid;

__ds_ns.Feed = __ds_scope.Feed;

__ds_ns.KvList = __ds_scope.KvList;

__ds_ns.ConsoleApp = __ds_scope.ConsoleApp;

__ds_ns.NAV_GROUPS = __ds_scope.NAV_GROUPS;

__ds_ns.HOURS = __ds_scope.HOURS;

__ds_ns.LIVE_SESSIONS = __ds_scope.LIVE_SESSIONS;

__ds_ns.RECENT_ERRORS = __ds_scope.RECENT_ERRORS;

__ds_ns.ACTIVITY = __ds_scope.ACTIVITY;

__ds_ns.VERSIONS = __ds_scope.VERSIONS;

__ds_ns.COUNTRIES = __ds_scope.COUNTRIES;

__ds_ns.ACCENT_PRESETS = __ds_scope.ACCENT_PRESETS;

__ds_ns.SESSION_SPARK = __ds_scope.SESSION_SPARK;

__ds_ns.ERROR_SPARK = __ds_scope.ERROR_SPARK;

__ds_ns.ErrorsScreen = __ds_scope.ErrorsScreen;

__ds_ns.LiveScreen = __ds_scope.LiveScreen;

__ds_ns.OverviewScreen = __ds_scope.OverviewScreen;

__ds_ns.PlaceholderScreen = __ds_scope.PlaceholderScreen;

__ds_ns.SettingsScreen = __ds_scope.SettingsScreen;

__ds_ns.VersionsScreen = __ds_scope.VersionsScreen;

})();
