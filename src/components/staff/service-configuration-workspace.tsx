"use client";

import { useState } from "react";
import { Box, Tab, Tabs } from "@mui/material";
import { ServiceTypeManager } from "@/components/staff/service-type-manager";
import type { ServiceTypeItem } from "@/components/staff/staff-types";
import { SupportPlaybookManager } from "@/components/staff/support-playbook-manager";
import type { SupportReplyPlaybookView } from "@/lib/support-reply-playbooks";

export function ServiceConfigurationWorkspace({
  serviceTypes,
  playbooks,
}: {
  serviceTypes: ServiceTypeItem[];
  playbooks: SupportReplyPlaybookView[];
}) {
  const [tab, setTab] = useState<"services" | "playbooks">("services");

  return (
    <>
      <Tabs value={tab} onChange={(_event, value) => setTab(value)}>
        <Tab value="services" label="服务类型与分类" />
        <Tab value="playbooks" label="回复助手" />
      </Tabs>
      <Box sx={{ pt: 2.5 }}>
        {tab === "services" ? (
          <ServiceTypeManager serviceTypes={serviceTypes} />
        ) : (
          <SupportPlaybookManager initialPlaybooks={playbooks} />
        )}
      </Box>
    </>
  );
}
