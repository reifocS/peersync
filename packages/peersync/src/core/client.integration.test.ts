import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSyncClient,
  type SyncChannelPlugin,
  type SyncClientOptions,
  type SyncPeerId,
} from "./client";
import { MemorySyncNetwork } from "../testing/memoryTransport";

type ListState = {
  items: string[];
};

type ListPatch = { type: "add"; added: string[] } | { type: "remove"; removed: string[] };

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, durationMs);
  });

const waitFor = async (assertion: () => void, timeoutMs = 1_500, pollIntervalMs = 10) => {
  const startTime = Date.now();
  // Retry until timeout because sync operations are async by design.
  // This keeps tests deterministic without hardcoded sleeps.
  while (Date.now() - startTime < timeoutMs) {
    try {
      assertion();
      return;
    } catch {
      await wait(pollIntervalMs);
    }
  }

  assertion();
};

const normalizeItems = (items: string[]) => Array.from(new Set(items)).sort();

const createListStore = (initialItems: string[] = []) => {
  let state: ListState = {
    items: normalizeItems(initialItems),
  };
  const listeners = new Set<(next: ListState, prev: ListState) => void>();

  const setState = (next: ListState) => {
    const previousState = state;
    state = {
      items: normalizeItems(next.items),
    };
    listeners.forEach((listener) => listener(state, previousState));
  };

  return {
    getState: () => state,
    setState,
    addItem: (item: string) => {
      setState({
        items: [...state.items, item],
      });
    },
    removeItem: (item: string) => {
      setState({
        items: state.items.filter((i) => i !== item),
      });
    },
    subscribe: (listener: (next: ListState, prev: ListState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const createListChannel = (
  key: string,
  store: ReturnType<typeof createListStore>
): SyncChannelPlugin<ListState, ListPatch> => {
  return {
    key,
    getState: () => store.getState(),
    subscribe: (listener) => store.subscribe(listener),
    setState: (next, meta) => {
      if (meta.origin === "remote") {
        if (meta.source === "snapshot") {
          const mergedItems = normalizeItems([...store.getState().items, ...next.items]);
          store.setState({ items: mergedItems });
        } else {
          store.setState(next);
        }
        return;
      }

      store.setState(next);
    },
    diff: (prev, next) => {
      const added = next.items.filter((item) => !prev.items.includes(item));
      if (added.length > 0) return { type: "add", added };

      const removed = prev.items.filter((item) => !next.items.includes(item));
      if (removed.length > 0) return { type: "remove", removed };

      return null;
    },
    apply: (base, patch) => {
      switch (patch.type) {
        case "add":
          return {
            items: normalizeItems([...base.items, ...patch.added]),
          };
        case "remove":
          return {
            items: base.items.filter((item) => !patch.removed.includes(item)),
          };
      }
    },
    snapshot: (state) => state,
    hydrate: (raw) => {
      if (!raw || typeof raw !== "object") {
        return { items: [] };
      }

      const candidate = raw as { items?: unknown };
      if (!Array.isArray(candidate.items)) {
        return { items: [] };
      }

      const validItems = candidate.items.filter(
        (item): item is string => typeof item === "string"
      );
      return {
        items: normalizeItems(validItems),
      };
    },
  };
};

const createClient = (
  network: MemorySyncNetwork,
  { roomId, localPeerId }: { roomId: string; localPeerId: SyncPeerId }
) => {
  const transport = network.createTransport();
  const options: SyncClientOptions = {
    roomId,
    localPeerId,
    transport,
  };
  return createSyncClient(options);
};

describe("createSyncClient integration (no UI)", () => {
  const clients: Array<ReturnType<typeof createSyncClient>> = [];

  afterEach(async () => {
    await Promise.all(
      clients.map(async (client) => {
        await client.stop();
      })
    );
    clients.length = 0;
  });

  it("syncs channel patches between connected peers in the same room", async () => {
    const network = new MemorySyncNetwork();
    const clientA = createClient(network, {
      roomId: "table-alpha",
      localPeerId: "peer-a",
    });
    const clientB = createClient(network, {
      roomId: "table-alpha",
      localPeerId: "peer-b",
    });
    clients.push(clientA, clientB);

    const storeA = createListStore();
    const storeB = createListStore();

    clientA.registerChannel(createListChannel("board", storeA));
    clientB.registerChannel(createListChannel("board", storeB));

    await clientA.start();
    await clientB.start();
    await clientB.connect("peer-a");

    storeA.addItem("card-from-a");
    await waitFor(() => {
      expect(storeB.getState().items).toContain("card-from-a");
    });

    storeB.addItem("card-from-b");
    await waitFor(() => {
      expect(storeA.getState().items).toEqual(["card-from-a", "card-from-b"]);
      expect(storeB.getState().items).toEqual(["card-from-a", "card-from-b"]);
    });
  });

  it("ignores messages from peers in another room even when transport is linked", async () => {
    const network = new MemorySyncNetwork();
    const clientA = createClient(network, {
      roomId: "table-room-a",
      localPeerId: "peer-a",
    });
    const clientB = createClient(network, {
      roomId: "table-room-b",
      localPeerId: "peer-b",
    });
    clients.push(clientA, clientB);

    const storeA = createListStore();
    const storeB = createListStore();
    const peerSyncHandler = vi.fn();

    clientA.registerChannel(createListChannel("board", storeA));
    clientB.registerChannel(createListChannel("board", storeB));
    clientB.onMessage("peer-sync", peerSyncHandler);

    await clientA.start();
    await clientB.start();
    await clientB.connect("peer-a");

    storeA.addItem("should-not-sync");
    clientA.send({
      type: "peer-sync",
      payload: { connectedPeers: ["peer-a"] },
    });

    await wait(50);
    expect(storeB.getState().items).toEqual([]);
    expect(peerSyncHandler).not.toHaveBeenCalled();
  });

  it("recovers remote changes after reconnect through snapshot replay", async () => {
    const network = new MemorySyncNetwork();
    const clientA = createClient(network, {
      roomId: "table-reconnect",
      localPeerId: "peer-a",
    });
    const clientB = createClient(network, {
      roomId: "table-reconnect",
      localPeerId: "peer-b",
    });
    clients.push(clientA, clientB);

    const storeA = createListStore();
    const storeB = createListStore();
    clientA.registerChannel(createListChannel("board", storeA));
    clientB.registerChannel(createListChannel("board", storeB));

    await clientA.start();
    await clientB.start();
    await clientB.connect("peer-a");

    storeA.addItem("before-disconnect");
    await waitFor(() => {
      expect(storeB.getState().items).toContain("before-disconnect");
    });

    await clientB.disconnect("peer-a");
    storeA.addItem("while-disconnected");
    await wait(50);
    expect(storeB.getState().items).not.toContain("while-disconnected");

    await clientB.connect("peer-a");
    await waitFor(() => {
      expect(storeB.getState().items).toEqual([
        "before-disconnect",
        "while-disconnected",
      ]);
    });

    expect(storeA.getState().items).toEqual(["before-disconnect", "while-disconnected"]);
  });

  it("converges with delayed and out-of-order patch delivery", async () => {
    const network = new MemorySyncNetwork({
      resolveDeliveryDelayMs: ({ message }) => {
        if (message.type !== "sync:channel-patch") return 0;
        const payload = message.payload as { patch?: { added?: string[] } };
        if (payload.patch?.added?.includes("a-slow")) {
          return 30;
        }
        if (payload.patch?.added?.includes("b-fast")) {
          return 1;
        }
        return 0;
      },
    });

    const clientA = createClient(network, {
      roomId: "table-delay",
      localPeerId: "peer-a",
    });
    const clientB = createClient(network, {
      roomId: "table-delay",
      localPeerId: "peer-b",
    });
    clients.push(clientA, clientB);

    const storeA = createListStore();
    const storeB = createListStore();
    clientA.registerChannel(createListChannel("board", storeA));
    clientB.registerChannel(createListChannel("board", storeB));

    await clientA.start();
    await clientB.start();
    await clientB.connect("peer-a");

    storeA.addItem("a-slow");
    storeB.addItem("b-fast");

    await waitFor(() => {
      expect(storeA.getState().items).toEqual(["a-slow", "b-fast"]);
      expect(storeB.getState().items).toEqual(["a-slow", "b-fast"]);
    });
  });

  it("syncs item removal between connected peers", async () => {
    const network = new MemorySyncNetwork();
    const clientA = createClient(network, {
      roomId: "table-remove",
      localPeerId: "peer-a",
    });
    const clientB = createClient(network, {
      roomId: "table-remove",
      localPeerId: "peer-b",
    });
    clients.push(clientA, clientB);

    const storeA = createListStore(["item-1", "item-2", "item-3"]);
    const storeB = createListStore(["item-1", "item-2", "item-3"]);

    clientA.registerChannel(createListChannel("board", storeA));
    clientB.registerChannel(createListChannel("board", storeB));

    await clientA.start();
    await clientB.start();
    await clientB.connect("peer-a");

    // Peer A removes an item
    storeA.removeItem("item-2");
    expect(storeA.getState().items).toEqual(["item-1", "item-3"]);

    // The removal should sync to peer B
    await waitFor(() => {
      expect(storeB.getState().items).toEqual(["item-1", "item-3"]);
    });
  });

  it("honors stop() called while start() is still in flight", async () => {
    const network = new MemorySyncNetwork();
    const delayedTransport = network.createTransport({ startDelayMs: 40 });
    const raceClient = createSyncClient({
      roomId: "table-race",
      localPeerId: "peer-a",
      transport: delayedTransport,
    });
    clients.push(raceClient);

    const startPromise = raceClient.start();
    const stopPromise = raceClient.stop();
    await Promise.all([startPromise, stopPromise]);

    expect(delayedTransport.isStarted()).toBe(false);

    const otherClient = createClient(network, {
      roomId: "table-race",
      localPeerId: "peer-b",
    });
    clients.push(otherClient);
    await otherClient.start();

    await expect(otherClient.connect("peer-a")).rejects.toThrow(
      "Unknown peer in connection"
    );
  });

  it("recovers correctly from strict-mode style start/stop/start overlap", async () => {
    const network = new MemorySyncNetwork();
    const delayedTransport = network.createTransport({ startDelayMs: 40 });
    const strictModeClient = createSyncClient({
      roomId: "table-strict-mode",
      localPeerId: "peer-a",
      transport: delayedTransport,
    });
    clients.push(strictModeClient);

    const firstStart = strictModeClient.start();
    const stopDuringFirstStart = strictModeClient.stop();
    const secondStart = strictModeClient.start();

    await Promise.all([firstStart, stopDuringFirstStart, secondStart]);

    expect(delayedTransport.isStarted()).toBe(true);
    expect(strictModeClient.localPeerId()).toBe("peer-a");
  });
});
