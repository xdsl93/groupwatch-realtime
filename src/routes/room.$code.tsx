import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft,
  Battery,
  Crosshair,
  Download,
  LogOut,
  MapPin,
  Plus,
  QrCode as QrIcon,
  Sun,
  Trash2,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { MapView } from "@/components/tactrack/MapView";
import { MARKER_ICONS, MarkerIconView } from "@/components/tactrack/MarkerIcon";
import { QrCode } from "@/components/tactrack/QrCode";
import { ensureIdentity } from "@/lib/tactrack/identity";
import { Mesh } from "@/lib/tactrack/mesh";
import {
  getRoomMarkers,
  putMarker,
  removeMarker,
  saveRoom,
} from "@/lib/tactrack/db";
import type { Identity, PeerState, Position, SharedMarker, WireMessage } from "@/lib/tactrack/types";
import { PALETTE, bearingDeg, formatDistance, formatRelative, haversineMeters } from "@/lib/tactrack/geo";

const search = z.object({ k: z.string() });

export const Route = createFileRoute("/room/$code")({
  validateSearch: (s) => search.parse(s),
  head: ({ params }) => ({
    meta: [{ title: `Room ${params.code} — TacTrack` }],
  }),
  component: RoomPage,
});

function RoomPage() {
  const { code } = Route.useParams();
  const { k: keyB64 } = Route.useSearch();
  const navigate = useNavigate();

  const [identity, setIdentity] = useState<Identity | null>(null);
  const [selfPos, setSelfPos] = useState<Position | null>(null);
  const [peers, setPeers] = useState<Map<string, PeerState>>(new Map());
  const [markers, setMarkers] = useState<Map<string, SharedMarker>>(new Map());
  const [followMe, setFollowMe] = useState(true);
  const [wakeLockOn, setWakeLockOn] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [editingMarker, setEditingMarker] = useState<SharedMarker | null>(null);
  const [centerReq, setCenterReq] = useState<{ lat: number; lng: number; ts: number } | null>(null);

  const meshRef = useRef<Mesh | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const lastBroadcastRef = useRef<{ pos: Position | null; ts: number }>({ pos: null, ts: 0 });

  // Bootstrap identity, mesh, geolocation, markers
  useEffect(() => {
    let cancelled = false;
    let geoWatchId: number | null = null;

    (async () => {
      const id = await ensureIdentity();
      if (cancelled) return;
      setIdentity(id);
      await saveRoom({ code, keyB64, createdAt: Date.now(), lastJoined: Date.now() });

      // Load persisted markers
      const persisted = await getRoomMarkers(code);
      const map = new Map<string, SharedMarker>();
      for (const m of persisted) map.set(m.id, m);
      if (!cancelled) setMarkers(map);

      // Start mesh
      const mesh = new Mesh(code, keyB64, id, {
        onSelfId: () => {},
        onError: (e) => console.warn("mesh error", e),
        onPeerConnected: (peerId) => {
          setPeers((prev) => {
            const next = new Map(prev);
            const ex = next.get(peerId);
            next.set(peerId, {
              id: peerId,
              callsign: ex?.callsign ?? "…",
              color: ex?.color ?? "#888",
              connected: true,
              lastSeen: Date.now(),
              pos: ex?.pos,
            });
            return next;
          });
        },
        onPeerDisconnected: (peerId) => {
          setPeers((prev) => {
            const next = new Map(prev);
            const ex = next.get(peerId);
            if (ex) next.set(peerId, { ...ex, connected: false });
            return next;
          });
        },
        onMessage: (msg, fromPeerId) => {
          handleIncoming(msg, fromPeerId);
        },
      });
      meshRef.current = mesh;
      await mesh.start();

      // Re-broadcast known markers to incoming peers periodically
      const reShare = setInterval(() => {
        const m = meshRef.current;
        if (!m) return;
        for (const mk of map.values()) {
          m.broadcast({ t: "marker", m: mk });
        }
      }, 15000);

      // Geolocation
      if ("geolocation" in navigator) {
        geoWatchId = navigator.geolocation.watchPosition(
          async (g) => {
            let battery: number | null = null;
            type NavWithBattery = Navigator & { getBattery?: () => Promise<{ level: number }> };
            const nb = navigator as NavWithBattery;
            if (typeof nb.getBattery === "function") {
              try {
                const b = await nb.getBattery();
                battery = Math.round(b.level * 100);
              } catch {
                // ignore
              }
            }
            const pos: Position = {
              lat: g.coords.latitude,
              lng: g.coords.longitude,
              accuracy: g.coords.accuracy,
              heading: g.coords.heading,
              speed: g.coords.speed,
              battery,
              ts: Date.now(),
            };
            setSelfPos(pos);
            // Throttle: every 3s OR if moved >5m
            const last = lastBroadcastRef.current;
            const moved = last.pos
              ? haversineMeters(last.pos, pos) > 5
              : true;
            if (Date.now() - last.ts > 3000 || moved) {
              lastBroadcastRef.current = { pos, ts: Date.now() };
              meshRef.current?.broadcast({ t: "pos", id: id.id, pos });
            }
          },
          (err) => console.warn("geolocation error", err.message),
          { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
        );
      }

      return () => clearInterval(reShare);
    })();

    return () => {
      cancelled = true;
      if (geoWatchId !== null) navigator.geolocation.clearWatch(geoWatchId);
      meshRef.current?.destroy();
      meshRef.current = null;
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, keyB64]);

  const handleIncoming = useCallback(
    async (msg: WireMessage, fromPeerId: string) => {
      if (msg.t === "hello") {
        setPeers((prev) => {
          const next = new Map(prev);
          next.set(fromPeerId, {
            id: msg.id,
            callsign: msg.callsign,
            color: msg.color,
            connected: true,
            lastSeen: Date.now(),
            pos: prev.get(fromPeerId)?.pos,
          });
          return next;
        });
      } else if (msg.t === "pos") {
        setPeers((prev) => {
          const next = new Map(prev);
          const ex = next.get(fromPeerId);
          if (ex) {
            next.set(fromPeerId, { ...ex, pos: msg.pos, lastSeen: Date.now() });
          } else {
            next.set(fromPeerId, {
              id: msg.id,
              callsign: "…",
              color: "#888",
              connected: true,
              lastSeen: Date.now(),
              pos: msg.pos,
            });
          }
          return next;
        });
      } else if (msg.t === "marker") {
        setMarkers((prev) => {
          const ex = prev.get(msg.m.id);
          if (ex && ex.ts >= msg.m.ts) return prev;
          const next = new Map(prev);
          next.set(msg.m.id, msg.m);
          return next;
        });
        await putMarker(code, msg.m);
      } else if (msg.t === "marker-del") {
        setMarkers((prev) => {
          const next = new Map(prev);
          next.delete(msg.id);
          return next;
        });
        await removeMarker(code, msg.id);
      }
    },
    [code],
  );

  const peerArr = useMemo(() => Array.from(peers.values()), [peers]);
  const markerArr = useMemo(() => Array.from(markers.values()), [markers]);
  const connectedCount = peerArr.filter((p) => p.connected).length;

  // Tick to refresh "last seen" labels
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);

  async function dropMarker(lat: number, lng: number) {
    if (!identity) return;
    const m: SharedMarker = {
      id: crypto.randomUUID(),
      lat,
      lng,
      label: "Waypoint",
      icon: "pin",
      color: identity.color,
      authorId: identity.id,
      authorCallsign: identity.callsign,
      ts: Date.now(),
    };
    setMarkers((prev) => new Map(prev).set(m.id, m));
    await putMarker(code, m);
    await meshRef.current?.broadcast({ t: "marker", m });
    setEditingMarker(m);
  }

  async function saveMarker(updated: SharedMarker) {
    const next: SharedMarker = { ...updated, ts: Date.now() };
    setMarkers((prev) => new Map(prev).set(next.id, next));
    await putMarker(code, next);
    await meshRef.current?.broadcast({ t: "marker", m: next });
  }

  async function deleteMarker(id: string) {
    setMarkers((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    await removeMarker(code, id);
    await meshRef.current?.broadcast({ t: "marker-del", id, ts: Date.now() });
    setEditingMarker(null);
  }

  async function toggleWakeLock() {
    type NavWithWakeLock = Navigator & { wakeLock?: { request: (t: string) => Promise<WakeLockSentinel> } };
    const nb = navigator as NavWithWakeLock;
    if (!nb.wakeLock) {
      alert("Wake Lock API not supported on this device.");
      return;
    }
    if (wakeLockRef.current) {
      await wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
      setWakeLockOn(false);
    } else {
      try {
        const lock = await nb.wakeLock.request("screen");
        wakeLockRef.current = lock;
        setWakeLockOn(true);
        lock.addEventListener("release", () => setWakeLockOn(false));
      } catch (e) {
        console.warn("wake lock failed", e);
      }
    }
  }

  function leave() {
    meshRef.current?.destroy();
    navigate({ to: "/" });
  }

  function centerOnPeer(p: PeerState) {
    if (!p.pos) return;
    setCenterReq({ lat: p.pos.lat, lng: p.pos.lng, ts: Date.now() });
    setFollowMe(false);
  }

  function centerOnMe() {
    if (!selfPos) return;
    setCenterReq({ lat: selfPos.lat, lng: selfPos.lng, ts: Date.now() });
    setFollowMe(true);
  }

  const inviteUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/join?c=${code}&k=${encodeURIComponent(keyB64)}`;
  }, [code, keyB64]);

  const qrPayload = useMemo(() => {
    if (inviteUrl) return inviteUrl;
    return `tactrack://join?c=${code}&k=${encodeURIComponent(keyB64)}`;
  }, [inviteUrl, code, keyB64]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background text-foreground">
      {identity && (
        <MapView
          self={identity}
          selfPos={selfPos}
          peers={peerArr}
          markers={markerArr}
          followMe={followMe}
          onLongPress={dropMarker}
          onMarkerClick={(id) => {
            const m = markers.get(id);
            if (m) setEditingMarker(m);
          }}
          onPeerClick={(peerId) => {
            const p = peers.get(peerId);
            if (p) centerOnPeer(p);
          }}
          centerRequest={centerReq}
        />
      )}

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-3">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border bg-card/90 px-3 py-2 shadow-xl backdrop-blur">
          <Button asChild size="icon" variant="ghost" className="h-8 w-8">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="flex flex-col">
            <span className="font-mono text-base font-bold leading-none tracking-[0.25em]">{code}</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {connectedCount} peer{connectedCount === 1 ? "" : "s"}
            </span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => setShowQr(true)}
            aria-label="Share QR"
          >
            <QrIcon className="h-4 w-4" />
          </Button>
          <Sheet>
            <SheetTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Roster">
                <Users className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[320px] sm:w-[380px]">
              <SheetHeader>
                <SheetTitle className="font-mono uppercase tracking-wider">Roster</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-2">
                {identity && selfPos && (
                  <RosterRow
                    label={`${identity.callsign} (you)`}
                    color={identity.color}
                    distance={null}
                    bearing={null}
                    lastSeen={Date.now()}
                    battery={selfPos.battery ?? null}
                    connected={true}
                    onClick={centerOnMe}
                  />
                )}
                {peerArr.length === 0 && (
                  <p className="px-2 text-sm text-muted-foreground">
                    Waiting for teammates to join…
                  </p>
                )}
                {peerArr.map((p) => {
                  const dist = p.pos && selfPos ? haversineMeters(selfPos, p.pos) : null;
                  const brg = p.pos && selfPos ? bearingDeg(selfPos, p.pos) : null;
                  return (
                    <RosterRow
                      key={p.id}
                      label={p.callsign}
                      color={p.color}
                      distance={dist}
                      bearing={brg}
                      lastSeen={p.lastSeen}
                      battery={p.pos?.battery ?? null}
                      connected={p.connected}
                      onClick={() => centerOnPeer(p)}
                    />
                  );
                })}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-3">
        <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border bg-card/90 p-1.5 shadow-xl backdrop-blur">
          <ActionButton onClick={centerOnMe} label="Me">
            <Crosshair className="h-5 w-5" />
          </ActionButton>
          <ActionButton
            onClick={() => {
              if (selfPos) dropMarker(selfPos.lat, selfPos.lng);
            }}
            label="Mark"
          >
            <Plus className="h-5 w-5" />
          </ActionButton>
          <ActionButton
            onClick={toggleWakeLock}
            label="Awake"
            active={wakeLockOn}
          >
            <Sun className="h-5 w-5" />
          </ActionButton>
          <ActionButton
            onClick={() => alert("Pan/zoom to your area, then come back. Tile pre-cache requires a service worker — disabled in this preview.")}
            label="Cache"
          >
            <Download className="h-5 w-5" />
          </ActionButton>
          <ActionButton onClick={leave} label="Leave" destructive>
            <LogOut className="h-5 w-5" />
          </ActionButton>
        </div>
      </div>

      {/* Stale notice */}
      {!selfPos && (
        <div className="pointer-events-none absolute inset-x-0 top-20 z-10 mx-auto w-fit rounded-md bg-card/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
          Waiting for GPS lock…
        </div>
      )}

      {/* QR share dialog */}
      <Dialog open={showQr} onOpenChange={setShowQr}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-wider">Share Room</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="rounded-lg bg-[#39FF14] p-3">
              <QrCode value={qrPayload} size={220} />
            </div>
            <div className="text-center">
              <div className="font-mono text-2xl font-bold tracking-[0.4em]">{code}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Room code
              </div>
            </div>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                navigator.clipboard.writeText(inviteUrl);
              }}
            >
              Copy invite link
            </Button>
            <p className="text-center text-[10px] leading-relaxed text-muted-foreground">
              Anyone with this code + key can join. Traffic is end-to-end encrypted.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Marker editor */}
      <Dialog open={!!editingMarker} onOpenChange={(o) => !o && setEditingMarker(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-wider">Marker</DialogTitle>
          </DialogHeader>
          {editingMarker && (
            <MarkerEditor
              marker={editingMarker}
              onSave={async (m) => {
                await saveMarker(m);
                setEditingMarker(null);
              }}
              onDelete={() => deleteMarker(editingMarker.id)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  label,
  active,
  destructive,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-14 w-16 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider transition-colors ${
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : active
            ? "bg-primary/20 text-primary"
            : "text-foreground hover:bg-secondary"
      }`}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function RosterRow({
  label,
  color,
  distance,
  bearing,
  lastSeen,
  battery,
  connected,
  onClick,
}: {
  label: string;
  color: string;
  distance: number | null;
  bearing: number | null;
  lastSeen: number;
  battery: number | null;
  connected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-secondary/30 p-2 text-left transition-colors hover:bg-secondary"
    >
      <span
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-sm font-bold">{label}</span>
          {connected ? (
            <Wifi className="h-3 w-3 text-primary" />
          ) : (
            <WifiOff className="h-3 w-3 text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{formatRelative(lastSeen)}</span>
          {distance !== null && (
            <>
              <span>·</span>
              <span>
                {formatDistance(distance)}
                {bearing !== null ? ` ${Math.round(bearing)}°` : ""}
              </span>
            </>
          )}
          {battery !== null && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-0.5">
                <Battery className="h-3 w-3" />
                {battery}%
              </span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

function MarkerEditor({
  marker,
  onSave,
  onDelete,
}: {
  marker: SharedMarker;
  onSave: (m: SharedMarker) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(marker.label);
  const [icon, setIcon] = useState(marker.icon);
  const [color, setColor] = useState(marker.color);
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
          Label
        </label>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} />
      </div>
      <div>
        <label className="mb-2 block text-[11px] uppercase tracking-wider text-muted-foreground">
          Icon
        </label>
        <div className="grid grid-cols-3 gap-2">
          {MARKER_ICONS.map((m) => (
            <button
              key={m.key}
              onClick={() => setIcon(m.key)}
              className={`flex flex-col items-center gap-1 rounded-md border p-2 text-xs transition-colors ${
                icon === m.key ? "border-primary bg-primary/10" : "border-border hover:bg-secondary"
              }`}
            >
              <MarkerIconView kind={m.key} color={color} size={20} />
              <span>{m.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="mb-2 block text-[11px] uppercase tracking-wider text-muted-foreground">
          Color
        </label>
        <div className="flex flex-wrap gap-2">
          {PALETTE.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className="h-8 w-8 rounded-md border-2"
              style={{
                backgroundColor: c,
                borderColor: color === c ? "white" : "transparent",
              }}
              aria-label={`color ${c}`}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <MapPin className="h-3 w-3" />
        {marker.lat.toFixed(5)}, {marker.lng.toFixed(5)}
      </div>
      <div className="flex gap-2">
        <Button variant="destructive" onClick={onDelete} className="gap-2">
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
        <Button className="flex-1" onClick={() => onSave({ ...marker, label, icon, color })}>
          Save
        </Button>
      </div>
    </div>
  );
}
