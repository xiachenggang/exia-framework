import { ImageAsset, Texture2D } from 'cc';
import { sp } from 'cc';
import { remoteAssets, LoadOptions, RetryPolicy } from './RemoteAssetManager';

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
    /** 骨骼数据 URL (.json 或 .skel) */
    skelUrl: string;
    /** Atlas 文件 URL，不传则自动从 skelUrl 推导 */
    atlasUrl?: string;
    /** 纹理基础路径，不传则自动从 atlasUrl 推导 */
    textureBaseUrl?: string;
    /** 重试策略覆盖 */
    retry?: Partial<RetryPolicy>;
    /** 单文件超时 ms */
    timeout?: number;
}

/** acquire 返回给上层的句柄 */
export interface SpineHandle {
    /** 配置标识 */
    key: string;
    /** 组装好的 SkeletonData，可直接赋给 sp.Skeleton.skeletonData */
    skeletonData: sp.SkeletonData;
    /** 上层必须调用释放 */
    release: () => void;
}

/** 池中的共享条目 */
interface SpinePoolEntry {
    skeletonData: sp.SkeletonData;
    textures: Texture2D[];
    imageAssetUrls: string[];       // 用于调用 remoteAssets.release
    imageAssetExts: string[];       // 对应的 ext 参数
    refCount: number;
    createdAt: number;
}

// ============================================================================

class RemoteSpineManager {

    private static _inst: RemoteSpineManager | null = null;
    static get instance(): RemoteSpineManager {
        return this._inst ??= new RemoteSpineManager();
    }

    /** key → 共享的 SkeletonData 条目 */
    private _pool = new Map<string, SpinePoolEntry>();

    /** key → 进行中的加载（去重） */
    private _loading = new Map<string, Promise<SpinePoolEntry>>();

    /** 默认重试配置（文本/二进制资源，图片走 RemoteAssetManager 自己的配置） */
    private _defaultRetry: RetryPolicy = { maxRetries: 3, baseDelay: 1000, maxDelay: 8000 };
    private _defaultTimeout = 20_000;

    private constructor() {}

    // ======================== 核心 API ========================

    /**
     * 获取远程 Spine 资源
     *
     * 完整流程：
     *  1. 检查池中是否已有 → refCount++ 直接返回
     *  2. 检查是否正在加载 → 复用 Promise（去重）
     *  3. 并行加载三类资源：
     *     · skeleton JSON/Binary → 自带重试的 XHR
     *     · atlas text           → 自带重试的 XHR
     *     · textures (N 张)      → RemoteAssetManager（享受全部能力）
     *  4. 解析 atlas 提取纹理文件名
     *  5. 组装 sp.SkeletonData
     *  6. 返回 SpineHandle（含一次性 release 回调）
     */
    async acquire(config: SpineLoadConfig): Promise<SpineHandle> {
        const key = this._makeKey(config);

        // ① 池命中
        const cached = this._pool.get(key);
        if (cached && cached.skeletonData.isValid) {
            cached.refCount++;
            return this._wrapHandle(key, cached);
        }
        if (cached) this._pool.delete(key);

        // ② 去重
        if (!this._loading.has(key)) {
            this._loading.set(key, this._doLoad(config, key));
        }

        try {
            const entry = await this._loading.get(key)!;
            // 并发等待者补 refCount
            if (this._pool.has(key)) {
                const e = this._pool.get(key)!;
                e.refCount++;
                return this._wrapHandle(key, e);
            }
            // 首次完成者写入池
            this._pool.set(key, entry);
            return this._wrapHandle(key, entry);
        } finally {
            this._loading.delete(key);
        }
    }

    /**
     * 预加载（不占引用）
     */
    async preload(config: SpineLoadConfig): Promise<void> {
        const handle = await this.acquire(config);
        handle.release();
    }

    // ======================== 查询 ========================

    getRefCount(config: SpineLoadConfig): number {
        return this._pool.get(this._makeKey(config))?.refCount ?? 0;
    }

    get poolSize(): number { return this._pool.size; }

    dump() {
        const rows: any[] = [];
        this._pool.forEach((e, k) => rows.push({
            key: k,
            ref: e.refCount,
            textures: e.textures.length,
        }));
        return rows;
    }

    /** 强制清空全部 */
    purgeAll(): void {
        this._pool.forEach((entry, key) => this._destroyEntry(key, entry));
        this._pool.clear();
    }

    // ======================== 内部实现 ========================

    private _makeKey(config: SpineLoadConfig): string {
        return config.skelUrl;
    }

    /**
     * 执行完整的三阶段加载
     */
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

        // 并行加载，每张图独立享受 RemoteAssetManager 的去重/重试/缓存
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

        // ImageAsset → Texture2D
        const textures = imageAssets.map(img => {
            const tex = new Texture2D();
            tex.image = img;
            return tex;
        });

        // ---- 阶段 4: 组装 sp.SkeletonData ----
        const skeletonData = new sp.SkeletonData();

        if (isBinary) {
            // 二进制 .skel
            (skeletonData as any)._nativeAsset = skelData as ArrayBuffer;
        } else {
            // JSON
            skeletonData.skeletonJson = skelData as any;
        }

        skeletonData.atlasText = atlasText;
        skeletonData.textures = textures;
        skeletonData.textureNames = textureNames;

        return {
            skeletonData,
            textures,
            imageAssetUrls: textureUrls,
            imageAssetExts,
            refCount: 1,
            createdAt: Date.now(),
        };
    }

    /**
     * 包装为 SpineHandle（含一次性 release）
     */
    private _wrapHandle(key: string, entry: SpinePoolEntry): SpineHandle {
        let released = false;
        return {
            key,
            skeletonData: entry.skeletonData,
            release: () => {
                if (released) return;
                released = true;
                this._releaseOne(key);
            },
        };
    }

    /**
     * ★ 释放链路 ★
     *
     * refCount-- → 归零后：
     *  1. sp.SkeletonData.destroy()     ← 骨骼数据
     *  2. Texture2D[].forEach(destroy)  ← GPU 显存
     *  3. remoteAssets.release() × N    ← ImageAsset 引用计数
     */
    private _releaseOne(key: string): void {
        const entry = this._pool.get(key);
        if (!entry) return;

        entry.refCount = Math.max(0, entry.refCount - 1);
        if (entry.refCount <= 0) {
            this._destroyEntry(key, entry);
        }
    }

    private _destroyEntry(key: string, entry: SpinePoolEntry): void {
        this._pool.delete(key);

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
    }

    // ======================== 网络工具 ========================

    /**
     * 带重试的 JSON 加载
     */
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

    /**
     * 带重试的文本加载
     */
    private async _fetchText(
        url: string, retry: RetryPolicy, timeout: number,
    ): Promise<string> {
        return this._fetchWithRetry(url, 'text', retry, timeout) as Promise<string>;
    }

    /**
     * 带重试的二进制加载
     */
    private async _fetchBinary(
        url: string, retry: RetryPolicy, timeout: number,
    ): Promise<ArrayBuffer> {
        return this._fetchWithRetry(url, 'arraybuffer', retry, timeout) as Promise<ArrayBuffer>;
    }

    /**
     * 通用 XHR 请求 + 指数退避重试
     */
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

    /**
     * 从 atlas 文本中提取纹理页文件名
     *
     * 兼容 Spine 3.x 和 4.x atlas 格式：
     *   - 非缩进行
     *   - 不含冒号（排除 size: / filter: 等属性行）
     *   - 以图片扩展名结尾
     *
     * 示例 atlas 片段：
     *   hero.png              ← 匹配 ✓
     *   size: 1024,1024       ← 不匹配（含冒号）
     *   filter: Linear,Linear ← 不匹配（含冒号）
     *     rotate: false       ← 不匹配（缩进）
     *   hero2.png             ← 匹配 ✓
     */
    static _parseAtlasPages(atlasText: string): string[] {
        const names: string[] = [];
        const seen = new Set<string>();
        const lines = atlasText.split(/\r?\n/);

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // 必须是非缩进行（原始行首字符不是空白）
            if (line[0] === ' ' || line[0] === '\t') continue;

            // 排除属性行（含冒号）
            if (trimmed.includes(':')) continue;

            // 以图片扩展名结尾
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
