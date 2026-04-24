import { useEffect, useRef } from "react";
import maplibregl, {
  type LngLatLike,
  type Map as MlMap,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Identity, PeerState, Position, SharedMarker } from "@/lib/tactrack/types";
import { renderToStaticMarkup } from "react-dom/server";
import { MARKER_ICONS } from "./MarkerIcon";

type Props = {
  self: Identity;
  selfPos: Position | null;
  peers: PeerState[];
  markers: SharedMarker[];
  basemap: BasemapMode;
  followMe: boolean;
  onLongPress: (lat: number, lng: number) => void;
  onMarkerClick: (markerId: string) => void;
  onPeerClick: (peerId: string) => void;
  centerRequest?: { lat: number; lng: number; ts: number } | null;
};

const OSM_STREETS_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "(c) OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [{ id: "osm-streets", type: "raster", source: "osm" }],
};
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    esri: {
      type: "raster",
      tiles: [
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "(c) Esri, Maxar, Earthstar Geographics",
      maxzoom: 19,
    },
  },
  layers: [{ id: "esri-satellite", type: "raster", source: "esri" }],
};
const TOPO_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    opentopo: {
      type: "raster",
      tiles: [
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "(c) OpenStreetMap contributors, SRTM | (c) OpenTopoMap (CC-BY-SA)",
      maxzoom: 17,
    },
  },
  layers: [{ id: "opentopo", type: "raster", source: "opentopo" }],
};

export type BasemapMode = "streets" | "satellite" | "topo";

function getStyleForBasemap(mode: BasemapMode): StyleSpecification {
  if (mode === "satellite") return JSON.parse(JSON.stringify(SATELLITE_STYLE)) as StyleSpecification;
  if (mode === "topo") return JSON.parse(JSON.stringify(TOPO_STYLE)) as StyleSpecification;
  return JSON.parse(JSON.stringify(OSM_STREETS_STYLE)) as StyleSpecification;
}

function arrowSvg(color: string, heading: number | null | undefined, isSelf: boolean) {
  const rot = heading ?? 0;
  const ring = isSelf
    ? `<circle cx="20" cy="20" r="18" fill="none" stroke="${color}" stroke-width="2" opacity="0.5"/>`
    : "";
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
      ${ring}
      <g transform="rotate(${rot} 20 20)">
        <path d="M20 4 L30 30 L20 24 L10 30 Z" fill="${color}" stroke="#0c1220" stroke-width="1.5"/>
      </g>
    </svg>
  `;
}

export function MapView(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const peerMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const sharedMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const selfMarkerRef = useRef<maplibregl.Marker | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: getStyleForBasemap(props.basemap),
        center: [12.4964, 41.9028], // Rome default
        zoom: 11,
        attributionControl: { compact: true },
      });
    } catch (e) {
      console.warn("map init failed", e);
      return;
    }

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    mapRef.current = map;
    requestAnimationFrame(() => map.resize());
    map.on("load", () => map.resize());

    let fallbackApplied = false;
    const applyFallbackStyle = () => {
      if (fallbackApplied || !mapRef.current) return;
      fallbackApplied = true;
      mapRef.current.setStyle(getStyleForBasemap("streets"));
    };

    map.on("error", (event) => {
      const message = (
        (event as { error?: { message?: string } }).error?.message ?? ""
      ).toLowerCase();
      if (
        message.includes("style") ||
        message.includes("sprite") ||
        message.includes("glyph") ||
        message.includes("source") ||
        message.includes("tile") ||
        message.includes("fetch") ||
        message.includes("network") ||
        message.includes("cors") ||
        message.includes("cross-origin")
      ) {
        applyFallbackStyle();
      }
    });

    const startLongPress = (lngLat: maplibregl.LngLat) => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = setTimeout(() => {
        props.onLongPress(lngLat.lat, lngLat.lng);
      }, 600);
    };
    const cancelLongPress = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };

    map.on("mousedown", (e) => startLongPress(e.lngLat));
    map.on("mouseup", cancelLongPress);
    map.on("mousemove", cancelLongPress);
    map.on("touchstart", (e) => startLongPress(e.lngLat));
    map.on("touchend", cancelLongPress);
    map.on("touchmove", cancelLongPress);
    map.on("contextmenu", (e) => {
      e.preventDefault();
      props.onLongPress(e.lngLat.lat, e.lngLat.lng);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      map.setStyle(getStyleForBasemap(props.basemap));
    } catch (e) {
      console.warn("basemap switch failed", e);
      map.setStyle(getStyleForBasemap("streets"));
    }
  }, [props.basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.selfPos) return;
    const el = document.createElement("div");
    el.innerHTML = arrowSvg(props.self.color, props.selfPos.heading ?? null, true);
    if (selfMarkerRef.current) {
      selfMarkerRef.current
        .setLngLat([props.selfPos.lng, props.selfPos.lat])
        .getElement().innerHTML = arrowSvg(props.self.color, props.selfPos.heading ?? null, true);
    } else {
      selfMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([props.selfPos.lng, props.selfPos.lat])
        .addTo(map);
    }
    if (props.followMe) {
      map.easeTo({ center: [props.selfPos.lng, props.selfPos.lat], duration: 500 });
    }
  }, [props.selfPos, props.self.color, props.followMe]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    for (const peer of props.peers) {
      if (!peer.pos) continue;
      seen.add(peer.id);
      const stale = Date.now() - peer.lastSeen > 30_000;
      const opacity = stale ? "0.5" : "1";
      let m = peerMarkersRef.current.get(peer.id);
      const html = `
        <div style="opacity:${opacity};display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer">
          ${arrowSvg(peer.color, peer.pos.heading ?? null, false)}
          <div style="background:#0c1220cc;color:${peer.color};font:600 10px ui-monospace,monospace;padding:1px 6px;border-radius:4px;border:1px solid ${peer.color}">${peer.callsign}</div>
        </div>`;
      if (!m) {
        const el = document.createElement("div");
        el.innerHTML = html;
        el.addEventListener("click", () => props.onPeerClick(peer.id));
        m = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([peer.pos.lng, peer.pos.lat])
          .addTo(map);
        peerMarkersRef.current.set(peer.id, m);
      } else {
        m.setLngLat([peer.pos.lng, peer.pos.lat]);
        m.getElement().innerHTML = html;
      }
    }
    for (const [id, m] of peerMarkersRef.current) {
      if (!seen.has(id)) {
        m.remove();
        peerMarkersRef.current.delete(id);
      }
    }
  }, [props.peers, props.onPeerClick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    for (const mk of props.markers) {
      if (mk.deleted) continue;
      seen.add(mk.id);
      const entry = MARKER_ICONS.find((x) => x.key === mk.icon) ?? MARKER_ICONS[0];
      const Icon = entry.Icon;
      const svg = renderToStaticMarkup(
        <Icon size={28} color={mk.color} strokeWidth={2.5} fill={mk.color + "33"} />,
      );
      const html = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;filter:drop-shadow(0 0 4px ${mk.color}88)">
          ${svg}
          <div style="background:#0c1220e0;color:#fff;font:500 10px ui-sans-serif;padding:1px 5px;border-radius:3px;border:1px solid ${mk.color};max-width:120px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(mk.label)}</div>
        </div>`;
      let m = sharedMarkersRef.current.get(mk.id);
      if (!m) {
        const el = document.createElement("div");
        el.innerHTML = html;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          props.onMarkerClick(mk.id);
        });
        m = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([mk.lng, mk.lat])
          .addTo(map);
        sharedMarkersRef.current.set(mk.id, m);
      } else {
        m.setLngLat([mk.lng, mk.lat]);
        m.getElement().innerHTML = html;
      }
    }
    for (const [id, m] of sharedMarkersRef.current) {
      if (!seen.has(id)) {
        m.remove();
        sharedMarkersRef.current.delete(id);
      }
    }
  }, [props.markers, props.onMarkerClick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.centerRequest) return;
    const c: LngLatLike = [props.centerRequest.lng, props.centerRequest.lat];
    map.flyTo({ center: c, zoom: Math.max(map.getZoom(), 15), speed: 1.2 });
  }, [props.centerRequest]);

  return <div ref={containerRef} className="absolute inset-0" style={{ width: "100%", height: "100%" }} />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
