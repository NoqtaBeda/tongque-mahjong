/// <reference types="vite/client" />
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // 构建用相对路径（`./`），这样同一份产物既能挂在 GitHub Pages 的项目子路径
  // https://<用户名>.github.io/tongque-mahjong/ 下，也能让 `vite preview` 在
  // 根路径 http://localhost:4173/ 直接打开。
  //
  // 以前这里写死成 '/tongque-mahjong/'，结果 `npm run build && npm run preview`
  // 打开是空白页：预览服务按根路径路由，而 HTML 里引用的是 /tongque-mahjong/assets/*，
  // 请求全部落到 SPA 兜底上、拿到 HTML 而不是 JS，模块自然加载失败。
  base: command === 'build' ? './' : '/',
}));
