import React from 'react';
import type { AssetProgress } from './assets.ts';

/**
 * 开局前的加载界面。
 *
 * 只在浏览器里预载素材期间出现；素材全部进缓存后立刻切到棋牌界面，
 * 这样慢网下也不会出现「打着打着牌面变空白」。
 */
export function LoadingScreen({ progress }: { progress: AssetProgress }) {
  const ratio = progress.total === 0 ? 1 : progress.loaded / progress.total;
  const percent = Math.round(ratio * 100);
  return (
    <div className="loading-screen">
      <div className="loading-card">
        <h1 className="loading-title">铜雀</h1>
        <p className="loading-sub">正在加载牌面素材…</p>
        <div
          className="loading-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="素材加载进度"
        >
          <div className="loading-bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <p className="loading-count">
          {progress.loaded} / {progress.total}
          {progress.failed.length > 0 && (
            <span className="loading-failed">
              （{progress.failed.length} 个素材加载失败，仍可开始）
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
