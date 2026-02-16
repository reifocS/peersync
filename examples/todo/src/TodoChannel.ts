import type { SyncChannelPlugin } from "peersync";

export type Todo = {
  id: string;
  text: string;
  done: boolean;
};

export type TodoState = {
  todos: Todo[];
};

export type TodoPatch =
  | { type: "add"; todo: Todo }
  | { type: "toggle"; id: string }
  | { type: "remove"; id: string }
  | { type: "snapshot"; todos: Todo[] };

export type TodoStore = {
  getState: () => TodoState;
  setState: (next: TodoState) => void;
  subscribe: (listener: () => void) => () => void;
};

export const createTodoStore = (initial: Todo[] = []): TodoStore => {
  let state: TodoState = { todos: initial };
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    setState: (next: TodoState) => {
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export const createTodoChannel = (
  store: TodoStore
): SyncChannelPlugin<TodoState, TodoPatch> => ({
  key: "todos",
  getState: () => store.getState(),
  subscribe: (callback) => {
    let prev = store.getState();
    return store.subscribe(() => {
      const next = store.getState();
      callback(next, prev);
      prev = next;
    });
  },
  setState: (next, meta) => {
    if (meta.origin === "remote") {
      if (meta.source === "snapshot") {
        const current = store.getState();
        const merged = mergeTodos(current.todos, next.todos);
        store.setState({ todos: merged });
      } else {
        store.setState(next);
      }
      return;
    }
    store.setState(next);
  },
  diff: (prev, next) => {
    const added = next.todos.find((t) => !prev.todos.some((p) => p.id === t.id));
    if (added) return { type: "add", todo: added };

    const toggled = next.todos.find((t) => {
      const old = prev.todos.find((p) => p.id === t.id);
      return old && old.done !== t.done;
    });
    if (toggled) return { type: "toggle", id: toggled.id };

    const removed = prev.todos.find((t) => !next.todos.some((n) => n.id === t.id));
    if (removed) return { type: "remove", id: removed.id };

    return null;
  },
  apply: (base, patch) => {
    switch (patch.type) {
      case "add":
        if (base.todos.some((t) => t.id === patch.todo.id)) return base;
        return { todos: [...base.todos, patch.todo] };
      case "toggle":
        return {
          todos: base.todos.map((t) => (t.id === patch.id ? { ...t, done: !t.done } : t)),
        };
      case "remove":
        return { todos: base.todos.filter((t) => t.id !== patch.id) };
      case "snapshot":
        return { todos: mergeTodos(base.todos, patch.todos) };
    }
  },
  snapshot: (state) => state,
  hydrate: (raw) => {
    if (!raw || typeof raw !== "object") return { todos: [] };
    const candidate = raw as { todos?: unknown };
    if (!Array.isArray(candidate.todos)) return { todos: [] };
    return {
      todos: candidate.todos.filter(
        (t): t is Todo =>
          typeof t === "object" &&
          t !== null &&
          typeof t.id === "string" &&
          typeof t.text === "string" &&
          typeof t.done === "boolean"
      ),
    };
  },
});

const mergeTodos = (local: Todo[], remote: Todo[]): Todo[] => {
  const merged = new Map<string, Todo>();
  for (const t of local) merged.set(t.id, t);
  for (const t of remote) {
    if (!merged.has(t.id)) {
      merged.set(t.id, t);
    } else {
      const existing = merged.get(t.id)!;
      if (t.done !== existing.done) {
        merged.set(t.id, { ...existing, done: t.done || existing.done });
      }
    }
  }
  return Array.from(merged.values());
};
