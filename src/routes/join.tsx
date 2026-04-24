import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Camera, KeyRound } from "lucide-react";
import { QrScanner } from "@/components/tactrack/QrScanner";
import { saveRoom } from "@/lib/tactrack/db";
import { normalizeKeyB64 } from "@/lib/tactrack/crypto";

const search = z.object({
  code: z.string().optional(),
  c: z.string().optional(),
  key: z.string().optional(),
  k: z.string().optional(),
  p: z.string().optional(),
});

export const Route = createFileRoute("/join")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [{ title: "Join Room — TacTrack" }],
  }),
  component: JoinPage,
});

// Payload format embedded in QR: tactrack://join?c=ABC123&k=base64key&p=peer-id
function parsePayload(text: string): { code: string; key: string; peerId?: string } | null {
  const raw = text.trim();
  if (!raw) return null;

  const normalize = (c: string | null, k: string | null, p: string | null) => {
    const code = (c ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const key = normalizeKeyB64(k ?? "");
    const peerId = (p ?? "").trim();
    if (!code || !key) return null;
    return { code, key, peerId: peerId || undefined };
  };

  const fromUrlSearch = (searchText: string) => {
    const sp = new URLSearchParams(searchText);
    return normalize(
      sp.get("c") ?? sp.get("code"),
      sp.get("k") ?? sp.get("key"),
      sp.get("p") ?? sp.get("peer"),
    );
  };

  try {
    const url = new URL(raw);
    const parsed = normalize(
      url.searchParams.get("c") ?? url.searchParams.get("code"),
      url.searchParams.get("k") ?? url.searchParams.get("key"),
      url.searchParams.get("p") ?? url.searchParams.get("peer"),
    );
    if (parsed) return parsed;
  } catch {
    // Continue with non-URL fallbacks.
  }

  const queryIdx = raw.indexOf("?");
  if (queryIdx >= 0) {
    const parsed = fromUrlSearch(raw.slice(queryIdx + 1));
    if (parsed) return parsed;
  }

  if (raw.includes("=")) {
    const parsed = fromUrlSearch(raw);
    if (parsed) return parsed;
  }

  return null;
}

function JoinPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [key, setKey] = useState("");
  const attemptedAutoJoinRef = useRef(false);

  async function go(c: string, k: string, peerId?: string) {
    const nextCode = c.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    const nextKey = normalizeKeyB64(k);
    const nextPeerId = (peerId ?? "").trim();

    if (nextCode.length < 4 || nextKey.length < 8) {
      setError("Invalid code or key");
      return;
    }

    setError(null);
    try {
      await saveRoom({ code: nextCode, keyB64: nextKey, createdAt: Date.now(), lastJoined: Date.now() });
    } catch (e) {
      console.warn("saveRoom failed (continuing)", e);
    }
    try {
      await navigate({
        to: "/room/$code",
        params: { code: nextCode },
        search: nextPeerId ? { k: nextKey, p: nextPeerId } : { k: nextKey },
      });
    } catch (e) {
      console.error("navigate to room failed", e);
      setError(e instanceof Error ? e.message : "Failed to open room.");
    }
  }

  function onScan(text: string) {
    const p = parsePayload(text);
    if (!p) {
      setError("Unrecognized QR. Expected a TacTrack invite.");
      return;
    }
    go(p.code, p.key, p.peerId);
  }

  useEffect(() => {
    const prefCode = (search.c ?? search.code ?? "").trim();
    const prefKey = (search.k ?? search.key ?? "").trim();
    if (prefCode) setCode(prefCode.toUpperCase());
    if (prefKey) setKey(normalizeKeyB64(prefKey));
  }, [search.c, search.code, search.k, search.key]);

  useEffect(() => {
    if (attemptedAutoJoinRef.current) return;
    const prefCode = (search.c ?? search.code ?? "").trim();
    const prefKey = (search.k ?? search.key ?? "").trim();
    const prefPeerId = (search.p ?? "").trim();
    if (!prefCode || !prefKey) return;

    attemptedAutoJoinRef.current = true;
    go(prefCode, prefKey, prefPeerId || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.c, search.code, search.k, search.key, search.p]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-xl px-4 py-6">
        <div className="mb-4 flex items-center gap-2">
          <Button asChild size="icon" variant="ghost">
            <Link to="/">
              <ArrowLeft />
            </Link>
          </Button>
          <h1 className="font-mono text-lg font-bold uppercase tracking-wider">Join Room</h1>
        </div>
        <Card className="border-border bg-card p-4">
          <Tabs defaultValue="scan">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="scan">
                <Camera className="mr-2 h-4 w-4" /> Scan QR
              </TabsTrigger>
              <TabsTrigger value="manual">
                <KeyRound className="mr-2 h-4 w-4" /> Manual
              </TabsTrigger>
            </TabsList>
            <TabsContent value="scan" className="mt-4">
              <QrScanner onResult={onScan} />
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Point the camera at the host's TacTrack QR code.
              </p>
            </TabsContent>
            <TabsContent value="manual" className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
                  Room code
                </label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="font-mono text-lg uppercase tracking-[0.3em]"
                  maxLength={6}
                  placeholder="ABC123"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
                  Encryption key (from host)
                </label>
                <Input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  className="font-mono text-xs"
                  placeholder="base64 key"
                />
              </div>
              <Button className="w-full" onClick={() => go(code.trim(), key.trim())}>
                Join
              </Button>
            </TabsContent>
          </Tabs>
          {error && (
            <p className="mt-3 text-center text-sm text-destructive">{error}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
