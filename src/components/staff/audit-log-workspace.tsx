"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Box, Paper, Stack, Tab, Tabs, Typography } from "@mui/material";
import {
  AuditRangePicker,
  msUntilNextShanghaiMidnight,
  rangeForPreset,
} from "@/components/staff/audit-shared";
import { AuditEventPanel } from "@/components/staff/audit-event-panel";
import { AuditOverviewPanel } from "@/components/staff/audit-overview-panel";
import { AuditPeoplePanel } from "@/components/staff/audit-people-panel";
import type { AuditRange } from "@/modules/audit/audit-types";

export type AuditTab = "overview" | "people" | "logs";

export function resolveAuditTab(value: string | null): AuditTab {
  if (value === "people" || value === "logs") return value;
  return "overview";
}

const TAB_LABELS: Record<AuditTab, string> = {
  overview: "概览",
  people: "用户活动",
  logs: "操作明细",
};

export function AuditLogWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = resolveAuditTab(searchParams.get("tab"));
  const [range, setRange] = useState<AuditRange>(() => rangeForPreset("7d"));
  // 每个视图保留自己的筛选状态：切回来时不会丢
  const [mounted, setMounted] = useState<Record<AuditTab, boolean>>(() => ({
    overview: tab === "overview",
    people: tab === "people",
    logs: tab === "logs",
  }));

  // 页面跨过北京时间零点时，预设区间要跟着走到新的一天（自定义日期不动）
  useEffect(() => {
    if (range.preset === "custom") return;
    const timer = window.setTimeout(() => {
      setRange((current) =>
        current.preset === "custom" ? current : rangeForPreset(current.preset),
      );
    }, msUntilNextShanghaiMidnight() + 1_000);
    return () => window.clearTimeout(timer);
  }, [range.preset, range.from, range.to]);

  // 从后台切回、或窗口重新聚焦时补一次跨日检查
  useEffect(() => {
    const sync = () => {
      setRange((current) => {
        if (current.preset === "custom") return current;
        const next = rangeForPreset(current.preset);
        return next.from === current.from && next.to === current.to
          ? current
          : next;
      });
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  function selectTab(next: AuditTab) {
    setMounted((current) => ({ ...current, [next]: true }));
    const params = new URLSearchParams(searchParams.toString());
    if (next === "overview") params.delete("tab");
    else params.set("tab", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <Stack spacing={2.5}>
      <Paper
        variant="outlined"
        sx={{
          px: { xs: 2, md: 2.5 },
          py: 1.75,
          display: "flex",
          flexDirection: { xs: "column", lg: "row" },
          gap: 1.5,
          alignItems: { xs: "stretch", lg: "center" },
          justifyContent: "space-between",
        }}
      >
        <Stack spacing={0.75}>
          <Typography variant="subtitle2" color="text.secondary">
            统计时间范围
          </Typography>
          <AuditRangePicker value={range} onChange={setRange} />
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          所有时间均为北京时间（UTC+08:00）
        </Typography>
      </Paper>

      <Tabs
        value={tab}
        onChange={(_event, value: AuditTab) => selectTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        aria-label="审计日志视图"
      >
        {(Object.keys(TAB_LABELS) as AuditTab[]).map((key) => (
          <Tab key={key} value={key} label={TAB_LABELS[key]} />
        ))}
      </Tabs>

      <Box>
        {tab === "overview" ? (
          // 概览含图表，隐藏时容器宽度为 0 会触发 recharts 警告，因此只在激活时挂载
          <AuditOverviewPanel range={range} />
        ) : null}
        {mounted.people ? (
          <Box sx={{ display: tab === "people" ? "block" : "none" }}>
            <AuditPeoplePanel range={range} />
          </Box>
        ) : null}
        {mounted.logs ? (
          <Box sx={{ display: tab === "logs" ? "block" : "none" }}>
            <AuditEventPanel range={range} />
          </Box>
        ) : null}
      </Box>
    </Stack>
  );
}
