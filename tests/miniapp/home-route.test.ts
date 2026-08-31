import { describe, expect, it } from "vitest";

import appJson from "../../miniapp/src/app.json";
import { HOME_PAGE } from "../../miniapp/src/lib/routes";

describe("小程序首页路径", () => {
  it("HOME_PAGE 与 app.json 首页保持一致", () => {
    // onPageNotFound 的兜底跳转用 HOME_PAGE：跳到不存在的页面时微信只推原生
    // 提示页且不再回调，用户无法自行回到小程序，所以这条一致性必须守住。
    expect(HOME_PAGE).toBe(`/${appJson.pages[0]}`);
  });

  it("首页是 tabBar 页：reLaunch 落地后底部导航仍在", () => {
    const tabPaths = appJson.tabBar.list.map((item) => `/${item.pagePath}`);
    expect(tabPaths).toContain(HOME_PAGE);
  });
});
