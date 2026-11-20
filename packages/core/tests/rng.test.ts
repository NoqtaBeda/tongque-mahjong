import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  describeRng,
  isRng,
  nextRng,
  randomRng,
  toRng,
} from '../src/engine/rng.ts';

describe('随机源 xoshiro128**', () => {
  it('同一种子产生同一串随机数（可复现）', () => {
    const run = (seed: number): number[] => {
      let rng = toRng(seed);
      const out: number[] = [];
      for (let index = 0; index < 8; index += 1) {
        const step = nextRng(rng);
        rng = step.rng;
        out.push(step.value);
      }
      return out;
    };
    assert.deepEqual(run(42), run(42));
    assert.notDeepEqual(run(42), run(43));
  });

  it('输出落在 [0,1) 且不是常数', () => {
    let rng = toRng(7);
    const seen = new Set<number>();
    for (let index = 0; index < 1000; index += 1) {
      const step = nextRng(rng);
      rng = step.rng;
      assert.ok(step.value >= 0 && step.value < 1);
      seen.add(step.value);
    }
    assert.ok(seen.size > 990, `不同值只有 ${seen.size} 个`);
  });

  it('128 位状态每一字都参与：只改第 4 个字，随后的整串就不同', () => {
    const stream = (
      rng: readonly [number, number, number, number],
    ): number[] => {
      let state = toRng(rng);
      const out: number[] = [];
      for (let index = 0; index < 4; index += 1) {
        const step = nextRng(state);
        state = step.rng;
        out.push(step.value);
      }
      return out;
    };
    // xoshiro128** 的第一步只依赖 s1，所以要比整串而不是第一个值
    assert.notDeepEqual(stream([1, 2, 3, 4]), stream([1, 2, 3, 5]));
    assert.notDeepEqual(stream([1, 2, 3, 4]), stream([6, 2, 3, 4]));
  });

  it('64 位 bigint 种子可用，且高低 32 位都影响结果', () => {
    const low = toRng(0x12345678n);
    const high = toRng(0x1234567800000000n);
    assert.equal(low.length, 4);
    assert.equal(high.length, 4);
    assert.notDeepEqual(low.slice(), high.slice());
    assert.notEqual(describeRng(low), describeRng(high));
  });

  it('字符串种子可用且稳定', () => {
    assert.deepEqual(toRng('2026-11-20'), toRng('2026-11-20'));
    assert.notDeepEqual(toRng('2026-11-20'), toRng('2026-11-21'));
  });

  it('全 0 状态会被替换掉（xoshiro 不能全 0）', () => {
    assert.notDeepEqual(toRng([0, 0, 0, 0]), [0, 0, 0, 0]);
  });

  it('均匀性：均值接近 0.5，落在 10 个桶里都接近期望', () => {
    let rng = toRng(20261120);
    const buckets = new Array(10).fill(0) as number[];
    const samples = 100_000;
    let sum = 0;
    for (let index = 0; index < samples; index += 1) {
      const step = nextRng(rng);
      rng = step.rng;
      sum += step.value;
      buckets[Math.min(9, Math.floor(step.value * 10))] += 1;
    }
    const mean = sum / samples;
    assert.ok(Math.abs(mean - 0.5) < 0.01, `均值 ${mean}`);
    const expected = samples / 10;
    for (const count of buckets) {
      // 3σ ≈ 3 * sqrt(n * 0.1 * 0.9) ≈ 284
      assert.ok(Math.abs(count - expected) < 900, `桶计数 ${count}`);
    }
  });

  it('取值没有短周期：连续 4096 个输出全不相同', () => {
    let rng = toRng(1);
    const seen = new Set<number>();
    for (let index = 0; index < 4096; index += 1) {
      const step = nextRng(rng);
      rng = step.rng;
      seen.add(step.value);
    }
    assert.equal(seen.size, 4096);
  });

  it('熵源种子可用，两次调用不同', () => {
    const left = randomRng();
    const right = randomRng();
    assert.ok(isRng(left) && isRng(right));
    assert.notDeepEqual(left.slice(), right.slice());
  });

  it('isRng 拒绝非 4 元或越界的值', () => {
    assert.equal(isRng([1, 2, 3, 4]), true);
    assert.equal(isRng([1, 2, 3]), false);
    assert.equal(isRng([1, 2, 3, -1]), false);
    assert.equal(isRng([1, 2, 3, 2 ** 32]), false);
    assert.equal(isRng('nope'), false);
  });
});
