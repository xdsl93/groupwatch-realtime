import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, LogIn, Radio, Settings as SettingsIcon, Trash2, Clock, Download } from "lucide-react";
import { ensureIdentity } from "@/lib/tactrack/identity";
import { deleteRoom, listRooms, saveRoom, setIdentity } from "@/lib/tactrack/db";
import { generateKey, exportKey, randomCode } from "@/lib/tactrack/crypto";
import type { Identity, RoomInfo } from "@/lib/tactrack/types";
import { PALETTE, formatRelative } from "@/lib/tactrack/geo";
import { useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TacTrack — Real-time Group Tracker" },
      { name: "description", content: "Serverless P2P live position sharing for small teams. ATAK-style tactical PWA." },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const [identity, setIdent] = useState<Identity | null>(null);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [joinCode, setJoinCode] = useState("");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    (async () => {
      const id = await ensureIdentity();
      setIdent(id);
      setRooms(await listRooms());
    })();
  }, []);

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setIsStandalone(!!standalone);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      try {
        await installPrompt.userChoice;
      } catch {
        // ignore
      }
      setInstallPrompt(null);
      return;
    }
    // iOS / browsers without prompt support
    alert(
      "Per installare:\n\n• iOS Safari: tocca Condividi → 'Aggiungi a Home'.\n• Android Chrome: menu ⋮ → 'Installa app'.\n• Desktop: icona di installazione nella barra degli indirizzi.",
    );
  }

  async function createRoom() {
    const code = randomCode(6);
    const key = await generateKey();
    const keyB64 = await exportKey(key);
    const room: RoomInfo = { code, keyB64, createdAt: Date.now(), lastJoined: Date.now() };
    await saveRoom(room);
    navigate({ to: "/room/$code", params: { code }, search: { k: keyB64 } });
  }

  async function joinExisting(code: string, keyB64: string) {
    await saveRoom({ code, keyB64, createdAt: Date.now(), lastJoined: Date.now() });
    navigate({ to: "/room/$code", params: { code }, search: { k: keyB64 } });
  }

  async function joinByCode() {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return;
    const room = rooms.find((r) => r.code === code);
    if (room) {
      await joinExisting(code, room.keyB64);
    } else {
      // Need scan QR for key — go to join screen
      navigate({ to: "/join", search: { code } });
    }
  }

  async function updateCallsign(v: string) {
    if (!identity) return;
    const next = { ...identity, callsign: v.toUpperCase().slice(0, 12) };
    setIdent(next);
    await setIdentity(next);
  }

  async function updateColor(c: string) {
    if (!identity) return;
    const next = { ...identity, color: c };
    setIdent(next);
    await setIdentity(next);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-6 md:py-10">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="grid h-10 w-10 place-items-center rounded-lg border-2"
              style={{ borderColor: "var(--primary)", boxShadow: "0 0 16px color-mix(in oklab, var(--primary) 40%, transparent)" }}
            >
              <Radio className="h-5 w-5" style={{ color: "var(--primary)" }} />
            </div>
            <div>
              <h1 className="font-mono text-xl font-bold tracking-wider">TACTRACK</h1>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                P2P Group Tracker
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isStandalone && (
              <Button
                size="sm"
                variant="outline"
                onClick={installApp}
                className="h-8 gap-1.5 font-mono text-[10px] uppercase tracking-wider"
              >
                <Download className="h-3.5 w-3.5" />
                Installa app
              </Button>
            )}
            <Badge variant="outline" className="font-mono text-[10px] uppercase">
              Serverless
            </Badge>
          </div>
        </header>

        {/* Identity */}
        {identity && (
          <Card className="mb-6 border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <SettingsIcon className="h-3.5 w-3.5" />
              Operator
            </div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
              Callsign
            </label>
            <Input
              value={identity.callsign}
              onChange={(e) => updateCallsign(e.target.value)}
              className="mb-3 font-mono uppercase"
              maxLength={12}
            />
            <label className="mb-2 block text-[11px] uppercase tracking-wider text-muted-foreground">
              Color
            </label>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => updateColor(c)}
                  className="h-9 w-9 rounded-md border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: identity.color === c ? "white" : "transparent",
                    boxShadow: identity.color === c ? `0 0 12px ${c}` : "none",
                  }}
                  aria-label={`color ${c}`}
                />
              ))}
            </div>
          </Card>
        )}

        {/* Actions */}
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            size="lg"
            onClick={createRoom}
            className="h-16 text-base font-bold uppercase tracking-wider"
          >
            <Plus className="!h-5 !w-5" />
            New Room
          </Button>
          <Button
            asChild
            size="lg"
            variant="secondary"
            className="h-16 text-base font-bold uppercase tracking-wider"
          >
            <Link to="/join">
              <LogIn className="!h-5 !w-5" />
              Join Room
            </Link>
          </Button>
        </div>

        {/* Quick code entry */}
        <Card className="mb-6 border-border bg-card p-4">
          <label className="mb-2 block text-[11px] uppercase tracking-wider text-muted-foreground">
            Quick rejoin by code
          </label>
          <div className="flex gap-2">
            <Input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              className="font-mono text-lg uppercase tracking-[0.3em]"
              maxLength={6}
            />
            <Button onClick={joinByCode} disabled={joinCode.length < 4}>
              Go
            </Button>
          </div>
        </Card>

        {/* Recent rooms */}
        {rooms.length > 0 && (
          <Card className="border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Recent Rooms
            </div>
            <ul className="space-y-2">
              {rooms.map((r) => (
                <li key={r.code} className="flex items-center gap-2">
                  <button
                    onClick={() => joinExisting(r.code, r.keyB64)}
                    className="flex flex-1 items-center justify-between rounded-md border border-border bg-secondary/40 px-3 py-2 text-left transition-colors hover:bg-secondary"
                  >
                    <span className="font-mono text-base font-bold tracking-[0.25em]">{r.code}</span>
                    <span className="text-xs text-muted-foreground">{formatRelative(r.lastJoined)}</span>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async () => {
                      await deleteRoom(r.code);
                      setRooms(await listRooms());
                    }}
                    aria-label="Delete room"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <p className="mt-8 text-center text-[11px] leading-relaxed text-muted-foreground">
          End-to-end encrypted (AES-GCM). Positions never touch a server.
          <br />A public WebRTC broker is used only for the initial handshake.
        </p>
      </div>
    </div>
  );
}
