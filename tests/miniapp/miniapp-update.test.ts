import { describe, expect, it, vi } from "vitest";
import {
  checkForUpdate,
  type UpdateConfirmOptions,
  type UpdateManagerLike,
} from "../../miniapp/src/lib/update";

type Harness = {
  manager: UpdateManagerLike & { applyUpdate: ReturnType<typeof vi.fn> };
  emitCheck: (hasUpdate: boolean) => void;
  emitReady: () => void;
  emitFailed: () => void;
  confirms: UpdateConfirmOptions[];
  warns: string[];
};

function setup(confirmAnswers: boolean[] = []): Harness {
  const callbacks: {
    check?: (result: { hasUpdate: boolean }) => void;
    ready?: () => void;
    failed?: () => void;
  } = {};
  const confirms: UpdateConfirmOptions[] = [];
  const warns: string[] = [];
  const answers = [...confirmAnswers];
  const manager = {
    onCheckForUpdate: (cb: (result: { hasUpdate: boolean }) => void) => {
      callbacks.check = cb;
    },
    onUpdateReady: (cb: () => void) => {
      callbacks.ready = cb;
    },
    onUpdateFailed: (cb: () => void) => {
      callbacks.failed = cb;
    },
    applyUpdate: vi.fn(),
  };
  checkForUpdate({
    getUpdateManager: () => manager,
    confirm: (options) => {
      confirms.push(options);
      return Promise.resolve(answers.shift() ?? false);
    },
    warn: (message) => {
      warns.push(message);
    },
  });
  return {
    manager,
    emitCheck: (hasUpdate) => callbacks.check?.({ hasUpdate }),
    emitReady: () => callbacks.ready?.(),
    emitFailed: () => callbacks.failed?.(),
    confirms,
    warns,
  };
}

describe("小程序版本更新提示", () => {
  it("基础库过旧拿不到 UpdateManager 时静默跳过", () => {
    const confirm = vi.fn();
    expect(() =>
      checkForUpdate({
        getUpdateManager: () => null,
        confirm,
        warn: () => undefined,
      }),
    ).not.toThrow();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("没有新版本时不打扰用户", () => {
    const h = setup();
    h.emitCheck(false);
    expect(h.confirms).toHaveLength(0);
    expect(h.manager.applyUpdate).not.toHaveBeenCalled();
    expect(h.warns).toContain("[app] update check");
  });

  it("检查到有更新本身不弹窗（要等下载完成）", () => {
    const h = setup();
    h.emitCheck(true);
    expect(h.confirms).toHaveLength(0);
    expect(h.manager.applyUpdate).not.toHaveBeenCalled();
  });

  it("新包就绪且用户确认后重启套用", async () => {
    const h = setup([true]);
    h.emitReady();
    await vi.waitFor(() => expect(h.manager.applyUpdate).toHaveBeenCalledTimes(1));
    expect(h.confirms[0]).toMatchObject({ showCancel: true });
  });

  it("用户选稍后则不重启，等下次冷启动自然生效", async () => {
    const h = setup([false]);
    h.emitReady();
    await vi.waitFor(() => expect(h.confirms).toHaveLength(1));
    expect(h.manager.applyUpdate).not.toHaveBeenCalled();
  });

  it("确认后重复触发就绪回调不会重复 applyUpdate", async () => {
    const h = setup([true, true]);
    h.emitReady();
    await vi.waitFor(() => expect(h.manager.applyUpdate).toHaveBeenCalledTimes(1));
    h.emitReady();
    await vi.waitFor(() => expect(h.confirms).toHaveLength(1));
    expect(h.manager.applyUpdate).toHaveBeenCalledTimes(1);
  });

  it("下载失败提示删除重进，且不重启", async () => {
    const h = setup([true]);
    h.emitFailed();
    await vi.waitFor(() => expect(h.confirms).toHaveLength(1));
    expect(h.confirms[0]).toMatchObject({ showCancel: false });
    expect(h.manager.applyUpdate).not.toHaveBeenCalled();
    expect(h.warns).toContain("[app] update download failed");
  });
});
