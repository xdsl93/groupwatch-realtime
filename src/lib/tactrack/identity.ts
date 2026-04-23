import { getIdentity, setIdentity } from "./db";
import { PALETTE } from "./geo";
import type { Identity } from "./types";

function randomCallsign() {
  const animals = ["WOLF", "HAWK", "FOX", "BEAR", "LYNX", "RAVEN", "ORCA", "VIPER", "EAGLE", "PUMA"];
  const n = Math.floor(Math.random() * 90 + 10);
  return `${animals[Math.floor(Math.random() * animals.length)]}-${n}`;
}

function randomId() {
  return crypto.randomUUID();
}

export async function ensureIdentity(): Promise<Identity> {
  const existing = await getIdentity();
  if (existing) return existing;
  const id: Identity = {
    id: randomId(),
    callsign: randomCallsign(),
    color: PALETTE[0],
  };
  await setIdentity(id);
  return id;
}