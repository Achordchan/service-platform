import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

// 说明：这里只能做源码级断言。miniapp/src/lib/delivery.ts 会一路 import 到
// 依赖 wx 全局的 api.ts，而根 tsconfig 排除了 miniapp，直接 import 会让
// typecheck 红。缓存本身的行为与 Web 侧同构，由
// tests/hooks/delivery-channels-cache.test.tsx 做黑盒覆盖。
describe("小程序送达通道缓存的作废", () => {
  it("导出的作废函数必须真有调用点，且挂在回前台那条路径上", async () => {
    const app = await readFile("miniapp/src/app.ts", "utf8");
    // 通道开关只能在 Web 后台改。没有这个调用点，作废函数就是死代码 ——
    // 小程序进程活着的整段时间里，提示行都会照着旧通道说话。
    expect(app).toContain("clearDeliveryChannelsCache");
    const onShow = app.slice(app.indexOf("onShow()"));
    expect(onShow).toContain("clearDeliveryChannelsCache()");
  });

  it("作废函数本身仍然导出（改名要连调用点一起改）", async () => {
    const delivery = await readFile("miniapp/src/lib/delivery.ts", "utf8");
    expect(delivery).toContain("export function clearDeliveryChannelsCache()");
  });
});
