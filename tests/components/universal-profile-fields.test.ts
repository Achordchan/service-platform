import { describe, expect, it } from "vitest";
import {
  mergeProfileFields,
  parseProfileFieldText,
} from "@/components/staff/universal-profile-fields-editor";

describe("资料字段批量粘贴解析", () => {
  it("一行一个字段，可带类型", () => {
    expect(
      parseProfileFieldText("app_version 客户端版本\nos\t系统\nretry_count: 重试次数 数字"),
    ).toEqual([
      { key: "app_version", label: "客户端版本", type: "text" },
      { key: "os", label: "系统", type: "text" },
      { key: "retry_count", label: "重试次数", type: "number" },
    ]);
  });

  it("Markdown 四列表格按组拆开，表头和分隔线忽略", () => {
    const table = [
      "| 字段名 | 标签 | 字段名 | 标签 |",
      "| --- | --- | --- | --- |",
      "| `app_version` | 客户端版本 | `connection` | 连接 |",
      "| os | 系统 | line_status | 线路状态 |",
    ].join("\n");
    expect(parseProfileFieldText(table)).toEqual([
      { key: "app_version", label: "客户端版本", type: "text" },
      { key: "connection", label: "连接", type: "text" },
      { key: "os", label: "系统", type: "text" },
      { key: "line_status", label: "线路状态", type: "text" },
    ]);
  });

  it("缺名称时用 key 兜底，大写开头的词不当作 key", () => {
    expect(parseProfileFieldText("plan\nlocale System Language")).toEqual([
      { key: "plan", label: "plan", type: "text" },
      { key: "locale", label: "System Language", type: "text" },
    ]);
  });

  it("合并时覆盖同名 key、追加新 key 并清掉空行", () => {
    const result = mergeProfileFields(
      [
        { key: "os", label: "旧名称", type: "text" },
        { key: "", label: "", type: "text" },
        { key: "plan", label: "套餐", type: "text" },
      ],
      [
        { key: "os", label: "系统", type: "text" },
        { key: "plan", label: "套餐", type: "text" },
        { key: "timezone", label: "时区", type: "text" },
      ],
    );
    expect(result).toEqual({
      fields: [
        { key: "os", label: "系统", type: "text" },
        { key: "plan", label: "套餐", type: "text" },
        { key: "timezone", label: "时区", type: "text" },
      ],
      added: 1,
      updated: 1,
    });
  });
});
