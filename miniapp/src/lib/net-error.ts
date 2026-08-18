// wx.request 的 fail 回调不能一律当成「网络不可用」：页面切换 reLaunch 会中止
// 在途请求，errMsg 形如 "request:fail abort"，若也显示成断网会误导（审核环境即因此
// 把跳转导致的 abort 当成网络故障驳回）。这里按 errMsg 精确分类。
// 纯函数、不引用 wx，便于单元测试。

export type RequestFailureInfo = { code: string; message: string };

export function classifyRequestFailure(errMsg: string | undefined): RequestFailureInfo {
  const msg = errMsg ?? "";
  if (/abort/i.test(msg)) {
    // 请求因页面切换/主动取消被中止——不是网络问题
    return { code: "REQUEST_ABORTED", message: "请求已取消，请重试" };
  }
  if (/timeout/i.test(msg)) {
    return { code: "REQUEST_TIMEOUT", message: "请求超时，请稍后重试" };
  }
  if (/fail/i.test(msg)) {
    // 真实网络失败（request:fail、domain 不在白名单、DNS 失败等）
    return { code: "NETWORK_ERROR", message: "网络不可用，请检查网络" };
  }
  // 其他运行时错误（未知 errMsg）
  return { code: "REQUEST_FAILED", message: "请求未完成，请重试" };
}
