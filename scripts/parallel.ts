// 分片启动器：把同一个脚本按「每片不同参数」并发跑 N 份，等全部退出。
//
// 为什么不用 worker_threads：这两个脚本是「重计算 + 写文件」型，子进程隔离更省心，
// 也不会因为共享堆导致 GC 互相拖累。
//
// 为什么用 stdio: 'ignore'：Windows 沙箱下 Node 用管道捕获子进程输出会被拒绝（EPERM），
// 而 'inherit' 会让 16 个分片的进度互相打架。子进程安静跑、把结果写文件，父进程汇总。
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';

/**
 * 并发跑 N 个分片，等全部退出。
 *
 * @param {object} options
 * @param {string} options.script       脚本路径（`.ts` 交给当前 Node 的类型剥离）
 * @param {number} options.jobs         分片数
 * @param {(index: number) => string[]} options.argsFor 按分片号生成参数
 * @param {(progress: {finished: number, jobs: number, elapsed: string}) => void} [options.onTick]
 * @param {number} [options.tickMs]     心跳间隔，默认 60 秒
 * @returns {Promise<{elapsed: number}>} 总耗时（秒）
 */
export interface ShardProgress {
  readonly finished: number;
  readonly jobs: number;
  readonly elapsed: string;
}

export interface RunShardsOptions {
  /** 脚本路径（`.ts` 交给当前 Node 的类型剥离） */
  readonly script: string;
  /** 分片数 */
  readonly jobs: number;
  /** 按分片号生成该片的完整参数 */
  readonly argsFor: (index: number) => string[];
  /** 心跳：用于打印"已完成几片" */
  readonly onTick?: (progress: ShardProgress) => void;
  /** 心跳间隔，默认 60 秒 */
  readonly tickMs?: number;
}

export async function runShards({
  script,
  jobs,
  argsFor,
  onTick,
  tickMs = 60_000,
}: RunShardsOptions): Promise<{ elapsed: number }> {
  const started = Date.now();
  const failures: string[] = [];
  let finished = 0;

  const ticking =
    onTick === undefined
      ? undefined
      : setInterval(() => {
          onTick({
            finished,
            jobs,
            elapsed: ((Date.now() - started) / 1000).toFixed(0),
          });
        }, tickMs);

  try {
    await Promise.all(
      Array.from({ length: jobs }, (_, index) => {
        return new Promise<void>((resolve) => {
          // 调试用：PARALLEL_VERBOSE=1 时把每片输出重定向到日志文件
          const verbose = process.env.PARALLEL_VERBOSE === '1';
          const logPath = `.data/parallel-shard-${index}.log`;
          const fd = verbose ? openSync(logPath, 'w') : null;
          const child = spawn(
            process.execPath,
            [script, ...argsFor(index), `--shard=${index}/${jobs}`],
            {
              stdio: fd === null ? 'ignore' : ['ignore', fd, fd],
            },
          );
          if (fd !== null) child.on('exit', () => closeSync(fd));
          child.on('error', (error) => {
            failures.push(`分片 ${index} 启动失败：${error.message}`);
            resolve();
          });
          child.on('exit', (code, signal) => {
            if (code === 0) {
              finished += 1;
            } else {
              failures.push(
                `分片 ${index} 退出码 ${code}${signal === null ? '' : `（${signal}）`}`,
              );
            }
            resolve();
          });
        });
      }),
    );
  } finally {
    if (ticking !== undefined) clearInterval(ticking);
  }

  if (failures.length > 0) {
    throw new Error(
      `有 ${failures.length} 个分片失败：\n  ${failures.join('\n  ')}`,
    );
  }
  return { elapsed: (Date.now() - started) / 1000 };
}
