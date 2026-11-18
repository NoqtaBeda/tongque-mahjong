import { tileCode } from '../../core/src/index.ts';

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
