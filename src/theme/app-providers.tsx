"use client";

import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { ToastProvider } from "@/components/shared/toast-provider";
import { appTheme } from "@/theme/theme";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
      <ThemeProvider theme={appTheme}>
        <CssBaseline />
        <ToastProvider>{children}</ToastProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
