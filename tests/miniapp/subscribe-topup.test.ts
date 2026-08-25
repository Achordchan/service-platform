import { describe, it, expect } from "vitest";
import {
  isQuotaSnapshotStale,
  selectPendingGrantReports,
  selectTopUpTargets,
  shouldHydrateQuota,
  takePendingGrantReports,
  HYDRATE_RETRY_MS,
  QUOTA_TRUST_MS,
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
// 默认给一个刚读到的额度快照
const FRESH = NOW;
const keys = (templates: Template[]) => templates.map((t) => t.templateKey);

describe("订阅额度静默续额的挑选规则", () => {
  it("从没续过（lastTopUpAt=0）时立即续，不等冷却", () => {
    expect(keys(selectTopUpTargets([REPLY], NOW, 0, FRESH))).toEqual([
      "REQUEST_REPLY",
    ]);
  });

  it("排除未勾「总是保持」的模板：混进去会弹窗打扰用户", () => {
    const targets = selectTopUpTargets([REPLY, STATUS, PROJECT], NOW, 0, FRESH);
    expect(keys(targets)).toEqual(["REQUEST_REPLY", "REQUEST_STATUS"]);
  });

  it("冷却期内一律跳过，冷却到点才放行", () => {
    const justNow = NOW - TOPUP_COOLDOWN_MS + 1;
    expect(selectTopUpTargets([REPLY], NOW, justNow, FRESH)).toEqual([]);
    expect(
      keys(selectTopUpTargets([REPLY], NOW, NOW - TOPUP_COOLDOWN_MS, FRESH)),
    ).toEqual(["REQUEST_REPLY"]);
  });

  it("快照新鲜且已达服务端封顶时不做无谓拉起", () => {
    const full = { ...REPLY, remaining: TOPUP_MAX_REMAINING };
    expect(selectTopUpTargets([full], NOW, 0, FRESH)).toEqual([]);
    expect(
      keys(
        selectTopUpTargets(
          [{ ...REPLY, remaining: TOPUP_MAX_REMAINING - 1 }],
          NOW,
          0,
          FRESH,
        ),
      ),
    ).toEqual(["REQUEST_REPLY"]);
  });

  it("快照过期后整体不拉起：persistent 在缓存里可能停留任意久，拿它静默续额会对已关闭的订阅弹窗", () => {
    const full = { ...REPLY, remaining: TOPUP_MAX_REMAINING };
    const stale = NOW - QUOTA_TRUST_MS;
    expect(selectTopUpTargets([REPLY], NOW, 0, stale)).toEqual([]);
    expect(selectTopUpTargets([full], NOW, 0, stale)).toEqual([]);
    // 未长期授权同样排除
    expect(selectTopUpTargets([PROJECT], NOW, 0, stale)).toEqual([]);
  });

  it("无快照（quotaReadAt=0，如冷启到工单详情页或 getSetting 读失败）同样先等 hydrate", () => {
    const full = { ...REPLY, remaining: TOPUP_MAX_REMAINING };
    expect(selectTopUpTargets([full], NOW, 0, 0)).toEqual([]);
    expect(selectTopUpTargets([REPLY], NOW, 0, 0)).toEqual([]);
  });

  it("全部模板都不满足时返回空数组（调用方据此不拉起授权）", () => {
    expect(selectTopUpTargets([PROJECT], NOW, 0, FRESH)).toEqual([]);
    expect(selectTopUpTargets([], NOW, 0, FRESH)).toEqual([]);
  });

  it("客户端冷却必须严格长于服务端 60s 上报节流，否则白拉一次记不上额度", () => {
    expect(TOPUP_COOLDOWN_MS).toBeGreaterThan(60 * 1000);
  });
});

describe("额度快照的信任期", () => {
  it("无快照与到期快照都判为过期，需重新拉取", () => {
    expect(isQuotaSnapshotStale(NOW, 0)).toBe(true);
    expect(isQuotaSnapshotStale(NOW, NOW - QUOTA_TRUST_MS)).toBe(true);
  });

  it("信任期内不重复拉取", () => {
    expect(isQuotaSnapshotStale(NOW, NOW - QUOTA_TRUST_MS + 1)).toBe(false);
    expect(isQuotaSnapshotStale(NOW, NOW)).toBe(false);
  });

  it("信任期长于续额冷却：不会每次续额都顺带重拉一次状态", () => {
    expect(QUOTA_TRUST_MS).toBeGreaterThan(TOPUP_COOLDOWN_MS);
  });
});

describe("订阅状态的重拉时机", () => {
  const STALE = NOW - QUOTA_TRUST_MS;

  it("快照过期就重拉（冷启到工单详情页时 quotaReadAt=0）", () => {
    expect(shouldHydrateQuota(NOW, 0, 0)).toBe(true);
    expect(shouldHydrateQuota(NOW, STALE, 0)).toBe(true);
  });

  it("快照仍新鲜时不重拉", () => {
    expect(shouldHydrateQuota(NOW, NOW, 0)).toBe(false);
  });

  it("快照始终无效时按重试间隔限流：旧基础库读不到 subscriptionsSetting 也不会每次点击都多打两个接口", () => {
    expect(shouldHydrateQuota(NOW, 0, NOW - HYDRATE_RETRY_MS + 1)).toBe(false);
    expect(shouldHydrateQuota(NOW, 0, NOW - HYDRATE_RETRY_MS)).toBe(true);
  });

  it("重试间隔短于快照信任期：无效快照要比过期快照更快被重拉", () => {
    expect(HYDRATE_RETRY_MS).toBeLessThan(QUOTA_TRUST_MS);
  });
});

describe("额度上报失败后的补报", () => {
  it("只挑出待补报的模板，不把其他模板卷进来", () => {
    expect(
      keys(
        selectPendingGrantReports([REPLY, STATUS, PROJECT], new Set(["REQUEST_STATUS"])),
      ),
    ).toEqual(["REQUEST_STATUS"]);
  });

  it("没有待补报时返回空，调用方据此不发 POST", () => {
    expect(selectPendingGrantReports([REPLY, STATUS], new Set())).toEqual([]);
  });

  it("待补报的模板不再进入静默拉起：冷却过期后也不能跟补报抢同一条微信额度", () => {
    expect(
      keys(
        selectTopUpTargets(
          [REPLY, STATUS],
          NOW,
          0,
          FRESH,
          new Set(["REQUEST_REPLY"]),
        ),
      ),
    ).toEqual(["REQUEST_STATUS"]);
  });

  it("发出补报前把 key 从 pending 拿走，第二次手势不会把同一次额度再报一遍", () => {
    const pending = new Set(["REQUEST_REPLY", "REQUEST_STATUS"]);
    expect(keys(takePendingGrantReports([REPLY, STATUS], pending))).toEqual([
      "REQUEST_REPLY",
      "REQUEST_STATUS",
    ]);
    expect(pending.size).toBe(0);
    expect(takePendingGrantReports([REPLY, STATUS], pending)).toEqual([]);
  });

  it("刚拿走的 in-flight key 仍要从静默拉起里排除，避免同一次手势再 request", () => {
    const pending = new Set(["REQUEST_REPLY"]);
    const inFlight = new Set<string>();
    takePendingGrantReports([REPLY, STATUS], pending, inFlight);
    expect(pending.size).toBe(0);
    expect([...inFlight]).toEqual(["REQUEST_REPLY"]);
    expect(
      keys(selectTopUpTargets([REPLY, STATUS], NOW, 0, FRESH, inFlight)),
    ).toEqual(["REQUEST_STATUS"]);
  });
});
