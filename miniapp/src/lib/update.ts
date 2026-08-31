// 版本更新提示：纯逻辑、不直接引用 wx（副作用经依赖注入），便于单元测试。
// 之所以要写这段——微信默认并不会提示用户「有新版本，重新载入」：
// 冷启动时客户端只是「异步」下载新代码包，本次启动照旧跑本地旧包，新包要等
// 「下一次」冷启动才生效。全量发布后用户连开两次都可能还是旧版，且全程无感知。
// 接上 UpdateManager 把这一步变成显式询问：下好了就问一句，用户同意才重启套用。
//
// 另一个必须做成可测的理由：开发版/体验版根本不触发这套回调，真机只有正式版能验，
// 开发者工具得靠「编译模式 → 下次编译时模拟更新」才走得到，靠手测等于没测。

export type UpdateManagerLike = {
  onCheckForUpdate(callback: (result: { hasUpdate: boolean }) => void): void;
  onUpdateReady(callback: () => void): void;
  onUpdateFailed(callback: () => void): void;
  applyUpdate(): void;
};

export type UpdateConfirmOptions = {
  title: string;
  content: string;
  confirmText: string;
  cancelText?: string;
  showCancel: boolean;
};

export type UpdateDeps = {
  /** 基础库过旧（< 1.9.90）时返回 null，此时静默跳过 */
  getUpdateManager: () => UpdateManagerLike | null;
  confirm: (options: UpdateConfirmOptions) => Promise<boolean>;
  warn: (message: string, detail?: unknown) => void;
};

/**
 * 在 onLaunch 里调用一次。回调是微信在下载完成/失败后异步回调的，
 * 注册本身不发起请求，也不会阻塞启动链路。
 */
export function checkForUpdate(deps: UpdateDeps): void {
  const manager = deps.getUpdateManager();
  if (!manager) return;

  manager.onCheckForUpdate((result) => {
    // 有无更新都不在这里打扰用户（新包还没下完）；留一行日志，
    // 便于排查「明明全量发布了却始终没提示」到底是没检查到还是没下完
    deps.warn("[app] update check", result);
  });

  // applyUpdate 会强杀当前进程重启，正在填的工单表单/草稿会丢，所以一定要询问；
  // 用户选「稍后」就什么都不做——新包已经落地，下次冷启动自然生效。
  // 守卫必须在 confirm 之前置位、且不再复位：一次冷启动只问一次。
  // 放到 then 里置位的话，弹窗待确认期间回调再次触发会叠第二个窗，
  // 两个窗都点确认就会调两次 applyUpdate。
  let asked = false;
  manager.onUpdateReady(() => {
    if (asked) return;
    asked = true;
    void deps
      .confirm({
        title: "有新版本",
        content: "新版本已经准备好，是否重启小程序以使用新版本？",
        confirmText: "立即重启",
        cancelText: "稍后",
        showCancel: true,
      })
      .then((confirmed) => {
        // 用户已表态「稍后」，同一次冷启动内不再重复打扰
        if (!confirmed) return;
        // 常驻 SSE 租约随进程一起断开，服务端按超时回收，与用户手动杀进程同路径
        manager.applyUpdate();
      });
  });

  manager.onUpdateFailed(() => {
    deps.warn("[app] update download failed");
    // 下载失败时旧包仍可用，但会一直卡在旧版本，只能靠用户删掉重进来重新拉包
    void deps.confirm({
      title: "新版本下载失败",
      content: "请删除该小程序后重新搜索打开，以使用最新版本。",
      confirmText: "知道了",
      showCancel: false,
    });
  });
}
