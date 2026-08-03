"use client";

import { useCallback, useRef } from "react";
import {
  ConfirmProvider,
  useConfirm,
  type ConfirmOptions,
} from "material-ui-confirm";

export function AppConfirmProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConfirmProvider
      defaultOptions={{
        title: "确认操作",
        confirmationText: "确认",
        cancellationText: "取消",
        dialogProps: { fullWidth: true, maxWidth: "xs" },
        confirmationButtonProps: { variant: "contained" },
        cancellationButtonProps: { color: "inherit" },
      }}
    >
      {children}
    </ConfirmProvider>
  );
}

export function useAppConfirm() {
  const confirm = useConfirm();
  const pendingRef = useRef(false);

  return useCallback(
    async (options: ConfirmOptions) => {
      if (pendingRef.current) return false;
      pendingRef.current = true;
      try {
        return (await confirm(options)).confirmed;
      } finally {
        pendingRef.current = false;
      }
    },
    [confirm],
  );
}
