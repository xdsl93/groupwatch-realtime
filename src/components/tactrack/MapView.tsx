import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type LngLatLike, type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PeerState, SharedMarker, Identity, Position } from "@/lib/tactrack/types";
import { MARKER_ICONS } from "./MarkerIcon";
import { renderToStaticMarkup } from "react-dom/server";

type Props = {
  self: Identity;
  selfPos: Position | null;
  peers: PeerState[];
  markers: SharedMarker[];
  followMe: boolean;
  onLongPress: (lat: number, lng: number) => void;
  onMarkerClick: (markerId: string) => void;
  onPeerClick: (peerId: string) => void;
  centerRequest?: { lat: number; lng: number; ts: number } | null;
};

const FALLBACK_STYLE = {
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
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

function arrowSvg(color: string, heading: number | null | undefined, isSelf: boolean) {
  const rot = heading ?? 0;
  const ring = isSelf ? `<circle cx="20" cy="20" r="18" fill="none" stroke="${color}" stroke-width="2" opacity="0.5"/>` : "";
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
  const [iframeFallback, setIframeFallback] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const peerMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const sharedMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const selfMarkerRef = useRef<maplibregl.Marker | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Init
  useEffect(() => {
    if (!containerRef.current) return;
    if (typeof maplibregl.supported === "function" && !maplibregl.supported()) {
      setIframeFallback(true);
      return;
    }

    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: FALLBACK_STYLE,
        center: [12.4964, 41.9028],
        zoom: 4,
        attributionControl: { compact: true },
      });
    } catch (e) {
      console.warn("map init failed", e);
      setIframeFallback(true);
      return;
    }

    let loaded = false;
    const hardFallbackTimeout = setTimeout(() => {
      if (!loaded) setIframeFallback(true);
    }, 12000);
    map.once("idle", () => {
      loaded = true;
      clearTimeout(hardFallbackTimeout);
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    mapRef.current = map;
    let fallbackApplied = false;

    const applyFallbackStyle = () => {
      if (fallbackApplied || !mapRef.current) return;
      fallbackApplied = true;
      mapRef.current.setStyle(FALLBACK_STYLE);
    };

    map.on("error", (event) => {
      const message = ((event as { error?: { message?: string } }).error?.message ?? "").toLowerCase();
      // If style/glyph/sprite/tile fetch fails, switch to a resilient raster fallback.
      if (
        message.includes("style") ||
        message.includes("sprite") ||
        message.includes("glyph") ||
        message.includes("source") ||
        message.includes("tile") ||
        message.includes("fetch") ||
        message.includes("network")
      ) {
        applyFallbackStyle();
      }
    });

    // Long-press / right-click to drop marker
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
      clearTimeout(hardFallbackTimeout);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Self marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.selfPos) return;
    const el = document.createElement("div");
    el.innerHTML = arrowSvg(props.self.color, props.selfPos.heading ?? null, true);
    if (selfMarkerRef.current) {
      selfMarkerRef.current
        .setLngLat([props.selfPos.lng, props.selfPos.lat])
        .getElement().innerHTML = arrowSvg(
          props.self.color,
          props.selfPos.heading ?? null,
          true,
        );
    } else {
      selfMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([props.selfPos.lng, props.selfPos.lat])
        .addTo(map);
    }
    if (props.followMe) {
      map.easeTo({ center: [props.selfPos.lng, props.selfPos.lat], duration: 500 });
    }
  }, [props.selfPos, props.self.color, props.followMe]);

  // Peers
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
    // Remove gone peers
    for (const [id, m] of peerMarkersRef.current) {
      if (!seen.has(id)) {
        m.remove();
        peerMarkersRef.current.delete(id);
      }
    }
  }, [props.peers, props.onPeerClick]);

  // Shared markers
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

  // Center request (e.g. tap on roster)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.centerRequest) return;
    const c: LngLatLike = [props.centerRequest.lng, props.centerRequest.lat];
    map.flyTo({ center: c, zoom: Math.max(map.getZoom(), 15), speed: 1.2 });
  }, [props.centerRequest]);

  const iframeSrc = useMemo(() => {
    const lat = props.selfPos?.lat ?? props.centerRequest?.lat ?? 41.9028;
    const lng = props.selfPos?.lng ?? props.centerRequest?.lng ?? 12.4964;
    const delta = 0.06;
    const minLon = (lng - delta).toFixed(6);
    const minLat = (lat - delta).toFixed(6);
    const maxLon = (lng + delta).toFixed(6);
    const maxLat = (lat + delta).toFixed(6);
    return `https://www.openstreetmap.org/export/embed.html?bbox=${minLon}%2C${minLat}%2C${maxLon}%2C${maxLat}&layer=mapnik&marker=${lat.toFixed(6)}%2C${lng.toFixed(6)}`;
  }, [props.selfPos, props.centerRequest]);

  if (iframeFallback) {
    return (
      <iframe
        title="map-fallback"
        src={iframeSrc}
        className="absolute inset-0 h-full w-full border-0"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    );
  }

  return <div ref={containerRef} className="absolute inset-0" />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
