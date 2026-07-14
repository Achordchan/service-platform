"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AppBar,
  Avatar,
  Box,
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
  Tooltip,
  Typography,
} from "@mui/material";
import ApartmentOutlinedIcon from "@mui/icons-material/ApartmentOutlined";
import BusinessCenterOutlinedIcon from "@mui/icons-material/BusinessCenterOutlined";
import CategoryOutlinedIcon from "@mui/icons-material/CategoryOutlined";
import ChevronLeftOutlinedIcon from "@mui/icons-material/ChevronLeftOutlined";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import KeyboardArrowDownOutlinedIcon from "@mui/icons-material/KeyboardArrowDownOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import SupportAgentOutlinedIcon from "@mui/icons-material/SupportAgentOutlined";
import type { StaffUser } from "@/components/staff/staff-types";
import { resolveAvatarSrc } from "@/lib/default-avatar";
import { authClient } from "@/lib/auth-client";
import { NotificationMenu } from "@/components/shared/notification-menu";

const drawerWidth = 224;

const primaryNavigation = [
  {
    href: "/staff/projects",
    label: "项目",
    icon: <BusinessCenterOutlinedIcon fontSize="small" />,
  },
  {
    href: "/staff/requests",
    label: "服务请求",
    icon: <SupportAgentOutlinedIcon fontSize="small" />,
  },
];

const adminNavigation = [
  {
    href: "/staff/customers",
    label: "客户",
    icon: <ApartmentOutlinedIcon fontSize="small" />,
  },
  {
    href: "/staff/team",
    label: "团队成员",
    icon: <GroupOutlinedIcon fontSize="small" />,
  },
  {
    href: "/staff/service-types",
    label: "服务类型",
    icon: <CategoryOutlinedIcon fontSize="small" />,
  },
  {
    href: "/staff/settings",
    label: "平台设置",
    icon: <SettingsOutlinedIcon fontSize="small" />,
  },
];

const roleLabels = {
  PLATFORM_ADMIN: "平台管理员",
  PROJECT_MANAGER: "项目负责人",
  TECHNICIAN: "技术人员",
};

export function StaffShell({
  user,
  children,
}: {
  user: StaffUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [accountAnchor, setAccountAnchor] = useState<null | HTMLElement>(null);
  const navigation =
    user.role === "PLATFORM_ADMIN"
      ? [...primaryNavigation, ...adminNavigation]
      : primaryNavigation;
  const currentWidth = collapsed ? 76 : drawerWidth;

  const navigationList = (
    <Stack sx={{ height: "100%" }}>
      <Toolbar
        sx={{
          minHeight: "72px !important",
          px: collapsed ? 1.5 : 2.5,
          justifyContent: collapsed ? "center" : "flex-start",
        }}
      >
        <DashboardOutlinedIcon color="primary" />
        {!collapsed ? (
          <Typography
            component={Link}
            href="/staff/projects"
            sx={{
              ml: 1.25,
              color: "primary.main",
              fontSize: 20,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            服务管理后台
          </Typography>
        ) : null}
      </Toolbar>
      <Divider />
      <List sx={{ px: 1, py: 2 }}>
        {navigation.map((item) => {
          const selected =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Tooltip
              key={item.href}
              title={collapsed ? item.label : ""}
              placement="right"
            >
              <ListItemButton
                component={Link}
                href={item.href}
                selected={selected}
                onClick={() => setMobileOpen(false)}
                sx={{
                  minHeight: 44,
                  px: collapsed ? 1.5 : 2,
                  my: 0.5,
                  borderRadius: 1.5,
                  justifyContent: collapsed ? "center" : "flex-start",
                  "&.Mui-selected": {
                    bgcolor: "#eaf2ff",
                    color: "primary.main",
                  },
                }}
              >
                <ListItemIcon
                  sx={{
                    minWidth: collapsed ? 0 : 38,
                    color: "inherit",
                    justifyContent: "center",
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                {!collapsed ? <ListItemText primary={item.label} /> : null}
              </ListItemButton>
            </Tooltip>
          );
        })}
      </List>
      <Box sx={{ mt: "auto", p: 1 }}>
        <Tooltip title={collapsed ? "展开侧栏" : "收起侧栏"} placement="right">
          <ListItemButton
            onClick={() => setCollapsed((value) => !value)}
            sx={{
              display: { xs: "none", md: "flex" },
              minHeight: 44,
              borderRadius: 1.5,
              justifyContent: collapsed ? "center" : "flex-end",
            }}
          >
            <ChevronLeftOutlinedIcon
              sx={{
                transform: collapsed ? "rotate(180deg)" : "none",
                transition: "transform 160ms ease",
              }}
            />
          </ListItemButton>
        </Tooltip>
      </Box>
    </Stack>
  );

  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100dvh",
        bgcolor: "background.default",
      }}
    >
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: "none", md: "block" },
          width: currentWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: {
            width: currentWidth,
            boxSizing: "border-box",
            borderRightColor: "divider",
            position: "relative",
            transition: "width 160ms ease",
            overflowX: "hidden",
          },
        }}
      >
        {navigationList}
      </Drawer>
      <Drawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { md: "none" } }}
        slotProps={{ paper: { sx: { width: drawerWidth } } }}
      >
        {navigationList}
      </Drawer>

      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <AppBar
          position="sticky"
          color="inherit"
          elevation={0}
          sx={{
            borderBottom: "1px solid",
            borderColor: "divider",
            bgcolor: "background.paper",
          }}
        >
          <Toolbar sx={{ minHeight: "72px !important", px: { xs: 2, md: 3 } }}>
            <IconButton
              aria-label="打开导航"
              onClick={() => {
                setCollapsed(false);
                setMobileOpen(true);
              }}
              sx={{ display: { md: "none" }, mr: 1 }}
            >
              <MenuOutlinedIcon />
            </IconButton>
            <Typography
              sx={{
                display: { xs: "block", md: "none" },
                fontWeight: 700,
                fontSize: 18,
              }}
            >
              服务管理后台
            </Typography>
            <Stack
              direction="row"
              spacing={{ xs: 0.5, sm: 1.5 }}
              sx={{ ml: "auto", alignItems: "center" }}
            >
              <NotificationMenu staff />
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
                  sx={{
                    width: 36,
                    height: 36,
                    bgcolor: "#dbeafe",
                    color: "#1769d2",
                  }}
                >
                  {user.name.slice(0, 1)}
                </Avatar>
                <Box
                  sx={{
                    display: { xs: "none", sm: "block" },
                    textAlign: "left",
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>
                    {user.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {roleLabels[user.role]}
                  </Typography>
                </Box>
                <KeyboardArrowDownOutlinedIcon
                  fontSize="small"
                  sx={{ display: { xs: "none", sm: "block" } }}
                />
              </Stack>
            </Stack>
          </Toolbar>
        </AppBar>

        <Box component="main" sx={{ flex: 1, minWidth: 0 }}>
          {children}
        </Box>
      </Box>

      <Menu
        anchorEl={accountAnchor}
        open={Boolean(accountAnchor)}
        onClose={() => setAccountAnchor(null)}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
      >
        <MenuItem disabled>{user.email}</MenuItem>
        <MenuItem
          component={Link}
          href="/staff/account"
          onClick={() => setAccountAnchor(null)}
        >
          个人设置
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={async () => {
            await authClient.signOut();
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
