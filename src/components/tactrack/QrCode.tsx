import { useEffect, useRef } from "react";
import QRCode from "qrcode";

export function QrCode({ value, size = 256 }: { value: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    QRCode.toCanvas(ref.current, value, {
      width: size,
      margin: 1,
      color: { dark: "#0c1220", light: "#39FF14" },
      errorCorrectionLevel: "M",
    });
  }, [value, size]);
  return <canvas ref={ref} className="rounded-lg" style={{ width: size, height: size }} />;
}