import { KIND_COUNT, tileCode } from '../../core/src/index.ts';

/**
 * 站点根路径。
 *
 * Vite 构建时会把 `import.meta.env.BASE_URL` 替换成 `vite.config.ts` 里的 `base`
 * （GitHub Pages 项目站点是 `/tongque-mahjong/`）；
 * 在没有 Vite 的环境（比如用 Node 跑 SSR 检查）它是 undefined，退回 `'/'`。
 */
const BASE_URL =
  (
    import.meta as ImportMeta & {
      readonly env?: { readonly BASE_URL?: string };
    }
  ).env?.BASE_URL ?? '/';

/** 牌面素材的**网络地址**：`public/tiles/Mahjong_<天凤代码>.svg` */
export function tileUrl(kind: number): string {
  return `${BASE_URL}tiles/Mahjong_${tileCode(kind)}.svg`;
}

/**
 * 预载成功后，每个牌种对应的 `blob:` 地址。
 *
 * 对局中直接用这些 blob 地址，等于牌面已经在内存里，
 * 既不回源、也不受 HTTP 缓存过期（GitHub Pages 是 max-age=600）影响。
 */
const tileBlobs = new Map<number, string>();

/** 牌面素材地址：预载完成用内存里的 blob，否则退回网络地址 */
export function tileSrc(kind: number): string {
  return tileBlobs.get(kind) ?? tileUrl(kind);
}

/** 全部牌面素材的网络地址（34 种牌，顺序即 kind），用于预载 */
export function tileSources(): string[] {
  const urls: string[] = [];
  for (let kind = 0; kind < KIND_COUNT; kind += 1) urls.push(tileUrl(kind));
  return urls;
}

/** 需要预载的所有素材（目前只有牌面；以后加背景/音效也放这里） */
export function allAssetSources(): string[] {
  return [...tileSources()];
}

export interface AssetProgress {
  /** 已结束（成功或失败）的素材数 */
  readonly loaded: number;
  /** 总数 */
  readonly total: number;
  /** 加载失败的地址，便于排查 */
  readonly failed: readonly string[];
}

/** 浏览器里才有的能力；Node/SSR 下全部跳过 */
function hasBrowser(): boolean {
  return typeof window !== 'undefined' && typeof fetch === 'function';
}

/**
 * 把一个 SVG 拉成内存里的 blob 地址。
 *
 * 用 `fetch` 拿文本再建 blob，而不是 `<img src>`：
 * 前者得到的是**内容**，之后所有 `<img>` 都指向内存，永不回源；
 * 后者只是把文件塞进 HTTP 缓存，缓存过期/被清掉时又会去下载。
 */
async function fetchAsBlobUrl(url: string): Promise<string | null> {
  // 慢网/抖动时单次失败很常见，重试两次再放弃，避免一张牌面永远缺着
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { cache: 'force-cache' });
      if (response.ok) {
        const text = await response.text();
        if (text.length > 0) {
          const blob = new Blob([text], { type: 'image/svg+xml' });
          return URL.createObjectURL(blob);
        }
      }
    } catch {
      // 落到下面的退避重试
    }
    await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
  }
  return null;
}

/**
 * 一次性把全部素材载入内存。
 *
 * - 单个素材失败不阻塞开局（缺一张牌面比整局打不开好），失败清单会回传
 * - 成功后 `tileSrc(kind)` 返回 `blob:` 地址，对局中完全不发请求
 * - 没有浏览器环境（SSR/Node）时立即完成
 */
/** 调试用：把预载结果挂到 window，线上排查时可以直接看 */
function publishDebugState(progress: AssetProgress): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __tongqueAssets?: AssetProgress }).__tongqueAssets =
    progress;
}

export async function preloadAssets(
  onProgress?: (progress: AssetProgress) => void,
): Promise<AssetProgress> {
  const total = KIND_COUNT;
  if (!hasBrowser()) {
    const done: AssetProgress = { loaded: total, total, failed: [] };
    onProgress?.(done);
    return done;
  }

  let loaded = 0;
  const failed: string[] = [];
  onProgress?.({ loaded, total, failed });
  publishDebugState({ loaded, total, failed });

  await Promise.all(
    Array.from({ length: total }, async (_, kind) => {
      const url = tileUrl(kind);
      const blobUrl = await fetchAsBlobUrl(url);
      if (blobUrl === null) failed.push(url);
      else tileBlobs.set(kind, blobUrl);
      loaded += 1;
      const snapshot = { loaded, total, failed: [...failed] };
      publishDebugState(snapshot);
      onProgress?.(snapshot);
    }),
  );

  const final = { loaded, total, failed };
  publishDebugState(final);
  return final;
}

/** 清空内存里的 blob 缓存（测试与「重新预载」用） */
export function clearAssetCache(): void {
  for (const url of tileBlobs.values()) {
    if (
      typeof URL !== 'undefined' &&
      typeof URL.revokeObjectURL === 'function'
    ) {
      URL.revokeObjectURL(url);
    }
  }
  tileBlobs.clear();
}

/** 是否当前环境需要（且值得）展示加载界面 */
export function needsPreload(): boolean {
  return hasBrowser();
}
