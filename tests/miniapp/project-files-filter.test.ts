import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// WXML 没有可跑的运行时，这里直接锁住模板判据：文件 tab 的空态曾经拿筛选后的
// `files` 判空，于是「来自沟通」筛出 0 条时连来源筛选条一起被空态替掉，用户切
// 进去就再也切不回「全部」（issue #23）。判据必须是未筛选的 `allFiles`。
const wxml = readFileSync(
  new URL("../../miniapp/src/pages/project-detail/page.wxml", import.meta.url),
  "utf8",
);

/** 取出 `activeTab === 'files'` 那段模板（到下一个 tab 分支为止） */
function filesTabTemplate(): string {
  const start = wxml.indexOf("activeTab === 'files'");
  expect(start).toBeGreaterThan(-1);
  const rest = wxml.slice(start);
  const end = rest.indexOf("<!-- 悬浮按钮");
  return (end > -1 ? rest.slice(0, end) : rest).replace(/\s+/g, " ");
}

describe("项目详情 · 文件 tab 的来源筛选", () => {
  it("整屏空态只看未筛选的 allFiles，不看筛选结果", () => {
    const template = filesTabTemplate();
    expect(template).toContain('wx:if="{{allFiles.length === 0}}"');
    expect(template).not.toContain('wx:if="{{files.length === 0}}" is="state-empty"');
  });

  it("筛选结果为空时仍渲染来源筛选条，并给出该来源的空提示", () => {
    const template = filesTabTemplate();
    const emptyStateAt = template.indexOf('is="state-empty"');
    const filterBarAt = template.indexOf("file-source-bar");
    expect(filterBarAt).toBeGreaterThan(emptyStateAt);
    expect(template).toContain('wx:if="{{files.length === 0}}" class="file-empty');
  });
});
