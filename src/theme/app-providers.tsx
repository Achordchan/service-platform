"use client";

import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { zhCN as datePickerZhCN } from "@mui/x-date-pickers/locales";
import { zhCN as dateFnsZhCN } from "date-fns/locale/zh-CN";
import { AppConfirmProvider } from "@/components/shared/confirm-provider";
import { FeedbackDialogProvider } from "@/components/shared/feedback-dialog-provider";
import { ToastProvider } from "@/components/shared/toast-provider";
import { QueryProvider } from "@/theme/query-provider";
import { appTheme } from "@/theme/theme";
import { THEME_MODE_STORAGE_KEY } from "@/theme/theme-mode";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
      <ThemeProvider
        theme={appTheme}
        defaultMode="system"
        modeStorageKey={THEME_MODE_STORAGE_KEY}
        disableTransitionOnChange
      >
        <CssBaseline enableColorScheme />
        <LocalizationProvider
          dateAdapter={AdapterDateFns}
          adapterLocale={dateFnsZhCN}
          localeText={
            datePickerZhCN.components.MuiLocalizationProvider.defaultProps
              .localeText
          }
        >
          <QueryProvider>
            <AppConfirmProvider>
              <ToastProvider>
                <FeedbackDialogProvider>
                  {children}
                </FeedbackDialogProvider>
              </ToastProvider>
            </AppConfirmProvider>
          </QueryProvider>
        </LocalizationProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
