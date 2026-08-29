import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createChannelCache } from "../../miniapp/src/lib/delivery-channel-cache";

type Rule = { key: string; emailEnabled: boolean };

const rules = (emailEnabled: boolean): Rule[] => [
  { key: "PROJECT_UPDATE", emailEnabled },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("送达通道缓存", () => {
  it("一次会话只拉一次，作废后才重拉", async () => {
    const fetchAll = vi
      .fn<() => Promise<Rule[]>>()
      .mockResolvedValueOnce(rules(true))
      .mockResolvedValueOnce(rules(false));
    const cache = createChannelCache(fetchAll);

    await expect(cache.get()).resolves.toEqual(rules(true));
    await expect(cache.get()).resolves.toEqual(rules(true));
    expect(fetchAll).toHaveBeenCalledOnce();

    cache.invalidate();
    await expect(cache.get()).resolves.toEqual(rules(false));
    expect(fetchAll).toHaveBeenCalledTimes(2);
  });

  it("作废时把在途的旧请求一并作废，不让它把旧规则写回来", async () => {
    const first = deferred<Rule[]>();
    const fetchAll = vi
      .fn<() => Promise<Rule[]>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(rules(false));
    const cache = createChannelCache(fetchAll);

    // 首次请求还在路上时管理员保存了规则
    const pending = cache.get();
    cache.invalidate();
    // 旧请求这才回来，带的是保存前的规则
    first.resolve(rules(true));

    // 只清 cache 不管 inflight 的话，这里会拿到 true 并把它写回缓存，
    // 于是这次作废等于没发生，所有提示行继续显示旧规则
    await expect(pending).resolves.toEqual(rules(false));
    await expect(cache.get()).resolves.toEqual(rules(false));
    expect(fetchAll).toHaveBeenCalledTimes(2);
  });

  it("作废后新发起的请求不会复用在途的旧请求", async () => {
    const first = deferred<Rule[]>();
    const fetchAll = vi
      .fn<() => Promise<Rule[]>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(rules(false));
    const cache = createChannelCache(fetchAll);

    void cache.get();
    cache.invalidate();
    const afterInvalidate = cache.get();
    first.resolve(rules(true));

    await expect(afterInvalidate).resolves.toEqual(rules(false));
  });

  it("作废会通知已挂载的使用方，退订后不再通知", () => {
    const cache = createChannelCache(async () => rules(true));
    const listener = vi.fn();
    const unsubscribe = cache.subscribe(listener);

    cache.invalidate();
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    cache.invalidate();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("取数失败当作没有规则，不把异常抛给宿主页面", async () => {
    const cache = createChannelCache<Rule>(async () => {
      throw new Error("网络异常");
    });
    await expect(cache.get()).resolves.toEqual([]);
  });
});

// 下面两条只能做源码级断言：miniapp 的 delivery.ts / 组件会一路 import 到
// 依赖 wx 全局的 api.ts，而根 tsconfig 排除了 miniapp，直接 import 会让
// typecheck 红。状态机本身已由上面的黑盒用例覆盖，这里只钉接线点。
describe("小程序侧的接线", () => {
  it("回前台时作废通道缓存", async () => {
    const app = await readFile("miniapp/src/app.ts", "utf8");
    // 没有这个调用点，作废函数就是死代码 —— 小程序进程活着的整段时间里，
    // 提示行都会照着 Web 后台改动之前的旧通道说话
    const onShow = app.slice(app.indexOf("onShow()"));
    expect(onShow).toContain("clearDeliveryChannelsCache()");
  });

  it("提示行组件订阅作废并重拉规则", async () => {
    const component = await readFile(
      "miniapp/src/components/delivery-notice/index.ts",
      "utf8",
    );
    // scene 没变时 observer 不会再触发，只清缓存救不了已经挂着的这一份
    expect(component).toContain("subscribeDeliveryChannels(");
    const attached = component.slice(component.indexOf("attached()"));
    expect(attached.slice(0, attached.indexOf("detached()"))).toContain(
      "this.loadRule(scene)",
    );
    expect(component).toContain("channelUnsubscribers.get(this)?.()");
  });
});
