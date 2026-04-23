import { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

export function QrScanner({ onResult }: { onResult: (text: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const id = "qr-scanner-region";
    ref.current.id = id;
    const scanner = new Html5Qrcode(id, { verbose: false });
    scannerRef.current = scanner;
    let stopped = false;
    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          if (stopped) return;
          stopped = true;
          onResult(decoded);
          scanner.stop().catch(() => {});
        },
        () => {},
      )
      .catch((e) => console.error("QR scanner failed", e));
    return () => {
      stopped = true;
      scanner
        .stop()
        .catch(() => {})
        .finally(() => scanner.clear());
    };
  }, [onResult]);

  return <div ref={ref} className="w-full overflow-hidden rounded-lg bg-black" style={{ minHeight: 280 }} />;
}