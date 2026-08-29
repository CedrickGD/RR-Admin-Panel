import {
  Crosshair,
  Globe2,
  Info,
  Layers,
  LocateFixed,
  Map as MapIcon,
  Maximize2,
  Menu,
  Minimize2,
  Minus,
  Plus,
  X,
} from "lucide-react";
import maplibregl, { type GeoJSONSource, LngLatBounds, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, LineString, Point } from "geojson";
import type { ThemeMode } from "../../types/telemetry";
import type { HeatmapSessionPoint } from "../../utils/dashboardInsights";
import { formatAccuracy, formatGeoSource, formatNumber } from "../../utils/format";
import { motionDuration } from "../../utils/motion";
import { stableSampleByKey } from "../../utils/stableSample";

interface WorldHeatmapProps {
  sessionPoints: HeatmapSessionPoint[];
  theme: ThemeMode;
  onOpenSession: (sessionId: string) => void;
  /** Dot key to select + fly to (session id on Live, user identity on All time). */
  focusedKey?: string | null;
  focusedToken?: number;
  /** Fires on every selection change so the page can drop its pinned target on deselect. */
  onActiveKeyChange?: (key: string | null) => void;
}

interface SessionMapPoint extends HeatmapSessionPoint {
  coordinates: [number, number];
}

interface MapPalette {
  background: string;
  naturalEarthOpacity: number;
  naturalEarthSaturation: number;
  naturalEarthContrast: number;
  water: string;
  waterLine: string;
  vegetation: string;
  vegetationOutline: string;
  land: string;
  residential: string;
  airport: string;
  boundary: string;
  boundarySubtle: string;
  building: string;
  buildingOutline: string;
  buildingExtrusion: string;
  roadCasingStrong: string;
  roadCasingSoft: string;
  motorway: string;
  trunk: string;
  secondary: string;
  minor: string;
  link: string;
  rail: string;
  country1: string;
  country2: string;
  country3: string;
  city: string;
  capital: string;
  halo: string;
}

type MapStyleMode = "tactical" | "standard" | "satellite";

const LIBERTY_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [{ id: "satellite", type: "raster", source: "satellite" }],
};

const MAP_STYLE_ORDER: MapStyleMode[] = ["tactical", "standard", "satellite"];
const MAP_STYLE_LABELS: Record<MapStyleMode, string> = {
  tactical: "Tactical",
  standard: "Standard",
  satellite: "Satellite",
};

function readSavedMapStyle(): MapStyleMode {
  const saved = localStorage.getItem("rr:map-style");
  if (saved === "standard" || saved === "satellite") return saved;
  return "tactical";
}

const CONNECTIONS_SOURCE_ID = "active-connections";
const CONNECTIONS_GLOW_LAYER_ID = "active-connections-glow";
const CONNECTIONS_LINE_LAYER_ID = "active-connections-line";
const SESSIONS_SOURCE_ID = "session-dots";
const SESSIONS_GLOW_LAYER_ID = "session-dots-glow";
const SESSIONS_CORE_LAYER_ID = "session-dots-core";
const SESSIONS_RING_LAYER_ID = "session-dots-ring";
const NO_ACTIVE_DOT_KEY = "__none__";
const INITIAL_CENTER: [number, number] = [12, 20];
const INITIAL_ZOOM = 1.45;
const DEFAULT_MAX_ZOOM = 18.8;
const PRIMARY_MARKET_ZOOM = 8.2;
const MAX_CONNECTION_POINTS = 400;
const HIDDEN_LABEL_LAYERS = new Set([
  "road_one_way_arrow",
  "road_one_way_arrow_opposite",
  "waterway_line_label",
  "water_name_point_label",
  "water_name_line_label",
  "poi_r20",
  "poi_r7",
  "poi_r1",
  "poi_transit",
  "highway-name-path",
  "highway-name-minor",
  "highway-name-major",
  "highway-shield-non-us",
  "highway-shield-us-interstate",
  "road_shield_us",
  "airport",
  "label_other",
  "label_village",
  "label_town",
  "label_state",
]);
const PRIMARY_LABEL_LAYERS = new Set([
  "label_country_1",
  "label_country_2",
  "label_country_3",
  "label_city",
  "label_city_capital",
]);

function buildSessionPoints(points: HeatmapSessionPoint[]): SessionMapPoint[] {
  return points
    .filter(
      (point) =>
        Number.isFinite(point.longitude ?? Number.NaN) &&
        Number.isFinite(point.latitude ?? Number.NaN),
    )
    .map((point) => ({
      ...point,
      coordinates: [Number(point.longitude), Number(point.latitude)],
    }));
}

/** Connect every rendered dot into one constellation: a minimum spanning tree
 *  over the dots themselves — so every dot joins the network and every string
 *  starts and ends exactly on a dot — plus each dot's nearest neighbour for
 *  local webbing. Distances are equirectangular-corrected so pairings stay
 *  sane at high latitudes; antimeridian-crossing edges unwrap longitude so the
 *  string takes the short way round instead of sweeping the whole map. */
export function buildConnections(sessionPoints: SessionMapPoint[]): FeatureCollection<LineString> {
  const n = sessionPoints.length;
  if (n < 2) {
    return { type: "FeatureCollection", features: [] };
  }

  const lng = new Float64Array(n);
  const lat = new Float64Array(n);
  const cosLat = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lng[i] = sessionPoints[i].coordinates[0];
    lat[i] = sessionPoints[i].coordinates[1];
    cosLat[i] = Math.cos((lat[i] * Math.PI) / 180);
  }

  // Distance in degree units with the longitude leg wrapped to the short way.
  const dist = (a: number, b: number): number => {
    let dLng = lng[b] - lng[a];
    if (dLng > 180) dLng -= 360;
    else if (dLng < -180) dLng += 360;
    dLng *= (cosLat[a] + cosLat[b]) / 2;
    return Math.hypot(dLng, lat[b] - lat[a]);
  };

  // Prim's MST, O(n²): guarantees one connected network over all dots. The
  // sweep evaluates every unordered pair exactly once (each pair is measured
  // when its first endpoint joins the tree), so exact nearest-neighbour
  // tracking rides along for free instead of needing a second O(n²) pass.
  const inTree = new Uint8Array(n);
  const bestDist = new Float64Array(n);
  const bestFrom = new Int32Array(n);
  const nearestDist = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const nearestOf = new Int32Array(n).fill(-1);
  const edges: Array<[number, number, number]> = [];

  const noteNearest = (a: number, b: number, d: number) => {
    if (d < nearestDist[a]) {
      nearestDist[a] = d;
      nearestOf[a] = b;
    }
    if (d < nearestDist[b]) {
      nearestDist[b] = d;
      nearestOf[b] = a;
    }
  };

  inTree[0] = 1;
  for (let i = 1; i < n; i++) {
    const d = dist(0, i);
    bestDist[i] = d;
    noteNearest(0, i, d);
  }
  for (let added = 1; added < n; added++) {
    let next = -1;
    let nextDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      if (!inTree[i] && bestDist[i] < nextDist) {
        next = i;
        nextDist = bestDist[i];
      }
    }
    if (next === -1) break;
    inTree[next] = 1;
    edges.push([bestFrom[next], next, nextDist]);
    for (let i = 0; i < n; i++) {
      if (!inTree[i]) {
        const d = dist(next, i);
        noteNearest(next, i, d);
        if (d < bestDist[i]) {
          bestDist[i] = d;
          bestFrom[i] = next;
        }
      }
    }
  }

  // Local webbing: each dot also links to its nearest neighbour when the
  // tree didn't already give it that edge.
  const edgeKeys = new Set(edges.map(([a, b]) => (a < b ? a * n + b : b * n + a)));
  for (let i = 0; i < n; i++) {
    const j = nearestOf[i];
    if (j === -1 || nearestDist[i] === 0) continue;
    const key = i < j ? i * n + j : j * n + i;
    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      edges.push([i, j, nearestDist[i]]);
    }
  }

  // Short hops render bright and wide; ocean-crossing links stay faint but
  // present. Zero-length edges (stacked dots) are connectivity-only — skip.
  return {
    type: "FeatureCollection",
    features: edges
      .filter(([, , d]) => d > 0)
      .map(([a, b, d]) => {
        let endLng = lng[b];
        if (endLng - lng[a] > 180) endLng -= 360;
        else if (endLng - lng[a] < -180) endLng += 360;
        return {
          type: "Feature" as const,
          properties: { weight: Math.max(0.05, 1 - d / 40) },
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [lng[a], lat[a]],
              [endLng, lat[b]],
            ],
          },
        };
      }),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildPopupMarkup(point: SessionMapPoint): string {
  const flag = point.flag ? `<span class="map-node-popup-flag">${point.flag}</span>` : "";
  const location =
    point.locationLabel !== point.label
      ? `<div class="map-node-popup-location">${escapeHtml(point.locationLabel)}</div>`
      : "";
  const session =
    point.userLabel && point.userLabel.trim()
      ? `<div class="map-node-popup-session">${escapeHtml(point.userLabel.trim())}</div>`
      : "";
  const geoDetails =
    point.geoSource || point.accuracyMeters !== null
      ? `<div class="map-node-popup-location">${escapeHtml(`${formatGeoSource(point.geoSource, point.geoSignalSource)}${point.accuracyMeters !== null ? ` · ±${formatAccuracy(point.accuracyMeters)}` : ""}`)}</div>`
      : "";
  const hint = `<div class="map-node-popup-hint">Open the selected session from the side panel.</div>`;
  const offline = point.active === false;
  const kicker = offline ? "OFFLINE · LAST KNOWN" : "ACTIVE NOW";
  const meta = offline
    ? escapeHtml(point.region)
    : `${formatNumber(point.marketValue)} live sessions · ${escapeHtml(point.region)}`;

  return `
    <div class="map-node-popup-card">
      <button type="button" class="map-node-popup-close" aria-label="Clear selection">&#215;</button>
      <div class="map-node-popup-kicker">${kicker}</div>
      <div class="map-node-popup-title">${flag}${escapeHtml(point.label)}</div>
      ${location}
      ${session}
      ${geoDetails}
      <div class="map-node-popup-meta">${meta}</div>
      ${hint}
    </div>
  `;
}

function fitToPoints(
  map: maplibregl.Map,
  points: Array<{ coordinates: [number, number] }>,
  forceClose = false,
) {
  if (points.length === 0) {
    map.easeTo({ center: INITIAL_CENTER, zoom: INITIAL_ZOOM, duration: motionDuration(700) });
    return;
  }

  // When not forced (initial load), always show the full globe so every region is visible
  if (!forceClose) {
    const bounds = new LngLatBounds(points[0].coordinates, points[0].coordinates);
    for (const point of points.slice(1)) bounds.extend(point.coordinates);
    map.fitBounds(bounds, { padding: 90, maxZoom: 2.8, duration: motionDuration(900) });
    return;
  }

  if (points.length === 1) {
    map.easeTo({ center: points[0].coordinates, zoom: 4.9, duration: motionDuration(800) });
    return;
  }

  const bounds = new LngLatBounds(points[0].coordinates, points[0].coordinates);

  for (const point of points.slice(1)) {
    bounds.extend(point.coordinates);
  }

  map.fitBounds(bounds, {
    padding: 90,
    maxZoom: 6.2,
    duration: motionDuration(900),
  });
}

interface DotPalette {
  glow: string;
  corePrecise: string;
  coreSpread: string;
  ring: string;
}

/** Resolve the user-themeable accent (--ah/--as/--al) into concrete colors for
 *  MapLibre paint properties, mirroring the retired .map-node-* CSS markers
 *  (core lightness 85% precise / 70% spread, accent halo). Re-read on every
 *  ensureSessionDots call so theme/accent changes propagate. */
function readDotPalette(): DotPalette {
  const styles = getComputedStyle(document.documentElement);
  const hue = styles.getPropertyValue("--ah").trim() || "217";
  const saturation = styles.getPropertyValue("--as").trim() || "83%";
  const lightness = styles.getPropertyValue("--al").trim() || "62%";

  return {
    glow: `hsl(${hue}, ${saturation}, ${lightness})`,
    corePrecise: `hsl(${hue}, ${saturation}, 85%)`,
    coreSpread: `hsl(${hue}, ${saturation}, 70%)`,
    ring: `hsl(${hue}, ${saturation}, ${lightness})`,
  };
}

function buildSessionDotsCollection(points: SessionMapPoint[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: points.map((point) => ({
      type: "Feature",
      properties: {
        key: point.key,
        // Intensity drives radius + opacity; the all-time set ships intensity 0
        // (HeatmapPage), so it renders as the smallest, dimmest variant.
        intensity: point.intensity,
        precise: point.precise,
      },
      geometry: { type: "Point", coordinates: point.coordinates },
    })),
  };
}

/** Session dots are a real GeoJSON source + circle layers (not HTML overlays),
 *  so every dot stays glued to its [longitude, latitude] at any zoom/pan and on
 *  both globe and mercator projections. */
function ensureSessionDots(
  map: maplibregl.Map,
  data: FeatureCollection<Point>,
  activeKey: string | null,
) {
  const palette = readDotPalette();
  const source = map.getSource(SESSIONS_SOURCE_ID) as GeoJSONSource | undefined;

  if (source) {
    source.setData(data);
  } else {
    map.addSource(SESSIONS_SOURCE_ID, { type: "geojson", data });
  }

  if (!map.getLayer(SESSIONS_GLOW_LAYER_ID)) {
    map.addLayer({
      id: SESSIONS_GLOW_LAYER_ID,
      type: "circle",
      source: SESSIONS_SOURCE_ID,
      paint: {
        "circle-color": palette.glow,
        "circle-blur": 0.9,
        "circle-opacity": ["+", 0.16, ["*", ["get", "intensity"], 0.2]],
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          ["+", 4.4, ["*", ["get", "intensity"], 3.4]],
          5,
          ["+", 7, ["*", ["get", "intensity"], 5.4]],
          10,
          ["+", 11, ["*", ["get", "intensity"], 8.4]],
          16,
          ["+", 15, ["*", ["get", "intensity"], 11]],
        ],
      },
    });
  } else {
    map.setPaintProperty(SESSIONS_GLOW_LAYER_ID, "circle-color", palette.glow);
  }

  if (!map.getLayer(SESSIONS_CORE_LAYER_ID)) {
    map.addLayer({
      id: SESSIONS_CORE_LAYER_ID,
      type: "circle",
      source: SESSIONS_SOURCE_ID,
      paint: {
        "circle-color": [
          "case",
          ["to-boolean", ["get", "precise"]],
          palette.corePrecise,
          palette.coreSpread,
        ],
        "circle-opacity": ["+", 0.78, ["*", ["get", "intensity"], 0.22]],
        "circle-stroke-width": 1,
        "circle-stroke-color": "rgba(255,255,255,0.14)",
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          ["+", 1.8, ["*", ["get", "intensity"], 1.4]],
          5,
          ["+", 2.9, ["*", ["get", "intensity"], 2.3]],
          10,
          ["+", 4.4, ["*", ["get", "intensity"], 3.4]],
          16,
          ["+", 6.2, ["*", ["get", "intensity"], 4.6]],
        ],
      },
    });
  } else {
    map.setPaintProperty(SESSIONS_CORE_LAYER_ID, "circle-color", [
      "case",
      ["to-boolean", ["get", "precise"]],
      palette.corePrecise,
      palette.coreSpread,
    ]);
  }

  if (!map.getLayer(SESSIONS_RING_LAYER_ID)) {
    map.addLayer({
      id: SESSIONS_RING_LAYER_ID,
      type: "circle",
      source: SESSIONS_SOURCE_ID,
      paint: {
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-width": 1.6,
        "circle-stroke-color": palette.ring,
        "circle-stroke-opacity": 0.92,
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          1,
          ["+", 4.6, ["*", ["get", "intensity"], 1.4]],
          5,
          ["+", 5.9, ["*", ["get", "intensity"], 2.3]],
          10,
          ["+", 7.4, ["*", ["get", "intensity"], 3.4]],
          16,
          ["+", 9.2, ["*", ["get", "intensity"], 4.6]],
        ],
      },
    });
  } else {
    map.setPaintProperty(SESSIONS_RING_LAYER_ID, "circle-stroke-color", palette.ring);
  }

  // Selection ring follows the active dot; parked on a sentinel when nothing is active.
  map.setFilter(SESSIONS_RING_LAYER_ID, ["==", ["get", "key"], activeKey ?? NO_ACTIVE_DOT_KEY]);
}

function createPalette(theme: ThemeMode): MapPalette {
  if (theme === "light") {
    return {
      background: "#e4e9ee",
      naturalEarthOpacity: 0.08,
      naturalEarthSaturation: -0.18,
      naturalEarthContrast: 0.04,
      water: "#dbe3ea",
      waterLine: "#6e94ad",
      vegetation: "#e2e8eb",
      vegetationOutline: "#c6d3db",
      land: "#eef2f5",
      residential: "#f6f8fa",
      airport: "#d7dfe6",
      boundary: "#6d8296",
      boundarySubtle: "#9babb9",
      building: "#dde4ea",
      buildingOutline: "#c3d0d9",
      buildingExtrusion: "#d0dae2",
      roadCasingStrong: "#a0b2c1",
      roadCasingSoft: "#bcc9d4",
      motorway: "#7e98ab",
      trunk: "#8898a8",
      secondary: "#9aaab8",
      minor: "#bec9d2",
      link: "#a7b5c0",
      rail: "#8f9ead",
      country1: "#243746",
      country2: "#41586b",
      country3: "#657c8e",
      city: "#4d7c8a",
      capital: "#5f8da7",
      halo: "rgba(255, 255, 255, 0.94)",
    };
  }

  return {
    background: "#0d1622",
    naturalEarthOpacity: 0.15,
    naturalEarthSaturation: -0.52,
    naturalEarthContrast: 0.08,
    water: "#0f1b29",
    waterLine: "#5f8198",
    vegetation: "#142231",
    vegetationOutline: "#243746",
    land: "#121f2d",
    residential: "#182432",
    airport: "#223140",
    boundary: "#506577",
    boundarySubtle: "#344454",
    building: "#192736",
    buildingOutline: "#2a3c4d",
    buildingExtrusion: "#213444",
    roadCasingStrong: "#2b3f52",
    roadCasingSoft: "#223344",
    motorway: "#65839a",
    trunk: "#5d778b",
    secondary: "#4e687b",
    minor: "#334858",
    link: "#405568",
    rail: "#6f8191",
    country1: "#eef4f8",
    country2: "#c6d2dd",
    country3: "#9eafbf",
    city: "#9bbbc5",
    capital: "#b7cad3",
    halo: "rgba(10, 15, 24, 0.9)",
  };
}

function resolveRoadColor(layerId: string, palette: MapPalette, isCasing: boolean): string {
  if (layerId.includes("rail")) {
    return palette.rail;
  }

  if (isCasing) {
    if (layerId.includes("motorway") || layerId.includes("trunk") || layerId.includes("primary")) {
      return palette.roadCasingStrong;
    }

    return palette.roadCasingSoft;
  }

  if (layerId.includes("motorway")) {
    return palette.motorway;
  }

  if (layerId.includes("trunk") || layerId.includes("primary")) {
    return palette.trunk;
  }

  if (layerId.includes("secondary") || layerId.includes("tertiary")) {
    return palette.secondary;
  }

  if (layerId.includes("link")) {
    return palette.link;
  }

  return palette.minor;
}

function styleMap(map: maplibregl.Map, theme: ThemeMode) {
  const palette = createPalette(theme);
  const layers = map.getStyle().layers ?? [];

  const setPaint = (layerId: string, property: string, value: unknown) => {
    if (!map.getLayer(layerId)) {
      return;
    }

    try {
      map.setPaintProperty(layerId, property, value);
    } catch {
      // Ignore paint updates for incompatible imported layers.
    }
  };

  const hideLayer = (layerId: string) => {
    if (!map.getLayer(layerId)) {
      return;
    }

    try {
      map.setLayoutProperty(layerId, "visibility", "none");
    } catch {
      // Ignore layout updates for incompatible imported layers.
    }
  };

  for (const layerId of HIDDEN_LABEL_LAYERS) {
    hideLayer(layerId);
  }

  for (const layer of layers) {
    const { id, type } = layer;

    if (id === "background") {
      setPaint(id, "background-color", palette.background);
      continue;
    }

    if (id === "natural_earth") {
      setPaint(id, "raster-opacity", palette.naturalEarthOpacity);
      setPaint(id, "raster-saturation", palette.naturalEarthSaturation);
      setPaint(id, "raster-contrast", palette.naturalEarthContrast);
      continue;
    }

    if (id === "water" && type === "fill") {
      setPaint(id, "fill-color", palette.water);
      continue;
    }

    if (id.startsWith("waterway_") && type === "line") {
      setPaint(id, "line-color", palette.waterLine);
      continue;
    }

    if (
      (id === "park" || id.startsWith("landcover_") || id.startsWith("landuse_")) &&
      type === "fill"
    ) {
      let fillColor = palette.land;

      if (id === "park" || id.includes("wood") || id.includes("grass")) {
        fillColor = palette.vegetation;
      } else if (id.includes("residential")) {
        fillColor = palette.residential;
      }

      setPaint(id, "fill-color", fillColor);

      if (id.includes("wetland")) {
        setPaint(id, "fill-opacity", theme === "light" ? 0.32 : 0.24);
      }

      continue;
    }

    if (id === "park_outline" && type === "line") {
      setPaint(id, "line-color", palette.vegetationOutline);
      continue;
    }

    if (id.startsWith("aeroway_")) {
      if (type === "fill") {
        setPaint(id, "fill-color", palette.airport);
      }

      if (type === "line") {
        setPaint(id, "line-color", palette.airport);
      }

      continue;
    }

    if (id.startsWith("boundary_") && type === "line") {
      setPaint(id, "line-color", id === "boundary_2" ? palette.boundary : palette.boundarySubtle);
      setPaint(id, "line-opacity", id === "boundary_2" ? (theme === "light" ? 0.58 : 0.72) : 0.38);
      continue;
    }

    if (id.startsWith("building")) {
      if (type === "fill") {
        setPaint(id, "fill-color", palette.building);
        setPaint(id, "fill-outline-color", palette.buildingOutline);
      }

      if (type === "fill-extrusion") {
        setPaint(id, "fill-extrusion-color", palette.buildingExtrusion);
        setPaint(id, "fill-extrusion-opacity", theme === "light" ? 0.44 : 0.56);
      }

      continue;
    }

    if (
      (id.startsWith("road_") || id.startsWith("bridge_") || id.startsWith("tunnel_")) &&
      !PRIMARY_LABEL_LAYERS.has(id)
    ) {
      if (type === "fill") {
        setPaint(id, "fill-color", palette.minor);
        setPaint(id, "fill-opacity", theme === "light" ? 0.14 : 0.08);
        continue;
      }

      if (type !== "line") {
        continue;
      }

      const isCasing = id.includes("casing");
      setPaint(id, "line-color", resolveRoadColor(id, palette, isCasing));

      if (id.includes("hatching")) {
        setPaint(id, "line-opacity", theme === "light" ? 0.42 : 0.32);
      }

      continue;
    }

    if (PRIMARY_LABEL_LAYERS.has(id) && type === "symbol") {
      let textColor = palette.country3;

      if (id === "label_country_1") {
        textColor = palette.country1;
      } else if (id === "label_country_2") {
        textColor = palette.country2;
      } else if (id === "label_city") {
        textColor = palette.city;
      } else if (id === "label_city_capital") {
        textColor = palette.capital;
      }

      setPaint(id, "text-color", textColor);
      setPaint(id, "text-halo-color", palette.halo);
      setPaint(id, "text-halo-width", theme === "light" ? 1.3 : 1.15);
    }
  }
}

function restoreDefaultStyle(
  map: maplibregl.Map,
  savedPaints: Map<string, Record<string, unknown>>,
) {
  for (const [layerId, paint] of savedPaints) {
    if (!map.getLayer(layerId)) continue;
    for (const [prop, value] of Object.entries(paint)) {
      try {
        map.setPaintProperty(layerId, prop, value);
      } catch {
        /* skip incompatible */
      }
    }
  }

  for (const layerId of HIDDEN_LABEL_LAYERS) {
    if (!map.getLayer(layerId)) continue;
    try {
      map.setLayoutProperty(layerId, "visibility", "visible");
    } catch {
      /* skip */
    }
  }
}

function captureOriginalPaints(map: maplibregl.Map): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  const layers = map.getStyle()?.layers;
  if (!layers) return result;

  for (const layer of layers) {
    const paint = (layer as Record<string, unknown>).paint as Record<string, unknown> | undefined;
    if (paint) {
      result.set(layer.id, { ...paint });
    }
  }

  return result;
}

function ensureConnections(map: maplibregl.Map, connections: FeatureCollection<LineString>) {
  // Accent-tinted arcs so the network reads clearly on the dark styles
  // (and follows the user's accent). Resolved per call like the dots.
  const palette = readDotPalette();
  const glowColor = palette.glow;
  const lineColor = palette.coreSpread;
  const source = map.getSource(CONNECTIONS_SOURCE_ID) as GeoJSONSource | undefined;

  if (source) {
    source.setData(connections);
  } else {
    map.addSource(CONNECTIONS_SOURCE_ID, {
      type: "geojson",
      data: connections,
    });
  }

  if (!map.getLayer(CONNECTIONS_GLOW_LAYER_ID)) {
    map.addLayer({
      id: CONNECTIONS_GLOW_LAYER_ID,
      type: "line",
      source: CONNECTIONS_SOURCE_ID,
      paint: {
        "line-color": glowColor,
        "line-width": ["interpolate", ["linear"], ["get", "weight"], 0, 1.2, 1, 3.6],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.22, 7, 0.1],
        "line-blur": 1.3,
      },
    });
  } else {
    map.setPaintProperty(CONNECTIONS_GLOW_LAYER_ID, "line-color", glowColor);
  }

  if (!map.getLayer(CONNECTIONS_LINE_LAYER_ID)) {
    map.addLayer({
      id: CONNECTIONS_LINE_LAYER_ID,
      type: "line",
      source: CONNECTIONS_SOURCE_ID,
      paint: {
        "line-color": lineColor,
        "line-width": ["interpolate", ["linear"], ["get", "weight"], 0, 0.8, 1, 1.7],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.85, 7, 0.42],
        "line-dasharray": [2, 1.5],
      },
    });
  } else {
    map.setPaintProperty(CONNECTIONS_LINE_LAYER_ID, "line-color", lineColor);
  }
}

export function WorldHeatmap({
  sessionPoints,
  theme,
  onOpenSession,
  focusedKey = null,
  focusedToken = 0,
  onActiveKeyChange,
}: WorldHeatmapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const autoFitRef = useRef(false);
  // Keyed on "key#token" so a fresh focus for a DIFFERENT dot is never swallowed
  // by a token collision, and a remount cannot replay an already-handled focus.
  const handledFocusRef = useRef<string | null>(null);
  const themeRef = useRef(theme);
  const activeKeyRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [globe, setGlobe] = useState(true);
  const [mapStyle, setMapStyle] = useState<MapStyleMode>(readSavedMapStyle);
  const mapStyleRef = useRef(mapStyle);
  const savedPaintsRef = useRef<Map<string, Record<string, unknown>> | null>(null);
  const sessionMarkerPoints = useMemo(() => buildSessionPoints(sessionPoints), [sessionPoints]);
  // Every dot remains interactive. Only the decorative constellation is
  // sampled, keeping its O(n²) MST comfortably below a frame as users grow.
  const connectionPoints = useMemo(
    () => stableSampleByKey(sessionMarkerPoints, MAX_CONNECTION_POINTS),
    [sessionMarkerPoints],
  );
  const connections = useMemo(() => buildConnections(connectionPoints), [connectionPoints]);
  const connectionsRef = useRef(connections);
  const sessionDots = useMemo(
    () => buildSessionDotsCollection(sessionMarkerPoints),
    [sessionMarkerPoints],
  );
  const sessionDotsRef = useRef(sessionDots);
  const onOpenSessionRef = useRef(onOpenSession);
  const onActiveKeyChangeRef = useRef(onActiveKeyChange);
  const activePoint = sessionMarkerPoints.find((point) => point.key === activeKey) ?? null;

  // Single entry point for selection changes so the parent page always hears
  // about them (it drops its pinned focus target on deselect / reselect).
  function updateActiveKey(key: string | null) {
    setActiveKey(key);
    onActiveKeyChangeRef.current?.(key);
  }
  const updateActiveKeyRef = useRef(updateActiveKey);
  updateActiveKeyRef.current = updateActiveKey;

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    activeKeyRef.current = activeKey;
  }, [activeKey]);

  useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);

  useEffect(() => {
    sessionDotsRef.current = sessionDots;
  }, [sessionDots]);

  useEffect(() => {
    onOpenSessionRef.current = onOpenSession;
  }, [onOpenSession]);

  useEffect(() => {
    onActiveKeyChangeRef.current = onActiveKeyChange;
  }, [onActiveKeyChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    requestAnimationFrame(() => map.resize());
  }, [fullscreen]);

  // Escape clears the dot selection first; a second press exits fullscreen.
  useEffect(() => {
    if (!fullscreen && !activeKey) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (activeKeyRef.current) {
        updateActiveKeyRef.current(null);
        return;
      }
      setFullscreen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen, activeKey]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const initialStyle = mapStyleRef.current === "satellite" ? SATELLITE_STYLE : LIBERTY_STYLE;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: initialStyle,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      minZoom: 1,
      maxZoom: DEFAULT_MAX_ZOOM,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: false,
      renderWorldCopies: true,
      // High-DPI screens multiply the pixels the GL context pushes per frame
      // (2x DPR = 4x fill cost on a near-viewport-sized canvas). Capping at
      // 1.5 keeps pans smooth for a barely perceptible softness on this
      // dark, low-detail style.
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
    });

    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      closeOnMove: false,
      offset: 20,
      className: `map-node-popup-shell map-node-popup-shell-${themeRef.current}`,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      if (mapStyleRef.current !== "satellite") {
        savedPaintsRef.current = captureOriginalPaints(map);
      }
      map.setProjection({ type: "globe" });
      if (mapStyleRef.current === "tactical") {
        styleMap(map, themeRef.current);
      }
      ensureConnections(map, connectionsRef.current);
      ensureSessionDots(map, sessionDotsRef.current, activeKeyRef.current);
      setMapReady(true);
    });

    map.on("styledata", () => {
      if (!map.isStyleLoaded()) {
        // Style still streaming (initial load of the standard style took
        // this path and left the dot/arc layers missing entirely) —
        // re-ensure once rendering settles instead of dropping the pass.
        map.once("idle", () => {
          ensureConnections(map, connectionsRef.current);
          ensureSessionDots(map, sessionDotsRef.current, activeKeyRef.current);
        });
        return;
      }
      ensureConnections(map, connectionsRef.current);
      ensureSessionDots(map, sessionDotsRef.current, activeKeyRef.current);
    });
    map.on("click", (event) => {
      // Hit-test only the small core circles (with a light tolerance box), not the
      // huge blurred glow layer — clicks on visually empty space must DESELECT
      // instead of silently re-selecting the nearest dot's halo.
      const tolerance = 5;
      const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [event.point.x - tolerance, event.point.y - tolerance],
        [event.point.x + tolerance, event.point.y + tolerance],
      ];
      const features = map.getLayer(SESSIONS_CORE_LAYER_ID)
        ? map.queryRenderedFeatures(bbox, { layers: [SESSIONS_CORE_LAYER_ID] })
        : [];
      const rawKey: unknown = features[0]?.properties?.key;
      const key = typeof rawKey === "string" ? rawKey : null;

      if (key) {
        // First click selects (popup + ring); a second click on the same dot drills in.
        const shouldOpenSession = activeKeyRef.current === key;
        updateActiveKeyRef.current(key);

        if (shouldOpenSession) {
          onOpenSessionRef.current(key);
        }

        return;
      }

      updateActiveKeyRef.current(null);
    });
    map.on("mouseenter", SESSIONS_CORE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", SESSIONS_CORE_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });

    // The liquid aurora repaints every frame and competes with the canvas for
    // GPU fill rate — pause it while the map is actually in motion (app-glue
    // styles html.map-moving). movestart/moveend cover drags, wheel zooms and
    // programmatic easeTo/fitBounds flights alike.
    const setMoving = (moving: boolean) => {
      document.documentElement.classList.toggle("map-moving", moving);
    };
    map.on("movestart", () => setMoving(true));
    map.on("moveend", () => setMoving(false));

    // An explicit pixelRatio option freezes maplibre's own DPR tracking, so
    // re-clamp whenever the window lands on a screen with a different DPR.
    let dprMedia: MediaQueryList | null = null;
    const onDprChange = () => {
      map.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      watchDpr();
    };
    const watchDpr = () => {
      dprMedia?.removeEventListener("change", onDprChange);
      dprMedia = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprMedia.addEventListener("change", onDprChange);
    };
    watchDpr();

    return () => {
      dprMedia?.removeEventListener("change", onDprChange);
      setMoving(false);
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const popup = popupRef.current;
    const map = mapRef.current;

    if (popup) {
      popup.removeClassName("map-node-popup-shell-dark");
      popup.removeClassName("map-node-popup-shell-light");
      popup.addClassName(`map-node-popup-shell-${theme}`);
    }

    if (!map || !mapReady) {
      return;
    }

    if (mapStyleRef.current === "tactical") {
      styleMap(map, theme);
    } else if (mapStyleRef.current === "standard" && savedPaintsRef.current) {
      restoreDefaultStyle(map, savedPaintsRef.current);
    }
    ensureConnections(map, connections);

    if (map.isStyleLoaded()) {
      ensureSessionDots(map, sessionDotsRef.current, activeKeyRef.current);
    }
  }, [connections, mapReady, theme]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapReady) {
      return;
    }

    if (map.isStyleLoaded()) {
      ensureSessionDots(map, sessionDots, activeKeyRef.current);
    } else {
      // A data update landing mid style-transition would otherwise be
      // dropped silently (e.g. switching Live -> All time right after
      // cycling the map style left a single stale dot rendered).
      map.once("idle", () => {
        ensureSessionDots(map, sessionDotsRef.current, activeKeyRef.current);
      });
    }

    if (sessionMarkerPoints.length === 0) {
      autoFitRef.current = false;
      if (activeKeyRef.current !== null) updateActiveKeyRef.current(null);
      popupRef.current?.remove();
      return;
    }

    if (!autoFitRef.current) {
      fitToPoints(map, sessionMarkerPoints);
      autoFitRef.current = true;
    }

    if (
      activeKeyRef.current &&
      !sessionMarkerPoints.some((point) => point.key === activeKeyRef.current)
    ) {
      updateActiveKeyRef.current(null);
    }
  }, [mapReady, sessionDots, sessionMarkerPoints]);

  useEffect(() => {
    const popup = popupRef.current;
    const map = mapRef.current;

    if (!popup || !map || !mapReady) {
      return;
    }

    if (map.getLayer(SESSIONS_RING_LAYER_ID)) {
      map.setFilter(SESSIONS_RING_LAYER_ID, ["==", ["get", "key"], activeKey ?? NO_ACTIVE_DOT_KEY]);
    }

    if (!activePoint) {
      popup.remove();
      return;
    }

    popup.setLngLat(activePoint.coordinates).setHTML(buildPopupMarkup(activePoint)).addTo(map);

    // setHTML replaces the DOM each time, so the close button is re-wired per render.
    popup
      .getElement()
      ?.querySelector<HTMLButtonElement>(".map-node-popup-close")
      ?.addEventListener("click", () => updateActiveKeyRef.current(null));
  }, [activeKey, activePoint, mapReady]);

  useEffect(() => {
    if (!focusedKey || focusedToken <= 0) {
      return;
    }

    // Each show-on-map click bumps the token. Handle it exactly once: data polls
    // refresh sessionPoints (new identity) and must NOT re-fly to / reopen the
    // focused dot after the owner has dismissed it and panned away.
    const focusStamp = `${focusedKey}#${focusedToken}`;
    if (handledFocusRef.current === focusStamp) {
      return;
    }

    const map = mapRef.current;

    if (!map || !mapReady) {
      return;
    }

    const point = sessionMarkerPoints.find((entry) => entry.key === focusedKey);

    if (!point) {
      // Leave the stamp unhandled so the focus completes once the dot arrives.
      return;
    }

    handledFocusRef.current = focusStamp;
    setActiveKey(point.key);
    map.easeTo({
      center: point.coordinates,
      zoom: Math.max(map.getZoom(), point.precise ? 9.6 : PRIMARY_MARKET_ZOOM),
      duration: motionDuration(900),
    });
  }, [focusedKey, focusedToken, mapReady, sessionMarkerPoints]);

  function focusLiveMarkets() {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    fitToPoints(map, sessionMarkerPoints, true);
  }

  function focusPrimaryMarket() {
    const map = mapRef.current;

    if (!map || !activePoint) {
      return;
    }

    map.easeTo({
      center: activePoint.coordinates,
      zoom: Math.max(map.getZoom(), PRIMARY_MARKET_ZOOM),
      duration: motionDuration(900),
    });
  }

  function openActiveSession() {
    if (!activePoint) {
      return;
    }

    onOpenSession(activePoint.key);
  }

  function cycleMapStyle() {
    const map = mapRef.current;
    if (!map) return;
    const idx = MAP_STYLE_ORDER.indexOf(mapStyle);
    const next = MAP_STYLE_ORDER[(idx + 1) % MAP_STYLE_ORDER.length];
    const prev = mapStyle;
    mapStyleRef.current = next;
    setMapStyle(next);
    localStorage.setItem("rr:map-style", next);

    const needsSetStyle = prev === "satellite" || next === "satellite";

    if (needsSetStyle) {
      const style = next === "satellite" ? SATELLITE_STYLE : LIBERTY_STYLE;
      map.setStyle(style);
      map.once("idle", () => {
        if (next !== "satellite" && !savedPaintsRef.current) {
          savedPaintsRef.current = captureOriginalPaints(map);
        }
        map.setProjection({ type: globe ? "globe" : "mercator" });
        if (next === "tactical") {
          styleMap(map, themeRef.current);
        }
        ensureConnections(map, connectionsRef.current);
        ensureSessionDots(map, sessionDotsRef.current, activeKeyRef.current);
      });
    } else {
      // tactical <-> standard: instant paint swap
      if (next === "tactical") {
        styleMap(map, themeRef.current);
      } else if (savedPaintsRef.current) {
        restoreDefaultStyle(map, savedPaintsRef.current);
      }
    }
  }

  function toggleProjection() {
    const map = mapRef.current;
    if (!map) return;
    const next = globe ? "mercator" : "globe";
    map.setProjection({ type: next as "mercator" | "globe" });
    setGlobe(!globe);
  }

  return (
    <div
      className={`world-heatmap world-heatmap-live world-heatmap-${theme}${fullscreen ? " world-heatmap-fullscreen" : ""}`}
    >
      <div className="world-heatmap-map-shell">
        <div ref={containerRef} className="world-heatmap-map" />
        <div className="world-heatmap-overlay" />

        {showPanel ? (
          <div className="world-heatmap-floating-panel">
            <div className="world-heatmap-floating-head">
              <Globe2 className="h-4 w-4" />
              <span>Live Earth</span>
              <button
                type="button"
                className="btn-icon"
                style={{ marginLeft: "auto", padding: 2 }}
                onClick={() => setShowPanel(false)}
                aria-label="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <strong>
              {activePoint
                ? `${activePoint.flag ? `${activePoint.flag} ` : ""}${activePoint.label}`
                : "Select a live node"}
            </strong>
            {activePoint?.userLabel?.trim() ? (
              <div className="world-heatmap-floating-session">{activePoint.userLabel.trim()}</div>
            ) : null}
            <p>
              {activePoint
                ? `${activePoint.locationLabel !== activePoint.label ? `${activePoint.locationLabel} · ` : ""}${formatNumber(activePoint.marketValue)} live sessions · ${activePoint.region}${activePoint.geoSource ? ` · ${formatGeoSource(activePoint.geoSource, activePoint.geoSignalSource)}` : ""}${activePoint.accuracyMeters !== null ? ` · ±${formatAccuracy(activePoint.accuracyMeters)}` : ""}`
                : "Click a turquoise pulse to lock its label. Click that same pulse again, or use the action below, to jump into the live session table."}
            </p>
            {activePoint ? (
              <div className="world-heatmap-floating-actions">
                <button type="button" className="btn-primary" onClick={openActiveSession}>
                  Open live session
                </button>
                <button type="button" className="btn-ghost" onClick={() => updateActiveKey(null)}>
                  Clear
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {activePoint ? (
          <button
            type="button"
            className="world-heatmap-clear-chip"
            onClick={() => updateActiveKey(null)}
            title="Deselect (Esc)"
          >
            <X className="h-3.5 w-3.5" />
            Clear selection
          </button>
        ) : null}

        <div className="world-heatmap-hovbar">
          <button type="button" className="world-heatmap-hovbar-trigger" aria-label="Map controls">
            <Menu className="h-4 w-4" />
          </button>
          <div className="world-heatmap-hovbar-items">
            {/* Zoom */}
            <button
              type="button"
              onClick={() => mapRef.current?.zoomIn({ duration: motionDuration(300) })}
              aria-label="Zoom in"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => mapRef.current?.zoomOut({ duration: motionDuration(300) })}
              aria-label="Zoom out"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="world-heatmap-hovbar-sep" />
            {/* Navigate */}
            <button type="button" onClick={focusLiveMarkets} aria-label="Focus live markets">
              <LocateFixed className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={focusPrimaryMarket}
              disabled={!activePoint}
              aria-label="Zoom to selected"
            >
              <Crosshair className="h-4 w-4" />
            </button>
            <span className="world-heatmap-hovbar-sep" />
            {/* View */}
            <button
              type="button"
              onClick={cycleMapStyle}
              aria-label={`Map style: ${MAP_STYLE_LABELS[mapStyle]}`}
              title={MAP_STYLE_LABELS[mapStyle]}
            >
              <Layers className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={toggleProjection}
              aria-label={globe ? "Switch to flat map" : "Switch to globe"}
            >
              {globe ? <MapIcon className="h-4 w-4" /> : <Globe2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setFullscreen((f) => !f)}
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setShowPanel((p) => !p)}
              aria-label="Toggle info panel"
            >
              <Info className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
