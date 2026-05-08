import { ImageAsset, Texture2D } from 'cc';
import { sp } from 'cc';
import { remoteAssets, LoadOptions, RetryPolicy } from './RemoteAssetManager';
import { RefCountCache, RefCountEntry } from '../core/RefCountCache';

// ============================================================================
//  第二层：RemoteSpineManager（Spine 资源池）
//
//  Spine 远程加载的复杂性在于「三件套」：
//    ① skeleton (.json / .skel)  —— 骨骼数据
//    ② atlas    (.atlas)          —— 图集描述文本
//    ③ textures (.png × N)        —— 图集纹理（可能多张）
//
//  这三类资源必须全部加载完毕才能组装成 sp.SkeletonData
//
//  本管理器职责：
//  · 并行加载三类资源（图片走 RemoteAssetManager 享受去重/重试/缓存）
//  · 解析 atlas 文本自动发现纹理文件名
//  · 组装 sp.SkeletonData
//  · 引用计数共享（多个 Skeleton 节点可复用同一份数据）
//  · 完整释放链路（SkeletonData → Texture2D → ImageAsset 逐层清理）
// ============================================================================

/** Spine 加载配置 */
export interface SpineLoadConfig {
    skelUrl: string;
    atlasUrl?: string;
    textureBaseUrl?: string;
    retry?: Partial<RetryPolicy>;
    timeout?: number;
}

/** acquire 返回给上层的句柄 */
export interface SpineHandle {
    key: string;
    skeletonData: sp.SkeletonData;
    release: () => void;
}

/** 池中的共享条目 */
interface SpinePoolEntry extends RefCountEntry {
    skeletonData: sp.SkeletonData;
    textures: Texture2D[];
    imageAssetUrls: string[];
    imageAssetExts: string[];
    createdAt: number;
}

// ============================================================================

class RemoteSpineManager {

    private static _inst: RemoteSpineManager | null = null;
    static get instance(): RemoteSpineManager {
        return this._inst ??= new RemoteSpineManager();
    }

    private _rc = new RefCountCache<SpinePoolEntry>((key, entry) => {
        // 1) SkeletonData
        if (entry.skeletonData.isValid) {
            entry.skeletonData.destroy();
        }
        // 2) Texture2D → GPU 显存
        entry.textures.forEach(tex => {
            if (tex.isValid) tex.destroy();
        });
        // 3) ImageAsset → 通过 RemoteAssetManager 释放引用
        entry.imageAssetUrls.forEach((url, i) => {
            remoteAssets.release(url, {
                type: ImageAsset as any,
                ext: entry.imageAssetExts[i],
            });
        });
        console.debug(`[RemoteSpineManager] 已释放: ${key} (${entry.textures.length} 张纹理)`);
    });

    private _defaultRetry: RetryPolicy = { maxRetries: 3, baseDelay: 1000, maxDelay: 8000 };
    private _defaultTimeout = 20_000;

    private constructor() {}

    // ======================== 核心 API ========================

    async acquire(config: SpineLoadConfig): Promise<SpineHandle> {
        const key = config.skelUrl;

        // ① 池命中
        const cached = this._rc.get(key, e => e.skeletonData.isValid);
        if (cached) return this._wrapHandle(key, cached);

        // ② 去重
        const pending = this._rc.getPending(key);
        if (pending) {
            const entry = await pending;
            const resolved = this._rc.get(key, e => e.skeletonData.isValid);
            if (resolved) return this._wrapHandle(key, resolved);
            return this._wrapHandle(key, entry);
        }

        // ③ 新请求
        const promise = this._doLoad(config, key);
        this._rc.setPending(key, promise);

        try {
            const entry = await promise;
            return this._wrapHandle(key, entry);
        } finally {
            this._rc.deletePending(key);
        }
    }

    async preload(config: SpineLoadConfig): Promise<void> {
        const handle = await this.acquire(config);
        handle.release();
    }

    // ======================== 查询 ========================

    getRefCount(config: SpineLoadConfig): number {
        return this._rc.getRefCount(config.skelUrl);
    }

    get poolSize(): number { return this._rc.size; }

    dump() {
        const rows: any[] = [];
        this._rc.forEach((e, k) => rows.push({
            key: k,
            ref: e.refCount,
            textures: e.textures.length,
        }));
        return rows;
    }

    purgeAll(): void {
        this._rc.releaseAll();
    }

    // ======================== 内部实现 ========================

    private async _doLoad(config: SpineLoadConfig, key: string): Promise<SpinePoolEntry> {
        const retry: RetryPolicy = { ...this._defaultRetry, ...config.retry };
        const timeout = config.timeout ?? this._defaultTimeout;

        // ---- 推导 URL ----
        const skelUrl = config.skelUrl;
        const isBinary = /\.skel$/i.test(skelUrl.split('?')[0]);
        const baseName = skelUrl.replace(/\.(json|skel)(\?.*)?$/i, '');
        const atlasUrl = config.atlasUrl ?? `${baseName}.atlas`;
        const textureBase = config.textureBaseUrl ?? atlasUrl.substring(0, atlasUrl.lastIndexOf('/') + 1);

        // ---- 阶段 1: 并行加载 skeleton + atlas ----
        const [skelData, atlasText] = await Promise.all([
            isBinary
                ? this._fetchBinary(skelUrl, retry, timeout)
                : this._fetchJson(skelUrl, retry, timeout),
            this._fetchText(atlasUrl, retry, timeout),
        ]);

        // ---- 阶段 2: 解析 atlas → 发现纹理文件名 ----
        const textureNames = RemoteSpineManager._parseAtlasPages(atlasText);
        if (textureNames.length === 0) {
            throw new Error(`[RemoteSpineManager] Atlas 中未找到纹理文件名: ${atlasUrl}`);
        }

        // ---- 阶段 3: 通过 RemoteAssetManager 加载所有纹理 ----
        const textureUrls = textureNames.map(name => `${textureBase}${name}`);
        const imageAssetExts = textureNames.map(name => {
            const lower = name.toLowerCase();
            if (lower.endsWith('.png'))  return '.png';
            if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return '.jpg';
            if (lower.endsWith('.webp')) return '.webp';
            return '.png';
        });

        const imageAssets = await Promise.all(
            textureUrls.map((url, i) =>
                remoteAssets.load<ImageAsset>(url, {
                    type: ImageAsset as any,
                    ext: imageAssetExts[i],
                    retry: config.retry,
                    timeout: config.timeout,
                }),
            ),
        );

        const textures = imageAssets.map(img => {
            const tex = new Texture2D();
            tex.image = img;
            return tex;
        });

        // ---- 阶段 4: 组装 sp.SkeletonData ----
        const skeletonData = new sp.SkeletonData();

        if (isBinary) {
            (skeletonData as any)._nativeAsset = skelData as ArrayBuffer;
        } else {
            skeletonData.skeletonJson = skelData as any;
        }

        skeletonData.atlasText = atlasText;
        skeletonData.textures = textures;
        skeletonData.textureNames = textureNames;

        const entry: SpinePoolEntry = {
            skeletonData,
            textures,
            imageAssetUrls: textureUrls,
            imageAssetExts,
            refCount: 1,
            createdAt: Date.now(),
            lastAccessAt: Date.now(),
        };
        this._rc.set(key, entry);
        return entry;
    }

    private _wrapHandle(key: string, entry: SpinePoolEntry): SpineHandle {
        let released = false;
        return {
            key,
            skeletonData: entry.skeletonData,
            release: () => {
                if (released) return;
                released = true;
                this._rc.release(key);
            },
        };
    }

    // ======================== 网络工具 ========================

    private async _fetchJson(
        url: string, retry: RetryPolicy, timeout: number,
    ): Promise<object> {
        const text = await this._fetchText(url, retry, timeout);
        try {
            return JSON.parse(text);
        } catch (e) {
            throw new Error(`[RemoteSpineManager] JSON 解析失败: ${url}`);
        }
    }

    private async _fetchText(
        url: string, retry: RetryPolicy, timeout: number,
    ): Promise<string> {
        return this._fetchWithRetry(url, 'text', retry, timeout) as Promise<string>;
    }

    private async _fetchBinary(
        url: string, retry: RetryPolicy, timeout: number,
    ): Promise<ArrayBuffer> {
        return this._fetchWithRetry(url, 'arraybuffer', retry, timeout) as Promise<ArrayBuffer>;
    }

    private async _fetchWithRetry(
        url: string,
        responseType: XMLHttpRequestResponseType,
        retry: RetryPolicy,
        timeout: number,
    ): Promise<string | ArrayBuffer> {
        let lastErr: Error | null = null;

        for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
            if (attempt > 0) {
                const base = retry.baseDelay * Math.pow(2, attempt - 1);
                const delay = Math.min(base + base * 0.3 * Math.random(), retry.maxDelay);
                await new Promise(r => setTimeout(r, delay));
                console.warn(`[RemoteSpineManager] 重试 ${attempt}/${retry.maxRetries} → ${url}`);
            }
            try {
                return await this._xhrOnce(url, responseType, timeout);
            } catch (e: any) {
                lastErr = e instanceof Error ? e : new Error(String(e));
            }
        }
        throw new Error(
            `[RemoteSpineManager] 加载失败(${retry.maxRetries + 1}次): ${url}\n${lastErr?.message}`
        );
    }

    private _xhrOnce(
        url: string,
        responseType: XMLHttpRequestResponseType,
        timeout: number,
    ): Promise<string | ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = responseType;
            xhr.timeout = timeout;

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(responseType === 'arraybuffer' ? xhr.response : xhr.responseText);
                } else {
                    reject(new Error(`HTTP ${xhr.status}: ${url}`));
                }
            };
            xhr.onerror = () => reject(new Error(`网络错误: ${url}`));
            xhr.ontimeout = () => reject(new Error(`超时(${timeout}ms): ${url}`));
            xhr.send();
        });
    }

    // ======================== Atlas 解析 ========================

    static _parseAtlasPages(atlasText: string): string[] {
        const names: string[] = [];
        const seen = new Set<string>();
        const lines = atlasText.split(/\r?\n/);

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (line[0] === ' ' || line[0] === '\t') continue;
            if (trimmed.includes(':')) continue;
            if (/\.(png|jpe?g|webp|bmp|ktx|pvr|astc)$/i.test(trimmed)) {
                if (!seen.has(trimmed)) {
                    seen.add(trimmed);
                    names.push(trimmed);
                }
            }
        }

        return names;
    }
}

export const remoteSpineManager = RemoteSpineManager.instance;
export { RemoteSpineManager };
