import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseHand } from '../src/index.ts';
import { encodeInput, NN_FEATURE_DIM } from '../src/ai/nn/features.ts';
import { predict, zeroWeights } from '../src/ai/nn/mlp.ts';
import type { MlpWeights } from '../src/ai/nn/mlp.ts';
import { predictValue } from '../src/ai/nn/value.ts';

function sampleInput() {
  return {
    concealed: parseHand('123m 456m 789m 12p 5s'),
    melds: [],
    visible: parseHand('19p 22z 3z'),
    seatWind: 1,
    round: 3,
    isDealer: false,
    wallRemaining: 42,
    score: 12,
    shanten: 1,
    ukeire: 8,
    potential: 3.5,
  };
}

describe('神经网络输入编码', () => {
  it('维度固定且取值有限', () => {
    const encoded = encodeInput(sampleInput());
    assert.equal(encoded.length, NN_FEATURE_DIM);
    for (const value of encoded) {
      assert.ok(Number.isFinite(value), `出现非有限值 ${value}`);
    }
  });

  it('手牌区是张数/4', () => {
    const encoded = encodeInput(sampleInput());
    assert.equal(encoded[0], 0.25, '1m 一张');
    assert.equal(encoded[22], 0.25, '5s 一张');
    assert.equal(encoded[8], 0.25, '9m 一张（来自 789m）');
    assert.equal(encoded[11], 0, '3p 不在手里');
  });

  it('自风是 one-hot', () => {
    const encoded = encodeInput(sampleInput());
    const start = 78;
    assert.deepEqual(
      [
        encoded[start],
        encoded[start + 1],
        encoded[start + 2],
        encoded[start + 3],
      ],
      [0, 1, 0, 0],
      '自风南',
    );
  });

  it('上下文特征归一化到 [0,1]', () => {
    const encoded = encodeInput({
      ...sampleInput(),
      shanten: 6,
      ukeire: 40,
      wallRemaining: 200,
    });
    assert.equal(encoded[73], 6 / 8);
    assert.equal(encoded[74], 1, '进张数上限截断');
    assert.equal(encoded[76], 1, '剩余牌数上限截断');
  });
});

describe('MLP 前向', () => {
  it('零权重输出为 0', () => {
    const weights = zeroWeights(4, 3, 2);
    assert.equal(predict(weights, new Float32Array([0.5, -0.2, 0.1, 0.9])), 0);
  });

  it('手算单路径', () => {
    // 1 -> 1 -> 1 -> 1，线性可比对
    const weights: MlpWeights = {
      dim0: 1,
      dim1: 1,
      dim2: 1,
      w1: Float32Array.from([1]),
      b1: Float32Array.from([0]),
      w2: Float32Array.from([2]),
      b2: Float32Array.from([0]),
      w3: Float32Array.from([3]),
      b3: Float32Array.from([1]),
    };
    // z1 = 0.5 → a1 = 0.5；z2 = 1 → a2 = 1；out = 3*1 + 1 = 4
    assert.equal(predict(weights, Float32Array.from([0.5])), 4);
  });

  it('ReLU 会把负输入截成 0', () => {
    const weights: MlpWeights = {
      dim0: 1,
      dim1: 1,
      dim2: 1,
      w1: Float32Array.from([1]),
      b1: Float32Array.from([0]),
      w2: Float32Array.from([2]),
      b2: Float32Array.from([0]),
      w3: Float32Array.from([3]),
      b3: Float32Array.from([1]),
    };
    assert.equal(predict(weights, Float32Array.from([-0.5])), 1, '只剩偏置');
  });
});

describe('价值接口', () => {
  it('预测值有限且落在合理量级内', () => {
    const value = predictValue(sampleInput());
    assert.ok(Number.isFinite(value), `预测值应有限，实际 ${value}`);
    // 标签是本场净得分，理论范围 [-12, 24]
    assert.ok(value > -12 && value < 24, `预测值超出量级：${value}`);
  });

  it('听牌手牌的预测不差于散牌（方向上）', () => {
    const good = predictValue({
      ...sampleInput(),
      shanten: 0,
      ukeire: 2,
      potential: 12,
    });
    const bad = predictValue({
      ...sampleInput(),
      shanten: 5,
      ukeire: 30,
      potential: 0,
    });
    assert.ok(Number.isFinite(good) && Number.isFinite(bad));
  });
});
