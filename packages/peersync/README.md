# peersync

Pluggable P2P sync engine with channel-based state synchronization. Sits between low-level WebRTC libraries (PeerJS, simple-peer) and heavy CRDT frameworks (Yjs, Automerge).

## Install

```bash
npm install peersync
# For WebRTC transport:
npm install peerjs
# For React bindings:
npm install react
```

## Entry Points

| Import | Purpose | Peer deps |
|--------|---------|-----------|
| `peersync` | Core sync engine | None |
| `peersync/core` | Same as root | None |
| `peersync/peerjs` | PeerJS WebRTC transport | `peerjs` |
| `peersync/react` | React context + hooks | `react` |
| `peersync/testing` | Memory transport for tests | None |

## Quick Start (Vanilla)

```ts
import { createSyncClient, type SyncChannelPlugin } from "peersync";
import { createPeerJsTransport } from "peersync/peerjs";

// 1. Create a transport
const transport = createPeerJsTransport();

// 2. Create a sync client
const client = createSyncClient({
  roomId: "my-room",
  transport,
});

// 3. Define a channel plugin
const counterChannel: SyncChannelPlugin<number, number> = {
  key: "counter",
  getState: () => myCounter,
  setState: (next) => { myCounter = next; },
  diff: (prev, next) => (next !== prev ? next - prev : null),
  apply: (base, patch) => base + patch,
  snapshot: (state) => state,
  hydrate: (raw) => (typeof raw === "number" ? raw : 0),
};

// 4. Register and start
client.registerChannel(counterChannel);
await client.start();

// 5. Connect to a peer
await client.connect("remote-peer-id");
```

## Quick Start (React)

```tsx
import { PeerSyncProvider, usePeerSync } from "peersync/react";
import { createPeerJsTransport } from "peersync/peerjs";

const transport = createPeerJsTransport();

function App() {
  return (
    <PeerSyncProvider roomId="my-room" transport={transport}>
      <MyComponent />
    </PeerSyncProvider>
  );
}

function MyComponent() {
  const { status, localPeerId, peers, connect, registerChannel } = usePeerSync();

  return (
    <div>
      <p>Status: {status}</p>
      <p>My ID: {localPeerId}</p>
      <p>Peers: {Array.from(peers).join(", ")}</p>
      <button onClick={() => connect("other-peer-id")}>Connect</button>
    </div>
  );
}
```

## Channel Plugins

A `SyncChannelPlugin<TState, TPatch>` defines how state is synchronized:

```ts
interface SyncChannelPlugin<TState, TPatch> {
  key: string;                    // Unique channel identifier
  getState: () => TState;         // Current state getter
  setState: (next, meta) => void; // State setter (meta.origin: "local" | "remote")
  subscribe?: (cb) => () => void; // Optional change subscription
  diff: (prev, next) => TPatch | null; // Compute patch from state change
  apply: (base, patch) => TState;      // Apply patch to produce new state
  snapshot: (state) => unknown;         // Serialize for new peers
  hydrate: (raw) => TState;            // Deserialize snapshot
}
```

The engine automatically:
- Sends patches to connected peers when local state changes
- Sends full snapshots when a new peer connects
- Replays snapshots on reconnect to recover missed changes
- Scopes messages to rooms (peers in different rooms are isolated)

## Testing

Use the memory transport for deterministic tests without network:

```ts
import { createSyncClient } from "peersync";
import { MemorySyncNetwork } from "peersync/testing";

const network = new MemorySyncNetwork();

const clientA = createSyncClient({
  roomId: "test",
  localPeerId: "a",
  transport: network.createTransport(),
});

const clientB = createSyncClient({
  roomId: "test",
  localPeerId: "b",
  transport: network.createTransport(),
});

await clientA.start();
await clientB.start();
await clientB.connect("a");
// State now syncs between A and B
```

The memory network supports simulated latency and message dropping:

```ts
const network = new MemorySyncNetwork({
  deliveryLatencyMs: 50,
  shouldDropMessage: (ctx) => Math.random() < 0.1, // 10% drop rate
});
```

## API Reference

### `createSyncClient(options)`

Creates a sync client instance.

- `options.roomId` - Room identifier for message scoping
- `options.transport` - Transport implementation
- `options.localPeerId` - Optional fixed peer ID

Returns: `{ start, stop, connect, disconnect, peers, localPeerId, send, onMessage, onConnectionOpen, onConnectionClose, registerChannel }`

### `createPeerJsTransport(options?)`

Creates a PeerJS WebRTC transport.

- `options.createPeer` - Custom Peer factory
- `options.onPeerReady` - Called when peer is ready
- `options.onConnectionsChanged` - Called when connections change
- `options.onError` - Error handler

### `PeerSyncProvider`

React context provider.

- `roomId` - Room identifier
- `transport` - Transport instance
- `autoStart` - Auto-start on mount (default: `true`)

### `usePeerSync()`

Returns `{ status, localPeerId, peers, error, connect, disconnect, send, onMessage, registerChannel }`.

### `usePeerSyncStatus()`

Lightweight hook returning only the connection status string.

## License

MIT
