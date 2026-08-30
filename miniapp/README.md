# 服务支持中心 · 微信小程序（客户侧 V1）

原生微信小程序 + TypeScript。技术方案见仓库根 `docs/miniapp-v1-technical-plan.md`。

## 目录结构

```text
src/
├── app.ts / app.json / app.wxss   # 4 Tab + 断网恢复补拉事件
├── config.ts                      # 探测运行平台，导出 API_BASE_URL
├── components/states.wxml        # 共享视觉组件：骨架屏 / 空状态 / 错误态（含无权、可重试）
├── lib/
│   ├── api-base-url.ts            # 后端地址选择：仅 devtools 连本机，真机一律生产
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

## 隐私接口与上传包

小程序目前只用了 TDesign 的一个组件（`t-icon`），但「构建 npm」会把整个
`tdesign-miniprogram` 产出到 `src/miniprogram_npm/`（100+ 组件）。微信在上传代码时会
**扫描包内代码**，把检测到的隐私接口列进「小程序设置 - 基本设置 - 服务内容声明 -
用户隐私保护指引」，要求逐项填写用途。

其中两个组件我们从未使用，却会凭空带来隐私声明项：

| 组件 | 带来的隐私接口 | 处理 |
| --- | --- | --- |
| `chat-record` | `startRecord` 等录音接口 → 「麦克风(Record)」 | 已在 `packOptions.ignore` 中排除 |
| `qrcode` | `saveImageToPhotosAlbum` → 「保存到相册」 | 已在 `packOptions.ignore` 中排除 |

2026-08-30 就因此被驳回：后台隐私指引里列着「Record 访问你的麦克风」，用途只能写
「无录音功能」，审核判定《用户隐私保护指引》描述不明确。**代码里确实没有任何录音功能。**

因此 `project.config.json` 的 `packOptions.ignore` 排除了这两个目录：它们不被上传，
微信也就扫不到对应接口。二者均无其它组件依赖（`icon` 只依赖 `common`），排除后不影响功能。

⚠️ 若将来要用到 `chat-record` / `qrcode`，需同步删掉对应的 ignore 项，并在后台隐私指引里
如实补充该接口的用途；反之，新引入的组件若带来不需要的隐私接口，按同样方式排除。

业务代码真正使用的隐私接口只有两个，都在 `lib/pick-files.ts`：`wx.chooseMedia`（相册/拍照，
仅 `mediaType: ["image"]`，不涉及视频与录音）与 `wx.chooseMessageFile`（聊天文件），
用于上传工单附件、项目文件与头像。

## 登录/绑定流程

```text
wx.login → POST /api/miniapp/auth/session
  已绑定 → token（Bearer）
  未绑定 → bindingTicket（10 分钟）
     ├─ /api/miniapp/auth/bind/account（邮箱密码 或 邮箱验证码）
     └─ /api/miniapp/auth/bind/code（管理员发放的一次性绑定码）
```
