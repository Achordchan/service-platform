import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import type { Actor } from "@/lib/actor";
import { createCustomerSpace } from "@/modules/customer-spaces/customer-space-service";
import { acceptInvitation } from "@/modules/invitations/invitation-service";
import { createProject } from "@/modules/projects/project-service";
import {
  uploadRequestAttachment,
  readAttachmentDownload,
} from "@/modules/attachments/attachment-service";
import {
  createRequest,
  getRequest,
  listRequestsForActor,
} from "@/modules/requests/request-service";
import { addRequestMessage } from "@/modules/requests/request-command-service";
import { getProject } from "@/modules/projects/project-service";
import { listMiniappEvents } from "@/modules/miniapp/event-sync-service";
import { getMiniappSpaceMembers } from "@/modules/miniapp/space-members-service";

vi.mock("@/lib/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jobs")>();
  return {
    ...actual,
    assertMailDeliveryReady: vi.fn().mockResolvedValue("RESEND"),
    dispatchQueuedMailMessage: vi.fn().mockResolvedValue("test-job"),
  };
});

const ownerPool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL,
  max: 1,
});

const run = randomUUID().slice(0, 8);

async function selectActor(userId: string): Promise<Actor> {
  const row = (
    await ownerPool.query<{
      id: string;
      name: string;
      email: string;
      platformRole: Actor["platformRole"];
    }>(
      'SELECT id, name, email, "platformRole" FROM "User" WHERE id = $1',
      [userId],
    )
  ).rows[0]!;
  return { ...row, isPlatformAdmin: false, isStaff: false };
}

async function bootstrapSpace(name: string) {
  const email = `wx2-${name}-${run}@local.test`;
  const space = await createCustomerSpace(admin, {
    name: `双空间越权-${name}`,
    slug: `wx2-${name}-${run}`,
    ownerName: `空间${name}负责人`,
    ownerEmail: email,
    memberLimit: 2,
    status: "ACTIVE",
  });
  const outbox = await ownerPool.query<{ action_url: string }>(
    `SELECT "actionUrl" AS action_url FROM "MailMessage"
     WHERE "sourceType" = 'CUSTOMER_OWNER_INVITATION' AND "toEmail" = $1
     ORDER BY "createdAt" DESC LIMIT 1`,
    [email],
  );
  await acceptInvitation({
    token: new URL(outbox.rows[0]!.action_url).searchParams.get("token")!,
    name: `空间${name}负责人`,
    password: `pass-${run}-123456`,
  });
  const userId = (
    await ownerPool.query<{ id: string }>(
      'SELECT id FROM "User" WHERE email = $1',
      [email],
    )
  ).rows[0]!.id;
  return { email, spaceId: space.id, userId };
}

let admin: Actor;
let ownerA: Actor;
let ownerB: Actor;
const fixture = {
  spaceAId: "",
  spaceBId: "",
  projectAId: "",
  projectBId: "",
  categoryId: "",
  emails: [] as string[],
  spaceIds: [] as string[],
  projectIds: [] as string[],
};

beforeAll(async () => {
  const adminRow = (
    await ownerPool.query<{
      id: string;
      name: string;
      email: string;
      platformRole: Actor["platformRole"];
    }>(
      'SELECT id, name, email, "platformRole" FROM "User" WHERE email = \'admin@local.test\' LIMIT 1',
    )
  ).rows[0];
  if (!adminRow) {
    throw new Error("请先执行 pnpm test:integration:prepare 创建管理员测试账号");
  }
  admin = { ...adminRow, isPlatformAdmin: true, isStaff: true };

  const seo = (
    await ownerPool.query<{ id: string; category_id: string }>(
      `SELECT st.id, c.id AS category_id
       FROM "ServiceType" st
       JOIN "RequestCategory" c ON c."serviceTypeId" = st.id AND c.active = true
       WHERE st.key = 'seo' LIMIT 1`,
    )
  ).rows[0]!;
  fixture.categoryId = seo.category_id;

  const spaceA = await bootstrapSpace("a");
  const spaceB = await bootstrapSpace("b");
  fixture.spaceAId = spaceA.spaceId;
  fixture.spaceBId = spaceB.spaceId;
  fixture.emails = [spaceA.email, spaceB.email];
  fixture.spaceIds = [spaceA.spaceId, spaceB.spaceId];
  ownerA = await selectActor(spaceA.userId);
  ownerB = await selectActor(spaceB.userId);

  for (const [name, spaceId] of [
    ["a", spaceA.spaceId],
    ["b", spaceB.spaceId],
  ] as const) {
    const project = await createProject(admin, {
      title: `越权测试项目 ${name} ${run}`,
      customerSpaceId: spaceId,
      serviceTypeId: seo.id,
      customerRequestsEnabled: true,
    });
    await ownerPool.query(
      "UPDATE \"Project\" SET status = 'ACTIVE' WHERE id = $1",
      [project.id],
    );
    if (name === "a") fixture.projectAId = project.id;
    else fixture.projectBId = project.id;
    fixture.projectIds.push(project.id);
  }
});

afterAll(async () => {
  await ownerPool.query('DELETE FROM "Project" WHERE id = ANY($1::text[])', [
    fixture.projectIds,
  ]);
  await ownerPool.query('DELETE FROM "CustomerSpace" WHERE id = ANY($1::text[])', [
    fixture.spaceIds,
  ]);
  await ownerPool.query('DELETE FROM "User" WHERE email = ANY($1::text[])', [
    fixture.emails,
  ]);
  await ownerPool.query('DELETE FROM "MailMessage" WHERE "toEmail" = ANY($1::text[])', [
    fixture.emails,
  ]);
  await ownerPool.end();
});

function requestInput(suffix: string, key?: string) {
  return {
    title: `阶段2集成工单 ${suffix}`,
    description: "<p>用于双空间越权与幂等验证的测试工单。</p>",
    categoryId: fixture.categoryId,
    priority: "NORMAL" as const,
    ...(key ? { clientMutationKey: key } : {}),
  };
}

describe("小程序阶段2：工单幂等", () => {
  it("相同 clientMutationKey 重复创建返回同一工单，不同 key 产生新工单", async () => {
    const key = `it-create-${run}`;
    const first = await createRequest(
      ownerA,
      fixture.projectAId,
      requestInput("idem", key),
    );
    const second = await createRequest(
      ownerA,
      fixture.projectAId,
      requestInput("idem", key),
    );
    expect(second.id).toBe(first.id);
    expect(second.number).toBe(first.number);

    const different = await createRequest(
      ownerA,
      fixture.projectAId,
      requestInput("idem", `it-create2-${run}`),
    );
    expect(different.id).not.toBe(first.id);

    const withoutKey = await createRequest(
      ownerA,
      fixture.projectAId,
      requestInput("nokey"),
    );
    const storedKey = await ownerPool.query<{ key: string | null }>(
      'SELECT "clientMutationKey" AS key FROM "ServiceRequest" WHERE id = $1',
      [withoutKey.id],
    );
    expect(storedKey.rows[0]?.key).toBeNull();
  });

  it("相同 clientMutationKey 重复回复返回同一条消息", async () => {
    const created = await createRequest(
      ownerA,
      fixture.projectAId,
      requestInput("reply"),
    );
    const key = `it-msg-${run}`;
    const first = await addRequestMessage(ownerA, created.id, {
      body: "<p>幂等回复测试</p>",
      visibility: "CUSTOMER_VISIBLE",
      clientMutationKey: key,
    });
    const second = await addRequestMessage(ownerA, created.id, {
      body: "<p>幂等回复测试</p>",
      visibility: "CUSTOMER_VISIBLE",
      clientMutationKey: key,
    });
    expect(second.message.id).toBe(first.message.id);

    const another = await addRequestMessage(ownerA, created.id, {
      body: "<p>另一条回复</p>",
      visibility: "CUSTOMER_VISIBLE",
      clientMutationKey: `it-msg2-${run}`,
    });
    expect(another.message.id).not.toBe(first.message.id);
  });
});

describe("小程序阶段2：双 CustomerSpace 横向越权", () => {
  let requestBId = "";

  beforeAll(async () => {
    const created = await createRequest(
      ownerB,
      fixture.projectBId,
      requestInput("spaceB"),
    );
    requestBId = created.id;
  });

  it("客户 A 无法读取空间 B 的项目与工单详情", async () => {
    await expect(getProject(ownerA, fixture.projectBId)).rejects.toMatchObject({
      code: expect.any(String),
    });
    await expect(getRequest(ownerA, requestBId)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("客户 A 无法向空间 B 的工单回复", async () => {
    await expect(
      addRequestMessage(ownerA, requestBId, { body: "<p>越权回复</p>", visibility: "CUSTOMER_VISIBLE" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("跨项目列表只包含自己可见项目的工单，项目筛选同样隔离", async () => {
    const mine = await listRequestsForActor(ownerA);
    const mineIds = mine.requests.map((item) => item.id);
    expect(mineIds).not.toContain(requestBId);

    const scoped = await listRequestsForActor(ownerA, {
      projectId: fixture.projectAId,
    });
    expect(
      scoped.requests.every((item) => item.id !== requestBId),
    ).toBe(true);

    const inProjectB = await listRequestsForActor(ownerA, {
      projectId: fixture.projectBId,
    });
    expect(inProjectB.requests).toEqual([]);

    const theirs = await listRequestsForActor(ownerB, {
      projectId: fixture.projectBId,
    });
    expect(theirs.requests.map((item) => item.id)).toContain(requestBId);
  });

  it("客户 A 无法读取空间 B 工单的附件", async () => {
    const uploaded = await uploadRequestAttachment(ownerB, {
      fileName: `cross-space-${run}.txt`,
      claimedMimeType: "text/plain",
      buffer: new TextEncoder().encode("cross-space attachment test"),
      serviceRequestId: requestBId,
      visibility: "CUSTOMER_VISIBLE",
    });

    const byOwner = await readAttachmentDownload(ownerB, uploaded.id);
    expect(new TextDecoder().decode(byOwner.buffer)).toContain(
      "cross-space attachment test",
    );

    await expect(
      readAttachmentDownload(ownerA, uploaded.id),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("小程序阶段3补充：成员管理读取收口", () => {
  it("非 Owner 成员不能读取成员/邀请列表，Owner 可以", async () => {
    // 给空间 A 追加一个普通成员
    const memberEmail = `wx2-extra-${run}@local.test`;
    const extraUser = await ownerPool.query<{ id: string }>(
      `INSERT INTO "User" (id, name, email, "emailVerified", "platformRole", "createdAt", "updatedAt")
       VALUES ($1, '空间A普通成员', $2, true, 'CUSTOMER', NOW(), NOW()) RETURNING id`,
      [randomUUID(), memberEmail],
    );
    await ownerPool.query(
      `INSERT INTO "Membership" (id, "customerSpaceId", "userId", role, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'MEMBER', NOW(), NOW())`,
      [randomUUID(), fixture.spaceAId, extraUser.rows[0]!.id],
    );
    fixture.emails.push(memberEmail);
    const memberActor = await selectActor(extraUser.rows[0]!.id);

    await expect(
      getMiniappSpaceMembers(memberActor, fixture.spaceAId),
    ).rejects.toMatchObject({ status: 403 });

    const ownerView = await getMiniappSpaceMembers(ownerA, fixture.spaceAId);
    expect(ownerView.ownerId).toBe(ownerA.id);
    expect(
      ownerView.memberships.some((m) => m.user.email === memberEmail),
    ).toBe(true);
  });
});

describe("小程序阶段2：EventRecord 增量同步", () => {
  it("事件按 Actor 可见性隔离且游标增量正确", async () => {
    const cursorProbe = await listMiniappEvents(ownerA, 0n, 5);
    expect(typeof cursorProbe.cursor).toBe("string");

    const createdB = await createRequest(
      ownerB,
      fixture.projectBId,
      requestInput("eventB"),
    );
    const createdA = await createRequest(
      ownerA,
      fixture.projectAId,
      requestInput("eventA"),
    );

    const eventsA = await listMiniappEvents(ownerA, 0n, 200);
    const requestIdsA = eventsA.events
      .map((event) => event.serviceRequestId)
      .filter((value): value is string => Boolean(value));
    expect(requestIdsA).toContain(createdA.id);
    expect(requestIdsA).not.toContain(createdB.id);
    expect(
      eventsA.events.some(
        (event) => event.customerSpaceId === fixture.spaceBId,
      ),
    ).toBe(false);

    const eventsB = await listMiniappEvents(ownerB, 0n, 200);
    expect(
      eventsB.events.some((event) => event.serviceRequestId === createdB.id),
    ).toBe(true);

    // 游标增量：以 A 当前游标为起点，只应返回之后产生的事件
    const before = await listMiniappEvents(ownerA, 0n, 200);
    const cursor = BigInt(before.cursor);
    await addRequestMessage(ownerA, createdA.id, {
      body: "<p>触发增量事件</p>",
      visibility: "CUSTOMER_VISIBLE",
      clientMutationKey: `it-evt-${run}`,
    });
    const delta = await listMiniappEvents(ownerA, cursor, 200);
    expect(
      delta.events.every((event) => BigInt(event.id) > cursor),
    ).toBe(true);
    expect(
      delta.events.some(
        (event) => event.type === "REQUEST_MESSAGE_CREATED",
      ),
    ).toBe(true);
    // 增量不应回放 B 空间事件
    expect(
      delta.events.some(
        (event) => event.customerSpaceId === fixture.spaceBId,
      ),
    ).toBe(false);
  });
});
