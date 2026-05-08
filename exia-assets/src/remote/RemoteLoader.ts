import {
    assetManager,
    JsonAsset,
    TextAsset,
    ImageAsset,
    SpriteFrame,
    Texture2D,
    AudioClip,
    sys,
} from 'cc';

/**
 * 远程资源类型
 */
export enum RemoteAssetType {
    JSON = 'json',
    TEXT = 'text',
    FONT = 'font',
    IMAGE = 'image',
    AUDIO = 'audio',
}

/**
 * 加载选项
 */
export interface LoadOptions {
    /** 强制指定资源类型（不指定则根据后缀自动推断） */
    type?: RemoteAssetType;
    /** 强制指定扩展名（用于 URL 无后缀的情况，如 CDN 鉴权链接） */
    ext?: string;
    /** 超时毫秒，默认 15000 */
    timeout?: number;
    /** 失败重试次数，默认 2 */
    retry?: number;
    /** 是否使用缓存，默认 true */
    useCache?: boolean;
    /** 进度回调（仅 batch 生效） */
    onProgress?: (finished: number, total: number) => void;
}

/**
 * 字体专用选项
 */
export interface FontLoadOptions extends LoadOptions {
    /** 指定字体在 CSS/Canvas 中的 family 名称，不传则从 URL 推断 */
    fontFamily?: string;
}

/**
 * 批量加载任务
 */
export interface LoadTask {
    url: string;
    options?: LoadOptions;
}

/**
 * 回调签名（与 cc.assetManager 保持一致：err 优先）
 */
export type CompleteCallback<T = any> = (err: Error | null, data: T | null) => void;

/**
 * 批量加载完成回调
 */
export type BatchCompleteCallback = (
    errors: Map<string, Error>,
    results: Map<string, any>,
) => void;

/**
 * 通用远程资源加载管理器
 *
 * 使用示例：
 *   const data = await RemoteLoader.instance.load<any>('https://xxx/config.json');
 *   const txt  = await RemoteLoader.instance.load<string>('https://xxx/dialog.txt');
 *   const fam  = await RemoteLoader.instance.loadFont('https://xxx/alibaba.ttf');
 *   label.fontFamily = fam; // Label 组件 useSystemFont = true 时生效
 */
export class RemoteLoader {
    // ---------- 单例 ----------
    private static _instance: RemoteLoader | null = null;
    public static get instance(): RemoteLoader {
        if (!this._instance) this._instance = new RemoteLoader();
        return this._instance;
    }

    // ---------- 内部状态 ----------
    /** 已加载资源缓存 url -> asset */
    private _cache: Map<string, any> = new Map();
    /** 进行中的请求，用于去重 url -> promise */
    private _pending: Map<string, Promise<any>> = new Map();
    /** 已注册的字体 family 集合 */
    private _loadedFonts: Set<string> = new Set();

    private _defaultTimeout = 15000;
    private _defaultRetry = 2;

    // ========================================================================
    // 对外主 API
    // ========================================================================

    /**
     * 加载单个远程资源
     *
     * 支持三种调用方式：
     *   1. Promise:   await load(url)
     *   2. Promise:   await load(url, options)
     *   3. Callback:  load(url, (err, data) => {})
     *   4. Callback:  load(url, options, (err, data) => {})
     */
    public load<T = any>(url: string, callback: CompleteCallback<T>): void;
    public load<T = any>(
        url: string,
        options: LoadOptions,
        callback: CompleteCallback<T>,
    ): void;
    public load<T = any>(url: string, options?: LoadOptions): Promise<T>;
    public load<T = any>(
        url: string,
        optionsOrCb?: LoadOptions | CompleteCallback<T>,
        cb?: CompleteCallback<T>,
    ): Promise<T> | void {
        // 规范化参数
        let options: LoadOptions = {};
        let callback: CompleteCallback<T> | null = null;

        if (typeof optionsOrCb === 'function') {
            callback = optionsOrCb;
        } else if (optionsOrCb) {
            options = optionsOrCb;
            if (typeof cb === 'function') callback = cb;
        }

        const promise = this._loadInternal<T>(url, options);

        // 有回调 → 走回调模式（不向外返回 Promise，避免 unhandled rejection）
        if (callback) {
            promise.then(
                (data) => callback!(null, data),
                (err) => callback!(err instanceof Error ? err : new Error(String(err)), null),
            );
            return;
        }

        // 无回调 → Promise 模式
        return promise;
    }

    /**
     * 真正的加载逻辑（内部使用，永远返回 Promise）
     */
    private async _loadInternal<T>(url: string, options: LoadOptions): Promise<T> {
        // 1. 缓存命中直接返回
        if (options.useCache !== false && this._cache.has(url)) {
            return this._cache.get(url) as T;
        }

        // 2. 相同 URL 的并发请求去重
        if (this._pending.has(url)) {
            return this._pending.get(url) as Promise<T>;
        }

        const type = options.type ?? this._detectType(url, options.ext);
        const promise = this._loadWithRetry<T>(url, type, options);
        this._pending.set(url, promise);

        try {
            const result = await promise;
            if (options.useCache !== false) {
                this._cache.set(url, result);
            }
            return result;
        } finally {
            this._pending.delete(url);
        }
    }

    /**
     * 便捷方法：加载 JSON
     */
    public loadJson<T = any>(url: string, callback: CompleteCallback<T>): void;
    public loadJson<T = any>(
        url: string,
        options: LoadOptions,
        callback: CompleteCallback<T>,
    ): void;
    public loadJson<T = any>(url: string, options?: LoadOptions): Promise<T>;
    public loadJson<T = any>(
        url: string,
        optionsOrCb?: LoadOptions | CompleteCallback<T>,
        cb?: CompleteCallback<T>,
    ): Promise<T> | void {
        return this._invokeTyped<T>(url, RemoteAssetType.JSON, optionsOrCb, cb);
    }

    /**
     * 便捷方法：加载文本
     */
    public loadText(url: string, callback: CompleteCallback<string>): void;
    public loadText(
        url: string,
        options: LoadOptions,
        callback: CompleteCallback<string>,
    ): void;
    public loadText(url: string, options?: LoadOptions): Promise<string>;
    public loadText(
        url: string,
        optionsOrCb?: LoadOptions | CompleteCallback<string>,
        cb?: CompleteCallback<string>,
    ): Promise<string> | void {
        return this._invokeTyped<string>(url, RemoteAssetType.TEXT, optionsOrCb, cb);
    }

    /**
     * 便捷方法：加载字体，返回可用于 Label 的 fontFamily 名称
     */
    public loadFont(url: string, callback: CompleteCallback<string>): void;
    public loadFont(
        url: string,
        options: FontLoadOptions,
        callback: CompleteCallback<string>,
    ): void;
    public loadFont(url: string, options?: FontLoadOptions): Promise<string>;
    public loadFont(
        url: string,
        optionsOrCb?: FontLoadOptions | CompleteCallback<string>,
        cb?: CompleteCallback<string>,
    ): Promise<string> | void {
        return this._invokeTyped<string>(url, RemoteAssetType.FONT, optionsOrCb, cb);
    }

    /**
     * 内部统一分发：把 type 合并进 options 后再转给 load()
     */
    private _invokeTyped<T>(
        url: string,
        type: RemoteAssetType,
        optionsOrCb: LoadOptions | CompleteCallback<T> | undefined,
        cb: CompleteCallback<T> | undefined,
    ): Promise<T> | void {
        if (typeof optionsOrCb === 'function') {
            return this.load<T>(url, { type }, optionsOrCb);
        }
        const merged: LoadOptions = { ...(optionsOrCb || {}), type };
        if (cb) return this.load<T>(url, merged, cb);
        return this.load<T>(url, merged);
    }

    /**
     * 批量并行加载（任一失败不影响其他）
     *
     * 支持用法：
     *   1. await loadBatch(tasks)
     *   2. await loadBatch(tasks, onProgress)
     *   3. loadBatch(tasks, onProgress, onComplete)    // 回调模式：必须两个回调都传
     *
     * 说明：回调模式强制同时传 onProgress 和 onComplete，避免单函数参数在运行时无法区分。
     *      不需要进度时传 `() => {}` 即可。
     */
    public loadBatch(
        tasks: LoadTask[],
        onProgress: (finished: number, total: number) => void,
        onComplete: BatchCompleteCallback,
    ): void;
    public loadBatch(
        tasks: LoadTask[],
        onProgress?: (finished: number, total: number) => void,
    ): Promise<Map<string, any>>;
    public loadBatch(
        tasks: LoadTask[],
        onProgress?: (finished: number, total: number) => void,
        onComplete?: BatchCompleteCallback,
    ): Promise<Map<string, any>> | void {
        // 内部会记录每个 url 的错误
        const errors = new Map<string, Error>();
        const promise = this._loadBatchInternal(tasks, onProgress, errors);

        if (onComplete) {
            promise.then(
                (results) => onComplete(errors, results),
                (err) => {
                    errors.set('__fatal__', err instanceof Error ? err : new Error(String(err)));
                    onComplete(errors, new Map());
                },
            );
            return;
        }
        return promise;
    }

    private async _loadBatchInternal(
        tasks: LoadTask[],
        onProgress?: (finished: number, total: number) => void,
        errorOut?: Map<string, Error>,
    ): Promise<Map<string, any>> {
        const results = new Map<string, any>();
        const total = tasks.length;
        let finished = 0;

        await Promise.all(
            tasks.map(async (task) => {
                try {
                    const asset = await this.load(task.url, task.options || {});
                    results.set(task.url, asset);
                } catch (e) {
                    const err = e instanceof Error ? e : new Error(String(e));
                    console.error(`[RemoteLoader] Failed: ${task.url}`, err);
                    results.set(task.url, null);
                    errorOut?.set(task.url, err);
                } finally {
                    finished++;
                    onProgress?.(finished, total);
                }
            }),
        );

        return results;
    }

    /**
     * 预加载，不关心返回值
     */
    public preload(urls: string[], callback: (err: Error | null) => void): void;
    public preload(urls: string[]): Promise<void>;
    public preload(
        urls: string[],
        callback?: (err: Error | null) => void,
    ): Promise<void> | void {
        const promise = this._loadBatchInternal(urls.map((url) => ({ url }))).then(
            (): void => undefined,
        );
        if (callback) {
            promise.then(
                () => callback(null),
                (err) => callback(err instanceof Error ? err : new Error(String(err))),
            );
            return;
        }
        return promise;
    }

    // ========================================================================
    // 缓存控制
    // ========================================================================

    /**
     * 清除缓存
     * @param url 不传则清除全部
     */
    public clearCache(url?: string): void {
        if (url) {
            this._cache.delete(url);
        } else {
            this._cache.clear();
        }
    }

    /**
     * 释放单个资源（包括引擎层 release）
     */
    public release(url: string): void {
        const asset = this._cache.get(url);
        if (asset && typeof asset.decRef === 'function') {
            // 是 cc.Asset 类型
            assetManager.releaseAsset(asset);
        }
        this._cache.delete(url);
    }

    // ========================================================================
    // 内部实现：重试 + 超时
    // ========================================================================

    private async _loadWithRetry<T>(
        url: string,
        type: RemoteAssetType,
        options: LoadOptions,
    ): Promise<T> {
        const maxRetry = options.retry ?? this._defaultRetry;
        let lastErr: any = null;

        for (let i = 0; i <= maxRetry; i++) {
            try {
                return await this._loadWithTimeout<T>(url, type, options);
            } catch (err) {
                lastErr = err;
                if (i < maxRetry) {
                    console.warn(`[RemoteLoader] Retry ${i + 1}/${maxRetry}: ${url}`);
                }
            }
        }
        throw lastErr;
    }

    private _loadWithTimeout<T>(
        url: string,
        type: RemoteAssetType,
        options: LoadOptions,
    ): Promise<T> {
        const timeout = options.timeout ?? this._defaultTimeout;

        return new Promise<T>((resolve, reject) => {
            let done = false;
            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                reject(new Error(`[RemoteLoader] Timeout ${timeout}ms: ${url}`));
            }, timeout);

            this._dispatch<T>(url, type, options)
                .then((res) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    resolve(res);
                })
                .catch((err) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    reject(err);
                });
        });
    }

    // ========================================================================
    // 内部实现：类型分发
    // ========================================================================

    private _dispatch<T>(
        url: string,
        type: RemoteAssetType,
        options: LoadOptions,
    ): Promise<T> {
        switch (type) {
            case RemoteAssetType.JSON:
                return this._loadJson(url) as Promise<T>;
            case RemoteAssetType.TEXT:
                return this._loadText(url, options) as Promise<T>;
            case RemoteAssetType.FONT:
                return this._loadFont(url, options as FontLoadOptions) as Promise<T>;
            case RemoteAssetType.IMAGE:
                return this._loadImage(url, options) as Promise<T>;
            case RemoteAssetType.AUDIO:
                return this._loadAudio(url, options) as Promise<T>;
            default:
                return Promise.reject(new Error(`[RemoteLoader] Unsupported type: ${type}`));
        }
    }

    // ---------- JSON ----------
    private _loadJson(url: string): Promise<any> {
        return new Promise((resolve, reject) => {
            assetManager.loadRemote<JsonAsset>(url, { ext: '.json' }, (err, asset) => {
                if (err) return reject(err);
                resolve(asset.json);
            });
        });
    }

    // ---------- Text ----------
    private _loadText(url: string, options: LoadOptions): Promise<string> {
        return new Promise((resolve, reject) => {
            const ext = options.ext ?? this._getExtFromUrl(url) ?? '.txt';
            assetManager.loadRemote<TextAsset>(url, { ext }, (err, asset) => {
                if (err) return reject(err);
                resolve(asset.text);
            });
        });
    }

    // ---------- Image ----------
    private _loadImage(url: string, options: LoadOptions): Promise<SpriteFrame> {
        return new Promise((resolve, reject) => {
            const ext = options.ext ?? this._getExtFromUrl(url) ?? '.png';
            assetManager.loadRemote<ImageAsset>(url, { ext }, (err, imageAsset) => {
                if (err) return reject(err);
                const tex = new Texture2D();
                tex.image = imageAsset;
                const sf = new SpriteFrame();
                sf.texture = tex;
                resolve(sf);
            });
        });
    }

    // ---------- Audio ----------
    private _loadAudio(url: string, options: LoadOptions): Promise<AudioClip> {
        return new Promise((resolve, reject) => {
            const ext = options.ext ?? this._getExtFromUrl(url) ?? '.mp3';
            assetManager.loadRemote<AudioClip>(url, { ext }, (err, clip) => {
                if (err) return reject(err);
                resolve(clip);
            });
        });
    }

    // ---------- Font ----------
    /**
     * 字体加载：
     * - Web/小游戏平台：使用 FontFace API 注册到 document.fonts
     * - Native：下载到本地 writablePath 后，通过 Label 的 fontFamily 引用
     * 返回值为可赋给 Label.fontFamily 的字符串
     */
    private async _loadFont(url: string, options: FontLoadOptions): Promise<string> {
        const fontFamily = options.fontFamily ?? this._getFontFamily(url);

        if (this._loadedFonts.has(fontFamily)) {
            return fontFamily;
        }

        if (sys.isBrowser || sys.platform === sys.Platform.WECHAT_GAME) {
            await this._loadFontWeb(url, fontFamily);
        } else {
            // Native 平台：退化为 arraybuffer 下载；具体落地需结合平台文件系统
            await this._loadFontNative(url, fontFamily);
        }

        this._loadedFonts.add(fontFamily);
        return fontFamily;
    }

    private async _loadFontWeb(url: string, fontFamily: string): Promise<void> {
        const globalAny = globalThis as any;

        // 微信小游戏有自己的 API
        if (sys.platform === sys.Platform.WECHAT_GAME && globalAny.wx?.loadFont) {
            await new Promise<void>((resolve, reject) => {
                // wx.loadFont 接收的是本地路径，需要先下载
                globalAny.wx.downloadFile({
                    url,
                    success: (res: any) => {
                        if (res.statusCode !== 200) {
                            return reject(new Error(`downloadFile status=${res.statusCode}`));
                        }
                        const family = globalAny.wx.loadFont(res.tempFilePath);
                        if (!family) return reject(new Error('wx.loadFont failed'));
                        resolve();
                    },
                    fail: reject,
                });
            });
            return;
        }

        // 浏览器标准 FontFace API
        if (typeof globalAny.FontFace === 'undefined') {
            throw new Error('[RemoteLoader] FontFace API not available');
        }
        const ff = new globalAny.FontFace(fontFamily, `url(${url})`);
        await ff.load();
        (document as any).fonts.add(ff);
    }

    private async _loadFontNative(url: string, fontFamily: string): Promise<void> {
        // Native 平台下载字体文件到本地缓存目录
        // 具体写入需用 jsb.fileUtils（原生）或 cc.sys.localStorage（退化方案）
        // 这里只做占位，实际项目请按平台补全
        console.warn(
            `[RemoteLoader] Native font loading for ${fontFamily} needs platform-specific implementation`,
        );
        // 可通过 xhr + jsb.fileUtils.writeDataToFile 写入 writablePath，然后 Label 引用该路径
    }

    // ========================================================================
    // 工具方法
    // ========================================================================

    private _detectType(url: string, ext?: string): RemoteAssetType {
        const e = (ext ?? this._getExtFromUrl(url) ?? '').toLowerCase();
        switch (e) {
            case '.json':
                return RemoteAssetType.JSON;
            case '.txt':
            case '.csv':
            case '.xml':
            case '.html':
                return RemoteAssetType.TEXT;
            case '.ttf':
            case '.otf':
            case '.woff':
            case '.woff2':
                return RemoteAssetType.FONT;
            case '.png':
            case '.jpg':
            case '.jpeg':
            case '.webp':
                return RemoteAssetType.IMAGE;
            case '.mp3':
            case '.ogg':
            case '.wav':
            case '.m4a':
                return RemoteAssetType.AUDIO;
            default:
                // 无法识别时按 JSON 处理（最常用）
                return RemoteAssetType.JSON;
        }
    }

    private _getExtFromUrl(url: string): string | null {
        // 去掉 query/hash
        const clean = url.split('?')[0].split('#')[0];
        const idx = clean.lastIndexOf('.');
        if (idx === -1) return null;
        const lastSlash = clean.lastIndexOf('/');
        if (idx < lastSlash) return null;
        return clean.substring(idx).toLowerCase();
    }

    private _getFontFamily(url: string): string {
        const clean = url.split('?')[0].split('#')[0];
        const file = clean.substring(clean.lastIndexOf('/') + 1);
        // 去掉扩展名，并清洗非法字符
        const name = file.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
        return `remote_${name}`;
    }
}

// 默认导出单例，方便使用
export default RemoteLoader.instance;
