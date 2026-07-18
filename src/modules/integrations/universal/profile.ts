import type { UniversalProfileField } from "@/modules/integrations/universal/schemas";
import { DomainError } from "@/modules/projects/errors";

const RESERVED_PROFILE_KEYS = new Set([
  "id",
  "name",
  "email",
  "username",
  "avatar_url",
  "token",
  "secret",
  "password",
  "api_key",
  "client_secret",
]);

export function normalizeUniversalProfileFields(fields: UniversalProfileField[]) {
  const keys = new Set<string>();
  for (const field of fields) {
    if (RESERVED_PROFILE_KEYS.has(field.key)) {
      throw new DomainError(
        "RESERVED_PROFILE_FIELD",
        `资料字段 ${field.key} 为系统保留字段`,
        422,
      );
    }
    if (keys.has(field.key)) {
      throw new DomainError(
        "DUPLICATE_PROFILE_FIELD",
        `资料字段 ${field.key} 重复`,
        422,
      );
    }
    keys.add(field.key);
  }
  return fields;
}

export function validateUniversalProfileAttributes(
  attributes: Record<string, string | number | boolean>,
  fields: UniversalProfileField[],
) {
  const definitions = new Map(fields.map((field) => [field.key, field]));
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    const field = definitions.get(key);
    if (!field) {
      throw new DomainError(
        "UNDECLARED_PROFILE_ATTRIBUTE",
        `用户资料字段 ${key} 未在连接中声明`,
        422,
      );
    }
    const valid =
      (field.type === "text" && typeof value === "string") ||
      (field.type === "number" && typeof value === "number") ||
      (field.type === "boolean" && typeof value === "boolean") ||
      (field.type === "date" &&
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) &&
        Number.isFinite(Date.parse(value)));
    if (!valid) {
      throw new DomainError(
        "INVALID_PROFILE_ATTRIBUTE",
        `用户资料字段 ${field.label} 类型不正确`,
        422,
      );
    }
    result[key] = value;
  }
  return result;
}
