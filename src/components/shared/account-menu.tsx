"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Avatar,
  Box,
  Divider,
  ListItemIcon,
  Menu,
  MenuItem,
  Stack,
  type SxProps,
  type Theme,
  Typography,
} from "@mui/material";
import KeyboardArrowDownOutlinedIcon from "@mui/icons-material/KeyboardArrowDownOutlined";
import FeedbackOutlinedIcon from "@mui/icons-material/FeedbackOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import ManageAccountsOutlinedIcon from "@mui/icons-material/ManageAccountsOutlined";
import { resolveAvatarSrc } from "@/lib/default-avatar";
import { authClient } from "@/lib/auth-client";
import { useFeedbackDialog } from "@/components/shared/feedback-dialog-provider";

type AccountMenuUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

export function AccountMenu({
  user,
  accountHref,
  subtitle,
  avatarSx,
}: {
  user: AccountMenuUser;
  accountHref: string;
  subtitle?: ReactNode;
  avatarSx?: SxProps<Theme>;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const feedbackDialog = useFeedbackDialog();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);

  return (
    <>
      <Stack
        component="button"
        type="button"
        direction="row"
        spacing={1}
        aria-label={`${user.name} 账号菜单`}
        onClick={(event) => setAnchor(event.currentTarget)}
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
          sx={{ width: 36, height: 36, bgcolor: "action.selected", ...avatarSx }}
        >
          {user.name.slice(0, 1)}
        </Avatar>
        {subtitle ? (
          <Box sx={{ display: { xs: "none", sm: "block" }, textAlign: "left" }}>
            <Typography variant="body2" sx={{ fontWeight: 650 }}>
              {user.name}
            </Typography>
            {subtitle}
          </Box>
        ) : (
          <Typography sx={{ display: { xs: "none", md: "block" } }}>
            {user.name}
          </Typography>
        )}
        <KeyboardArrowDownOutlinedIcon
          fontSize="small"
          sx={{ display: { xs: "none", md: "block" } }}
        />
      </Stack>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        slotProps={{ paper: { sx: { minWidth: 280 } } }}
      >
        <Box sx={{ px: 2, py: 1.75, maxWidth: 320 }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
            <Avatar
              src={resolveAvatarSrc(user.image, user.name, user.id)}
              alt={user.name}
              sx={{ width: 40, height: 40, bgcolor: "action.selected", ...avatarSx }}
            >
              {user.name.slice(0, 1)}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 650 }} noWrap>
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
          href={accountHref}
          onClick={() => setAnchor(null)}
        >
          <ListItemIcon>
            <ManageAccountsOutlinedIcon fontSize="small" />
          </ListItemIcon>
          个人设置
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            feedbackDialog.open();
          }}
        >
          <ListItemIcon>
            <FeedbackOutlinedIcon fontSize="small" />
          </ListItemIcon>
          意见反馈
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
    </>
  );
}
