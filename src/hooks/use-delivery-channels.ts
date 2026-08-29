"use client";

import { useEffect, useState } from "react";
import { staffApi } from "@/components/staff/staff-api";
import type { DeliveryChannelRule } from "@/lib/delivery-notice";

// 全场景共用一份：只是「哪些通道当前开着」，与收件人无关，一个会话拉一次就够。
let cache: DeliveryChannelRule[] | null = null;
let inflight: Promise<DeliveryChannelRule[]> | null = null;
const subscribers = new Set<() => void>();

function load() {
  if (cache) return Promise.resolve(cache);
  inflight ??= staffApi<DeliveryChannelRule[]>(
    "/api/v1/notifications/delivery-channels",
  )
    .then((rules) => {
      // 提示行是辅助信息：拿到非预期载荷就当没有规则，别让它把宿主表单打崩
      cache = Array.isArray(rules) ? rules : [];
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 后台通知规则被改过之后调用，让提示行重新拉 */
export function invalidateDeliveryChannels() {
  cache = null;
  // 只清缓存不够：还挂着的提示行拿的是自己 state 里的旧规则，
  // 得等它下次重新挂载才会更新 —— 那期间它会照着旧通道说话。
  for (const notify of [...subscribers]) notify();
}

export function useDeliveryChannelRule(ruleKey: string) {
  const [rules, setRules] = useState<DeliveryChannelRule[] | null>(cache);

  useEffect(() => {
    const invalidate = () => setRules(null);
    subscribers.add(invalidate);
    return () => {
      subscribers.delete(invalidate);
    };
  }, []);

  useEffect(() => {
    if (rules) return;
    let active = true;
    void load()
      .then((next) => {
        if (active) setRules(next);
      })
      .catch(() => {
        // 提示行是辅助信息，拉不到就不显示，不打扰主流程
        if (active) setRules([]);
      });
    return () => {
      active = false;
    };
  }, [rules]);

  if (!Array.isArray(rules)) return null;
  return rules.find((rule) => rule.key === ruleKey) ?? null;
}
