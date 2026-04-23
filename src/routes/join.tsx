import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Camera, KeyRound } from "lucide-react";
import { QrScanner } from "@/components/tactrack/QrScanner";
import { saveRoom } from "@/lib/tactrack/db";

const search = z.object({
  code: z.string().optional(),
});

export const Route = createFileRoute("/join")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [{ title: "Join Room — TacTrack" }],
  }),
  component: JoinPage,
});

// Payload format embedded in QR: tactrack://join?c=ABC123&k=base64key
function parsePayload(text: string): { code: string; key: string } | null {
  try {
    const url = new URL(text);
    const c = url.searchParams.get("c");
    const k = url.searchParams.get("k");
    if (c && k) return { code: c.toUpperCase(), key: k };
  } catch {
    // ignore
  }
  return null;
}

function JoinPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [key, setKey] = useState("");

  async function go(c: string, k: string) {
    if (c.length < 4 || k.length < 8) {
      setError("Invalid code or key");
      return;
    }
    await saveRoom({ code: c, keyB64: k, createdAt: Date.now(), lastJoined: Date.now() });
    navigate({ to: "/room/$code", params: { code: c }, search: { k } });
  }

  function onScan(text: string) {
    const p = parsePayload(text);
    if (!p) {
      setError("Unrecognized QR. Expected a TacTrack invite.");
      return;
    }
    go(p.code, p.key);
  }

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