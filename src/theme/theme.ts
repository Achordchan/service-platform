"use client";

import { createTheme } from "@mui/material/styles";
import type {} from "@mui/x-data-grid/themeAugmentation";

export const appTheme = createTheme({
  cssVariables: true,
  palette: {
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
  },
  shape: {
    borderRadius: 10,
  },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    h1: { fontSize: "2rem", lineHeight: 1.25, fontWeight: 650 },
    h2: { fontSize: "1.5rem", lineHeight: 1.35, fontWeight: 650 },
    h3: { fontSize: "1.125rem", lineHeight: 1.45, fontWeight: 650 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 40,
          borderRadius: 9,
          paddingInline: 18,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        size: "small",
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 14,
          border: "1px solid #e5e7eb",
          boxShadow: "0 24px 80px rgba(16, 24, 40, 0.14)",
        },
      },
    },
    MuiDataGrid: {
      styleOverrides: {
        root: {
          borderColor: "#e5e7eb",
          "--DataGrid-rowBorderColor": "#eef0f3",
        },
        columnHeaders: {
          backgroundColor: "#fafbfc",
        },
      },
    },
  },
});
