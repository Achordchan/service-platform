# 小程序《用户隐私保护指引》填写模板

> 位置：mp.weixin.qq.com → 小程序设置 → 基本设置 → 服务内容声明 → 用户隐私保护指引
>
> **每次改动隐私相关接口后都要回来核对本文件**，指引与代码不一致会被以
> 「《用户隐私保护指引》不明确或空白」驳回（2026-08-31 第三次驳回即此原因）。

## 一、为什么「删不掉」

被驳回时后台填的是：

| 隐私接口 | 使用说明 |
|---|---|
| PhoneNumber 收集你的手机号 | 从未调用 getPhoneNumber，登录是邮箱+微信绑定 |
| Record 访问你的麦克风 | 无录音功能 |

而**删掉手机号那条会立刻被驳回**。原因不在指引本身，在代码包：

微信会对上传的代码包做静态扫描，**包里出现的隐私接口必须有对应声明**，否则驳回；
而声明了却写不出真实用途，又会被判「指引不明确」。两头堵，所以只能从代码包下手。

根因：`tdesign-miniprogram` 的 `common/template/button.wxml` 里带着
`bind:getphonenumber`、`bind:getrealtimephonenumber`、`bind:getuserinfo`。
本项目只用了 TDesign 的 `icon` 一个组件，`project.config.json` 的 `packOptions.ignore`
也逐个排除了其余组件（含 `button`、`chat-record`），**但漏了 `common/template` 目录**——
于是这个文件照样进包，扫描扫到手机号接口，声明就删不掉。

已修（2026-08-31）：`packOptions.ignore` 补上
`miniprogram_npm/tdesign-miniprogram/common/template`（`icon` 只依赖 `common/utils.wxs`，
不引用该目录下任何模板）。修完后包内已无任何未使用的隐私接口痕迹，两条声明都可以删。

`tests/miniapp/privacy-api-surface.test.ts` 守住这条线。因为 `miniprogram_npm` 是「构建
npm」产物、不入库、CI 上并不存在，所以扫描建立在两类输入上：

- **自有代码 + `node_modules/tdesign-miniprogram`（CI 上 `pnpm install` 之后都在，永远真的
  在跑）**：扫已安装 TDesign 包里作为构建源的 `miniprogram_dist`，凡命中隐私接口的文件都必须
  被 `packOptions.ignore` 覆盖。清单是动态推导的，升级 TDesign 引入新的隐私目录会直接失败，
  不必手工维护;判定复用 `isIgnored`，`folder` 覆盖整棵子树、`file` 只精确匹配单个文件，
  所以误删条目或把 `folder` 改成 `file` 都拦得住。
- **`src/miniprogram_npm`（构建产物，只在本地）**：按 `packOptions.ignore` 还原「真正会上传
  的文件集合」全量扫描，并校验 TDesign 只剩 `icon` 与公共依赖进包，作为最终一致性校验。
  CI 上这两条显式标记为 skipped。

`.wechatide.ib.json` 是开发者工具的 API 补全索引，列着全量接口名却不参与运行，已一并排除。

扫描按**能力域**匹配而不是枚举 API 名——蓝牙、Wi-Fi、NFC 这类一个能力就有十几个入口
（`startBluetoothDevicesDiscovery`、`getConnectedBluetoothDevices`…），枚举必然漏，微信新增
API 时也会静默失效。`COVERAGE_SAMPLES` 里放着每个域的代表性入口，收紧正则时会先失败，防止
顺手漏掉真实接口。

扫描对象也不只是 JS 接口名：`<camera>`、`<live-pusher>`、`<voip-room>`、`<open-data>` 这类原生
组件不经过任何 API 就能拿到摄像头／麦克风／微信身份，同样在匹配范围内（带尖括号，避免误伤
`chooseMedia` 的 `sourceType: ["album", "camera"]`）；`chooseAvatar` 则只认
`open-type="chooseAvatar"` / `bind:chooseavatar` 的声明式写法，因为项目里的 `onChooseAvatar`
是自己的方法名、走的是 `chooseMedia`。

### 删条目要在提审流程里做，不是在设置页

**「设置-服务内容声明」页改的是「现网版」隐私协议（`privacy_ver=1`），它的必填项被
「线上正在跑的那个版本」的接口调用情况锁死。** 代码修好、新版本只是开发版还没发布时，
相册／麦克风这类条目在那个页面根本删不动——2026-08-31 实测到这一步。

删除属于只能改「开发版」（`privacy_ver=2`）的操作，官方流程是：

> 开发者每次提交代码审核时，平台默认拉取小程序现网版本隐私协议，作为开发版本的隐私协议
> 进入平台审核。若提交审核的开发版本，其隐私接口调用情况与隐私协议内容有出入，则在提审时
> 会提醒开发者进行更新。

所以顺序是：

1. 先合并代码改动，用微信开发者工具**重新上传一版代码**；
2. **去提交代码审核**——提审流程里会出现隐私协议／信息填写环节，并提示「接口调用情况与协议
   不符」；
3. **就在那一步**删掉不用的条目、按第四节补齐正向说明；
4. 审核通过并发布后，现网版的锁定才跟着解除。

若提审流程里也不给删，带上 AppID 走开放社区「意见反馈」请官方后台处理。

参考：[用户隐私保护指引填写说明](https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/)、
[setprivacysetting 接口](https://developers.weixin.qq.com/doc/oplatform/openApi/miniprogram-management/privacy-management/api_setprivacysetting.html)。

### 已验证的部分

代码包清干净后，`PhoneNumber` 那条确实可以删了——这是本次修复生效的直接证据。
相册（仅写入）与麦克风删不动则与代码无关，属上面的现网版锁定。

## 二、说明栏的写法

1. **不用的接口删条目**，不要保留后写"未调用"——留着且写否定句＝自相矛盾。
2. **说明必须是正向描述**：谁在什么场景、因为什么目的、收集什么、给谁看、怎么用。
   「无 XX 功能」「从未调用」这类否定句一律视为空白。

## 三、当前代码实际收集的信息（2026-08-31 核对）

| 接口 / 来源 | 代码位置 |
|---|---|
| `wx.chooseMedia`（相册 + 拍摄，仅图片） | `miniapp/src/lib/pick-files.ts:23`、`miniapp/src/pages/profile-edit/page.ts:62` |
| `wx.chooseMessageFile`（聊天文件） | `miniapp/src/lib/pick-files.ts:43` |
| `wx.getDeviceInfo` / `wx.getSystemInfoSync`（仅取 platform） | `miniapp/src/config.ts:9` |
| 邮箱（登录/绑定账号时用户填写） | `miniapp/src/lib/auth.ts` |
| 姓名、头像（用户在「编辑资料」自填） | `miniapp/src/pages/profile-edit/page.ts` |
| 微信 OpenID（`wx.login` 换取，用于绑定登录） | `miniapp/src/lib/auth.ts:228` |

不涉及：手机号、麦克风/录音、位置、通讯录、剪贴板读取、蓝牙、相册写入。
（`wx.setClipboardData` 是写入剪贴板，不在微信隐私接口清单内，无需声明。）

## 四、逐条填写内容（复制粘贴）

### 1. 你选中的照片或视频信息

> 为了让你在提交工单、补充问题说明以及设置个人头像时能够上传图片，在你主动点击"添加附件—拍摄/从相册选择"或"更换头像"并完成选择后，我们会收集你本次选中或拍摄的图片，上传至我们的服务器，作为该工单的附件或你的头像，展示给你所在项目的服务人员。你不主动选择时我们不会收集，也不会在后台读取你的相册或静默开启摄像头。

### 2. 你选中的文件

> 为了让你能够把合同、日志、截图等资料作为工单附件提交，在你主动点击"添加附件—从聊天记录选择"并选中文件后，我们会收集该文件并上传至我们的服务器，供处理该工单的服务人员查看与下载。你不主动选择时我们不会收集，也无法读取你的其他聊天内容。

### 3. 设备信息

> 为了适配不同机型的页面显示，并在你反馈异常时定位故障，在你打开小程序时我们会收集你的设备操作系统平台信息（如 iOS/Android/开发者工具）。我们不收集设备唯一标识，该信息仅用于页面适配与故障排查。

### 4. 邮箱

> 为了将你的微信与本服务平台的账号绑定并完成登录验证，在你首次登录、输入邮箱并接收验证码时，我们会收集你填写的邮箱地址，用于校验身份、后续找回账号以及向你发送与工单进度相关的通知。

### 5. 其他 —— 你填写的姓名与上传的头像

> 为了让服务人员在工单沟通中识别你的身份，在你主动进入"我的—编辑资料"并保存时，我们会收集你填写的姓名和你上传的头像图片，展示在你所在项目的成员列表与工单沟通记录中。你可以随时修改这些信息。

### 6. 其他 —— 你在小程序内填写的工单内容

> 为了向你提供工单受理与处理服务，在你提交工单、发送消息或补充说明时，我们会收集你填写的标题、描述、留言内容及其附件，用于服务人员处理你的诉求，并保存在我们的服务器上作为服务记录。

### 需要删除的条目

- ❌ PhoneNumber 收集你的手机号
- ❌ Record 访问你的麦克风

## 五、指引里其他必填项

- **开发者主体名称**：与小程序主体一致，不能留空或写"个人"两字了事。
- **联系方式**：填可正常接收的邮箱（或电话），审核会核对格式。
- **第三方 SDK / 插件**：本小程序未接入任何会收集用户信息的第三方 SDK
  （TDesign 仅为前端 UI 组件库，不采集信息），此项选"无"或如实说明。
- **信息存储与共享**：说明信息存储在开发者服务器（support.achord.cn），
  除法律法规要求外不向第三方提供。
- 保存后需**重新提交代码审核**，指引修改本身不会自动触发过审。

## 六、后续如果新增隐私接口

新增任何隐私接口（录音、定位、手机号快捷登录等）时：

1. 先来本文件补一条正向说明，并同步到 mp 后台，同时把关键词从
   `tests/miniapp/privacy-api-surface.test.ts` 的 `FORBIDDEN` 里放开对应的域
   （连同 `COVERAGE_SAMPLES` 里的样本一起调整）；
2. 若届时开启了隐私校验（`app.json` 的 `__usePrivacyCheck__`），
   还需接入 `wx.onNeedPrivacyAuthorization` 隐私弹窗，否则接口调用会直接 fail；
   当前未开启，暂不需要。
