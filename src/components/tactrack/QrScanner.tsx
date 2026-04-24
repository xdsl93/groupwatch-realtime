import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const id = "qr-scanner-region";
    ref.current.id = id;

    if (!navigator.mediaDevices?.getUserMedia) {
      setErr("Camera API not available. Use HTTPS and a modern browser, or enter the code manually.");
      return;
    }

    const scanner = new Html5Qrcode(id, { verbose: false });
    scannerRef.current = scanner;
    let stopped = false;

    const tryStart = async (constraint: MediaTrackConstraints | { facingMode: string }) => {
      await scanner.start(
        constraint,
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          if (stopped) return;
          stopped = true;
          onResult(decoded);
          scanner.stop().catch(() => {});
        },
        () => {},
      );
    };

    (async () => {
      try {
        await tryStart({ facingMode: { ideal: "environment" } });
        setErr(null);
      } catch (e1) {
        try {
          await tryStart({ facingMode: "user" });
          setErr(null);
        } catch (e2) {
          const msg =
            (e2 as { message?: string })?.message ||
            (e1 as { message?: string })?.message ||
            "Camera unavailable.";
          console.error("QR scanner failed", e1, e2);
          setErr(`${msg} — please grant camera permission or use manual entry.`);
        }
      }
    })();

    return () => {
      stopped = true;
      const s = scannerRef.current;
      if (!s) return;
      s.stop()
        .catch(() => {})
        .finally(() => {
          try {
            s.clear();
          } catch {
            // ignore
          }
        });
    };
  }, [onResult]);

  return (
    <div className="space-y-2">
      <div
        ref={ref}
        className="w-full overflow-hidden rounded-lg bg-black"
        style={{ minHeight: 280 }}
      />
      {err && (
        <p className="text-center text-xs text-destructive" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}