"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AppBar,
  Box,
  Button,
  Container,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";
import HomeWorkOutlinedIcon from "@mui/icons-material/HomeWorkOutlined";
import ManageAccountsOutlinedIcon from "@mui/icons-material/ManageAccountsOutlined";
import SupportAgentOutlinedIcon from "@mui/icons-material/SupportAgentOutlined";
import type {
  CustomerSpaceOption,
  CustomerUser,
} from "@/components/customer/customer-types";
import { AccountMenu } from "@/components/shared/account-menu";
import { NotificationMenu } from "@/components/shared/notification-menu";
import { GlobalRealtimeSound } from "@/components/shared/global-realtime-sound";
import { NavigationUnreadBadge } from "@/components/shared/navigation-unread-badge";
import { ThemeModeMenu } from "@/components/shared/theme-mode-menu";
import {
  EMPTY_NAVIGATION_UNREAD,
  type NavigationUnreadState,
} from "@/lib/notification-navigation";

const baseNavigation = [
  {
    href: "/customer/projects",
    label: "服务项目",
    icon: <HomeWorkOutlinedIcon fontSize="small" />,
  },
  {
    href: "/customer/requests",
    label: "服务请求",
    icon: <SupportAgentOutlinedIcon fontSize="small" />,
  },
];

export function CustomerShell({
  user,
  spaces,
  children,
}: {
  user: CustomerUser;
  spaces: CustomerSpaceOption[];
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const [navigationUnread, setNavigationUnread] =
    useState<NavigationUnreadState>(EMPTY_NAVIGATION_UNREAD);
  const canManageMembers = spaces.some((space) => space.role === "OWNER");
  const navigation = canManageMembers
    ? [
        ...baseNavigation,
        {
          href: "/customer/members",
          label: "成员",
          icon: <ManageAccountsOutlinedIcon fontSize="small" />,
        },
      ]
    : baseNavigation;

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <GlobalRealtimeSound
        currentUserId={user.id}
        enabled={user.soundNotificationsEnabled}
      />
      <AppBar
        position="sticky"
        color="inherit"
        elevation={0}
        sx={{ borderBottom: "1px solid", borderColor: "divider" }}
      >
        <Container maxWidth={false} sx={{ px: { xs: 2, md: 3.5 } }}>
          <Toolbar disableGutters sx={{ "&": { minHeight: { xs: 56, md: 64 } } }}>
            <IconButton
              aria-label="打开导航"
              onClick={() => setDrawerOpen(true)}
              sx={{ display: { md: "none" }, mr: 1 }}
            >
              <MenuOutlinedIcon />
            </IconButton>
            <Typography
              component={Link}
              href="/customer/projects"
              sx={{
                fontSize: { xs: 18, md: 22 },
                fontWeight: 650,
                letterSpacing: "0.02em",
                color: "text.primary",
                whiteSpace: "nowrap",
              }}
            >
              客户中心
            </Typography>

            <Stack
              direction="row"
              spacing={0.5}
              sx={{ display: { xs: "none", md: "flex" }, ml: 3 }}
            >
              {navigation.map((item) => {
                const selected =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                const hasUnread = item.href === "/customer/projects"
                  ? navigationUnread.projects
                  : item.href === "/customer/requests"
                    ? navigationUnread.requests
                    : false;
                const showUnread = hasUnread && !selected;
                return (
                  <Button
                    key={item.href}
                    component={Link}
                    href={item.href}
                    aria-label={
                      showUnread ? `${item.label}，有未读更新` : item.label
                    }
                    color={selected ? "primary" : "inherit"}
                    sx={{
                      px: 1.5,
                      bgcolor: selected ? "action.selected" : "transparent",
                    }}
                  >
                    <NavigationUnreadBadge visible={showUnread}>
                      {item.label}
                    </NavigationUnreadBadge>
                  </Button>
                );
              })}
            </Stack>

            <Stack
              direction="row"
              spacing={{ xs: 0.75, md: 1.25 }}
              sx={{ ml: "auto", alignItems: "center" }}
            >
              <ThemeModeMenu initialPreference={user.themePreference} />
              <NotificationMenu
                staff={false}
                onUnreadStateChange={setNavigationUnread}
              />
              <AccountMenu user={user} accountHref="/customer/account" />
            </Stack>
          </Toolbar>
        </Container>
      </AppBar>

      <Box component="main">{children}</Box>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        slotProps={{ paper: { sx: { width: 280 } } }}
      >
        <Box sx={{ px: 2.5, py: 2.5 }}>
          <Typography variant="h3">客户中心</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {user.email}
          </Typography>
        </Box>
        <Divider />
        <List sx={{ px: 1.5 }}>
          {navigation.map((item) => {
            const selected =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const hasUnread = item.href === "/customer/projects"
              ? navigationUnread.projects
              : item.href === "/customer/requests"
                ? navigationUnread.requests
                : false;
            const showUnread = hasUnread && !selected;
            return (
              <ListItemButton
                key={item.href}
                component={Link}
                href={item.href}
                aria-label={
                  showUnread ? `${item.label}，有未读更新` : item.label
                }
                selected={selected}
                onClick={() => setDrawerOpen(false)}
                sx={{ borderRadius: 1.5, my: 0.5 }}
              >
                <ListItemIcon sx={{ minWidth: 38 }}>
                  <NavigationUnreadBadge visible={showUnread}>
                    {item.icon}
                  </NavigationUnreadBadge>
                </ListItemIcon>
                <ListItemText primary={item.label} />
              </ListItemButton>
            );
          })}
        </List>
      </Drawer>
    </Box>
  );
}
