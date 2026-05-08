/**
 * 引用计数缓存条目的最小约束
 */
export interface RefCountEntry {
    refCount: number;
    lastAccessAt: number;
}

/**
 * 泛型引用计数缓存
 *
 * 提供：缓存命中自动 refCount++、请求去重（pending）、
 * 释放（refCount-- → 归零销毁）、空闲回收、强制释放等能力。
 *
 * 各 Manager 注入不同的 onDestroy 回调以控制实际销毁逻辑。
 */
export class RefCountCache<TEntry extends RefCountEntry> {

    private _cache = new Map<string, TEntry>();
    private _pending = new Map<string, { promise: Promise<TEntry>; callerCount: number }>();

    constructor(private _onDestroy: (key: string, entry: TEntry) => void) {}

    // ======================== 缓存操作 ========================

    /**
     * 获取缓存条目，命中则 refCount++ 并更新访问时间。
     * 若 isValid 返回 false，自动删除失效条目并返回 null。
     */
    get(key: string, isValid?: (entry: TEntry) => boolean): TEntry | null {
        const entry = this._cache.get(key);
        if (!entry) return null;

        if (isValid && !isValid(entry)) {
            this._cache.delete(key);
            return null;
        }

        entry.refCount++;
        entry.lastAccessAt = Date.now();
        return entry;
    }

    set(key: string, entry: TEntry): void {
        this._cache.set(key, entry);
    }

    delete(key: string): void {
        this._cache.delete(key);
    }

    // ======================== 请求去重 ========================

    /**
     * 获取进行中的请求。命中则 callerCount++，返回 Promise；未命中返回 null。
     */
    getPending(key: string): Promise<TEntry> | null {
        const pending = this._pending.get(key);
        if (pending) {
            pending.callerCount++;
            return pending.promise;
        }
        return null;
    }

    setPending(key: string, promise: Promise<TEntry>): void {
        this._pending.set(key, { promise, callerCount: 1 });
    }

    deletePending(key: string): void {
        this._pending.delete(key);
    }

    // ======================== 释放 ========================

    /** refCount-- → 归零时调用 onDestroy */
    release(key: string): void {
        const entry = this._cache.get(key);
        if (!entry) return;
        entry.refCount = Math.max(0, entry.refCount - 1);
        if (entry.refCount <= 0) {
            this._cache.delete(key);
            this._onDestroy(key, entry);
        }
    }

    /** 直接销毁，忽略 refCount */
    forceRelease(key: string): void {
        const entry = this._cache.get(key);
        if (entry) {
            this._cache.delete(key);
            this._onDestroy(key, entry);
        }
    }

    /** 释放所有条目 */
    releaseAll(): void {
        this._cache.forEach((entry, key) => this._onDestroy(key, entry));
        this._cache.clear();
    }

    /** 释放 refCount<=0 且空闲超过 maxIdleMs 的条目 */
    releaseIdle(maxIdleMs: number): void {
        const now = Date.now();
        const toDelete: string[] = [];
        this._cache.forEach((entry, key) => {
            if (entry.refCount <= 0 && now - entry.lastAccessAt > maxIdleMs) {
                toDelete.push(key);
            }
        });
        for (const key of toDelete) {
            const entry = this._cache.get(key);
            if (entry) {
                this._cache.delete(key);
                this._onDestroy(key, entry);
            }
        }
    }

    // ======================== 查询 ========================

    has(key: string): boolean {
        return this._cache.has(key);
    }

    getEntry(key: string): TEntry | undefined {
        return this._cache.get(key);
    }

    getRefCount(key: string): number {
        return this._cache.get(key)?.refCount ?? 0;
    }

    get size(): number {
        return this._cache.size;
    }

    forEach(fn: (entry: TEntry, key: string) => void): void {
        this._cache.forEach(fn);
    }
}
