# Changelog

## 0.1.0

Initial release.

- Core sync engine with channel-based state synchronization
- `createSyncClient` - framework-agnostic P2P sync client
- `SyncChannelPlugin` interface for pluggable state channels
- PeerJS WebRTC transport (`peersync/peerjs`)
- React bindings with `PeerSyncProvider`, `usePeerSync`, `usePeerSyncStatus` (`peersync/react`)
- Memory transport for testing (`peersync/testing`)
- Room-scoped messaging with automatic snapshot replay on reconnect
