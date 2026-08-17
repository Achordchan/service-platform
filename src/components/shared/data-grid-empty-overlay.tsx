import type { ReactNode } from "react";
import { EmptyState } from "@/components/shared/content-state";

export function gridNoRowsOverlay(title: string, icon?: ReactNode) {
  return function NoRowsOverlay() {
    return <EmptyState dense title={title} icon={icon} />;
  };
}
