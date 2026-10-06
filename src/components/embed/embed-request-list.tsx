"use client";

import type { ElementType } from "react";
import { Box, Button, ButtonBase, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import AccessTimeOutlinedIcon from "@mui/icons-material/AccessTimeOutlined";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import ArrowForwardOutlinedIcon from "@mui/icons-material/ArrowForwardOutlined";
import AutorenewOutlinedIcon from "@mui/icons-material/AutorenewOutlined";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import FlagOutlinedIcon from "@mui/icons-material/FlagOutlined";
import InboxOutlinedIcon from "@mui/icons-material/InboxOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import ReplyOutlinedIcon from "@mui/icons-material/ReplyOutlined";

export type EmbedRequestStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "WAITING_CUSTOMER"
  | "RESOLVED"
  | "CLOSED";

export type EmbedRequestListItem = {
  id: string;
  number: string;
  title: string;
  description: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  status: EmbedRequestStatus;
  updatedAt: string;
  category: { id: string; name: string };
  unreadCount: number;
};

export type EmbedListFilter = "all" | "wait" | "doing" | "done";

const FILTERS: Array<{ key: EmbedListFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "wait", label: "待我回复" },
  { key: "doing", label: "进行中" },
  { key: "done", label: "已完成" },
];

// 请求太少时筛选条只是噪音
const FILTER_MIN_REQUESTS = 4;

// ButtonBase 会去掉浏览器默认轮廓，不补的话键盘 Tab 时看不到焦点在哪
const focusRing = (color: string) => ({
  "&.Mui-focusVisible": {
    outline: `2px solid ${color}`,
    outlineOffset: 2,
  },
});

const STATUS_GROUP: Record<EmbedRequestStatus, Exclude<EmbedListFilter, "all">> = {
  WAITING_CUSTOMER: "wait",
  PENDING: "doing",
  IN_PROGRESS: "doing",
  RESOLVED: "done",
  CLOSED: "done",
};

type Tone = { bg: string; fg: string };

type StatusMeta = {
  label: string;
  Icon: ElementType;
  light: Tone;
  dark: Tone;
};

// 色值按亮/暗两套手选：语义色直接取 theme.palette.*.main 做浅底文字对比度不够
const STATUS_META: Record<EmbedRequestStatus, StatusMeta> = {
  WAITING_CUSTOMER: {
    label: "等待客户",
    Icon: AccessTimeOutlinedIcon,
    light: { bg: "#fff1d6", fg: "#8a4b00" },
    dark: { bg: "#3a2b0b", fg: "#ffcb6b" },
  },
  IN_PROGRESS: {
    label: "处理中",
    Icon: AutorenewOutlinedIcon,
    light: { bg: "#e3eeff", fg: "#0f4fb8" },
    dark: { bg: "#14284f", fg: "#8db8ff" },
  },
  PENDING: {
    label: "待处理",
    Icon: InboxOutlinedIcon,
    light: { bg: "#e9edf5", fg: "#3f4a60" },
    dark: { bg: "#232a40", fg: "#b6c0d8" },
  },
  RESOLVED: {
    label: "已解决",
    Icon: CheckCircleOutlineOutlinedIcon,
    light: { bg: "#ddf4e6", fg: "#0b6b3a" },
    dark: { bg: "#0f3322", fg: "#6fd8a0" },
  },
  CLOSED: {
    label: "已关闭",
    Icon: LockOutlinedIcon,
    light: { bg: "#eef0f4", fg: "#5b6478" },
    dark: { bg: "#1e2436", fg: "#8c96ae" },
  },
};

type FooterMeta = {
  text: string;
  action: string;
  Icon: ElementType;
  light: Tone & { line: string };
  dark: Tone & { line: string };
};

// 只给需要用户动手的两种状态加底部提示带。
// 文案刻意不含「关闭」二字，避免卡片按钮的可访问名称被 getByRole("button", { name: "关闭" }) 误匹配
const FOOTER_META: Partial<Record<EmbedRequestStatus, FooterMeta>> = {
  WAITING_CUSTOMER: {
    text: "客服在等你的回复",
    action: "去回复",
    Icon: ReplyOutlinedIcon,
    light: { bg: "#fff6e3", fg: "#7a4300", line: "#fbe2a8" },
    dark: { bg: "#2a2110", fg: "#ffd27d", line: "#4a3814" },
  },
  RESOLVED: {
    text: "问题已解决，请确认是否还有疑问",
    action: "去确认",
    Icon: CheckCircleOutlineOutlinedIcon,
    light: { bg: "#eaf8ef", fg: "#0b6b3a", line: "#c9ebd6" },
    dark: { bg: "#0f2a1d", fg: "#7bdca8", line: "#1b4a33" },
  },
};

// 本地日历日相差几天；用 UTC 分量做减法，夏令时切换日不会让「一天」变成 23/25 小时
function calendarDayDiff(from: Date, to: Date) {
  const dayMs = 24 * 60 * 60_000;
  return Math.round(
    (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) -
      Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) /
      dayMs,
  );
}

export function formatRelativeTime(iso: string, now: number = Date.now()) {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const diff = Math.max(0, now - time);
  const minute = 60_000;
  const hour = 60 * minute;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * hour) return `${Math.floor(diff / hour)} 小时前`;
  // 满 24 小时后按日历日算：「昨天」必须真的是昨天，而不是 24–48 小时前
  const date = new Date(time);
  const days = calendarDayDiff(date, new Date(now));
  if (days <= 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return `${sameYear ? "" : `${date.getFullYear()} 年 `}${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export function countByFilter(requests: Pick<EmbedRequestListItem, "status">[]) {
  const counts: Record<EmbedListFilter, number> = {
    all: requests.length,
    wait: 0,
    doing: 0,
    done: 0,
  };
  for (const request of requests) counts[STATUS_GROUP[request.status]] += 1;
  return counts;
}

export function EmbedListHero({
  contactName,
  canCreate,
  onCreate,
}: {
  contactName: string;
  canCreate: boolean;
  onCreate: () => void;
}) {
  const theme = useTheme();
  return (
    <Box
      component="section"
      sx={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 2,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography
          component="h1"
          sx={{
            fontSize: { xs: 26, sm: 30 },
            fontWeight: 700,
            lineHeight: 1.25,
            letterSpacing: "-0.01em",
            overflowWrap: "anywhere",
          }}
        >
          你好，{contactName}
        </Typography>
        <Typography
          sx={{ mt: 1, fontSize: 15, lineHeight: 1.6, color: theme.palette.text.secondary }}
        >
          查看请求进度，或提交新的问题，客服会尽快回复。
        </Typography>
      </Box>
      {canCreate ? (
        <Button
          variant="contained"
          disableElevation
          startIcon={<AddOutlinedIcon />}
          onClick={onCreate}
          sx={{
            display: { xs: "none", sm: "inline-flex" },
            height: 44,
            px: 2.5,
            borderRadius: "12px",
            fontSize: 15,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          新建服务请求
        </Button>
      ) : null}
    </Box>
  );
}

/** 窄屏下替代头部里的新建按钮：贴着视口底部，不遮挡内容 */
export function EmbedCreateFab({ onCreate }: { onCreate: () => void }) {
  return (
    <Box
      sx={{
        position: "sticky",
        bottom: 0,
        display: { xs: "flex", sm: "none" },
        justifyContent: "flex-end",
        px: 2,
        pb: 2.5,
        pointerEvents: "none",
      }}
    >
      <Button
        variant="contained"
        startIcon={<AddOutlinedIcon />}
        onClick={onCreate}
        sx={{
          pointerEvents: "auto",
          height: 52,
          px: 2.75,
          borderRadius: "26px",
          fontSize: 15,
          fontWeight: 700,
          boxShadow: (theme) => `0 8px 24px ${alpha(theme.palette.primary.main, 0.4)}`,
        }}
      >
        新建请求
      </Button>
    </Box>
  );
}

function EmptyState({
  canCreate,
  onCreate,
}: {
  canCreate: boolean;
  onCreate: () => void;
}) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const back = dark ? "#232b45" : "#e6ebf5";
  const line = dark ? "#3a4566" : "#c5cee2";
  return (
    <Box
      component="section"
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 1.5,
        px: { xs: 2.5, sm: 4 },
        py: { xs: 5, sm: 7 },
        borderRadius: "20px",
        bgcolor: "background.paper",
        border: `1px dashed ${theme.palette.divider}`,
      }}
    >
      <svg width="168" height="126" viewBox="0 0 160 120" fill="none" aria-hidden="true">
        <rect x="12" y="12" width="94" height="58" rx="16" fill={back} />
        <path d="M30 70v16l18-16z" fill={back} />
        <rect x="30" y="30" width="50" height="7" rx="3.5" fill={line} />
        <rect x="30" y="46" width="32" height="7" rx="3.5" fill={line} />
        <rect x="54" y="44" width="94" height="60" rx="16" fill={theme.palette.primary.main} />
        <path d="M128 104v14l-16-14z" fill={theme.palette.primary.main} />
        <circle cx="84" cy="74" r="4.5" fill="#fff" />
        <circle cx="101" cy="74" r="4.5" fill="#fff" />
        <circle cx="118" cy="74" r="4.5" fill="#fff" />
      </svg>
      <Typography component="h2" sx={{ mt: 1.5, fontSize: 20, fontWeight: 700 }}>
        暂无服务请求
      </Typography>
      <Typography
        sx={{
          maxWidth: 380,
          fontSize: 14.5,
          lineHeight: 1.7,
          color: theme.palette.text.secondary,
          mb: canCreate ? 1 : 0,
        }}
      >
        {canCreate
          ? "遇到连接问题或有疑问？提交后客服会尽快回复，处理进展都会显示在这里。"
          : "当前项目只允许查看历史服务请求。"}
      </Typography>
      {canCreate ? (
        <Button
          variant="contained"
          disableElevation
          startIcon={<AddOutlinedIcon />}
          onClick={onCreate}
          sx={{ height: 44, px: 2.5, borderRadius: "12px", fontSize: 15, fontWeight: 700 }}
        >
          新建服务请求
        </Button>
      ) : null}
    </Box>
  );
}

function FilterTabs({
  filter,
  counts,
  onChange,
}: {
  filter: EmbedListFilter;
  counts: Record<EmbedListFilter, number>;
  onChange: (next: EmbedListFilter) => void;
}) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const amber = STATUS_META.WAITING_CUSTOMER[dark ? "dark" : "light"];
  const subtle = alpha(theme.palette.text.primary, dark ? 0.1 : 0.06);
  return (
    <Box sx={{ overflowX: "auto", mx: { xs: -2, sm: 0 }, px: { xs: 2, sm: 0 } }}>
      <Box
        role="group"
        aria-label="按状态筛选"
        sx={{
          display: "inline-flex",
          gap: 0.5,
          p: 0.5,
          borderRadius: "13px",
          bgcolor: subtle,
        }}
      >
        {FILTERS.map((item) => {
          const active = filter === item.key;
          const urgent = item.key === "wait" && counts.wait > 0;
          return (
            <ButtonBase
              key={item.key}
              aria-pressed={active}
              onClick={() => onChange(item.key)}
              sx={{
                flexShrink: 0,
                gap: 1,
                px: 1.75,
                height: { xs: 44, sm: 36 },
                borderRadius: "9px",
                fontSize: 14,
                fontWeight: 500,
                whiteSpace: "nowrap",
                color: active ? theme.palette.text.primary : theme.palette.text.secondary,
                bgcolor: active ? theme.palette.background.paper : "transparent",
                boxShadow: active ? `0 1px 2px ${alpha("#000", dark ? 0.4 : 0.08)}` : "none",
                ...focusRing(theme.palette.primary.main),
              }}
            >
              {item.label}
              <Box
                component="span"
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 20,
                  height: 20,
                  px: 0.75,
                  borderRadius: "10px",
                  fontSize: 12,
                  fontWeight: 700,
                  bgcolor: urgent ? amber.bg : subtle,
                  color: urgent ? amber.fg : theme.palette.text.secondary,
                }}
              >
                {counts[item.key]}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  );
}

function RequestCard({
  request,
  writable,
  onOpen,
}: {
  request: EmbedRequestListItem;
  writable: boolean;
  onOpen: (requestId: string) => void;
}) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const mode = dark ? "dark" : "light";
  const status = STATUS_META[request.status];
  const statusTone = status[mode];
  const footerMeta = FOOTER_META[request.status];
  // 回复与确认都要写权限；只读项目里提示这些动作会把用户引向不可用的入口
  const footer = writable ? (footerMeta ?? null) : null;
  const highPriority = request.priority === "HIGH" || request.priority === "URGENT";
  const StatusIcon = status.Icon;
  const neutral = alpha(theme.palette.text.primary, dark ? 0.1 : 0.06);

  return (
    <ButtonBase
      onClick={() => onOpen(request.id)}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "flex-start",
        width: "100%",
        textAlign: "left",
        overflow: "hidden",
        borderRadius: "16px",
        color: theme.palette.text.primary,
        bgcolor: "background.paper",
        border: `1px solid ${theme.palette.divider}`,
        boxShadow: `0 1px 2px ${alpha("#000", dark ? 0.3 : 0.05)}`,
        transition: "transform .15s ease, box-shadow .15s ease, border-color .15s ease",
        "&:hover": {
          transform: "translateY(-1px)",
          borderColor: theme.palette.primary.main,
          boxShadow: `0 10px 28px ${alpha("#000", dark ? 0.45 : 0.1)}`,
        },
        "@media (prefers-reduced-motion: reduce)": {
          transition: "none",
          "&:hover": { transform: "none" },
        },
        ...focusRing(theme.palette.primary.main),
      }}
    >
      <Box
        component="span"
        sx={{ display: "flex", flexDirection: "column", p: { xs: 2, sm: "18px 20px" } }}
      >
        <Box
          component="span"
          sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1.5 }}
        >
          <Box
            component="span"
            sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1, minWidth: 0 }}
          >
            <Typography
              component="span"
              sx={{ fontSize: 16.5, fontWeight: 700, lineHeight: 1.4, overflowWrap: "anywhere" }}
            >
              {request.title}
            </Typography>
            {request.unreadCount > 0 ? (
              <Box
                component="span"
                aria-label={`${request.unreadCount} 条未读`}
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  height: 22,
                  px: 1.125,
                  borderRadius: "11px",
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  fontSize: 12,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                }}
              >
                {request.unreadCount > 99 ? "99+" : request.unreadCount} 条新消息
              </Box>
            ) : null}
          </Box>
          <Box
            component="time"
            dateTime={request.updatedAt}
            sx={{
              flexShrink: 0,
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: "nowrap",
              color: theme.palette.text.secondary,
            }}
          >
            {formatRelativeTime(request.updatedAt)}
          </Box>
        </Box>

        {request.description ? (
          <Typography
            component="span"
            sx={{
              mt: 0.75,
              fontSize: 14,
              lineHeight: 1.65,
              color: theme.palette.text.secondary,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              overflowWrap: "anywhere",
            }}
          >
            {request.description}
          </Typography>
        ) : null}

        <Box
          component="span"
          sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, mt: 1.75 }}
        >
          <Typography
            component="span"
            sx={{
              fontSize: 12.5,
              letterSpacing: "0.02em",
              fontVariantNumeric: "tabular-nums",
              color: theme.palette.text.secondary,
            }}
          >
            {request.number}
          </Typography>
          <Box
            component="span"
            sx={{
              display: "inline-flex",
              alignItems: "center",
              height: 24,
              px: 1.25,
              borderRadius: "8px",
              fontSize: 12.5,
              fontWeight: 500,
              bgcolor: neutral,
              color: theme.palette.text.secondary,
            }}
          >
            {request.category.name}
          </Box>
          {highPriority ? (
            <Box
              component="span"
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.625,
                height: 24,
                px: 1.25,
                borderRadius: "8px",
                fontSize: 12.5,
                fontWeight: 700,
                bgcolor: dark ? "#3b1416" : "#fde8e8",
                color: dark ? "#ff9c9c" : "#a31d1d",
              }}
            >
              <FlagOutlinedIcon sx={{ fontSize: 14 }} />
              {request.priority === "URGENT" ? "紧急" : "高优先级"}
            </Box>
          ) : null}
          <Box component="span" sx={{ flex: 1 }} />
          <Box
            component="span"
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.75,
              height: 26,
              px: 1.25,
              borderRadius: "999px",
              fontSize: 12.5,
              fontWeight: 700,
              whiteSpace: "nowrap",
              bgcolor: statusTone.bg,
              color: statusTone.fg,
            }}
          >
            <StatusIcon sx={{ fontSize: 15 }} />
            {status.label}
          </Box>
        </Box>
      </Box>

      {footer ? (
        <Box
          component="span"
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1.5,
            px: { xs: 2, sm: 2.5 },
            py: 1.375,
            fontSize: 13.5,
            fontWeight: 500,
            lineHeight: 1.4,
            bgcolor: footer[mode].bg,
            color: footer[mode].fg,
            borderTop: `1px solid ${footer[mode].line}`,
          }}
        >
          <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 1, minWidth: 0 }}>
            <footer.Icon sx={{ fontSize: 18, flexShrink: 0 }} />
            {footer.text}
          </Box>
          <Box
            component="span"
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontWeight: 700, whiteSpace: "nowrap" }}
          >
            {footer.action}
            <ArrowForwardOutlinedIcon sx={{ fontSize: 18 }} />
          </Box>
        </Box>
      ) : null}
    </ButtonBase>
  );
}

export function EmbedRequestListView({
  requests,
  writable,
  filter,
  onFilterChange,
  onOpen,
  onCreate,
}: {
  requests: EmbedRequestListItem[];
  writable: boolean;
  filter: EmbedListFilter;
  onFilterChange: (next: EmbedListFilter) => void;
  onOpen: (requestId: string) => void;
  onCreate: () => void;
}) {
  const theme = useTheme();
  if (requests.length === 0) {
    return <EmptyState canCreate={writable} onCreate={onCreate} />;
  }

  const showFilters = requests.length >= FILTER_MIN_REQUESTS;
  // 筛选条隐藏时旧的筛选值不该继续生效
  const activeFilter = showFilters ? filter : "all";
  const counts = countByFilter(requests);
  const visible =
    activeFilter === "all"
      ? requests
      : requests.filter((request) => STATUS_GROUP[request.status] === activeFilter);

  return (
    <>
      {showFilters ? (
        <FilterTabs filter={activeFilter} counts={counts} onChange={onFilterChange} />
      ) : null}
      {visible.length === 0 ? (
        <Typography sx={{ py: 4, textAlign: "center", color: theme.palette.text.secondary }}>
          这个分类下暂无请求
        </Typography>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.75 }}>
          {visible.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              writable={writable}
              onOpen={onOpen}
            />
          ))}
        </Box>
      )}
    </>
  );
}
