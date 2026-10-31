interface Listeners<Value> {
  readonly emit: (value: Value) => void;
  readonly listenerCount: () => number;
  readonly subscribe: (listener: (value: Value) => void) => () => void;
}

export function createListeners<Value = void>(): Listeners<Value> {
  const listeners = new Set<(value: Value) => void>();

  return {
    emit: (value) => {
      for (const listener of listeners) {
        listener(value);
      }
    },
    listenerCount: () => {
      return listeners.size;
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
