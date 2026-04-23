import { Flag, MapPin, Target, AlertTriangle, Shield, Crosshair } from "lucide-react";
import type { MarkerIcon as MarkerIconKind } from "@/lib/tactrack/types";

export const MARKER_ICONS: Array<{ key: MarkerIconKind; label: string; Icon: typeof Flag }> = [
  { key: "pin", label: "Pin", Icon: MapPin },
  { key: "flag", label: "Flag", Icon: Flag },
  { key: "target", label: "Target", Icon: Target },
  { key: "hazard", label: "Hazard", Icon: AlertTriangle },
  { key: "friendly", label: "Friendly", Icon: Shield },
  { key: "objective", label: "Objective", Icon: Crosshair },
];

export function MarkerIconView({ kind, color, size = 18 }: { kind: MarkerIconKind; color: string; size?: number }) {
  const entry = MARKER_ICONS.find((m) => m.key === kind) ?? MARKER_ICONS[0];
  const Icon = entry.Icon;
  return <Icon size={size} color={color} />;
}