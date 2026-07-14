import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { validateAttachmentFile } from "@/modules/attachments/attachment-validation";
import { writeAuditLog } from "@/modules/audit/audit-service";
import { badRequest } from "@/modules/requests/errors";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(60),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

function publicAvatarKey(userId: string, extension: string) {
  return path.posix.join("avatars", userId, `${randomUUID()}.${extension}`);
}

function publicAvatarRoot() {
  return path.resolve(process.cwd(), "public", "uploads");
}

async function writePublicAvatar(storageKey: string, buffer: Uint8Array) {
  const target = path.resolve(publicAvatarRoot(), storageKey);
  const root = publicAvatarRoot();
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("INVALID_AVATAR_PATH");
  }
  await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
  await writeFile(target, buffer, { flag: "wx", mode: 0o644 });
}

export function updateProfile(actor: Actor, input: UpdateProfileInput) {
  return withActorDb(actor, async (tx) => {
    const updated = await tx.user.update({
      where: { id: actor.id },
      data: { name: input.name },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        platformRole: true,
        updatedAt: true,
      },
    });
    await writeAuditLog(tx, actor, {
      action: "PROFILE_UPDATED",
      resourceType: "User",
      resourceId: actor.id,
      metadata: { name: updated.name },
    });
    return updated;
  });
}

export async function updateProfileAvatar(
  actor: Actor,
  file: {
    fileName: string;
    claimedMimeType?: string;
    buffer: Uint8Array;
  },
) {
  const validated = await validateAttachmentFile(
    file.buffer,
    file.claimedMimeType,
    file.fileName,
  );
  if (!validated.mimeType.startsWith("image/")) {
    throw badRequest("AVATAR_TYPE_NOT_ALLOWED", "头像仅支持 JPG、PNG、GIF、WebP");
  }
  if (file.buffer.byteLength > 2 * 1024 * 1024) {
    throw badRequest("AVATAR_TOO_LARGE", "头像大小不能超过 2MB");
  }

  const storageKey = publicAvatarKey(actor.id, validated.extension);
  await writePublicAvatar(storageKey, file.buffer);
  const publicPath = `/uploads/${storageKey}`;

  try {
    return await withActorDb(actor, async (tx) => {
      const previous = await tx.user.findUnique({
        where: { id: actor.id },
        select: { image: true },
      });
      const updated = await tx.user.update({
        where: { id: actor.id },
        data: { image: publicPath },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          platformRole: true,
          updatedAt: true,
        },
      });
      await writeAuditLog(tx, actor, {
        action: "PROFILE_AVATAR_UPDATED",
        resourceType: "User",
        resourceId: actor.id,
        metadata: {
          image: publicPath,
          previousImage: previous?.image ?? null,
        },
      });
      return updated;
    });
  } catch (error) {
    // best-effort cleanup for public avatar write
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(path.resolve(publicAvatarRoot(), storageKey));
    } catch {
      // ignore
    }
    throw error;
  }
}
