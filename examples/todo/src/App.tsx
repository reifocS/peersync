import { useEffect, useMemo, useRef, useState } from "react";
import { usePeerSync } from "peersync/react";
import {
  createTodoStore,
  createTodoChannel,
  type Todo,
  type TodoState,
} from "./TodoChannel";

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const useTodoStore = () => {
  const store = useMemo(() => createTodoStore(), []);
  const [state, setState] = useState<TodoState>(store.getState());

  useEffect(() => {
    return store.subscribe((next) => setState(next));
  }, [store]);

  return { store, state };
};

export const App = () => {
  const { status, localPeerId, peers, connect, registerChannel } = usePeerSync();
  const { store, state } = useTodoStore();
  const [peerInput, setPeerInput] = useState("");
  const [todoInput, setTodoInput] = useState("");
  const channelRegistered = useRef(false);

  useEffect(() => {
    if (channelRegistered.current) return;
    channelRegistered.current = true;
    const unregister = registerChannel(createTodoChannel(store));
    return () => {
      channelRegistered.current = false;
      unregister();
    };
  }, [registerChannel, store]);

  const handleConnect = () => {
    if (!peerInput.trim()) return;
    connect(peerInput.trim());
    setPeerInput("");
  };

  const handleAddTodo = () => {
    if (!todoInput.trim()) return;
    const todo: Todo = { id: generateId(), text: todoInput.trim(), done: false };
    store.setState({ todos: [...state.todos, todo] });
    setTodoInput("");
  };

  const handleToggle = (id: string) => {
    store.setState({
      todos: state.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    });
  };

  const handleRemove = (id: string) => {
    store.setState({ todos: state.todos.filter((t) => t.id !== id) });
  };

  return (
    <div>
      <h1 style={{ marginBottom: 8 }}>Peersync Todo</h1>

      <div
        style={{
          padding: 16,
          background: "#fff",
          borderRadius: 8,
          marginBottom: 16,
          border: "1px solid #e0e0e0",
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <strong>Status:</strong>{" "}
          <span
            style={{
              color:
                status === "connected"
                  ? "#2e7d32"
                  : status === "error"
                    ? "#c62828"
                    : "#666",
            }}
          >
            {status}
          </span>
        </div>
        <div style={{ marginBottom: 8 }}>
          <strong>Your Peer ID:</strong>{" "}
          <code
            style={{
              background: "#f5f5f5",
              padding: "2px 6px",
              borderRadius: 4,
              fontSize: 13,
              userSelect: "all",
            }}
          >
            {localPeerId ?? "..."}
          </code>
        </div>
        <div style={{ marginBottom: 12 }}>
          <strong>Connected peers:</strong>{" "}
          {peers.size === 0 ? (
            <span style={{ color: "#999" }}>none</span>
          ) : (
            Array.from(peers).map((p) => (
              <code
                key={p}
                style={{
                  background: "#e8f5e9",
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontSize: 13,
                  marginLeft: 4,
                }}
              >
                {p}
              </code>
            ))
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={peerInput}
            onChange={(e) => setPeerInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            placeholder="Enter peer ID to connect..."
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid #ccc",
              fontSize: 14,
            }}
          />
          <button
            onClick={handleConnect}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: "#1976d2",
              color: "#fff",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Connect
          </button>
        </div>
      </div>

      <div
        style={{
          padding: 16,
          background: "#fff",
          borderRadius: 8,
          border: "1px solid #e0e0e0",
        }}
      >
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            value={todoInput}
            onChange={(e) => setTodoInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddTodo()}
            placeholder="Add a todo..."
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid #ccc",
              fontSize: 14,
            }}
          />
          <button
            onClick={handleAddTodo}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: "#2e7d32",
              color: "#fff",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Add
          </button>
        </div>

        {state.todos.length === 0 ? (
          <p style={{ color: "#999", textAlign: "center", padding: 20 }}>
            No todos yet. Add one above!
          </p>
        ) : (
          <ul style={{ listStyle: "none" }}>
            {state.todos.map((todo) => (
              <li
                key={todo.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 0",
                  borderBottom: "1px solid #f0f0f0",
                }}
              >
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => handleToggle(todo.id)}
                  style={{ width: 18, height: 18, cursor: "pointer" }}
                />
                <span
                  style={{
                    flex: 1,
                    textDecoration: todo.done ? "line-through" : "none",
                    color: todo.done ? "#999" : "#1a1a2e",
                  }}
                >
                  {todo.text}
                </span>
                <button
                  onClick={() => handleRemove(todo.id)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#c62828",
                    cursor: "pointer",
                    fontSize: 18,
                    padding: "0 4px",
                  }}
                >
                  x
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
