import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createChannelCache } from "../../miniapp/src/lib/delivery-channel-cache";
import { createLatestRequest } from "../../miniapp/src/lib/latest-request";

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

describe("后发起的那次说了算", () => {
  it("只有最后一次开始的请求判定为有效", () => {
    const latest = createLatestRequest();
    const first = latest.begin();
    expect(first()).toBe(true);

    const second = latest.begin();
    // 先发的那次结果回来时已经过期：写回去会覆盖后发的那次
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("作废后连当前这次也判为过期", () => {
    const latest = createLatestRequest();
    const current = latest.begin();
    expect(current()).toBe(true);

    latest.cancel();
    expect(current()).toBe(false);
  });
});

// 下面三条只能做源码级断言：miniapp 的 delivery.ts / 组件会一路 import 到
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

  it("面板开着时连预览一起重拉，且预览请求走后发者优先", async () => {
    const component = await readFile(
      "miniapp/src/components/delivery-notice/index.ts",
      "utf8",
    );
    const attached = component.slice(component.indexOf("attached()"));
    const callback = attached.slice(0, attached.indexOf("detached()"));
    // 只重拉 rule 不重拉 preview 的话，面板里仍是旧通道与旧收件人，
    // 而 onApply 会拿旧 preview.rule 物化覆盖 —— 等于替用户把管理员
    // 刚关掉的通道显式打开
    expect(callback).toContain("this.loadPreview(scene)");
    // 唯一的预览入口都要过代次判定，绕开它就等于没修
    expect(component).toContain("latestPreviewOf(this).begin()");
    expect(component).toContain("if (!isCurrent()) return;");
    expect(component).not.toMatch(/onOpenPanel\(\)[\s\S]{0,400}previewDelivery\(/);
  });
});
