// ============================================================
// 并发池
// ------------------------------------------------------------
// 原型的并发是硬编码 8，且失败直接丢弃。这里：
//   · 并发可配置（--map-workers）
//   · handler 抛错不中断其他任务，由调用方决定是否进补偿队列
// ============================================================

export interface PoolResult<T> {
  index: number;
  item: T;
  error?: Error;
}

export async function runPool<T>(
  items: T[],
  concurrency: number,
  handler: (item: T, index: number) => Promise<void>,
  onDone?: (done: number, total: number) => void,
): Promise<PoolResult<T>[]> {
  const results: PoolResult<T>[] = [];
  let cursor = 0;
  let done = 0;
  const workers = Math.max(1, Math.min(concurrency, items.length || 1));

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        await handler(items[i]!, i);
        results.push({ index: i, item: items[i]! });
      } catch (e) {
        results.push({
          index: i,
          item: items[i]!,
          error: e instanceof Error ? e : new Error(String(e)),
        });
      }
      done++;
      onDone?.(done, items.length);
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results.sort((a, b) => a.index - b.index);
}
