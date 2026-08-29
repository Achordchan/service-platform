/**
 * 「后发起的那次说了算」：并发/被作废的异步结果回来时判定为过期，直接丢掉。
 *
 * 这条规则在本仓库已经踩过两次（通道缓存的在途请求、送达预览），
 * 所以单拎出来 —— 刻意不 import 任何依赖 wx 的模块，可以直接测。
 */
export type LatestRequest = {
  /** 开一次新请求，返回「这次结果此刻是否仍然有效」的判定 */
  begin(): () => boolean;
  /** 作废所有在途请求：它们的结果回来时一律判为过期 */
  cancel(): void;
};

export function createLatestRequest(): LatestRequest {
  let token = 0;
  return {
    begin() {
      const current = ++token;
      return () => current === token;
    },
    cancel() {
      token += 1;
    },
  };
}
