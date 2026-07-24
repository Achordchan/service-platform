import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth } from "@/lib/auth";

const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});
const missingEmail = `missing-${randomUUID()}@example.com`;
const pendingEmail = `pending-${randomUUID()}@example.com`;
const pendingUserId = randomUUID();
const authBaseUrl =
  process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";

beforeAll(async () => {
  await ownerPool.query('DELETE FROM "User" WHERE email = ANY($1::text[])', [
    [missingEmail, pendingEmail],
  ]);
  await ownerPool.query(
    `INSERT INTO "User" (
       id, name, email, "emailVerified", "platformRole", "createdAt", "updatedAt"
     ) VALUES ($1, '待接受邀请客户', $2, false, 'CUSTOMER', NOW(), NOW())`,
    [pendingUserId, pendingEmail],
  );
});

afterAll(async () => {
  await ownerPool.query('DELETE FROM "Verification" WHERE identifier LIKE $1', [
    `%${missingEmail}%`,
  ]);
  await ownerPool.query('DELETE FROM "MailMessage" WHERE "toEmail" = $1', [
    missingEmail,
  ]);
  await ownerPool.query('DELETE FROM "Verification" WHERE identifier LIKE $1', [
    `%${pendingEmail}%`,
  ]);
  await ownerPool.query('DELETE FROM "MailMessage" WHERE "toEmail" = $1', [
    pendingEmail,
  ]);
  await ownerPool.query('DELETE FROM "User" WHERE id = $1', [pendingUserId]);
  await ownerPool.end();
});

describe("邮箱验证码登录账号校验", () => {
  it("不存在的邮箱返回明确错误且不创建验证码或邮件", async () => {
    const response = await auth.handler(
      new Request(
        `${authBaseUrl}/api/auth/email-otp/send-verification-otp`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: authBaseUrl,
          },
          body: JSON.stringify({ email: missingEmail, type: "sign-in" }),
        },
      ),
    );
    const body = (await response.json()) as { code?: string; message?: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("EMAIL_NOT_FOUND");
    expect(body.message).toBe("邮箱不存在");

    const verification = await ownerPool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "Verification" WHERE identifier LIKE $1',
      [`%${missingEmail}%`],
    );
    const mail = await ownerPool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "MailMessage" WHERE "toEmail" = $1',
      [missingEmail],
    );
    expect(verification.rows[0]?.count).toBe("0");
    expect(mail.rows[0]?.count).toBe("0");
  });

  it("尚未接受邀请的预建客户账号不能绕过邀请直接验证码登录", async () => {
    const response = await auth.handler(
      new Request(
        `${authBaseUrl}/api/auth/email-otp/send-verification-otp`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: authBaseUrl,
          },
          body: JSON.stringify({ email: pendingEmail, type: "sign-in" }),
        },
      ),
    );
    const body = (await response.json()) as { code?: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe("EMAIL_NOT_FOUND");

    const verification = await ownerPool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "Verification" WHERE identifier LIKE $1',
      [`%${pendingEmail}%`],
    );
    const mail = await ownerPool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "MailMessage" WHERE "toEmail" = $1',
      [pendingEmail],
    );
    expect(verification.rows[0]?.count).toBe("0");
    expect(mail.rows[0]?.count).toBe("0");
  });
});
