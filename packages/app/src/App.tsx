import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  legalActions,
  makeConfig,
  observe,
  reduce,
} from '../../core/src/index.ts';
import type { Action, GameState, RuleConfig } from '../../core/src/index.ts';
import { decide } from '../../core/src/ai/index.ts';
import {
  GameView,
  HistoryDialog,
  HUMAN,
  PRESETS,
  SettingsDialog,
  StartScreen,
  TutorialDialog,
  presetOf,
  roundsOf,
} from './GameView.tsx';
import type { ConfigPreset } from './GameView.tsx';
import type { DurationId } from './duration.ts';
import {
  clearState,
  loadState,
  loadView,
  saveState,
  saveView,
} from './storage.ts';
import { newSession, resumeSession, step } from './session.ts';
import { randomRng } from '../../core/src/index.ts';
import type { Session } from './session.ts';
import { readMuted, sfx, soundCue, writeMuted } from './sound.ts';
import { LoadingScreen } from './LoadingScreen.tsx';
import { allAssetSources, needsPreload, preloadAssets } from './assets.ts';
import type { AssetProgress } from './assets.ts';

const AI_DELAY_MS = 320;
const DEFAULT_SEED = 20260101;
const PRESET_KEY = 'mahjong-playground/preset';
const DEAD_WALL_KEY = 'mahjong-playground/deadwall';
const CHI_KEY = 'mahjong-playground/chi';
const DURATION_KEY = 'mahjong-playground/duration';

/** 对局时长：默认半庄战 */
function readDuration(): DurationId {
  if (typeof localStorage === 'undefined') return 'hanchan';
  try {
    const raw = localStorage.getItem(DURATION_KEY);
    return raw === 'tonpuu' || raw === 'full' || raw === 'hanchan'
      ? raw
      : 'hanchan';
  } catch {
    return 'hanchan';
  }
}

function writeDuration(duration: DurationId): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(DURATION_KEY, duration);
  } catch {
    // 忽略
  }
}

/** 是否使用王牌：默认不使用 */
function readKeepDeadWall(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(DEAD_WALL_KEY) === '1';
  } catch {
    return false;
  }
}

function writeKeepDeadWall(value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(DEAD_WALL_KEY, value ? '1' : '0');
  } catch {
    // 忽略
  }
}

function readChi(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(CHI_KEY) === '1';
  } catch {
    return false;
  }
}

function writeChi(value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CHI_KEY, value ? '1' : '0');
  } catch {
    // 忽略
  }
}

function configFromPreset(
  preset: ConfigPreset,
  keepDeadWall: boolean,
  duration: DurationId,
  chi: boolean,
): RuleConfig {
  return makeConfig({
    players: preset.players,
    tileSet: preset.tileSet,
    rounds: roundsOf(preset.players, duration),
    keepDeadWall,
    // 四人麻将必须能吃；三人麻将在设置里选，默认禁止
    allowChi: preset.players === 4 ? true : chi,
  });
}

function loadPreset(): ConfigPreset {
  if (typeof localStorage === 'undefined') return PRESETS[0];
  try {
    const id = localStorage.getItem(PRESET_KEY);
    return PRESETS.find((preset) => preset.id === id) ?? PRESETS[0];
  } catch {
    return PRESETS[0];
  }
}

function rememberPreset(preset: ConfigPreset): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PRESET_KEY, preset.id);
  } catch {
    // 忽略
  }
}

/**
 * 开局时决定用哪份状态。
 *
 * 只要有存档就接着用——包括 `phase === 'over'` 的结算态。结算界面本来就是
 * 由状态推出来的，还原后自然停在那一页；以前这里把"已结束"的存档丢掉，
 * 结果在结算界面刷新一下，整局就直接从头开始了。
 */
function initialSession(
  keepDeadWall: boolean,
  duration: DurationId,
  chi: boolean,
): Session {
  return resumeSession(loadState(), () =>
    newSession(
      configFromPreset(loadPreset(), keepDeadWall, duration, chi),
      DEFAULT_SEED,
    ),
  );
}

export function App() {
  // 浏览器里先把牌面素材全部灌进缓存，再进游戏；SSR/Node 下不需要等
  const [assets, setAssets] = useState<AssetProgress | null>(() =>
    needsPreload()
      ? { loaded: 0, total: allAssetSources().length, failed: [] }
      : null,
  );

  useEffect(() => {
    if (!needsPreload()) return;
    let alive = true;
    void preloadAssets((progress) => {
      if (alive) setAssets(progress);
    }).then((final) => {
      if (alive) setAssets(null);
      if (final.failed.length > 0) {
        console.warn('部分素材加载失败：', final.failed);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  const [keepDeadWall, setKeepDeadWall] = useState<boolean>(() =>
    readKeepDeadWall(),
  );
  const [duration, setDuration] = useState<DurationId>(() => readDuration());
  const [session, setSession] = useState<Session>(() =>
    initialSession(readKeepDeadWall(), readDuration(), readChi()),
  );
  const [muted, setMuted] = useState<boolean>(() => readMuted());
  // 有存档就直接续玩，没有就先停在开始界面
  const [started, setStarted] = useState<boolean>(() => loadState() !== null);
  const [chi, setChi] = useState<boolean>(() => readChi());
  // 全部局数打完后：先展示「本局结算」，点按钮再翻到「最终结算」
  // 恢复上次停留的界面：可能停在最终结算页
  const [finalShown, setFinalShown] = useState(() => loadView().finalShown);
  const [replay, setReplay] = useState<{
    states: readonly GameState[];
    index: number;
  } | null>(null);

  // 选项对话框：草稿值放在这里，点了「应用」才生效；有改动时先二次确认
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [draftPreset, setDraftPreset] = useState<ConfigPreset>(() =>
    presetOf(session.state.cfg),
  );
  const [draftChi, setDraftChi] = useState<boolean>(chi);
  const [draftDeadWall, setDraftDeadWall] = useState(keepDeadWall);
  const [draftDuration, setDraftDuration] = useState<DurationId>(duration);
  const [confirming, setConfirming] = useState(false);

  const config = session.state.cfg;
  const prevRef = useRef<GameState | null>(null);

  const applyAction = useCallback((action: Action) => {
    sfx.unlock();
    setSession((current) => step(current, action));
  }, []);

  // AI 行动：轮到自己以外时，延迟一小段再走一手
  useEffect(() => {
    const state = session.state;
    if (state.phase === 'over') return;
    const actor = state.actor;
    if (actor === null || actor === HUMAN) return;

    const timer = window.setTimeout(() => {
      setSession((current) => {
        if (current.state.phase === 'over') return current;
        if (current.state.actor !== actor) return current;
        const action = decide(observe(current.state, actor));
        return step(current, action);
      });
    }, AI_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [session.state]);

  // 音效：根据状态差异推断刚才发生了什么
  useEffect(() => {
    const previous = prevRef.current;
    const state = session.state;
    prevRef.current = state;
    if (previous === null) return;

    const cue = soundCue(previous, state);
    if (cue !== null) sfx[cue]();
  }, [session.state]);

  // 存档
  useEffect(() => {
    saveState(session.state);
  }, [session.state]);

  // 记住是否已经翻到最终结算页，刷新后还停在那儿
  useEffect(() => {
    saveView({ finalShown });
  }, [finalShown]);

  const restart = useCallback(() => {
    const preset = presetOf(session.state.cfg);
    rememberPreset(preset);
    clearState();
    setReplay(null);
    setFinalShown(false);
    setSession(newSession(session.state.cfg, randomRng()));
  }, [session.state.cfg]);

  const openSettings = useCallback(() => {
    setDraftPreset(presetOf(session.state.cfg));
    setDraftChi(chi);
    setDraftDeadWall(keepDeadWall);
    setDraftDuration(duration);
    setConfirming(false);
    setSettingsOpen(true);
  }, [session.state.cfg, chi, keepDeadWall, duration]);

  const currentPreset = presetOf(session.state.cfg);
  const settingsDirty =
    draftPreset.id !== currentPreset.id ||
    draftChi !== chi ||
    draftDeadWall !== keepDeadWall ||
    draftDuration !== duration;

  const applySettings = useCallback(() => {
    if (!settingsDirty) {
      setSettingsOpen(false);
      return;
    }
    setConfirming(true);
  }, [settingsDirty]);

  // 二次确认后：应用选项并重开对局
  const confirmSettings = useCallback(() => {
    rememberPreset(draftPreset);
    writeChi(draftChi);
    writeKeepDeadWall(draftDeadWall);
    writeDuration(draftDuration);
    setChi(draftChi);
    setKeepDeadWall(draftDeadWall);
    setDuration(draftDuration);

    clearState();
    setReplay(null);
    setFinalShown(false);
    setSession(
      newSession(
        configFromPreset(draftPreset, draftDeadWall, draftDuration, draftChi),
        randomRng(),
      ),
    );

    setConfirming(false);
    setSettingsOpen(false);
  }, [draftPreset, draftChi, draftDeadWall, draftDuration]);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      writeMuted(next);
      return next;
    });
  }, []);

  const openReplay = useCallback(() => {
    const states: GameState[] = [session.roundStart];
    let cursor = session.roundStart;
    for (const action of session.log) {
      cursor = reduce(cursor, action);
      states.push(cursor);
    }
    setReplay({ states, index: states.length - 1 });
  }, [session]);

  const shown = replay === null ? session.state : replay.states[replay.index];
  const legal = useMemo(
    () => (replay === null ? legalActions(session.state, HUMAN) : []),
    [replay, session.state],
  );
  const canReplay = session.log.length > 0;

  if (assets !== null) {
    return <LoadingScreen progress={assets} />;
  }

  if (!started) {
    return (
      <>
        <StartScreen
          onStart={() => {
            setStarted(true);
            sfx.unlock();
          }}
          onTutorial={() => setTutorialOpen(true)}
        />
        {tutorialOpen && (
          <TutorialDialog onClose={() => setTutorialOpen(false)} />
        )}
      </>
    );
  }

  return (
    <>
      <GameView
        state={shown}
        legal={legal}
        config={replay === null ? config : shown.cfg}
        muted={muted}
        canReplay={canReplay}
        readOnly={replay !== null}
        showFinal={finalShown && replay === null}
        onShowFinal={() => setFinalShown(true)}
        onAction={applyAction}
        onRestart={restart}
        onOpenSettings={openSettings}
        onOpenTutorial={() => setTutorialOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
        onToggleMute={toggleMute}
        onOpenReplay={openReplay}
      />

      {historyOpen && (
        <HistoryDialog
          history={session.state.history ?? []}
          players={config.players}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {tutorialOpen && (
        <TutorialDialog onClose={() => setTutorialOpen(false)} />
      )}

      {settingsOpen && (
        <SettingsDialog
          preset={draftPreset}
          keepDeadWall={draftDeadWall}
          duration={draftDuration}
          chi={draftChi}
          dirty={settingsDirty}
          confirming={confirming}
          onChangePreset={(next) => {
            setDraftPreset(next);
            setConfirming(false);
          }}
          onChangeDeadWall={(next) => {
            setDraftDeadWall(next);
            setConfirming(false);
          }}
          onChangeDuration={(next) => {
            setDraftDuration(next);
            setConfirming(false);
          }}
          onChangeChi={(next) => {
            setDraftChi(next);
            setConfirming(false);
          }}
          onApply={applySettings}
          onCancel={() => setSettingsOpen(false)}
          onConfirm={confirmSettings}
          onDismissConfirm={() => setConfirming(false)}
        />
      )}

      {replay !== null && (
        <div className="replay-bar">
          <button
            type="button"
            onClick={() => setReplay({ ...replay, index: 0 })}
          >
            ⏮
          </button>
          <button
            type="button"
            onClick={() =>
              setReplay({ ...replay, index: Math.max(0, replay.index - 1) })
            }
          >
            ◀
          </button>
          <span className="replay-pos">
            {replay.index + 1} / {replay.states.length}
          </span>
          <button
            type="button"
            onClick={() =>
              setReplay({
                ...replay,
                index: Math.min(replay.states.length - 1, replay.index + 1),
              })
            }
          >
            ▶
          </button>
          <button
            type="button"
            onClick={() =>
              setReplay({ ...replay, index: replay.states.length - 1 })
            }
          >
            ⏭
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="ghost"
            onClick={() => setReplay(null)}
          >
            退出回放
          </button>
        </div>
      )}
    </>
  );
}
