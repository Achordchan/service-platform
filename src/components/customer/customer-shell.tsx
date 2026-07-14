"use client";

import { resolveAvatarSrc } from "@/lib/default-avatar";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AppBar,
  Avatar,
  Box,
  Chip,
  Container,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";
import HomeWorkOutlinedIcon from "@mui/icons-material/HomeWorkOutlined";
import ManageAccountsOutlinedIcon from "@mui/icons-material/ManageAccountsOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import KeyboardArrowDownOutlinedIcon from "@mui/icons-material/KeyboardArrowDownOutlined";
import VerifiedIcon from "@mui/icons-material/Verified";
import type {
  CustomerSpaceOption,
  CustomerUser,
} from "@/components/customer/customer-types";
import { authClient } from "@/lib/auth-client";
import { NotificationMenu } from "@/components/shared/notification-menu";

const baseNavigation = [
  {
    href: "/customer/projects",
    label: "我的服务",
    icon: <HomeWorkOutlinedIcon fontSize="small" />,
  },
];

const roleLabel = {
  OWNER: "空间所有者",
  MEMBER: "空间成员",
} as const;

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
  const [accountAnchor, setAccountAnchor] = useState<null | HTMLElement>(null);
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? "");
  const canManageMembers = spaces.some((space) => space.role === "OWNER");
  const currentSpace = spaces.find((space) => space.id === spaceId) ?? spaces[0];
  const navigation = canManageMembers
    ? [
        ...baseNavigation,
        {
          href: "/customer/members",
          label: "成员管理",
          icon: <ManageAccountsOutlinedIcon fontSize="small" />,
        },
      ]
    : baseNavigation;

  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
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
              服务支持中心
            </Typography>

            <Stack
              direction="row"
              spacing={{ xs: 0.75, md: 1.25 }}
              sx={{ ml: "auto", alignItems: "center" }}
            >
              {spaces.length > 0 ? (
                <FormControl
                  size="small"
                  sx={{
                    display: { xs: "none", sm: "block" },
                    minWidth: 0,
                    maxWidth: 280,
                  }}
                >
                  <Select
                    value={spaceId}
                    onChange={(event) => setSpaceId(event.target.value)}
                    aria-label="当前客户空间"
                    renderValue={(value) => {
                      const space = spaces.find((item) => item.id === value);
                      return (
                        <Stack
                          direction="row"
                          spacing={0.75}
                          sx={{ alignItems: "center", minWidth: 0 }}
                        >
                          <VerifiedIcon
                            sx={{
                              fontSize: 18,
                              color: "#15803d",
                              flexShrink: 0,
                            }}
                          />
                          <Typography
                            noWrap
                            sx={{ fontWeight: 650, fontSize: 14, minWidth: 0 }}
                          >
                            {space?.name ?? "服务空间"}
                          </Typography>
                          <Chip
                            size="small"
                            icon={<VerifiedIcon sx={{ fontSize: "16px !important", color: "#16a34a !important" }} />}
                            label="已认证"
                            sx={{
                              height: 22,
                              fontWeight: 700,
                              fontSize: 11,
                              letterSpacing: "0.02em",
                              color: "#166534",
                              bgcolor: "#dcfce7",
                              border: "1px solid #86efac",
                              "& .MuiChip-icon": { ml: 0.5, mr: -0.25 },
                              "& .MuiChip-label": { px: 0.75 },
                            }}
                          />
                        </Stack>
                      );
                    }}
                    sx={{
                      height: 40,
                      borderRadius: 999,
                      bgcolor: "#f0fdf4",
                      minWidth: 210,
                      "& .MuiOutlinedInput-notchedOutline": {
                        borderColor: "#86efac",
                      },
                      "&:hover .MuiOutlinedInput-notchedOutline": {
                        borderColor: "#22c55e",
                      },
                      "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                        borderColor: "#16a34a",
                        borderWidth: 1,
                      },
                      "& .MuiSelect-select": {
                        py: 0.75,
                        pr: 4,
                        display: "flex",
                        alignItems: "center",
                      },
                    }}
                  >
                    {spaces.map((space) => (
                      <MenuItem key={space.id} value={space.id}>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: "center", minWidth: 0 }}
                        >
                          <VerifiedIcon
                            sx={{ fontSize: 18, color: "#15803d" }}
                          />
                          <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 650 }} noWrap>
                              {space.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              已认证服务空间
                              {space.role ? ` · ${roleLabel[space.role]}` : ""}
                            </Typography>
                          </Box>
                        </Stack>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              ) : null}
              <NotificationMenu staff={false} />
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
                  sx={{ width: 36, height: 36, bgcolor: "#e5e7eb" }}
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
            服务支持中心
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {currentSpace?.name ?? user.email}
          </Typography>
        </Box>
        <Divider />
        <List sx={{ px: 1.5 }}>
          {navigation.map((item) => (
            <ListItemButton
              key={item.href}
              component={Link}
              href={item.href}
              onClick={() => setDrawerOpen(false)}
              sx={{ borderRadius: 1.5, my: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 38 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
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
              sx={{ width: 40, height: 40, bgcolor: "#e5e7eb" }}
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
          href="/customer/projects"
          onClick={() => setAccountAnchor(null)}
        >
          我的服务
        </MenuItem>
        <MenuItem
          component={Link}
          href="/customer/account"
          onClick={() => setAccountAnchor(null)}
        >
          个人设置
        </MenuItem>
        {canManageMembers ? (
          <MenuItem
            component={Link}
            href="/customer/members"
            onClick={() => setAccountAnchor(null)}
          >
            成员管理
          </MenuItem>
        ) : null}
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
