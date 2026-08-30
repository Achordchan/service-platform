# 服务支持中心 · 微信小程序（客户侧 V1）

原生微信小程序 + TypeScript。技术方案见仓库根 `docs/miniapp-v1-technical-plan.md`。

## 目录结构

```text
src/
├── app.ts / app.json / app.wxss   # 4 Tab + 断网恢复补拉事件
├── config.ts                      # API_BASE_URL（本机调试 → 生产域名）
├── components/states.wxml        # 共享视觉组件：骨架屏 / 空状态 / 错误态（含无权、可重试）
├── lib/
│   ├── badge.ts                   # TabBar 未读角标统一刷新（Tab onShow + 事件回调）
│   ├── request.ts                 # wx.request 封装：Bearer 注入、401 重登、X-Idempotency-Key
│   ├── auth.ts                    # 登录 / 两种绑定 / 登出 / me
│   ├── api.ts                     # 项目/工单/附件资源封装（阶段 2）
│   ├── events.ts                  # EventRecord 游标增量同步管理器
│   └── format.ts                  # 状态/优先级映射（对齐 Web）+ 时间/文件大小格式化
└── pages/
    ├── projects/                  # Tab 项目列表（下拉刷新）
    ├── project-detail/            # 概览/里程碑/动态/请求/文件（Tab 按项目开关门控）
    ├── requests/                  # Tab 工单列表（筛选/搜索/分页）
    ├── request-new/               # 新建工单（项目→分类级联、附件、幂等提交）
    ├── request-detail/            # 对话消息流 + 引用回复 + 附件预览 + 事件自动刷新
    ├── messages/                  # Tab 消息中心（未读角标/已读/跳转/事件刷新）
    ├── notification-settings/     # 通知偏好 + 微信提醒授权引导
    ├── members/                   # 成员管理（Owner：列表/邀请/移除）
    ├── profile/                   # 我的（绑定状态 + 通知设置/成员入口 + 登出）
    └── auth/                      # login / bind-account / bind-code
```

## 本地开发

1. **后端**（仓库根）启动 `next dev`，并设置：

   ```bash
   MINIAPP_WECHAT_PROVIDER=dev   # 本地假 Provider（生产环境会被硬性拒绝）
   # MINIAPP_DEV_OPENID=dev-openid-alice  # 可选：固定测试身份
   ```

   正式环境使用 `WECHAT_MINIAPP_APPID` / `WECHAT_MINIAPP_APP_SECRET`，
   `MINIAPP_WECHAT_PROVIDER` 保持默认 `real`。

2. **小程序**：微信开发者工具「导入项目」选择本目录（appid 可用测试号），
   详情设置勾选「不校验合法域名」。后端地址按运行平台选（`src/config.ts` 探测平台，
   常量与选择逻辑在 `src/lib/api-base-url.ts`）：只有开发者工具（platform 为
   `devtools`）连 `http://127.0.0.1:3000`，真机——预览、体验版、审核版、正式版——
   一律走生产域名，没有开关可以覆盖。

   真机需要连本机后端联调时，把 `src/lib/api-base-url.ts` 的 `PROD_API_BASE_URL`
   临时改成电脑的局域网 IP（如 `http://192.168.1.5:3000`，手机与电脑连同一 WiFi），
   **用完立刻改回**；忘了改回的话 `tests/miniapp/api-base-url.test.ts` 会在 CI 拦住。

   ⚠️ 不要改回用 `envVersion` 判断环境：微信审核版的 `envVersion` 返回 `develop`，
   会把审核员的真机请求打到 127.0.0.1 而导致「功能报错」驳回。

3. **构建 npm（TDesign 组件库，首次必做）**：微信开发者工具菜单「工具 → 构建 npm」。
   项目已配置 `packNpmManually` + `packNpmRelationList`（npm 包在 miniapp/ 根，
   产物输出到 src/miniprogram_npm/）。如需重新安装依赖：
   `cd miniapp && npm install`，然后再点一次「构建 npm」。

4. 类型检查：仓库根 `pnpm typecheck:miniapp`（或在 miniapp/ 下 `tsc --noEmit`）。

## 登录/绑定流程

```text
wx.login → POST /api/miniapp/auth/session
  已绑定 → token（Bearer）
  未绑定 → bindingTicket（10 分钟）
     ├─ /api/miniapp/auth/bind/account（邮箱密码 或 邮箱验证码）
     └─ /api/miniapp/auth/bind/code（管理员发放的一次性绑定码）
```
