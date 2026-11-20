import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NN_FEATURE_DIM } from '../../core/src/ai/nn/features.ts';
import {
  decodePolicyWeights,
  policyLogits,
  zeroPolicyWeights,
} from '../../core/src/ai/nn/policy.ts';

/** 把 Float32Array 编码回导出用的 base64 */
function encodeFloats(values: Float32Array): string {
  return Buffer.from(
    values.buffer,
    values.byteOffset,
    values.byteLength,
  ).toString('base64');
}

describe('策略头（P0）', () => {
  it('零权重的 logit 恒为 0（不干扰原有价值）', () => {
    const weights = zeroPolicyWeights(NN_FEATURE_DIM, 8, 4);
    const logits = policyLogits(weights, new Float32Array(NN_FEATURE_DIM));
    assert.equal(logits.length, 34);
    assert.ok(logits.every((value) => value === 0));
  });

  it('b3 会被原样加到每个输出上（策略头能表达"这张牌更好"）', () => {
    const weights = zeroPolicyWeights(NN_FEATURE_DIM, 8, 4);
    weights.b3[5] = 2.5;
    const logits = policyLogits(weights, new Float32Array(NN_FEATURE_DIM));
    assert.equal(logits[5], 2.5);
    assert.equal(logits[6], 0);
  });

  it('decode 能把导出的 base64 还原成同样的权重', () => {
    const source = zeroPolicyWeights(NN_FEATURE_DIM, 6, 3);
    source.b1[0] = 0.5;
    source.b3[7] = -1.25;
    const decoded = decodePolicyWeights({
      dim0: source.dim0,
      dim1: source.dim1,
      dim2: source.dim2,
      tiles: source.tiles,
      w1: encodeFloats(source.w1),
      b1: encodeFloats(source.b1),
      w2: encodeFloats(source.w2),
      b2: encodeFloats(source.b2),
      w3: encodeFloats(source.w3),
      b3: encodeFloats(source.b3),
    });
    assert.equal(decoded.dim1, 6);
    assert.equal(decoded.b1[0], 0.5);
    assert.equal(decoded.b3[7], -1.25);
    const logits = policyLogits(decoded, new Float32Array(NN_FEATURE_DIM));
    assert.equal(logits[7], -1.25);
  });

  it('长度不对时 decode 会报错（防止导出/加载错位）', () => {
    const source = zeroPolicyWeights(NN_FEATURE_DIM, 4, 2);
    assert.throws(
      () =>
        decodePolicyWeights({
          dim0: source.dim0,
          dim1: source.dim1,
          dim2: source.dim2,
          tiles: source.tiles,
          w1: encodeFloats(source.w1),
          b1: 'AAAA', // 故意给错
          w2: encodeFloats(source.w2),
          b2: encodeFloats(source.b2),
          w3: encodeFloats(source.w3),
          b3: encodeFloats(source.b3),
        }),
      /长度不符/,
    );
  });
});
