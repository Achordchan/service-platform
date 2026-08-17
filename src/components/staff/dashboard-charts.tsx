"use client";

import { Box, Stack } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, parseISO } from "date-fns";
import { ChartCard } from "@/components/shared/chart-card";
import { useChartTheme } from "@/components/shared/chart-theme";
import { statusLabelFor } from "@/lib/status-config";
import { queryKeys } from "@/lib/query-keys";
import { staffApi } from "@/components/staff/staff-api";
import type { DashboardAnalytics } from "@/modules/dashboard/dashboard-analytics-service";

const PRIORITY_LABELS = {
  LOW: "低",
  NORMAL: "普通",
  HIGH: "高",
  URGENT: "紧急",
} as const;

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} 分钟`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} 小时`;
  return `${(hours / 24).toFixed(1)} 天`;
}

export function DashboardCharts() {
  const theme = useChartTheme();
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.dashboard.analytics,
    queryFn: () =>
      staffApi<DashboardAnalytics>("/api/v1/admin/dashboard/analytics"),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading || !data) {
    return (
      <Stack spacing={2.5}>
        <ChartCard title="服务请求量趋势" height={280} loading />
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "45fr 55fr" },
            gap: 2.5,
          }}
        >
          <ChartCard title="工单状态分布" height={300} loading />
          <ChartCard title="按优先级平均首响时间" height={300} loading />
        </Box>
      </Stack>
    );
  }

  const totalRequests = data.statusDistribution.reduce(
    (sum, item) => sum + item.count,
    0,
  );

  return (
    <Stack spacing={2.5}>
      <ChartCard title="服务请求量趋势" height={280}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.volumeTrend}>
            <defs>
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={theme.areaFill}
                  stopOpacity={theme.areaFillOpacity}
                />
                <stop
                  offset="100%"
                  stopColor={theme.areaFill}
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tickFormatter={(date) => format(parseISO(date), "M/d")}
              stroke={theme.axisTickColor}
              style={{
                fontSize: theme.fontSize,
                fontFamily: theme.fontFamily,
              }}
              tick={{ fill: theme.axisTickColor }}
            />
            <YAxis
              stroke={theme.axisTickColor}
              style={{
                fontSize: theme.fontSize,
                fontFamily: theme.fontFamily,
              }}
              tick={{ fill: theme.axisTickColor }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: theme.tooltipBg,
                border: `1px solid ${theme.tooltipBorder}`,
                borderRadius: 8,
                fontSize: theme.fontSize,
                fontFamily: theme.fontFamily,
              }}
              labelFormatter={(date) => format(parseISO(date as string), "M月d日")}
              formatter={(value) => [`${value ?? 0} 条请求`, ""]}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke={theme.areaStroke}
              strokeWidth={2}
              fill="url(#areaGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "45fr 55fr" },
          gap: 2.5,
        }}
      >
        <ChartCard title="工单状态分布" height={300}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data.statusDistribution}
                dataKey="count"
                nameKey="status"
                cx="50%"
                cy="45%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={2}
              >
                {data.statusDistribution.map((entry) => (
                  <Cell
                    key={entry.status}
                    fill={theme.statusColors[entry.status]}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: theme.tooltipBg,
                  border: `1px solid ${theme.tooltipBorder}`,
                  borderRadius: 8,
                  fontSize: theme.fontSize,
                  fontFamily: theme.fontFamily,
                }}
                formatter={(value, name) => [
                  `${value ?? 0} 条`,
                  statusLabelFor(name as never),
                ]}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value) => statusLabelFor(value as never)}
                wrapperStyle={{
                  fontSize: theme.fontSize,
                  fontFamily: theme.fontFamily,
                }}
              />
              <text
                x="50%"
                y="45%"
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fontSize: 28,
                  fontWeight: 650,
                  fill: theme.tooltipTextColor,
                  fontFamily: theme.fontFamily,
                }}
              >
                {totalRequests}
              </text>
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="按优先级平均首响时间" height={300}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.responseTimeByPriority}
              layout="vertical"
              margin={{ left: 10, right: 30 }}
            >
              <XAxis
                type="number"
                stroke={theme.axisTickColor}
                style={{
                  fontSize: theme.fontSize,
                  fontFamily: theme.fontFamily,
                }}
                tick={{ fill: theme.axisTickColor }}
              />
              <YAxis
                type="category"
                dataKey="priority"
                stroke={theme.axisTickColor}
                style={{
                  fontSize: theme.fontSize,
                  fontFamily: theme.fontFamily,
                }}
                tick={{ fill: theme.axisTickColor }}
                tickFormatter={(priority) => PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: theme.tooltipBg,
                  border: `1px solid ${theme.tooltipBorder}`,
                  borderRadius: 8,
                  fontSize: theme.fontSize,
                  fontFamily: theme.fontFamily,
                }}
                formatter={(value, _name, props) => [
                  `${formatMinutes(value as number)} (${(props as { payload: { count: number } }).payload.count} 条)`,
                  "平均首响",
                ]}
                labelFormatter={(priority) =>
                  PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS]
                }
              />
              <Bar dataKey="avgMinutes" radius={[0, 4, 4, 0]}>
                {data.responseTimeByPriority.map((entry) => (
                  <Cell
                    key={entry.priority}
                    fill={theme.priorityColors[entry.priority]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </Box>
    </Stack>
  );
}
