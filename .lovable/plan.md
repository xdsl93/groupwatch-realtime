
## ATAK-style Real-Time Group Tracker (PWA, Serverless)

A cross-platform Progressive Web App for live position sharing within a small group, with no backend infrastructure to run. Everything goes peer-to-peer over WebRTC after a one-time QR/code handshake.

### Architecture (serverless)

- **Transport:** WebRTC mesh DataChannel between all peers in a room. Once connected, no server is involved — positions, markers, and presence flow directly device-to-device.
- **Signaling bootstrap:** A free public WebRTC signaling relay (e.g. PeerJS public broker) is used *only* for the initial handshake. After connection, traffic is fully P2P. Note: a tiny public signaling endpoint is technically required to exchange SDP offers — there is no truly zero-server way to bootstrap WebRTC. We'll document this clearly.
- **Encryption:** Room code embeds a shared secret; all DataChannel payloads are end-to-end encrypted (AES-GCM via WebCrypto) so the signaling relay can never read positions.
- **Mesh resilience:** Each peer connects to every other peer (full mesh). Suitable for groups up to ~8–10 people. New joiners are introduced by any existing peer.

### Group flow

- **Create room:** Leader taps "New Room" → app generates a 6-character code + AES key → shows a large QR + the code.
- **Join room:** "Join" → scan QR (using device camera) or type the 6-char code → auto-connects to the mesh.
- **Identity:** Each user picks a callsign and color on first launch (stored locally). No accounts, no login.

### Map (MapLibre + OSM)

- MapLibre GL with OpenStreetMap vector tiles.
- Service-worker caching of viewed tiles for offline reuse.
- "Download current area" button: pre-caches tiles for the visible bbox at zoom levels 10–16 so the team can operate offline in that region.
- Standard map controls: zoom, center-on-me, follow-me toggle, north-up/heading-up.

### Live tracking

- Browser Geolocation API with `watchPosition` (high accuracy).
- Each peer broadcasts position updates (throttled, e.g. every 3s or on >5m movement) with: lat/lng, accuracy, heading, speed, battery %, timestamp.
- On the map: each teammate shown as a colored arrow/dot with callsign label, fading opacity if last update >30s, "stale" badge after 2 min.
- Tap a teammate marker → side panel with details + distance/bearing from you.

### Shared map markers

- Long-press (or tap "+") anywhere on the map to drop a marker.
- Marker editor: label, icon (pin / flag / target / hazard / friendly / objective), color.
- Markers sync to the whole room via the mesh and persist locally (IndexedDB).
- Anyone can edit/delete markers; deletions broadcast to the group.

### Roster panel

- Bottom sheet listing all peers: callsign, last-seen, distance from you, battery, connection status (P2P / disconnected).
- Tap a name to center the map on that person.

### PWA & cross-platform

- Installable on iOS, Android, desktop (manifest + standalone display, custom icon).
- Service worker for offline shell + map tile cache.
- Wake-lock API to keep screen on during active tracking (toggle).
- Background geolocation is limited in browsers — we'll show a clear "keep screen on / app foreground for continuous tracking" notice (this is a real PWA limitation vs native ATAK).

### Persistence (local only)

- IndexedDB stores: identity (callsign/color), saved rooms, cached markers per room, downloaded tile regions. No cloud, no Lovable Cloud needed.

### Screens

1. **Home** — Create Room / Join Room / Recent Rooms / Settings (callsign, color).
2. **Room (main)** — Full-screen map, top bar (room code + connected peer count + share QR button), right-side roster toggle, bottom action bar (drop marker, download area, wake-lock, leave room).
3. **QR/Code share modal** — Big QR + room code + copy button.
4. **Join modal** — Camera QR scanner + manual code entry tab.
5. **Marker editor sheet** — Label / icon / color / delete.

### Design

- Dark, high-contrast tactical aesthetic (deep slate background, neon accent for own position, distinct vivid colors per teammate).
- Mobile-first, large touch targets, glove-friendly buttons. Works landscape and portrait.

### Out of scope for v1

- Drawn shapes, routes, SOS, voice chat, file transfer (can be added later).
- True background tracking (browser limitation).
- Self-hosted signaling (can be added as a setting later).
