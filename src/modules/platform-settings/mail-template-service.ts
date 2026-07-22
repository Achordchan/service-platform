import "server-only";

import type { Actor } from "@/lib/actor";
import { withActorDb } from "@/lib/actor";
import { withSystemDb } from "@/lib/system-db";
import { writeAuditLog } from "@/modules/audit/audit-service";
import {
  getMailTemplateDefinition,
  isMailTemplateKey,
  listMailTemplateDefinitions,
  normalizeMailActionUrl,
  renderTemplateContent,
  sampleVariablesForTemplate,
  validateTemplatePlaceholders,
  type MailTemplateContent,
  type MailTemplateKey,
} from "@/modules/platform-settings/mail-template-catalog";
import { DomainError, assertAllowed } from "@/modules/projects/errors";

function requireTemplateKey(value: string): MailTemplateKey {
  if (!isMailTemplateKey(value)) {
    throw new DomainError(
      "MAIL_TEMPLATE_NOT_FOUND",
      "邮件模板不存在",
      404,
    );
  }
  return value;
}

function effectiveContent(
  key: MailTemplateKey,
  override?: MailTemplateContent | null,
) {
  return override ?? getMailTemplateDefinition(key).defaults;
}

export async function buildTemplateMail(input: {
  key: MailTemplateKey;
  variables: Record<string, string>;
  actionUrl?: string;
}) {
  return withSystemDb((tx) => buildTemplateMailInTx(tx, input));
}

export async function buildTemplateMailInTx(
  tx: Parameters<Parameters<typeof withSystemDb>[0]>[0],
  input: {
    key: MailTemplateKey;
    variables: Record<string, string>;
    actionUrl?: string;
  },
) {
  const override = await tx.mailTemplateOverride.findUnique({
    where: { key: input.key },
  });
  const content = effectiveContent(input.key, override);
  const rendered = renderTemplateContent(input.key, content, input.variables);
  return {
    templateKey: input.key,
    ...rendered,
    actionUrl: rendered.actionLabel
      ? normalizeMailActionUrl(input.actionUrl)
      : null,
  };
}

export async function listMailTemplates(actor: Actor) {
  assertAllowed(actor.isPlatformAdmin);
  const overrides = await withActorDb(actor, (tx) =>
    tx.mailTemplateOverride.findMany(),
  );
  const overrideByKey = new Map(
    overrides.map((override) => [override.key, override]),
  );

  return listMailTemplateDefinitions().map((definition) => {
    const override = overrideByKey.get(definition.key);
    const content = effectiveContent(definition.key, override);
    return {
      key: definition.key,
      name: definition.name,
      description: definition.description,
      variables: definition.variables,
      content,
      preview: renderTemplateContent(
        definition.key,
        content,
        sampleVariablesForTemplate(definition.key),
      ),
      customized: Boolean(override),
      updatedAt: override?.updatedAt.toISOString() ?? null,
    };
  });
}

export async function updateMailTemplate(
  actor: Actor,
  templateKey: string,
  content: MailTemplateContent,
) {
  assertAllowed(actor.isPlatformAdmin);
  const key = requireTemplateKey(templateKey);
  try {
    validateTemplatePlaceholders(key, content);
    renderTemplateContent(key, content, sampleVariablesForTemplate(key));
  } catch (error) {
    throw new DomainError(
      "MAIL_TEMPLATE_INVALID",
      error instanceof Error ? error.message : "邮件模板无效",
      422,
    );
  }

  await withActorDb(actor, async (tx) => {
    await tx.mailTemplateOverride.upsert({
      where: { key },
      create: {
        key,
        ...content,
        updatedById: actor.id,
      },
      update: {
        ...content,
        updatedById: actor.id,
      },
    });
    await writeAuditLog(tx, actor, {
      action: "MAIL_TEMPLATE_UPDATED",
      resourceType: "MailTemplateOverride",
      resourceId: key,
      metadata: { templateKey: key },
    });
  });
  return listMailTemplates(actor);
}

export async function resetMailTemplate(
  actor: Actor,
  templateKey: string,
) {
  assertAllowed(actor.isPlatformAdmin);
  const key = requireTemplateKey(templateKey);
  await withActorDb(actor, async (tx) => {
    await tx.mailTemplateOverride.deleteMany({ where: { key } });
    await writeAuditLog(tx, actor, {
      action: "MAIL_TEMPLATE_RESET",
      resourceType: "MailTemplateOverride",
      resourceId: key,
      metadata: { templateKey: key },
    });
  });
  return listMailTemplates(actor);
}
