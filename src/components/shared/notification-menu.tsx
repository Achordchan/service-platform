"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  Stack,
  Typography,
} from "@mui/material";
import NotificationsNoneOutlinedIcon from "@mui/icons-material/NotificationsNoneOutlined";
import DoneAllOutlinedIcon from "@mui/icons-material/DoneAllOutlined";
import {
  subscribeRealtime,
  subscribeRealtimeReady,
  type RealtimeEventType,
} from "@/lib/realtime-client";
import type { NavigationUnreadState } from "@/lib/notification-navigation";
import {
  matchesNotificationLocalUpdate,
  type NotificationLocalUpdateDetail,
} from "@/lib/notification-local-update";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt?: string | null;
  projectId?: string | null;
  serviceRequestId?: string | null;
  occurrenceCount?: number;
  createdAt: string;
  updatedAt: string;
};

type NotificationPage = {
  items: NotificationItem[];
  totalUnread: number;
  nextCursor: string | null;
};

const eventTypes: readonly RealtimeEventType[] = [
  "NOTIFICATION_CREATED",
  "PROJECT_UPDATED",
];

const notificationTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function NotificationMenu({
  staff,
  onUnreadStateChange,
}: {
  staff: boolean;
  onUnreadStateChange?: (state: NavigationUnreadState) => void;
}) {
  const router = useRouter();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const refreshSequenceRef = useRef(0);
  const { unread, refresh: refreshSummary } = useUnreadNotifications();

  useEffect(() => {
    onUnreadStateChange?.(unread.navigation);
  }, [onUnreadStateChange, unread.navigation]);

  const refreshItems = useCallback(async () => {
    const sequence = ++refreshSequenceRef.current;
    try {
      const response = await fetch("/api/v1/notifications?limit=30", {
        cache: "no-store",
      });
      if (!response.ok || sequence !== refreshSequenceRef.current) return;
      const result = (await response.json()) as { data: NotificationPage };
      setItems(result.data.items);
      setNextCursor(result.data.nextCursor);
    } catch {
      // Keep the current list during transient failures.
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refreshItems(), 0);
    const unsubscribeEvents = subscribeRealtime(eventTypes, (event) => {
      if (event.live) void refreshItems();
    });
    const unsubscribeReady = subscribeRealtimeReady(() => void refreshItems());
    const handleLocalUpdate = (event: Event) => {
      const detail = (event as CustomEvent<NotificationLocalUpdateDetail>)
        .detail;
      if (detail) {
        const now = new Date().toISOString();
        setItems((current) =>
          current.map((item) =>
            !item.readAt && matchesNotificationLocalUpdate(item, detail)
              ? { ...item, readAt: now }
              : item,
          ),
        );
      }
      void refreshItems();
    };
    window.addEventListener("notifications-updated", handleLocalUpdate);
    return () => {
      window.clearTimeout(initialRefresh);
      unsubscribeEvents();
      unsubscribeReady();
      window.removeEventListener("notifications-updated", handleLocalUpdate);
    };
  }, [refreshItems]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `/api/v1/notifications?limit=30&cursor=${encodeURIComponent(nextCursor)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const result = (await response.json()) as { data: NotificationPage };
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [
          ...current,
          ...result.data.items.filter((item) => !known.has(item.id)),
        ];
      });
      setNextCursor(result.data.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  async function openNotification(item: NotificationItem) {
    if (!item.readAt) {
      const response = await fetch("/api/v1/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      if (response.ok) {
        setItems((current) =>
          current.map((notification) =>
            notification.id === item.id
              ? { ...notification, readAt: new Date().toISOString() }
              : notification,
          ),
        );
        window.dispatchEvent(
          new CustomEvent("notifications-updated", {
            detail: { notificationId: item.id },
          }),
        );
        await refreshSummary();
      }
    }
    setAnchor(null);
    if (item.serviceRequestId) {
      router.push(
        staff
          ? `/staff/requests/${item.serviceRequestId}`
          : `/customer/requests/${item.serviceRequestId}`,
      );
    } else if (item.projectId) {
      router.push(
        staff
          ? `/staff/projects/${item.projectId}`
          : `/customer/projects/${item.projectId}`,
      );
    }
  }

  async function markAllRead() {
    if (unread.totalUnread === 0 || markingAll) return;
    setMarkingAll(true);
    try {
      const response = await fetch("/api/v1/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!response.ok) return;
      const now = new Date().toISOString();
      setItems((current) =>
        current.map((item) =>
          item.readAt ? item : { ...item, readAt: now },
        ),
      );
      window.dispatchEvent(
        new CustomEvent("notifications-updated", { detail: { all: true } }),
      );
      await refreshSummary();
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <>
      <IconButton
        aria-label={`通知${unread.totalUnread ? `，${unread.totalUnread} 条未读` : ""}`}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <Badge
          color="primary"
          badgeContent={unread.totalUnread}
          max={99}
          invisible={unread.totalUnread === 0}
        >
          <NotificationsNoneOutlinedIcon />
        </Badge>
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        slotProps={{ paper: { sx: { width: 360, maxWidth: "92vw" } } }}
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{
            px: 2,
            py: 1.25,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Box>
            <Typography sx={{ fontWeight: 650 }}>通知</Typography>
            {unread.totalUnread > 0 ? (
              <Typography variant="caption" color="text.secondary">
                {unread.totalUnread} 条未读
              </Typography>
            ) : null}
          </Box>
          <Button
            size="small"
            startIcon={<DoneAllOutlinedIcon fontSize="small" />}
            onClick={() => void markAllRead()}
            disabled={unread.totalUnread === 0 || markingAll}
          >
            {markingAll ? "处理中" : "全部已读"}
          </Button>
        </Stack>
        <Divider />
        <List disablePadding sx={{ maxHeight: 420, overflowY: "auto" }}>
          {items.map((item) => (
            <ListItemButton
              key={item.id}
              onClick={() => void openNotification(item)}
              sx={{
                alignItems: "flex-start",
                py: 1.5,
                bgcolor: item.readAt ? "transparent" : "#f5f9ff",
              }}
            >
              <ListItemText
                primary={`${item.title}${
                  (item.occurrenceCount ?? 1) > 1
                    ? ` · ${item.occurrenceCount} 条`
                    : ""
                }`}
                secondary={
                  <Stack spacing={0.35} sx={{ mt: 0.5 }}>
                    <Typography
                      component="span"
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {item.body}
                    </Typography>
                    <Typography
                      component="span"
                      variant="caption"
                      color="text.secondary"
                    >
                      {notificationTimeFormatter.format(
                        new Date(item.updatedAt || item.createdAt),
                      )}
                    </Typography>
                  </Stack>
                }
                slotProps={{
                  primary: { sx: { fontWeight: item.readAt ? 500 : 650 } },
                  secondary: { component: "div" },
                }}
              />
            </ListItemButton>
          ))}
          {nextCursor ? (
            <Box sx={{ p: 1.5, textAlign: "center" }}>
              <Button
                size="small"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? "加载中" : "加载更早通知"}
              </Button>
            </Box>
          ) : null}
          {items.length === 0 ? (
            <Typography
              color="text.secondary"
              variant="body2"
              sx={{ px: 2, py: 4, textAlign: "center" }}
            >
              暂无通知
            </Typography>
          ) : null}
        </List>
      </Menu>
    </>
  );
}
