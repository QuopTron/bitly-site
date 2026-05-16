class AsyncLocalStorage {
  constructor() { }
  getStore(): unknown {
    return undefined;
  }
  run(store: unknown, callback: () => unknown): unknown {
    return callback();
  }
  enterWith(store: unknown): void { }
}

export { AsyncLocalStorage };
export default { AsyncLocalStorage };
