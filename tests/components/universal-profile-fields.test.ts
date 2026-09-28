import { describe, expect, it } from "vitest";
import {
  mergeProfileFields,
  parseProfileFieldText,
} from "@/components/staff/universal-profile-fields-editor";

describe("资料字段批量粘贴解析", () => {
  it("一行一个字段，可带类型，名称可含空格", () => {
    expect(
      parseProfileFieldText(
        "app_version 客户端版本\nretry_count: 重试次数 数字\nlocale System Language\nos 系统，版本",
      ),
    ).toEqual([
      { key: "app_version", label: "客户端版本", type: "text" },
      { key: "retry_count", label: "重试次数", type: "number" },
      { key: "locale", label: "System Language", type: "text" },
      { key: "os", label: "系统，版本", type: "text" },
    ]);
  });

  it("逐行解析：下一行的 date 字段不会被当成上一行的类型", () => {
    expect(parseProfileFieldText("os 系统\ndate 日期\ntext 备注")).toEqual([
      { key: "os", label: "系统", type: "text" },
      { key: "date", label: "日期", type: "text" },
      { key: "text", label: "备注", type: "text" },
    ]);
  });

  it("Tab 分隔的行按列解析，英文名称不会被拆成字段", () => {
    expect(
      parseProfileFieldText("os\toperating system\ttext\nplan\tplan name"),
    ).toEqual([
      { key: "os", label: "operating system", type: "text" },
      { key: "plan", label: "plan name", type: "text" },
    ]);
  });

  it("多组表格里名为类型词的 key 仍按位置当 key", () => {
    expect(
      parseProfileFieldText("os\t系统\tdate\t日期\nlevel\t等级\t数字\tsince\t注册时间\t日期"),
    ).toEqual([
      { key: "os", label: "系统", type: "text" },
      { key: "date", label: "日期", type: "text" },
      { key: "level", label: "等级", type: "number" },
      { key: "since", label: "注册时间", type: "date" },
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

  it("缺名称时用 key 兜底，不以合法 key 开头的行忽略", () => {
    expect(parseProfileFieldText("plan\nApp_Version 版本\n字段名 标签")).toEqual([
      { key: "plan", label: "plan", type: "text" },
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
