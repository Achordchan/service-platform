"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Avatar,
  Box,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { format, parseISO } from "date-fns";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import AssignmentOutlinedIcon from "@mui/icons-material/AssignmentOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import LoginOutlinedIcon from "@mui/icons-material/LoginOutlined";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";
import WifiTetheringOutlinedIcon from "@mui/icons-material/WifiTetheringOutlined";
import { ChartCard } from "@/components/shared/chart-card";
import { useChartTheme } from "@/components/shared/chart-theme";
import { ErrorState } from "@/components/shared/content-state";
import { StatCard } from "@/components/shared/stat-card";
import { AuditEventDetailDrawer } from "@/components/staff/audit-detail-drawer";
import {
  ActorIdentity,
  formatAuditFullTime,
  formatDuration,
  ResultChip,
  SessionCaveat,
} from "@/components/staff/audit-shared";
import { staffApi } from "@/components/staff/staff-api";
import { getAvatarInitials, getAvatarPalette } from "@/lib/default-avatar";
import { queryKeys } from "@/lib/query-keys";
import type {
  AuditLogRow,
  AuditOverview,
  AuditRange,
} from "@/modules/audit/audit-types";

function rangeQuery(range: AuditRange) {
  return new URLSearchParams({ from: range.from, to: range.to }).toString();
}

function OnlineRow({
  name,
  roleLabel,
  startedAt,
  durationMs,
  deviceLabel,
  ipAddress,
}: {
  name: string;
  roleLabel: string;
  startedAt: string;
  durationMs: number;
  deviceLabel: string;
  ipAddress: string | null;
}) {
  const palette = getAvatarPalette(name);
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", py: 1, minWidth: 0 }}>
      <Avatar
        sx={{
          width: 30,
          height: 30,
          fontSize: 13,
          fontWeight: 650,
          bgcolor: palette.bg,
          color: palette.fg,
        }}
      >
        {getAvatarInitials(name)}
      </Avatar>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 550 }}>
          {name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {roleLabel} · {deviceLabel}
          {ipAddress ? ` · ${ipAddress}` : ""}
        </Typography>
      </Box>
      <Tooltip title={`登录于 ${formatAuditFullTime(startedAt)}`}>
        <Chip
          size="small"
          variant="outlined"
          color="primary"
          label={`已登录 ${formatDuration(durationMs)}`}
        />
      </Tooltip>
    </Stack>
  );
}

function EmptyBlock({ children }: { children: string }) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
      {children}
    </Typography>
  );
}

export function AuditOverviewPanel({ range }: { range: AuditRange }) {
  const theme = useChartTheme();
  const muiTheme = useTheme();
  const [detail, setDetail] = useState<AuditLogRow | null>(null);

  const query = useQuery({
    queryKey: queryKeys.auditLogs.overview(rangeQuery(range)),
    queryFn: () =>
      staffApi<AuditOverview>(
        `/api/v1/admin/audit-logs/overview?${rangeQuery(range)}`,
      ),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const data = query.data;
  const loading = query.isPending;
  const topMax = Math.max(1, ...(data?.topPeople.map((person) => person.actionCount) ?? [1]));

  return (
    <Stack spacing={2.5}>
      {query.isError ? (
        <ErrorState
          message="概览加载失败，请稍后重试。"
          onRetry={() => void query.refetch()}
        />
      ) : null}

      <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
        <StatCard
          label="活跃用户"
          value={loading ? "—" : (data?.totals.activePeople ?? 0)}
          icon={<GroupOutlinedIcon />}
          tone="primary"
        />
        <StatCard
          label="登录次数"
          value={loading ? "—" : (data?.totals.loginCount ?? 0)}
          icon={<LoginOutlinedIcon />}
          tone="success"
        />
        <StatCard
          label="操作总数"
          value={loading ? "—" : (data?.totals.actionCount ?? 0)}
          icon={<AssignmentOutlinedIcon />}
        />
        <Tooltip title="按登录到登出（或最后一次操作）估算；仍登录中的会话不计入平均。">
          <Box sx={{ display: "flex", flex: "1 1 200px", minWidth: 0 }}>
            <StatCard
              label="平均每次停留（已登出）"
              value={
                loading
                  ? "—"
                  : data?.totals.avgSessionMs
                    ? formatDuration(data.totals.avgSessionMs)
                    : "样本不足"
              }
              icon={<TimerOutlinedIcon />}
              tone="warning"
            />
          </Box>
        </Tooltip>
        <Tooltip title="按仍有效的登录会话统计，不代表此刻正在浏览页面。">
          <Box sx={{ display: "flex", flex: "1 1 200px", minWidth: 0 }}>
            <StatCard
              label="当前登录中"
              value={loading ? "—" : (data?.totals.onlineNow ?? 0)}
              icon={<WifiTetheringOutlinedIcon />}
              tone="neutral"
            />
          </Box>
        </Tooltip>
      </Stack>

      <ChartCard title="操作与活跃趋势" height={260} loading={loading}>
        {data ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.trend} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={theme.gridStrokeColor}
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={(date) => format(parseISO(date as string), "M/d")}
                stroke={theme.axisTickColor}
                tick={{ fill: theme.axisTickColor }}
                style={{ fontSize: theme.fontSize, fontFamily: theme.fontFamily }}
                minTickGap={16}
              />
              <YAxis
                allowDecimals={false}
                stroke={theme.axisTickColor}
                tick={{ fill: theme.axisTickColor }}
                style={{ fontSize: theme.fontSize, fontFamily: theme.fontFamily }}
              />
              <ChartTooltip
                contentStyle={{
                  backgroundColor: theme.tooltipBg,
                  border: `1px solid ${theme.tooltipBorder}`,
                  borderRadius: 8,
                  fontSize: theme.fontSize,
                  fontFamily: theme.fontFamily,
                }}
                labelFormatter={(date) =>
                  format(parseISO(date as string), "yyyy 年 M 月 d 日")
                }
                formatter={(value, name) => [`${value ?? 0}`, name]}
              />
              <Legend
                wrapperStyle={{ fontSize: theme.fontSize, fontFamily: theme.fontFamily }}
              />
              <Bar
                dataKey="actions"
                name="操作数"
                fill={theme.areaFill}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
              <Line
                type="monotone"
                dataKey="activePeople"
                name="活跃人数"
                stroke={muiTheme.palette.success.main}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="logins"
                name="登录次数"
                stroke={muiTheme.palette.warning.main}
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : null}
      </ChartCard>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          gap: 2.5,
        }}
      >
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <Typography variant="h3">当前登录中</Typography>
            <Typography variant="caption" color="text.secondary">
              {loading ? "" : `${data?.onlineSessions.length ?? 0} 个会话`}
            </Typography>
          </Stack>
          <SessionCaveat />
          {loading ? (
            <Skeleton variant="rectangular" height={120} sx={{ mt: 1.5, borderRadius: 1.5 }} />
          ) : data && data.onlineSessions.length > 0 ? (
            <Stack divider={<Divider flexItem />} sx={{ mt: 1 }}>
              {data.onlineSessions.map((session) => (
                <OnlineRow
                  key={session.sessionId}
                  name={session.name}
                  roleLabel={session.roleLabel}
                  startedAt={session.startedAt}
                  durationMs={session.durationMs}
                  deviceLabel={session.device.label}
                  ipAddress={session.ipAddress}
                />
              ))}
            </Stack>
          ) : (
            <EmptyBlock>当前没有仍有效的登录会话。</EmptyBlock>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="h3">最近登录</Typography>
          <Typography variant="caption" color="text.secondary">
            区间内最近几次成功登录
          </Typography>
          {loading ? (
            <Skeleton variant="rectangular" height={120} sx={{ mt: 1.5, borderRadius: 1.5 }} />
          ) : data && data.recentLogins.length > 0 ? (
            <Stack divider={<Divider flexItem />} sx={{ mt: 1 }}>
              {data.recentLogins.map((row) => {
                const method = row.context.find((item) => item.label === "登录方式")?.value;
                return (
                  <Stack
                    key={row.id}
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center", py: 1, minWidth: 0 }}
                  >
                    <ActorIdentity actor={row.actor} showEmail={false} />
                    <Box sx={{ flex: 1 }} />
                    <Stack sx={{ alignItems: "flex-end", flexShrink: 0 }}>
                      <Typography variant="caption" color="text.secondary">
                        {method ?? "网页登录"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatAuditFullTime(row.createdAt).replace("（北京时间）", "")}
                      </Typography>
                    </Stack>
                  </Stack>
                );
              })}
            </Stack>
          ) : (
            <EmptyBlock>区间内还没有登录记录。</EmptyBlock>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="h3">最活跃的人</Typography>
          <Typography variant="caption" color="text.secondary">
            按区间内的操作次数排序
          </Typography>
          {loading ? (
            <Skeleton variant="rectangular" height={120} sx={{ mt: 1.5, borderRadius: 1.5 }} />
          ) : data && data.topPeople.length > 0 ? (
            <Stack spacing={1.5} sx={{ mt: 1.5 }}>
              {data.topPeople.map((person) => (
                <Stack key={person.id} spacing={0.5}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
                    <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                      {person.name}
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
                        {person.roleLabel}
                      </Typography>
                    </Typography>
                    <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {person.actionCount} 次
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={Math.max(4, (person.actionCount / topMax) * 100)}
                    sx={{ height: 6, borderRadius: 3 }}
                  />
                </Stack>
              ))}
            </Stack>
          ) : (
            <EmptyBlock>区间内还没有业务操作。</EmptyBlock>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="h3">需要留意</Typography>
          <Typography variant="caption" color="text.secondary">
            登录失败与多网络登录等安全提示
          </Typography>
          {loading ? (
            <Skeleton variant="rectangular" height={120} sx={{ mt: 1.5, borderRadius: 1.5 }} />
          ) : data && data.notices.length > 0 ? (
            <Stack spacing={1.25} sx={{ mt: 1.5 }}>
              {data.notices.map((notice) => (
                <Alert key={notice.key} severity={notice.tone} icon={false}>
                  <Typography variant="subtitle2">{notice.title}</Typography>
                  <Typography variant="body2">{notice.description}</Typography>
                </Alert>
              ))}
            </Stack>
          ) : (
            <Alert severity="success" icon={false} sx={{ mt: 1.5 }}>
              区间内没有发现需要特别留意的登录行为。
            </Alert>
          )}
          {!loading && (data?.totals.failedLoginCount ?? 0) === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
              登录失败为 0 次。
            </Typography>
          ) : null}
        </Paper>
      </Box>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <Typography variant="h3">最近动态</Typography>
          <Typography variant="caption" color="text.secondary">
            仅展示关键操作，不含页面浏览
          </Typography>
        </Stack>
        {loading ? (
          <Skeleton variant="rectangular" height={180} sx={{ mt: 1.5, borderRadius: 1.5 }} />
        ) : data && data.recentEvents.length > 0 ? (
          <Stack divider={<Divider flexItem />} sx={{ mt: 1 }}>
            {data.recentEvents.map((row) => (
              <Stack
                key={row.id}
                component="button"
                onClick={() => setDetail(row)}
                sx={{
                  border: 0,
                  bgcolor: "transparent",
                  color: "text.primary",
                  textAlign: "left",
                  cursor: "pointer",
                  py: 1.25,
                  px: 0,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", minWidth: 0 }}>
                  <ActorIdentity actor={row.actor} showEmail={false} />
                  <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                    {row.summary}
                  </Typography>
                  <ResultChip result={row.result} label={row.resultLabel} />
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                  {formatAuditFullTime(row.createdAt)}
                </Typography>
              </Stack>
            ))}
          </Stack>
        ) : (
          <EmptyBlock>区间内还没有关键操作。</EmptyBlock>
        )}
      </Paper>

      <AuditEventDetailDrawer row={detail} onClose={() => setDetail(null)} />
    </Stack>
  );
}
