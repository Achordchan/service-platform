import "server-only";

import {
  queueImageWebpAttachment,
} from "@/lib/jobs";
import { withSystemDb } from "@/lib/system-db";
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";
import { IMAGE_WEBP_PLUGIN_KEY } from "@/modules/plugins/plugin-registry";

export async function scheduleAttachmentPluginJobs(attachmentId: string) {
  try {
    await ensurePluginInstallations();
    const enabled = await withSystemDb((tx) =>
      tx.pluginInstallation.findUnique({
        where: { key: IMAGE_WEBP_PLUGIN_KEY },
        select: { enabled: true },
      }),
    );
    if (!enabled?.enabled) return;
    await queueImageWebpAttachment(attachmentId);
  } catch (error) {
    console.error("PLUGIN_ATTACHMENT_JOB_QUEUE_FAILED", {
      attachmentId,
      pluginKey: IMAGE_WEBP_PLUGIN_KEY,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
