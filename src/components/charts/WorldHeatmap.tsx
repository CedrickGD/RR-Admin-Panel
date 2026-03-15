import { Crosshair, Globe2, LocateFixed } from "lucide-react";
import maplibregl, {
  type GeoJSONSource,
  LngLatBounds,
  Marker,
  Popup,
} from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, LineString } from "geojson";
import type { ThemeMode } from "../../types/telemetry";
import type {
  HeatmapPoint,
  HeatmapSessionPoint,
} from "../../utils/dashboardInsights";
import { formatNumber } from "../../utils/format";

interface WorldHeatmapProps {
  marketPoints: HeatmapPoint[];
  sessionPoints: HeatmapSessionPoint[];
  theme: ThemeMode;
  onOpenSession: (sessionId: string) => void;
  focusedSessionId?: string | null;
  focusedSessionToken?: number;
}

interface MarketMapPoint extends HeatmapPoint {
  key: string;
  coordinates: [number, number];
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

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const CONNECTIONS_SOURCE_ID = "active-connections";
const CONNECTIONS_GLOW_LAYER_ID = "active-connections-glow";
const CONNECTIONS_LINE_LAYER_ID = "active-connections-line";
const INITIAL_CENTER: [number, number] = [12, 20];
const INITIAL_ZOOM = 1.45;
const DEFAULT_MAX_ZOOM = 18.8;
const PRIMARY_MARKET_ZOOM = 8.2;
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

function buildMarketPoints(points: HeatmapPoint[]): MarketMapPoint[] {
  return points
    .filter(
      (point) =>
        Number.isFinite(point.longitude ?? Number.NaN) &&
        Number.isFinite(point.latitude ?? Number.NaN),
    )
    .map((point) => ({
      ...point,
      key: point.code ?? point.label,
      coordinates: [Number(point.longitude), Number(point.latitude)],
    }));
}

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

function buildConnections(points: MarketMapPoint[]): FeatureCollection<LineString> {
  const edges = new Map<
    string,
    { coordinates: [[number, number], [number, number]]; weight: number }
  >();
  const hubs = [...points].sort((left, right) => right.value - left.value).slice(0, 8);

  const addEdge = (from: MarketMapPoint, to: MarketMapPoint, weight: number) => {
    const key = from.key < to.key ? `${from.key}:${to.key}` : `${to.key}:${from.key}`;
    const current = edges.get(key);

    if (!current || current.weight < weight) {
      edges.set(key, {
        coordinates: [from.coordinates, to.coordinates],
        weight,
      });
    }
  };

  for (const point of points) {
    const neighbors = points
      .filter((candidate) => candidate !== point)
      .map((candidate) => ({
        candidate,
        distance: Math.hypot(
          candidate.coordinates[0] - point.coordinates[0],
          candidate.coordinates[1] - point.coordinates[1],
        ),
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 2);

    for (const neighbor of neighbors) {
      if (neighbor.distance <= 42) {
        addEdge(point, neighbor.candidate, 1 - (neighbor.distance / 42));
      }
    }
  }

  if (hubs.length > 1) {
    const anchor = hubs[0];

    for (const hub of hubs.slice(1)) {
      const distance = Math.hypot(
        hub.coordinates[0] - anchor.coordinates[0],
        hub.coordinates[1] - anchor.coordinates[1],
      );

      if (distance <= 140) {
        addEdge(anchor, hub, 1 - (distance / 140));
      }
    }
  }

  return {
    type: "FeatureCollection",
    features: Array.from(edges.values()).map((edge) => ({
      type: "Feature",
      properties: {
        weight: edge.weight,
      },
      geometry: {
        type: "LineString",
        coordinates: edge.coordinates,
      },
    })),
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
  const hint = `<div class="map-node-popup-hint">Open the selected session from the side panel.</div>`;

  return `
    <div class="map-node-popup-card">
      <div class="map-node-popup-kicker">ACTIVE NOW</div>
      <div class="map-node-popup-title">${flag}${escapeHtml(point.label)}</div>
      ${location}
      ${session}
      <div class="map-node-popup-meta">${formatNumber(point.marketValue)} live sessions · ${escapeHtml(point.region)}</div>
      ${hint}
    </div>
  `;
}

function fitToPoints(
  map: maplibregl.Map,
  points: Array<{ coordinates: [number, number] }>,
) {
  if (points.length === 0) {
    map.easeTo({ center: INITIAL_CENTER, zoom: INITIAL_ZOOM, duration: 700 });
    return;
  }

  if (points.length === 1) {
    map.easeTo({ center: points[0].coordinates, zoom: 4.9, duration: 800 });
    return;
  }

  const bounds = new LngLatBounds(points[0].coordinates, points[0].coordinates);

  for (const point of points.slice(1)) {
    bounds.extend(point.coordinates);
  }

  map.fitBounds(bounds, {
    padding: 90,
    maxZoom: 6.2,
    duration: 900,
  });
}

function createMarkerElement(point: SessionMapPoint) {
  const button = document.createElement("button");
  const size = (point.precise ? 4.6 : 5) + (point.intensity * 3.6);
  const pulseScale = point.precise ? 1.95 : 2.15;
  const pulseOpacity = 0.1 + (point.intensity * 0.1);

  button.type = "button";
  button.className = `map-node-marker ${point.precise ? "map-node-marker-precise" : "map-node-marker-spread"}`;
  button.setAttribute("aria-label", `${point.label}: ${point.marketValue} active users`);
  button.title = `${point.label} · ${formatNumber(point.marketValue)} live sessions`;
  button.style.setProperty("--map-node-size", `${size}px`);
  button.style.setProperty("--map-node-pulse-scale", pulseScale.toFixed(2));
  button.style.setProperty("--map-node-pulse-opacity", pulseOpacity.toFixed(3));
  button.innerHTML = `
    <span class="map-node-pulse"></span>
    <span class="map-node-halo"></span>
    <span class="map-node-core"></span>
  `;

  return button;
}

function createPalette(theme: ThemeMode): MapPalette {
  if (theme === "light") {
    return {
      background: "#dfeef7",
      naturalEarthOpacity: 0.08,
      naturalEarthSaturation: -0.06,
      naturalEarthContrast: 0.06,
      water: "#d4e7f3",
      waterLine: "#3599c1",
      vegetation: "#deedf3",
      vegetationOutline: "#bed8e5",
      land: "#edf6fb",
      residential: "#f5fbfe",
      airport: "#d6e2ea",
      boundary: "#4c728f",
      boundarySubtle: "#8ca9bf",
      building: "#dae5ed",
      buildingOutline: "#bfd2df",
      buildingExtrusion: "#c9dce7",
      roadCasingStrong: "#7faeca",
      roadCasingSoft: "#a4c2d5",
      motorway: "#5299c9",
      trunk: "#5e8db3",
      secondary: "#7aa9c7",
      minor: "#a7c7d9",
      link: "#86b6d1",
      rail: "#7b90a4",
      country1: "#0f3450",
      country2: "#1d4d6c",
      country3: "#2b667f",
      city: "#0f766e",
      capital: "#0284c7",
      halo: "rgba(255, 255, 255, 0.94)",
    };
  }

  return {
    background: "#07111c",
    naturalEarthOpacity: 0.15,
    naturalEarthSaturation: -0.44,
    naturalEarthContrast: 0.14,
    water: "#071a28",
    waterLine: "#1692ba",
    vegetation: "#0d2432",
    vegetationOutline: "#173748",
    land: "#0b1b28",
    residential: "#10212d",
    airport: "#183241",
    boundary: "#345975",
    boundarySubtle: "#223b50",
    building: "#102330",
    buildingOutline: "#1b374a",
    buildingExtrusion: "#153243",
    roadCasingStrong: "#173951",
    roadCasingSoft: "#102738",
    motorway: "#2e8ebc",
    trunk: "#27739a",
    secondary: "#1f5979",
    minor: "#173c55",
    link: "#1c4c67",
    rail: "#5a7186",
    country1: "#ebf6ff",
    country2: "#c8e1ff",
    country3: "#9fccff",
    city: "#67e8f9",
    capital: "#99f6e4",
    halo: "rgba(2, 6, 23, 0.9)",
  };
}

function resolveRoadColor(
  layerId: string,
  palette: MapPalette,
  isCasing: boolean,
): string {
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

    if ((id === "park" || id.startsWith("landcover_") || id.startsWith("landuse_")) && type === "fill") {
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

function ensureConnections(
  map: maplibregl.Map,
  connections: FeatureCollection<LineString>,
) {
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
        "line-color": "rgba(34,211,238,0.18)",
        "line-width": ["interpolate", ["linear"], ["get", "weight"], 0, 1, 1, 3.2],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.48, 7, 0.2],
        "line-blur": 1.3,
      },
    });
  }

  if (!map.getLayer(CONNECTIONS_LINE_LAYER_ID)) {
    map.addLayer({
      id: CONNECTIONS_LINE_LAYER_ID,
      type: "line",
      source: CONNECTIONS_SOURCE_ID,
      paint: {
        "line-color": "rgba(125,211,252,0.72)",
        "line-width": ["interpolate", ["linear"], ["get", "weight"], 0, 0.6, 1, 1.5],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.76, 7, 0.36],
        "line-dasharray": [2, 1.5],
      },
    });
  }
}

export function WorldHeatmap({
  marketPoints,
  sessionPoints,
  theme,
  onOpenSession,
  focusedSessionId = null,
  focusedSessionToken = 0,
}: WorldHeatmapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const markersRef = useRef<Array<{ key: string; marker: Marker; element: HTMLButtonElement }>>([]);
  const autoFitRef = useRef(false);
  const themeRef = useRef(theme);
  const activeKeyRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const marketMarkerPoints = useMemo(() => buildMarketPoints(marketPoints), [marketPoints]);
  const sessionMarkerPoints = useMemo(() => buildSessionPoints(sessionPoints), [sessionPoints]);
  const connections = useMemo(() => buildConnections(marketMarkerPoints), [marketMarkerPoints]);
  const connectionsRef = useRef(connections);
  const activePoint = sessionMarkerPoints.find((point) => point.key === activeKey) ?? null;

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
    if (!containerRef.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      minZoom: 1,
      maxZoom: DEFAULT_MAX_ZOOM,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: false,
      renderWorldCopies: true,
    });

    const applyStyle = () => {
      if (!map.isStyleLoaded()) {
        return;
      }

      styleMap(map, themeRef.current);
      ensureConnections(map, connectionsRef.current);
    };

    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      closeOnMove: false,
      offset: 20,
      className: `map-node-popup-shell map-node-popup-shell-${themeRef.current}`,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: false }), "top-right");
    map.addControl(new maplibregl.GlobeControl(), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      map.setProjection({ type: "globe" });
      applyStyle();
      setMapReady(true);
      setZoom(map.getZoom());
    });

    map.on("styledata", applyStyle);
    map.on("zoom", () => {
      setZoom(map.getZoom());
    });
    map.on("click", (event) => {
      const target = event.originalEvent.target;
      if (target instanceof Element && target.closest(".map-node-marker")) {
        return;
      }

      setActiveKey(null);
    });

    return () => {
      popupRef.current?.remove();
      popupRef.current = null;

      for (const item of markersRef.current) {
        item.marker.remove();
      }

      markersRef.current = [];
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

    styleMap(map, theme);
    ensureConnections(map, connections);
  }, [connections, mapReady, theme]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapReady) {
      return;
    }

    ensureConnections(map, connections);
  }, [connections, mapReady]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapReady) {
      return;
    }

    for (const item of markersRef.current) {
      item.marker.remove();
    }

    markersRef.current = [];

    for (const point of sessionMarkerPoints) {
      const element = createMarkerElement(point);
      const marker = new maplibregl.Marker({
        element,
        anchor: "center",
      })
        .setLngLat(point.coordinates)
        .addTo(map);

      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const shouldOpenSession = activeKeyRef.current === point.key;
        setActiveKey(point.key);

        if (shouldOpenSession) {
          onOpenSession(point.key);
        }
      });

      markersRef.current.push({ key: point.key, marker, element });
    }

    if (sessionMarkerPoints.length === 0) {
      autoFitRef.current = false;
      setActiveKey(null);
      popupRef.current?.remove();
      return;
    }

    if (!autoFitRef.current) {
      fitToPoints(map, sessionMarkerPoints);
      autoFitRef.current = true;
    }

    if (!sessionMarkerPoints.some((point) => point.key === activeKeyRef.current)) {
      setActiveKey(null);
    }
  }, [mapReady, sessionMarkerPoints]);

  useEffect(() => {
    const popup = popupRef.current;
    const map = mapRef.current;

    if (!popup || !map || !mapReady) {
      return;
    }

    for (const item of markersRef.current) {
      item.element.classList.toggle("map-node-marker-active", item.key === activeKey);
    }

    if (!activePoint) {
      popup.remove();
      return;
    }

    popup
      .setLngLat(activePoint.coordinates)
      .setHTML(buildPopupMarkup(activePoint))
      .addTo(map);
  }, [activeKey, activePoint, mapReady]);

  useEffect(() => {
    if (!focusedSessionId || focusedSessionToken <= 0) {
      return;
    }

    const map = mapRef.current;

    if (!map || !mapReady) {
      return;
    }

    const point = sessionMarkerPoints.find((entry) => entry.key === focusedSessionId);

    if (!point) {
      return;
    }

    setActiveKey(point.key);
    map.easeTo({
      center: point.coordinates,
      zoom: Math.max(map.getZoom(), point.precise ? 9.6 : PRIMARY_MARKET_ZOOM),
      duration: 900,
    });
  }, [focusedSessionId, focusedSessionToken, mapReady, sessionMarkerPoints]);

  function focusLiveMarkets() {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    fitToPoints(map, sessionMarkerPoints);
  }

  function focusPrimaryMarket() {
    const map = mapRef.current;

    if (!map || !activePoint) {
      return;
    }

    map.easeTo({
      center: activePoint.coordinates,
      zoom: Math.max(map.getZoom(), PRIMARY_MARKET_ZOOM),
      duration: 900,
    });
  }

  function openActiveSession() {
    if (!activePoint) {
      return;
    }

    onOpenSession(activePoint.key);
  }

  if (sessionMarkerPoints.length === 0) {
    return <div className="empty-panel small">No active geo signals are available right now.</div>;
  }

  return (
    <div className={`world-heatmap world-heatmap-live world-heatmap-${theme}`}>
      <div className="world-heatmap-toolbar">
        <div className="world-heatmap-hint">
          <span>Interactive map</span>
          <strong>Every active session gets its own micro-node. Click a pulse to lock its label, then open that exact user in Live.</strong>
        </div>
        <div className="world-heatmap-toolbar-metrics">
          <div>
            <span>Zoom</span>
            <strong>{zoom.toFixed(1)}x</strong>
          </div>
          <div>
            <span>Live users</span>
            <strong>{formatNumber(sessionMarkerPoints.length)}</strong>
          </div>
          <div>
            <span>Markets</span>
            <strong>{formatNumber(marketMarkerPoints.length)}</strong>
          </div>
        </div>
      </div>

      <div className="world-heatmap-map-shell">
        <div ref={containerRef} className="world-heatmap-map" />
        <div className="world-heatmap-overlay" />

        <div className="world-heatmap-floating-panel">
          <div className="world-heatmap-floating-head">
            <Globe2 className="h-4 w-4" />
            <span>Live Earth</span>
          </div>
          <strong>
            {activePoint ? `${activePoint.flag ? `${activePoint.flag} ` : ""}${activePoint.label}` : "Select a live node"}
          </strong>
          {activePoint?.userLabel?.trim() ? (
            <div className="world-heatmap-floating-session">{activePoint.userLabel.trim()}</div>
          ) : null}
          <p>
            {activePoint
              ? `${activePoint.locationLabel !== activePoint.label ? `${activePoint.locationLabel} · ` : ""}${formatNumber(activePoint.marketValue)} live sessions · ${activePoint.region}`
              : "Click a turquoise pulse to lock its label. Click that same pulse again, or use the action below, to jump into the live session table."}
          </p>
          {activePoint ? (
            <div className="world-heatmap-floating-actions">
              <button type="button" className="btn-primary" onClick={openActiveSession}>
                Open live session
              </button>
              <button type="button" className="btn-ghost" onClick={() => setActiveKey(null)}>
                Clear
              </button>
            </div>
          ) : null}
        </div>

        <div className="world-heatmap-action-stack">
          <button type="button" className="world-heatmap-chip" onClick={focusLiveMarkets}>
            <LocateFixed className="h-4 w-4" />
            Focus live
          </button>
          <button type="button" className="world-heatmap-chip" onClick={focusPrimaryMarket} disabled={!activePoint}>
            <Crosshair className="h-4 w-4" />
            Zoom selected
          </button>
        </div>
      </div>
    </div>
  );
}
