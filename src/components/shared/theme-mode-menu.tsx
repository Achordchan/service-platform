"use client";

import { useEffect, useRef, useState } from "react";
import CheckOutlinedIcon from "@mui/icons-material/CheckOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import SettingsBrightnessOutlinedIcon from "@mui/icons-material/SettingsBrightnessOutlined";
import {
  CircularProgress,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
} from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import { useToast } from "@/components/shared/toast-provider";
import {
  themePreferenceToMode,
  type ThemePreference,
} from "@/theme/theme-mode";

const options: Array<{
  value: ThemePreference;
  label: string;
  icon: React.ReactElement;
}> = [
  {
    value: "SYSTEM",
    label: "跟随系统",
    icon: <SettingsBrightnessOutlinedIcon fontSize="small" />,
  },
  {
    value: "LIGHT",
    label: "浅色",
    icon: <LightModeOutlinedIcon fontSize="small" />,
  },
  {
    value: "DARK",
    label: "深色",
    icon: <DarkModeOutlinedIcon fontSize="small" />,
  },
];

export function ThemeModeMenu({
  initialPreference,
}: {
  initialPreference: ThemePreference;
}) {
  const toast = useToast();
  const { setMode } = useColorScheme();
  const [preference, setPreference] = useState(initialPreference);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  const initialModeSynced = useRef(false);
  const current =
    options.find((option) => option.value === preference) ?? options[0];

  useEffect(() => {
    if (initialModeSynced.current) return;
    initialModeSynced.current = true;
    setMode(themePreferenceToMode(initialPreference));
  }, [initialPreference, setMode]);

  async function selectPreference(next: ThemePreference) {
    setAnchorEl(null);
    if (next === preference || saving) return;
    const previous = preference;
    setPreference(next);
    setMode(themePreferenceToMode(next));
    setSaving(true);
    try {
      const response = await fetch("/api/v1/me/appearance-preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themePreference: next }),
      });
      const result = (await response.json()) as {
        data?: { themePreference: ThemePreference };
        error?: { message?: string };
      };
      if (!response.ok || !result.data) {
        throw new Error(result.error?.message || "外观设置保存失败");
      }
      setPreference(result.data.themePreference);
      setMode(themePreferenceToMode(result.data.themePreference));
    } catch (error) {
      setPreference(previous);
      setMode(themePreferenceToMode(previous));
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Tooltip title={`外观：${current.label}`}>
        <span>
          <IconButton
            aria-label={`切换外观，当前${current.label}`}
            onClick={(event) => setAnchorEl(event.currentTarget)}
            disabled={saving}
            sx={{ width: 40, height: 40 }}
          >
            {saving ? <CircularProgress size={20} /> : current.icon}
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        slotProps={{ paper: { sx: { minWidth: 180 } } }}
      >
        {options.map((option) => (
          <MenuItem
            key={option.value}
            selected={option.value === preference}
            onClick={() => void selectPreference(option.value)}
          >
            <ListItemIcon>{option.icon}</ListItemIcon>
            <ListItemText>{option.label}</ListItemText>
            {option.value === preference ? (
              <CheckOutlinedIcon fontSize="small" color="primary" />
            ) : null}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
