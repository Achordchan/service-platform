"use client";

import { useEffect, useState } from "react";
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

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  readAt?: string | null;
  projectId?: string | null;
  serviceRequestId?: string | null;
  occurrenceCount?: number;
  createdAt: string;
  updatedAt: string;
};

const eventTypes: readonly RealtimeEventType[] = [
  "NOTIFICATION_CREATED",
];

const notificationTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function NotificationMenu({ staff }: { staff: boolean }) {
  const router = useRouter();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    let active = true;
    async function refresh() {
      const response = await fetch("/api/v1/notifications", {
        cache: "no-store",
      });
      if (!response.ok || !active) return;
      const result = (await response.json()) as {
        data: NotificationItem[];
      };
      if (active) {
        setItems(result.data);
      }
    }

    void refresh();
    const unsubscribeEvents = subscribeRealtime(eventTypes, (event) => {
      if (event.live) void refresh();
    });
    const unsubscribeReady = subscribeRealtimeReady(() => {
      void refresh();
    });
    const handleLocalUpdate = () => void refresh();
    window.addEventListener("notifications-updated", handleLocalUpdate);
    return () => {
      active = false;
      unsubscribeEvents();
      unsubscribeReady();
      window.removeEventListener("notifications-updated", handleLocalUpdate);
    };
  }, []);

  const unreadCount = items.filter((item) => !item.readAt).length;

  async function openNotification(item: NotificationItem) {
    if (!item.readAt) {
      await fetch("/api/v1/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      setItems((current) =>
        current.map((notification) =>
          notification.id === item.id
            ? { ...notification, readAt: new Date().toISOString() }
            : notification,
        ),
      );
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
    if (unreadCount === 0 || markingAll) return;
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
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <>
      <IconButton
        aria-label={`通知${unreadCount ? `，${unreadCount} 条未读` : ""}`}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <Badge
          color="primary"
          badgeContent={unreadCount}
          max={99}
          invisible={unreadCount === 0}
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
            {unreadCount > 0 ? (
              <Typography variant="caption" color="text.secondary">
                {unreadCount} 条未读
              </Typography>
            ) : null}
          </Box>
          <Button
            size="small"
            startIcon={<DoneAllOutlinedIcon fontSize="small" />}
            onClick={() => void markAllRead()}
            disabled={unreadCount === 0 || markingAll}
          >
            {markingAll ? "处理中" : "全部已读"}
          </Button>
        </Stack>
        <Divider />
        <List disablePadding sx={{ maxHeight: 420, overflowY: "auto" }}>
          {items.map((item) => (
            <ListItemButton
              key={item.id}
              onClick={() => openNotification(item)}
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
