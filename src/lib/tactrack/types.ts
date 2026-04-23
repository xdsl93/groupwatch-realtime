export type Identity = {
  id: string; // peerId
  callsign: string;
  color: string;
};

export type RoomInfo = {
  code: string; // 6-char
  keyB64: string; // base64 raw AES-GCM key
  createdAt: number;
  lastJoined: number;
};

export type Position = {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number | null;
  speed?: number | null;
  battery?: number | null;
  ts: number;
};

export type PeerState = Identity & {
  pos?: Position;
  connected: boolean;
  lastSeen: number;
};

export type MarkerIcon = "pin" | "flag" | "target" | "hazard" | "friendly" | "objective";

export type SharedMarker = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  icon: MarkerIcon;
  color: string;
  authorId: string;
  authorCallsign: string;
  ts: number;
  deleted?: boolean;
};

export type WireMessage =
  | { t: "hello"; id: string; callsign: string; color: string }
  | { t: "pos"; id: string; pos: Position }
  | { t: "marker"; m: SharedMarker }
  | { t: "marker-del"; id: string; ts: number }
  | { t: "peers"; ids: string[] } // mesh introduction
  | { t: "ping"; ts: number };