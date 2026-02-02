const store = new Map();

export const cacheGet = (k) => store.get(k);
export const cacheSet = (k, v) => store.set(k, v);
export const cacheDel = (k) => store.delete(k);
