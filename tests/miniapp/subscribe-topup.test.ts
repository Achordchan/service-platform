import { describe, it, expect } from "vitest";
import {
  selectTopUpTargets,
  TOPUP_COOLDOWN_MS,
  TOPUP_MAX_REMAINING,
} from "../../miniapp/src/lib/subscribe-topup";

type Template = {
  templateKey: string;
  persistent: boolean;
  remaining: number;
};

const REPLY: Template = {
  templateKey: "REQUEST_REPLY",
  persistent: true,
  remaining: 0,
};
const STATUS: Template = {
  templateKey: "REQUEST_STATUS",
  persistent: true,
  remaining: 3,
};
const PROJECT: Template = {
  templateKey: "PROJECT_UPDATE",
  persistent: false,
  remaining: 3,
};

const NOW = 1_700_000_000_000;
const keys = (templates: Template[]) => templates.map((t) => t.templateKey);

describe("订阅额度静默续额的挑选规则", () => {
  it("从没续过（lastTopUpAt=0）时立即续，不等冷却", () => {
    expect(keys(selectTopUpTargets([REPLY], NOW, 0))).toEqual(["REQUEST_REPLY"]);
  });

  it("排除未勾「总是保持」的模板：混进去会弹窗打扰用户", () => {
    const targets = selectTopUpTargets([REPLY, STATUS, PROJECT], NOW, 0);
    expect(keys(targets)).toEqual(["REQUEST_REPLY", "REQUEST_STATUS"]);
  });

  it("额度耗尽的工单回复会被续上（用户反馈的场景）", () => {
    expect(keys(selectTopUpTargets([REPLY], NOW, 0))).toContain(
      "REQUEST_REPLY",
    );
  });

  it("冷却期内一律跳过，冷却到点才放行", () => {
    const justNow = NOW - TOPUP_COOLDOWN_MS + 1;
    expect(selectTopUpTargets([REPLY], NOW, justNow)).toEqual([]);
    expect(
      keys(selectTopUpTargets([REPLY], NOW, NOW - TOPUP_COOLDOWN_MS)),
    ).toEqual(["REQUEST_REPLY"]);
  });

  it("额度已达服务端封顶时不做无谓拉起", () => {
    const full = { ...REPLY, remaining: TOPUP_MAX_REMAINING };
    expect(selectTopUpTargets([full], NOW, 0)).toEqual([]);
    expect(
      keys(
        selectTopUpTargets(
          [{ ...REPLY, remaining: TOPUP_MAX_REMAINING - 1 }],
          NOW,
          0,
        ),
      ),
    ).toEqual(["REQUEST_REPLY"]);
  });

  it("全部模板都不满足时返回空数组（调用方据此不拉起授权）", () => {
    expect(selectTopUpTargets([PROJECT], NOW, 0)).toEqual([]);
    expect(selectTopUpTargets([], NOW, 0)).toEqual([]);
  });

  it("客户端冷却必须严格长于服务端 60s 上报节流，否则白拉一次记不上额度", () => {
    expect(TOPUP_COOLDOWN_MS).toBeGreaterThan(60 * 1000);
  });
});
