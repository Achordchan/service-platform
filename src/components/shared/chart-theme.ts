"use client";

import { useTheme } from "@mui/material/styles";

export function useChartTheme() {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";

  return {
    axisTickColor: theme.palette.text.secondary,
    gridStrokeColor: theme.palette.divider,
    tooltipBg: theme.palette.background.paper,
    tooltipBorder: theme.palette.divider,
    tooltipTextColor: theme.palette.text.primary,
    areaFill: theme.palette.primary.main,
    areaStroke: theme.palette.primary.main,
    areaFillOpacity: isDark ? 0.15 : 0.2,
    fontSize: 12,
    fontFamily: theme.typography.fontFamily as string,
    statusColors: {
      PENDING: theme.palette.warning.main,
      IN_PROGRESS: theme.palette.primary.main,
      WAITING_CUSTOMER: isDark ? "#7c8aff" : "#5b6abf",
      RESOLVED: theme.palette.success.main,
      CLOSED: theme.palette.text.disabled,
    } as const,
    priorityColors: {
      LOW: theme.palette.text.disabled,
      NORMAL: theme.palette.primary.main,
      HIGH: theme.palette.warning.main,
      URGENT: theme.palette.error.main,
    } as const,
  };
}
