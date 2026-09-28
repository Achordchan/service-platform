import { describe, expect, it } from "vitest";
import {
  mergeProfileFields,
  parseProfileFieldText,
} from "@/components/staff/universal-profile-fields-editor";

const text = (value: string, label: string) => ({ key: value, label, type: "text" as const });

describe("资料字段批量粘贴解析", () => {
  it("纯文本一行一个字段，名称可含空格，只认中文类型词", () => {
    expect(
      parseProfileFieldText(
        [
          "app_version 客户端版本",
          "retry_count: 重试次数 数字",
          "locale System Language",
          "release_at Release date",
          "os 系统，版本",
        ].join("\n"),
      ),
    ).toEqual({
      fields: [
        text("app_version", "客户端版本"),
        { key: "retry_count", label: "重试次数", type: "number" },
        text("locale", "System Language"),
        text("release_at", "Release date"),
        text("os", "系统，版本"),
      ],
      skippedLines: [],
      headerLines: [],
    });
  });

  it("逐行解析：下一行的 date 字段不会被当成上一行的类型", () => {
    expect(parseProfileFieldText("os 系统\ndate 日期\ntext 备注").fields).toEqual([
      text("os", "系统"),
      text("date", "日期"),
      text("text", "备注"),
    ]);
  });

  it("无表头的 Tab 行按每组 2 列或 3 列整行切分，重复 key 以最后一次为准", () => {
    expect(
      parseProfileFieldText(
        [
          "os\toperating system\ttext",
          "os\tplatform\tdate\tbirthday",
          "level\t等级\tnumber",
          "plan\t套餐\t\t",
        ].join("\n"),
      ),
    ).toEqual({
      fields: [
        text("os", "platform"),
        text("date", "birthday"),
        { key: "level", label: "等级", type: "number" },
        text("plan", "套餐"),
      ],
      skippedLines: [],
      headerLines: [],
    });
  });

  it("两种列宽都能切开（有歧义）或都切不开的行跳过并报告行号", () => {
    expect(
      parseProfileFieldText("a\tA\tdate\tb\tc\ttext\nOS\t系统\nos\t系统\tx"),
    ).toEqual({ fields: [], skippedLines: [1, 2, 3], headerLines: [] });
  });

  it("英文表头被跳过并按表头认列", () => {
    const table = [
      "| key | label | type |",
      "| --- | --- | --- |",
      "| os | operating system | text |",
      "| since | 注册时间 | date |",
      "| birthday | 生日 | |",
    ].join("\n");
    expect(parseProfileFieldText(table)).toEqual({
      fields: [
        text("os", "operating system"),
        { key: "since", label: "注册时间", type: "date" },
        text("birthday", "生日"),
      ],
      skippedLines: [],
      headerLines: [1],
    });
  });

  it("中文四列表头按表头拆组，空组跳过，类型列非法时整行跳过", () => {
    const table = [
      "| 字段名 | 标签 | 字段名 | 标签 |",
      "| --- | --- | --- | --- |",
      "| `app_version` | 客户端版本 | `connection` | 连接 |",
      "| os | 系统 | date | 日期 |",
      "| plan | 套餐 | | |",
      "",
      "key\tlabel\ttype",
      "flag\t开关\tyes",
    ].join("\n");
    expect(parseProfileFieldText(table)).toEqual({
      fields: [
        text("app_version", "客户端版本"),
        text("connection", "连接"),
        text("os", "系统"),
        text("date", "日期"),
        text("plan", "套餐"),
      ],
      skippedLines: [8],
      headerLines: [1, 7],
    });
  });

  it("缺名称时用 key 兜底，纯文本表头跳过，非法 key 的行报告", () => {
    expect(parseProfileFieldText("字段名 标签\nplan\nApp_Version 版本")).toEqual({
      fields: [text("plan", "plan")],
      skippedLines: [3],
      headerLines: [1],
    });
  });

  it("原型链上的属性名不会被当成类型或表头", () => {
    expect(
      parseProfileFieldText(
        [
          "object_name Object constructor",
          "hint 提示 toString",
          "flag\t开关\tconstructor",
          "constructor\ttoString",
          "a\tb",
        ].join("\n"),
      ),
    ).toEqual({
      fields: [
        text("object_name", "Object constructor"),
        text("hint", "提示 toString"),
        text("constructor", "toString"),
        text("a", "b"),
      ],
      skippedLines: [3],
      headerLines: [],
    });
  });

  it("只有一段的第一行能当表头，之后与表头词同名的数据行照常导入", () => {
    expect(
      parseProfileFieldText(
        [
          "key\tlabel",
          "field\t名称",
          "name\tlabel",
          "",
          "os 系统",
          "key 名称",
          "",
          "key 名称",
          "field 字段",
        ].join("\n"),
      ),
    ).toEqual({
      fields: [
        text("field", "字段"),
        text("name", "label"),
        text("os", "系统"),
        text("key", "名称"),
      ],
      skippedLines: [],
      headerLines: [1, 8],
    });
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
