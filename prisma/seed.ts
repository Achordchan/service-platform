import { hashPassword } from "better-auth/crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  type PlatformRole,
} from "../src/generated/prisma/client";

const databaseUrl =
  process.env.DATABASE_MIGRATION_URL ??
  "postgresql://a1234@localhost:5438/service_platform?schema=public";
const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
const password = "ServiceDemo!2026";

async function upsertUser(
  email: string,
  name: string,
  platformRole: PlatformRole,
) {
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, platformRole, emailVerified: true },
    create: { email, name, platformRole, emailVerified: true },
  });
  await prisma.account.upsert({
    where: {
      providerId_accountId: {
        providerId: "credential",
        accountId: user.id,
      },
    },
    update: { password: passwordHash },
    create: {
      providerId: "credential",
      accountId: user.id,
      userId: user.id,
      password: passwordHash,
    },
  });
  return user;
}

async function main() {
  await prisma.platformSetting.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      appUrl: process.env.APP_URL ?? "http://localhost:3000",
      mailMode: "LOCAL_OUTBOX",
      smtpFrom: "服务支持中心 <info@achord.cn>",
      smtpSecure: false,
    },
  });

  const admin = await upsertUser(
    "admin@local.test",
    "陈经理",
    "PLATFORM_ADMIN",
  );
  const manager = await upsertUser(
    "manager@local.test",
    "王专员",
    "PROJECT_MANAGER",
  );
  const technician = await upsertUser(
    "tech@local.test",
    "李工程师",
    "TECHNICIAN",
  );
  const client = await upsertUser(
    "client@local.test",
    "张伟",
    "CUSTOMER",
  );
  const clientMember = await upsertUser(
    "client2@local.test",
    "刘敏",
    "CUSTOMER",
  );

  const space = await prisma.customerSpace.upsert({
    where: { slug: "vision-tech" },
    update: { name: "远景科技", ownerId: client.id, memberLimit: 2 },
    create: {
      name: "远景科技",
      slug: "vision-tech",
      ownerId: client.id,
      memberLimit: 2,
    },
  });

  await prisma.membership.upsert({
    where: {
      customerSpaceId_userId: {
        customerSpaceId: space.id,
        userId: client.id,
      },
    },
    update: { role: "OWNER" },
    create: {
      customerSpaceId: space.id,
      userId: client.id,
      role: "OWNER",
    },
  });
  await prisma.membership.upsert({
    where: {
      customerSpaceId_userId: {
        customerSpaceId: space.id,
        userId: clientMember.id,
      },
    },
    update: { role: "MEMBER" },
    create: {
      customerSpaceId: space.id,
      userId: clientMember.id,
      role: "MEMBER",
    },
  });

  const seo = await prisma.serviceType.upsert({
    where: { key: "seo" },
    update: {
      name: "SEO 项目",
      description: "收录、排名与站点优化服务",
      active: true,
    },
    create: {
      key: "seo",
      name: "SEO 项目",
      description: "收录、排名与站点优化服务",
    },
  });
  await prisma.serviceType.upsert({
    where: { key: "api-support" },
    update: {
      name: "API 技术支持",
      description: "接口接入、调用问题与技术咨询",
      active: true,
    },
    create: {
      key: "api-support",
      name: "API 技术支持",
      description: "接口接入、调用问题与技术咨询",
    },
  });

  const contentCategory = await prisma.requestCategory.upsert({
    where: {
      serviceTypeId_name: {
        serviceTypeId: seo.id,
        name: "内容优化咨询",
      },
    },
    update: { active: true },
    create: {
      serviceTypeId: seo.id,
      name: "内容优化咨询",
    },
  });
  const technicalCategory = await prisma.requestCategory.upsert({
    where: {
      serviceTypeId_name: {
        serviceTypeId: seo.id,
        name: "技术问题排查",
      },
    },
    update: { active: true },
    create: {
      serviceTypeId: seo.id,
      name: "技术问题排查",
    },
  });

  let project = await prisma.project.findFirst({
    where: { customerSpaceId: space.id, title: "官网 SEO 优化服务" },
  });
  project = project
    ? await prisma.project.update({
        where: { id: project.id },
        data: {
          status: "ACTIVE",
          currentStage: "站点优化",
          startDate: new Date("2026-07-01"),
          endDate: new Date("2026-12-31"),
        },
      })
    : await prisma.project.create({
        data: {
          title: "官网 SEO 优化服务",
          description: "围绕站点技术、页面内容和收录表现持续优化。",
          status: "ACTIVE",
          currentStage: "站点优化",
          startDate: new Date("2026-07-01"),
          endDate: new Date("2026-12-31"),
          customerSpaceId: space.id,
          serviceTypeId: seo.id,
          createdById: admin.id,
        },
      });

  for (const assignment of [
    { userId: manager.id, role: "PROJECT_MANAGER" as const },
    { userId: technician.id, role: "TECHNICIAN" as const },
  ]) {
    await prisma.projectStaff.upsert({
      where: {
        projectId_userId: { projectId: project.id, userId: assignment.userId },
      },
      update: { role: assignment.role },
      create: { projectId: project.id, ...assignment },
    });
  }

  await prisma.milestone.deleteMany({ where: { projectId: project.id } });
  await prisma.milestone.createMany({
    data: [
      {
        projectId: project.id,
        createdById: manager.id,
        title: "项目启动",
        description: "明确项目目标与范围，完成资料对接与权限开通。",
        status: "COMPLETED",
        sortOrder: 1,
        endDate: new Date("2026-07-01"),
      },
      {
        projectId: project.id,
        createdById: manager.id,
        title: "站点诊断",
        description: "完成全站技术与内容诊断，输出问题清单。",
        status: "COMPLETED",
        sortOrder: 2,
        endDate: new Date("2026-07-15"),
      },
      {
        projectId: project.id,
        createdById: manager.id,
        title: "站点优化",
        description: "实施技术优化与内容优化，提升页面质量。",
        status: "IN_PROGRESS",
        sortOrder: 3,
        startDate: new Date("2026-07-16"),
        endDate: new Date("2026-10-15"),
      },
      {
        projectId: project.id,
        createdById: manager.id,
        title: "效果跟踪",
        description: "跟踪收录与排名变化，输出阶段性效果报告。",
        status: "NOT_STARTED",
        sortOrder: 4,
        startDate: new Date("2026-10-16"),
        endDate: new Date("2026-12-31"),
      },
    ],
  });

  await prisma.projectUpdate.deleteMany({ where: { projectId: project.id } });
  await prisma.projectUpdate.createMany({
    data: [
      {
        projectId: project.id,
        authorId: manager.id,
        title: "已完成全站技术诊断",
        body: "诊断报告已上传，当前主要问题集中在页面索引和结构化内容。",
        createdAt: new Date("2026-07-15T10:30:00+08:00"),
      },
      {
        projectId: project.id,
        authorId: technician.id,
        title: "首批重点页面优化已上线",
        body: "已完成首页与三个产品页面的标题、描述和内部链接调整。",
        createdAt: new Date("2026-08-05T15:20:00+08:00"),
      },
      {
        projectId: project.id,
        authorId: manager.id,
        title: "下一步将跟踪收录与排名变化",
        body: "未来两周将持续跟踪重点页面表现，并根据数据安排下一轮优化。",
        createdAt: new Date("2026-08-12T09:45:00+08:00"),
      },
    ],
  });

  await prisma.serviceRequest.upsert({
    where: { number: "TK-20260812-0012" },
    update: {
      title: "关于首页标题优化建议",
      status: "IN_PROGRESS",
      assigneeId: technician.id,
    },
    create: {
      number: "TK-20260812-0012",
      title: "关于首页标题优化建议",
      description: "希望确认首页新标题是否需要保留品牌名称。",
      priority: "NORMAL",
      status: "IN_PROGRESS",
      projectId: project.id,
      categoryId: contentCategory.id,
      createdById: client.id,
      assigneeId: technician.id,
    },
  });
  await prisma.serviceRequest.upsert({
    where: { number: "TK-20260808-0007" },
    update: {
      title: "页面收录异常排查",
      status: "RESOLVED",
      assigneeId: manager.id,
    },
    create: {
      number: "TK-20260808-0007",
      title: "页面收录异常排查",
      description: "两个产品页面连续一周未被搜索引擎收录。",
      priority: "HIGH",
      status: "RESOLVED",
      projectId: project.id,
      categoryId: technicalCategory.id,
      createdById: clientMember.id,
      assigneeId: manager.id,
      resolvedAt: new Date("2026-08-10T11:08:00+08:00"),
    },
  });


  const seededRequests = await prisma.serviceRequest.findMany({
    where: {
      number: { in: ["TK-20260812-0012", "TK-20260808-0007"] },
      assigneeId: { not: null },
    },
    select: { id: true, assigneeId: true },
  });
  for (const request of seededRequests) {
    if (!request.assigneeId) continue;
    await prisma.requestAssignee.upsert({
      where: {
        serviceRequestId_userId: {
          serviceRequestId: request.id,
          userId: request.assigneeId,
        },
      },
      update: {},
      create: {
        serviceRequestId: request.id,
        userId: request.assigneeId,
      },
    });
  }

  await prisma.notification.deleteMany({ where: { userId: client.id } });
  await prisma.notification.create({
    data: {
      userId: client.id,
      customerSpaceId: space.id,
      projectId: project.id,
      type: "PROJECT_UPDATE",
      title: "项目有新的进度",
      body: "下一步将跟踪收录与排名变化",
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    process.stderr.write(
      `初始化数据失败：${error instanceof Error ? error.message : String(error)}\n`,
    );
    await prisma.$disconnect();
    process.exit(1);
  });
