import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { PeerSyncProvider } from "peersync/react";
import { createPeerJsTransport } from "peersync/peerjs";
import { App } from "./App";

const Root = () => {
  const transport = useMemo(() => createPeerJsTransport(), []);

  return (
    <StrictMode>
      <PeerSyncProvider roomId="peersync-todo-demo" transport={transport}>
        <App />
      </PeerSyncProvider>
    </StrictMode>
  );
};

createRoot(document.getElementById("root")!).render(<Root />);
