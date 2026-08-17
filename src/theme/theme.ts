"use client";

import {
  createTheme,
  type PaletteOptions,
  type ThemeOptions,
} from "@mui/material/styles";
import type {} from "@mui/x-data-grid/themeAugmentation";
import { zhCN as dataGridZhCN } from "@mui/x-data-grid/locales";

const commonThemeOptions: ThemeOptions = {
  shape: {
    borderRadius: 10,
  },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    h1: { fontSize: "2rem", lineHeight: 1.25, fontWeight: 650 },
    h2: { fontSize: "1.5rem", lineHeight: 1.35, fontWeight: 650 },
    h3: { fontSize: "1.125rem", lineHeight: 1.45, fontWeight: 650 },
    h4: { fontSize: "1rem", lineHeight: 1.5, fontWeight: 650 },
    h5: { fontSize: "0.9375rem", lineHeight: 1.5, fontWeight: 650 },
    h6: { fontSize: "0.875rem", lineHeight: 1.5, fontWeight: 600 },
    subtitle1: { fontSize: "0.9375rem", lineHeight: 1.5, fontWeight: 600 },
    subtitle2: { fontSize: "0.8125rem", lineHeight: 1.5, fontWeight: 600 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 40,
          paddingInline: 18,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
        outlined: ({ theme }) => ({
          // 确保深色模式下 outlined Paper 不回退到 MUI 默认的白色 divider
          borderColor: theme.palette.divider,
          ...theme.applyStyles("dark", {
            borderColor: "rgba(255, 255, 255, 0.07)",
          }),
        }),
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: theme.palette.divider,
            ...theme.applyStyles("dark", {
              borderColor: "rgba(255, 255, 255, 0.09)",
            }),
          },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: theme.palette.primary.main,
          },
        }),
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderColor: theme.palette.divider,
          ...theme.applyStyles("dark", {
            borderColor: "rgba(255, 255, 255, 0.07)",
          }),
        }),
      },
    },
    MuiTextField: {
      defaultProps: {
        size: "small",
      },
    },
    MuiDialog: {
      styleOverrides: {
        container: ({ theme }) => ({
          [theme.breakpoints.down("sm")]: {
            alignItems: "flex-end",
          },
        }),
        paper: ({ theme }) => ({
          borderRadius: 14,
          border: `1px solid ${theme.palette.divider}`,
          boxShadow: "0 24px 80px rgba(16, 24, 40, 0.14)",
          ...theme.applyStyles("dark", {
            boxShadow: "0 24px 80px rgba(0, 0, 0, 0.42)",
          }),
          [theme.breakpoints.down("sm")]: {
            width: "100%",
            maxWidth: "100%",
            margin: 0,
            borderRadius: "14px 14px 0 0",
            maxHeight: "calc(100% - 56px)",
          },
        }),
      },
    },
    MuiDataGrid: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderColor: theme.palette.divider,
          "--DataGrid-rowBorderColor": theme.palette.divider,
        }),
        columnHeaders: ({ theme }) => ({
          backgroundColor: theme.palette.action.hover,
        }),
      },
    },
    MuiChip: {
      defaultProps: {
        size: "small",
      },
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 600,
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: ({ theme }) => ({
          minHeight: 40,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }),
        indicator: {
          height: 2.5,
          borderRadius: 2,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 40,
          textTransform: "none",
          fontWeight: 600,
        },
      },
    },
    MuiAvatar: {
      styleOverrides: {
        root: ({ theme }) => ({
          fontWeight: 650,
          fontSize: "0.85rem",
          backgroundColor: theme.palette.primary.light,
          color: theme.palette.primary.dark,
        }),
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: ({ theme }) => ({
          backgroundColor: theme.palette.mode === "dark"
            ? theme.palette.grey[700]
            : theme.palette.grey[800],
          fontSize: "0.75rem",
          borderRadius: 8,
        }),
      },
    },
    MuiToolbar: {
      styleOverrides: {
        root: {
          "&": { minHeight: 64 },
        },
      },
    },
  },
};

const lightPalette: PaletteOptions = {
  mode: "light",
  primary: {
    main: "#1677ff",
    dark: "#0b5fd7",
    light: "#eaf3ff",
  },
  background: {
    default: "#ffffff",
    paper: "#ffffff",
  },
  text: {
    primary: "#1d1d1f",
    secondary: "#667085",
  },
  divider: "#e5e7eb",
  success: { main: "#16a466" },
  warning: { main: "#d98b16" },
  error: { main: "#d14343" },
};

const darkPalette: PaletteOptions = {
  mode: "dark",
  primary: {
    main: "#5aa2ff",
    dark: "#2d7de0",
    light: "#d8e9ff",
  },
  background: {
    default: "#111418",
    paper: "#171b21",
  },
  text: {
    primary: "#f4f6f8",
    secondary: "#a7b0bf",
  },
  divider: "#262b33",
  success: { main: "#35bd7f" },
  warning: { main: "#e7a642" },
  error: { main: "#ef6b6b" },
};

export const appTheme = createTheme({
  cssVariables: {
    colorSchemeSelector: "data-mui-color-scheme",
  },
  ...commonThemeOptions,
  colorSchemes: {
    light: { palette: lightPalette },
    dark: { palette: darkPalette },
  },
}, dataGridZhCN);

export function createEmbedTheme(mode: "light" | "dark") {
  return createTheme({
    ...commonThemeOptions,
    palette: mode === "dark" ? darkPalette : lightPalette,
  });
}
