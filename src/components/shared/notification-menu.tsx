"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
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
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { apiRequest, jsonRequest } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-keys";

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
  const queryClient = useQueryClient();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { unread, refresh: refreshSummary } = useUnreadNotifications();
  const notificationsQuery = useInfiniteQuery({
    queryKey: queryKeys.notifications.list,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: "30" });
      if (pageParam) params.set("cursor", pageParam);
      return apiRequest<NotificationPage>(
        `/api/v1/notifications?${params}`,
        { cache: "no-store", signal },
        "通知加载失败",
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const markReadMutation = useMutation({
    mutationFn: (variables: { id: string } | { all: true }) =>
      apiRequest<void>(
        "/api/v1/notifications",
        jsonRequest("PATCH", variables),
        "通知状态更新失败",
      ),
    onSuccess: async (_, variables) => {
      const now = new Date().toISOString();
      queryClient.setQueryData<InfiniteData<NotificationPage>>(
        queryKeys.notifications.list,
        (current) =>
          current
            ? {
                ...current,
                pages: current.pages.map((page) => ({
                  ...page,
                  items: page.items.map((item) =>
                    "all" in variables || item.id === variables.id
                      ? { ...item, readAt: item.readAt ?? now }
                      : item,
                  ),
                })),
              }
            : current,
      );
      window.dispatchEvent(
        new CustomEvent("notifications-updated", {
          detail:
            "all" in variables
              ? { all: true }
              : { notificationId: variables.id },
        }),
      );
      await refreshSummary();
    },
  });
  const items = useMemo(() => {
    const known = new Set<string>();
    return (notificationsQuery.data?.pages ?? []).flatMap((page) =>
      page.items.filter((item) => {
        if (known.has(item.id)) return false;
        known.add(item.id);
        return true;
      }),
    );
  }, [notificationsQuery.data]);
  const markingAll =
    markReadMutation.isPending &&
    Boolean(markReadMutation.variables && "all" in markReadMutation.variables);

  useEffect(() => {
    onUnreadStateChange?.(unread.navigation);
  }, [onUnreadStateChange, unread.navigation]);

  const refreshItems = useCallback(async () => {
    queryClient.setQueryData<InfiniteData<NotificationPage>>(
      queryKeys.notifications.list,
      (current) =>
        current
          ? {
              pages: current.pages.slice(0, 1),
              pageParams: current.pageParams.slice(0, 1),
            }
          : current,
    );
    await queryClient.invalidateQueries({
      queryKey: queryKeys.notifications.list,
    });
  }, [queryClient]);

  useEffect(() => {
    const unsubscribeEvents = subscribeRealtime(eventTypes, (event) => {
      if (event.live) void refreshItems();
    });
    const unsubscribeReady = subscribeRealtimeReady(() => void refreshItems());
    const handleLocalUpdate = () => void refreshItems();
    window.addEventListener("notifications-updated", handleLocalUpdate);
    return () => {
      unsubscribeEvents();
      unsubscribeReady();
      window.removeEventListener("notifications-updated", handleLocalUpdate);
    };
  }, [refreshItems]);

  async function openNotification(item: NotificationItem) {
    if (!item.readAt) {
      await markReadMutation.mutateAsync({ id: item.id }).catch(() => undefined);
    }
    setAnchor(null);
    if (staff && item.type === "CONTENT_RISK") {
      router.push("/staff/plugins");
    } else if (item.serviceRequestId) {
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
    await markReadMutation.mutateAsync({ all: true }).catch(() => undefined);
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
                bgcolor: item.readAt ? "transparent" : "action.selected",
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
          {notificationsQuery.hasNextPage ? (
            <Box sx={{ p: 1.5, textAlign: "center" }}>
              <Button
                size="small"
                onClick={() => void notificationsQuery.fetchNextPage()}
                disabled={notificationsQuery.isFetchingNextPage}
              >
                {notificationsQuery.isFetchingNextPage
                  ? "加载中"
                  : "加载更早通知"}
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
