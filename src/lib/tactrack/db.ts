import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Identity, RoomInfo, SharedMarker } from "./types";

interface TactrackDB extends DBSchema {
  kv: { key: string; value: unknown };
  rooms: { key: string; value: RoomInfo };
  markers: {
    key: string; // `${roomCode}:${markerId}`
    value: SharedMarker & { roomCode: string };
    indexes: { byRoom: string };
  };
}

let dbp: Promise<IDBPDatabase<TactrackDB>> | null = null;

function getDB() {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB unavailable");
  }
  if (!dbp) {
    dbp = openDB<TactrackDB>("tactrack", 1, {
      upgrade(db) {
        db.createObjectStore("kv");
        db.createObjectStore("rooms", { keyPath: "code" });
        const m = db.createObjectStore("markers", { keyPath: "id" });
        m.createIndex("byRoom", "roomCode");
      },
    });
  }
  return dbp;
}

export async function getIdentity(): Promise<Identity | null> {
  const db = await getDB();
  return ((await db.get("kv", "identity")) as Identity | undefined) ?? null;
}

export async function setIdentity(id: Identity) {
  const db = await getDB();
  await db.put("kv", id, "identity");
}

export async function listRooms(): Promise<RoomInfo[]> {
  const db = await getDB();
  const all = await db.getAll("rooms");
  return all.sort((a, b) => b.lastJoined - a.lastJoined);
}

export async function saveRoom(room: RoomInfo) {
  const db = await getDB();
  await db.put("rooms", room);
}

export async function deleteRoom(code: string) {
  const db = await getDB();
  await db.delete("rooms", code);
}

export async function getRoomMarkers(roomCode: string): Promise<SharedMarker[]> {
  const db = await getDB();
  const tx = db.transaction("markers");
  const idx = tx.store.index("byRoom");
  const out: SharedMarker[] = [];
  for await (const c of idx.iterate(roomCode)) {
    const v = c.value;
    if (!v.deleted) out.push(v);
  }
  return out;
}

export async function putMarker(roomCode: string, m: SharedMarker) {
  const db = await getDB();
  await db.put("markers", { ...m, roomCode, id: `${roomCode}:${m.id}` });
}

export async function removeMarker(roomCode: string, markerId: string) {
  const db = await getDB();
  await db.delete("markers", `${roomCode}:${markerId}`);
}