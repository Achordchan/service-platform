import "server-only";

import {
  queueImageWebpAttachment,
} from "@/lib/jobs";
import { withSystemDb } from "@/lib/system-db";
import { ensurePluginInstallations } from "@/modules/plugins/plugin-installation-service";
import { IMAGE_WEBP_PLUGIN_KEY } from "@/modules/plugins/plugin-registry";
import { reportSystemError } from "@/lib/system-error-log";

export async function scheduleAttachmentPluginJobs(attachmentId: string) {
  try {
    await ensurePluginInstallations();
    const installation = await withSystemDb((tx) =>
      tx.pluginInstallation.findUnique({
        where: { key: IMAGE_WEBP_PLUGIN_KEY },
        select: { enabled: true, healthStatus: true },
      }),
    );
    if (
      !installation?.enabled ||
      installation.healthStatus !== "READY"
    ) {
      return;
    }
    await queueImageWebpAttachment(attachmentId);
  } catch (error) {
    reportSystemError(error, {
      source: "plugin-scheduler",
      operation: "plugin.attachment_job_queue_failed",
      context: { attachmentId, pluginKey: IMAGE_WEBP_PLUGIN_KEY },
      logLabel: "PLUGIN_ATTACHMENT_JOB_QUEUE_FAILED",
    });
  }
}
