import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KIND_COUNT } from '../../core/src/index.ts';
import {
  clearAssetCache,
  preloadAssets,
  tileSrc,
  tileUrl,
} from '../src/assets.ts';

/**
 * 复现「打着打着牌面空白」的根因回归：
 * 预载完成后，牌面地址必须指向内存里的 blob，而不是继续指向网络地址。
 */
describe('素材预载（浏览器环境）', () => {
  it('预载完成后 tileSrc 返回内存 blob，不再指向网络', async () => {
    const globals = globalThis as unknown as {
      window?: unknown;
      fetch?: unknown;
      Blob?: unknown;
      URL: { createObjectURL?: unknown };
    };
    const saved = {
      window: globals.window,
      fetch: globals.fetch,
      Blob: globals.Blob,
      createObjectURL: globals.URL.createObjectURL,
    };

    let created = 0;
    globals.window = {};
    globals.Blob = class StubBlob {
      readonly parts: unknown[];
      constructor(parts: unknown[]) {
        this.parts = parts;
      }
    };
    globals.URL.createObjectURL = (): string => {
      created += 1;
      return `blob:tongque/${created}`;
    };
    globals.fetch = async (url: string): Promise<unknown> => ({
      ok: true,
      text: async (): Promise<string> => `<svg data-src="${url}"/>`,
    });

    clearAssetCache();
    try {
      const progress = await preloadAssets();
      assert.equal(progress.loaded, KIND_COUNT);
      assert.deepEqual(progress.failed, []);
      for (let kind = 0; kind < KIND_COUNT; kind += 1) {
        const src = tileSrc(kind);
        assert.ok(
          src.startsWith('blob:'),
          `预载后牌面应指向内存 blob，实际是 ${src}`,
        );
        assert.notEqual(src, tileUrl(kind), '不应再回落到网络地址');
      }
    } finally {
      globals.window = saved.window;
      globals.fetch = saved.fetch;
      globals.Blob = saved.Blob;
      globals.URL.createObjectURL = saved.createObjectURL;
    }
  });

  it('个别素材持续失败时会记录到 failed，但不阻塞开始', async () => {
    const globals = globalThis as unknown as {
      window?: unknown;
      fetch?: unknown;
      Blob?: unknown;
      URL: { createObjectURL?: unknown };
    };
    const saved = {
      window: globals.window,
      fetch: globals.fetch,
      Blob: globals.Blob,
      createObjectURL: globals.URL.createObjectURL,
    };

    globals.window = {};
    globals.Blob = class StubBlob {
      readonly parts: unknown[];
      constructor(parts: unknown[]) {
        this.parts = parts;
      }
    };
    globals.URL.createObjectURL = (): string => 'blob:ok';
    // 只让 1m 失败，其它正常
    globals.fetch = async (url: string): Promise<unknown> => {
      if (url.includes('Mahjong_1m.svg')) return { ok: false };
      return { ok: true, text: async (): Promise<string> => '<svg/>' };
    };

    clearAssetCache();
    try {
      const progress = await preloadAssets();
      assert.equal(progress.loaded, KIND_COUNT);
      assert.equal(progress.failed.length, 1);
      assert.ok(progress.failed[0].includes('Mahjong_1m.svg'));
      // 失败的那张回落到网络地址（其余仍是 blob）
      assert.equal(tileSrc(0), tileUrl(0));
      assert.ok(tileSrc(1).startsWith('blob:'));
    } finally {
      globals.window = saved.window;
      globals.fetch = saved.fetch;
      globals.Blob = saved.Blob;
      globals.URL.createObjectURL = saved.createObjectURL;
    }
  });
});
