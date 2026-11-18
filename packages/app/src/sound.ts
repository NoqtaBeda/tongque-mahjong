/**
 * 用 Web Audio 现场合成音效，不依赖任何音频素材。
 * 所有入口都做了环境判断，SSR / 无 AudioContext 的环境下静默跳过。
 */

import type { GameState } from '../../core/src/index.ts';

let context: AudioContext | null = null;
let muted = false;
const MUTE_KEY = 'mahjong-playground/muted';

export function readMuted(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeMuted(value: boolean): void {
  muted = value;
  if (typeof localStorage === 'undefined') return;
  try {
    if (value) localStorage.setItem(MUTE_KEY, '1');
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    // 忽略
  }
}

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined')
    return null;
  if (context === null) {
    try {
      context = new AudioContext();
    } catch {
      return null;
    }
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

/**
 * 总音量倍数：所有音效的 peak 都乘这个数。
 * 浏览器里 WebAudio 的默认输出偏小，乘 2.4 才接近"听得到"的力度。
 */
const VOLUME = 2.4;

function tone(
  frequency: number,
  duration: number,
  type: OscillatorType,
  peak: number,
  delay = 0,
): void {
  if (muted) return;
  const audio = ensureContext();
  if (audio === null) return;

  const start = audio.currentTime + delay;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(
    Math.min(0.85, peak * VOLUME),
    start + 0.012,
  );
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.03);
}

/** 四家副露的总组数。鸣牌窗口关闭时只有真的鸣了牌，这个数才会变大。 */
function meldCount(state: GameState): number {
  let total = 0;
  for (const melds of state.melds) total += melds.length;
  return total;
}

export type SoundCue = 'win' | 'drain' | 'discard' | 'call';

/**
 * 由前后两个局面推断这一步该放什么音效。
 *
 * 返回 `null` 表示**不该出声**。
 *
 * 摸牌不放声音：摸牌几乎每巡都有，再加一声会显得吵；而且全员 pass 之后局面也是
 * "下家摸牌"，那一支会跟着一起静音。
 */
export function soundCue(
  previous: GameState,
  state: GameState,
): SoundCue | null {
  if (state.phase === 'over' && previous.phase !== 'over') {
    return state.result !== null && state.result.kind !== 'draw'
      ? 'win'
      : 'drain';
  }
  if (state.turnIndex !== previous.turnIndex) return 'discard';
  // 鸣牌窗口关闭：只有真的有人吃/碰/杠（副露变多）才算鸣牌，全员 pass 静音
  if (
    state.phase === 'discard' &&
    previous.phase === 'claim' &&
    meldCount(state) > meldCount(previous)
  ) {
    return 'call';
  }
  return null;
}

export const sfx = {
  discard(): void {
    tone(260, 0.09, 'square', 0.035);
  },
  call(): void {
    tone(440, 0.08, 'square', 0.045);
    tone(660, 0.1, 'square', 0.035, 0.05);
  },
  win(): void {
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      tone(frequency, 0.3, 'sine', 0.06, index * 0.085);
    });
  },
  drain(): void {
    tone(196, 0.35, 'sine', 0.05);
    tone(147, 0.4, 'sine', 0.04, 0.08);
  },
  /** 需要在一次用户手势里调用，用来解锁 AudioContext */
  unlock(): void {
    ensureContext();
  },
};
