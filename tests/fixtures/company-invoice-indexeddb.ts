import { vi } from "vitest";
// Copied deterministic offline IndexedDB primitive, no dependency or production IO.
type MockRequest = {
  result?: unknown;
  error?: Error;
  onsuccess?: () => void;
  onerror?: () => void;
  onupgradeneeded?: () => void;
  onblocked?: () => void;
};
type MockTx = {
  oncomplete?: () => void;
  onabort?: () => void;
  onerror?: () => void;
  abort(): void;
  objectStore(name: string): {
    get(key: string): MockRequest;
    count(key?: string): MockRequest;
    put(value: unknown, key: string): MockRequest;
    delete(key: string): MockRequest;
  };
};
export function invoiceIndexedDBMock() {
  let data = new Map<string, Map<string, unknown>>();
  const pending: (() => void)[] = [];
  let busy = false;
  const model = {
    failCommit: false,
    failOpen: false,
    blocked: false,
    failPut: false,
    transactions: [] as { mode: IDBTransactionMode; durability?: string }[],
    close: vi.fn(),
    entries: (store: string) => [...(data.get(store) ?? new Map()).entries()],
    edit: (store: string, key: string, value: unknown) => {
      data.get(store)!.set(key, structuredClone(value));
    },
    erase: (store: string, key: string) => {
      data.get(store)!.delete(key);
    },
    factory: undefined as unknown as IDBFactory,
  };
  const startNext = () => {
    if (busy || !pending.length) return;
    busy = true;
    pending.shift()!();
  };
  const db = {
    onversionchange: undefined as undefined | (() => void),
    close: model.close,
    createObjectStore(name: string) {
      if (data.has(name)) throw new Error("duplicate store");
      data.set(name, new Map());
    },
    transaction(
      _names: string[],
      mode: IDBTransactionMode,
      options?: { durability?: string },
    ): MockTx {
      model.transactions.push({ mode, durability: options?.durability });
      let aborted = false;
      let started = false;
      let running = false;
      let ended = false;
      let local: Map<string, Map<string, unknown>>;
      const requests: (() => void)[] = [];
      const finish = () => {
        if (ended) return;
        ended = true;
        busy = false;
        queueMicrotask(startNext);
      };
      const fail = () => {
        aborted = true;
        if (started) {
          tx.onabort?.();
          finish();
        }
      };
      const process = () => {
        if (aborted || ended || !started || running) return;
        running = true;
        queueMicrotask(() => {
          running = false;
          if (aborted || ended) return;
          const work = requests.shift();
          if (work) {
            work();
            process();
            return;
          }
          if (model.failCommit && mode === "readwrite") {
            model.failCommit = false;
            fail();
            return;
          }
          if (mode === "readwrite") data = local;
          tx.oncomplete?.();
          finish();
        });
      };
      const request = (work: () => unknown): MockRequest => {
        const req: MockRequest = {};
        requests.push(() => {
          try {
            req.result = work();
            req.onsuccess?.();
          } catch (error) {
            req.error = error as Error;
            req.onerror?.();
            tx.onerror?.();
            fail();
          }
        });
        process();
        return req;
      };
      const tx: MockTx = {
        abort: fail,
        objectStore(name: string) {
          return {
            get: (key) =>
              request(() => structuredClone(local.get(name)!.get(key))),
            count: (key) =>
              request(() =>
                key === undefined
                  ? local.get(name)!.size
                  : Number(local.get(name)!.has(key)),
              ),
            put: (value, key) => {
              const cloned = structuredClone(value); // May throw DataCloneError synchronously.
              return request(() => {
                if (model.failPut) {
                  model.failPut = false;
                  throw new Error("mock put failure");
                }
                local.get(name)!.set(key, cloned);
                return key;
              });
            },
            delete: (key) =>
              request(() => {
                local.get(name)!.delete(key);
              }),
          };
        },
      };
      pending.push(() => {
        started = true;
        if (aborted) {
          tx.onabort?.();
          finish();
          return;
        }
        local = new Map(
          [...data].map(([name, values]) => [
            name,
            new Map(
              [...values].map(([key, value]) => [key, structuredClone(value)]),
            ),
          ]),
        );
        process();
      });
      queueMicrotask(startNext);
      return tx;
    },
  };
  model.factory = {
    open: () => {
      const request: MockRequest = {};
      queueMicrotask(() => {
        if (model.failOpen) {
          request.error = new Error("mock opening failure");
          request.onerror?.();
          return;
        }
        if (model.blocked) {
          request.onblocked?.();
          return;
        }
        request.result = db;
        if (!data.size) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  } as unknown as IDBFactory;
  return model;
}
