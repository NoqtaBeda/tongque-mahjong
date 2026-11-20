import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KIND_COUNT } from '../../core/src/index.ts';
import {
  allAssetSources,
  needsPreload,
  preloadAssets,
  tileSources,
  tileSrc,
} from '../src/assets.ts';

describe('素材预加载', () => {
  it('牌面素材覆盖全部牌种，且都是 <base>tiles/xxx.svg', () => {
    const sources = tileSources();
    assert.equal(sources.length, KIND_COUNT);
    assert.equal(new Set(sources).size, KIND_COUNT, '不应有重复地址');
    for (const url of sources) {
      assert.match(
        url,
        /^\/tiles\/Mahjong_[1-9][mpsz]\.svg$/,
        `地址格式异常：${url}`,
      );
    }
    // 与单张取址保持一致
    for (let kind = 0; kind < KIND_COUNT; kind += 1) {
      assert.equal(sources[kind], tileSrc(kind));
    }
  });

  it('全部素材地址没有重复', () => {
    const sources = allAssetSources();
    assert.equal(new Set(sources).size, sources.length);
    assert.ok(sources.length >= KIND_COUNT);
  });

  it('Node（没有 Image）下不需要加载界面，预载直接完成', async () => {
    assert.equal(needsPreload(), false);
    const progress = await preloadAssets();
    assert.equal(progress.loaded, progress.total);
    assert.deepEqual(progress.failed, []);
  });
});
