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

/** 牌面素材：`public/tiles/Mahjong_<天凤代码>.svg` */
export function tileSrc(kind: number): string {
  return `${BASE_URL}tiles/Mahjong_${tileCode(kind)}.svg`;
}

/** 全部牌面素材的地址（34 种牌，顺序即 kind），用于开局前一次性预载 */
export function tileSources(): string[] {
  const urls: string[] = [];
  for (let kind = 0; kind < KIND_COUNT; kind += 1) urls.push(tileSrc(kind));
  return urls;
}

/** 需要预载的所有素材（目前只有牌面；以后加背景/音效也放这里） */
export function allAssetSources(): string[] {
  return [...tileSources()];
}

export interface AssetProgress {
  /** 已结束（成功或失败）的张数 */
  readonly loaded: number;
  /** 总张数 */
  readonly total: number;
  /** 加载失败的文件名，便于排查 */
  readonly failed: readonly string[];
}

/** 浏览器里才有的 Image 构造器；Node/SSR 下为 undefined */
function hasImage(): boolean {
  return typeof Image !== 'undefined';
}

function loadOne(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    // 解码完成算真正可用：慢网下 `onload` 之后还可能有一瞬间渲染空白
    const finish = (ok: boolean): void => resolve(ok);
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.decoding = 'async';
    image.src = url;
    // 已经有缓存时，某些浏览器不会再触发 onload
    if (image.complete && image.naturalWidth > 0) finish(true);
  });
}

/**
 * 一次性把全部素材载入浏览器缓存。
 *
 * - 单个文件失败不阻塞开局（牌面缺一张比整局打不开好），失败列表会回传
 * - 同一 URL 只请求一次；浏览器 HTTP 缓存保证后续 `<img>` 直接命中
 * - 没有 Image（SSR/Node）时立即完成，返回空的进度
 */
export async function preloadAssets(
  onProgress?: (progress: AssetProgress) => void,
): Promise<AssetProgress> {
  const urls = allAssetSources();
  const total = urls.length;
  if (!hasImage() || total === 0) {
    const done: AssetProgress = { loaded: total, total, failed: [] };
    onProgress?.(done);
    return done;
  }

  let loaded = 0;
  const failed: string[] = [];
  onProgress?.({ loaded, total, failed });

  await Promise.all(
    urls.map(async (url) => {
      const ok = await loadOne(url);
      if (!ok) failed.push(url);
      loaded += 1;
      onProgress?.({ loaded, total, failed: [...failed] });
    }),
  );

  return { loaded, total, failed };
}

/** 是否当前环境需要（且值得）展示加载界面 */
export function needsPreload(): boolean {
  return hasImage();
}
