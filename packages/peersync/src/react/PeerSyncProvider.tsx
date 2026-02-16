"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createSyncClient,
  type SyncChannelPlugin,
  type SyncEnvelope,
  type SyncTransport,
} from "../core";

export type PeerSyncStatus = "idle" | "starting" | "connected" | "error";

export type PeerSyncState = {
  status: PeerSyncStatus;
  localPeerId: string | null;
  peers: Set<string>;
  error: Error | null;
};

export type PeerSyncActions = {
  connect: (peerId: string) => void;
  disconnect: (peerId?: string) => void;
  send: (message: SyncEnvelope, peerId?: string) => void;
  onMessage: <TPayload = unknown>(
    type: string,
    handler: (message: SyncEnvelope<string, TPayload>, peerId: string) => void
  ) => () => void;
  registerChannel: <TState, TPatch>(
    channel: SyncChannelPlugin<TState, TPatch>
  ) => () => void;
};

type Store = {
  getSnapshot: () => PeerSyncState;
  subscribe: (callback: () => void) => () => void;
  setState: (partial: Partial<PeerSyncState>) => void;
};

type PeerSyncContextValue = {
  store: Store;
  actions: PeerSyncActions;
  client: ReturnType<typeof createSyncClient>;
};

const PeerSyncContext = createContext<PeerSyncContextValue | null>(null);

export type PeerSyncProviderProps = {
  roomId: string;
  transport: SyncTransport;
  autoStart?: boolean;
  children: ReactNode;
};

const toError = (error: unknown) => {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  return new Error("Unknown peer sync error");
};

const createStore = (initial: PeerSyncState): Store => {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => state,
    subscribe: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    setState: (partial) => {
      state = { ...state, ...partial };
      listeners.forEach((l) => l());
    },
  };
};

export const PeerSyncProvider = ({
  roomId,
  transport,
  autoStart = true,
  children,
}: PeerSyncProviderProps) => {
  const ctxRef = useRef<PeerSyncContextValue | null>(null);

  if (ctxRef.current === null) {
    const store = createStore({
      status: "idle",
      localPeerId: null,
      peers: new Set(),
      error: null,
    });

    const client = createSyncClient({ roomId, transport });

    client.onConnectionOpen((peerId) => {
      const current = store.getSnapshot();
      const nextPeers = new Set(current.peers);
      nextPeers.add(peerId);
      store.setState({
        status: "connected",
        peers: nextPeers,
        localPeerId: client.localPeerId(),
      });
    });

    client.onConnectionClose((peerId) => {
      const current = store.getSnapshot();
      const nextPeers = new Set(current.peers);
      nextPeers.delete(peerId);
      store.setState({ peers: nextPeers });
    });

    const actions: PeerSyncActions = {
      connect: (peerId: string) => {
        const trimmed = peerId.trim();
        if (!trimmed) return;
        client.connect(trimmed).catch((err) => {
          store.setState({ status: "error", error: toError(err) });
        });
      },
      disconnect: (peerId?: string) => {
        if (peerId) {
          client.disconnect(peerId).catch((err) => {
            store.setState({ error: toError(err) });
          });
          return;
        }
        client.stop().catch((err) => {
          store.setState({ error: toError(err) });
        });
      },
      send: (message, peerId?) => {
        client.send(message, peerId);
      },
      onMessage: (type, handler) => {
        return client.onMessage(type, handler);
      },
      registerChannel: (channel) => {
        return client.registerChannel(channel);
      },
    };

    ctxRef.current = { store, actions, client };
  }

  useEffect(() => {
    if (!autoStart) return;
    const { client, store } = ctxRef.current!;

    store.setState({ status: "starting" });
    client.start().then(
      () => {
        store.setState({
          status: "connected",
          localPeerId: client.localPeerId(),
        });
      },
      (err) => {
        store.setState({ status: "error", error: toError(err) });
      }
    );

    return () => {
      void client.stop();
      store.setState({ status: "idle", peers: new Set(), localPeerId: null });
    };
  }, [autoStart]);

  const { store, actions } = ctxRef.current!;

  return (
    <PeerSyncContext.Provider value={{ store, actions, client: ctxRef.current!.client }}>
      {children}
    </PeerSyncContext.Provider>
  );
};

const usePeerSyncContext = () => {
  const ctx = useContext(PeerSyncContext);
  if (!ctx) {
    throw new Error("usePeerSync must be used within a <PeerSyncProvider>");
  }
  return ctx;
};

export const usePeerSync = (): PeerSyncState & PeerSyncActions => {
  const { store, actions } = usePeerSyncContext();
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  return { ...state, ...actions };
};

export const usePeerSyncStatus = (): PeerSyncStatus => {
  const { store } = usePeerSyncContext();
  return useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().status,
    () => store.getSnapshot().status
  );
};
