interface CacheItem<T> {
  data: T;
  expiry: number;
}

class MemoryCache {
  private cache = new Map<string, CacheItem<any>>();
  private pendingPromises = new Map<string, Promise<any>>();

  set<T>(key: string, value: T, ttlMs: number): void {
    const expiry = Date.now() + ttlMs;
    this.cache.set(key, { data: value, expiry });
    this.pendingPromises.delete(key);
  }

  get<T>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }

    return item.data;
  }

  async getOrFetch<T>(
    key: string, 
    fetchFn: () => Promise<T>, 
    ttlMs: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const existingPromise = this.pendingPromises.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = fetchFn().then(result => {
      this.set(key, result, ttlMs);
      return result;
    }).catch(error => {
      this.pendingPromises.delete(key);
      throw error;
    });

    this.pendingPromises.set(key, promise);
    return promise;
  }

  delete(key: string): void {
    this.cache.delete(key);
    this.pendingPromises.delete(key);
  }

  deleteByPattern(pattern: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
    for (const key of this.pendingPromises.keys()) {
      if (key.includes(pattern)) {
        this.pendingPromises.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
    this.pendingPromises.clear();
  }
}

export const cache = new MemoryCache();

export const CACHE_KEYS = {
  PLAYER_LIST: 'players:list',
  PLAYER: (pId: string) => `players:${pId}`,
} as const;

export const CACHE_TTL = {
  PLAYER_LIST: 10 * 1000, // 10 seconds
  PLAYER: 60 * 1000, // 1 minute
} as const;