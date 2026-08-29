/**
 * 通道开关的会话级缓存：全场景共用一份，与收件人无关，一次会话拉一次。
 *
 * 刻意不 import 任何依赖 wx 的模块（取数函数由外部注入），
 * 这样这段有状态的逻辑可以脱离小程序运行时被直接测。
 */
export type ChannelCache<T> = {
  get(): Promise<T[]>;
  /** 规则可能已经变了：清缓存、作废在途请求，并通知已挂载的使用方重拉 */
  invalidate(): void;
  subscribe(listener: () => void): () => void;
};

export function createChannelCache<T>(
  fetchAll: () => Promise<T[]>,
): ChannelCache<T> {
  let cache: T[] | null = null;
  let inflight: Promise<T[]> | null = null;
  // 作废代次：作废之前发出的那次请求回来时带的已经是旧规则
  let generation = 0;
  const subscribers = new Set<() => void>();

  function get(): Promise<T[]> {
    if (cache) return Promise.resolve(cache);
    if (inflight) return inflight;
    const startedAt = generation;
    const request: Promise<T[]> = fetchAll()
      // 提示行是辅助信息：非预期载荷或请求失败都当没有规则，别把宿主页面打崩
      .then((rules) => (Array.isArray(rules) ? rules : ([] as T[])))
      .catch(() => [] as T[])
      .then((next) => {
        // 这次请求发出之后规则被改过：手上这份是保存前的，
        // 写回去等于把刚才那次作废吃掉，所有使用方继续看旧值
        if (startedAt !== generation) return get();
        cache = next;
        return next;
      })
      .then((next) => {
        // 作废时已经把在途请求摘掉了，这里只收自己那一份
        if (inflight === request) inflight = null;
        return next;
      });
    inflight = request;
    return request;
  }

  return {
    get,
    invalidate() {
      cache = null;
      generation += 1;
      // 与在途的旧请求脱钩：留着它，后来的调用方会复用它拿到保存前的结果
      inflight = null;
      for (const notify of [...subscribers]) notify();
    },
    subscribe(listener: () => void) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
  };
}
