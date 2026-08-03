"use client";

import { resolveAvatarSrc } from "@/lib/default-avatar";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  AppBar,
  Avatar,
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
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";
import HomeWorkOutlinedIcon from "@mui/icons-material/HomeWorkOutlined";
import ManageAccountsOutlinedIcon from "@mui/icons-material/ManageAccountsOutlined";
import SupportAgentOutlinedIcon from "@mui/icons-material/SupportAgentOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import KeyboardArrowDownOutlinedIcon from "@mui/icons-material/KeyboardArrowDownOutlined";
import type {
  CustomerSpaceOption,
  CustomerUser,
} from "@/components/customer/customer-types";
import { authClient } from "@/lib/auth-client";
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [accountAnchor, setAccountAnchor] = useState<null | HTMLElement>(null);
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
        <Container maxWidth={false} sx={{ px: { xs: 2, md: 5 } }}>
          <Toolbar disableGutters sx={{ minHeight: { xs: 64, md: 76 } }}>
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
              <Stack
                component="button"
                type="button"
                direction="row"
                spacing={1}
                onClick={(event) => setAccountAnchor(event.currentTarget)}
                sx={{
                  alignItems: "center",
                  border: 0,
                  bgcolor: "transparent",
                  color: "text.primary",
                  cursor: "pointer",
                  p: 0.5,
                }}
              >
                <Avatar
                  src={resolveAvatarSrc(user.image, user.name, user.id)}
                  alt={user.name}
                  sx={{ width: 36, height: 36, bgcolor: "action.selected" }}
                >
                  {user.name.slice(0, 1)}
                </Avatar>
                <Typography sx={{ display: { xs: "none", md: "block" } }}>
                  {user.name}
                </Typography>
                <KeyboardArrowDownOutlinedIcon
                  fontSize="small"
                  sx={{ display: { xs: "none", md: "block" } }}
                />
              </Stack>
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
          <Typography sx={{ fontWeight: 650, fontSize: 18 }}>
            客户中心
          </Typography>
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

      <Menu
        anchorEl={accountAnchor}
        open={Boolean(accountAnchor)}
        onClose={() => setAccountAnchor(null)}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        slotProps={{ paper: { sx: { minWidth: 280 } } }}
      >
        <Box sx={{ px: 2, py: 1.75, maxWidth: 320 }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
            <Avatar
              src={resolveAvatarSrc(user.image, user.name, user.id)}
              alt={user.name}
              sx={{ width: 40, height: 40, bgcolor: "action.selected" }}
            >
              {user.name.slice(0, 1)}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 700 }} noWrap>
                {user.name}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {user.email}
              </Typography>
            </Box>
          </Stack>
        </Box>
        <Divider />
        <MenuItem
          component={Link}
          href="/customer/account"
          onClick={() => setAccountAnchor(null)}
        >
          <ListItemIcon>
            <ManageAccountsOutlinedIcon fontSize="small" />
          </ListItemIcon>
          个人设置
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={async () => {
            await authClient.signOut();
            queryClient.clear();
            router.replace("/login");
            router.refresh();
          }}
        >
          <ListItemIcon>
            <LogoutOutlinedIcon fontSize="small" />
          </ListItemIcon>
          退出登录
        </MenuItem>
      </Menu>
    </Box>
  );
}
