# 抖音直播冰箱咨询互动背景 MVP 技术规格

## 1. 文档约束

本文件将 [PRD.md](PRD.md) 转换为可实现的技术规格。开发必须遵守以下优先级：

1. `PRD.md` 定义产品意图和范围。
2. `SPEC.md` 定义技术行为和接口。
3. `PLAN.md` 定义实现顺序和测试门禁。

发现冲突时停止相关实现，先修订上游文档，再同步下游文档。

## 2. 架构概览

系统采用本地单机 Client-Server 架构：

```text
┌──────────────────────────── 本地电脑 ────────────────────────────┐
│                                                                 │
│  Chrome /studio                                                 │
│  ├─ 直播区域                                                    │
│  ├─ 私有桌面后台                                                │
│  ├─ Web Speech API 适配器                                       │
│  └─ MediaPipe Worker ── 第二摄像头                              │
│             │ REST + WebSocket                                  │
│             ▼                                                   │
│  Python / FastAPI                                               │
│  ├─ 产品目录                                                    │
│  ├─ 会话状态机                                                  │
│  ├─ 命令校验                                                    │
│  ├─ JSON 持久化                                                 │
│  └─ 前端静态文件                                                │
│             ▲                                                   │
│             │ WebSocket                                         │
│  iPhone Safari /control/{token}                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 技术选型

后端：

- Python 3.12。
- FastAPI：HTTP、WebSocket 和静态文件服务。
- Pydantic v2：请求、目录、状态和事件模型。
- Uvicorn：本地 ASGI 服务器。
- `uv`：依赖、虚拟环境、锁文件和命令执行。
- `qrcode`：终端或页面二维码生成。

前端：

- React：创建前端工程时采用 npm `latest` 稳定版，并通过 `package-lock.json` 锁定；MVP 开发期间不做主版本升级。
- TypeScript 严格模式。
- Vite。
- React Router。
- 原生 WebSocket 客户端封装。
- MediaPipe Tasks Vision Gesture Recognizer。
- CSS Modules 或项目级 CSS 变量；不引入重量级 UI 框架。

测试：

- 后端：pytest、pytest-asyncio、FastAPI TestClient/httpx、Ruff、mypy。
- 前端：Vitest、Testing Library、ESLint、TypeScript。
- 端到端：Playwright。

### 2.2 运行原则

- FastAPI 是唯一后端进程。
- 前端开发时由 Vite 提供资源并代理 `/api` 与 `/ws`。
- 生产运行时由 FastAPI 提供 `frontend/dist`。
- 默认绑定地址可配置；本机使用 `127.0.0.1`，手机控制时使用 `0.0.0.0`。
- 不在业务代码中加入 WSL 专用路径、端口转发或系统分隔逻辑。

## 3. 目录结构

```text
.
├── PRD.md
├── SPEC.md
├── PLAN.md
├── pyproject.toml
├── uv.lock
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── cli.py
│   │   ├── config.py
│   │   ├── api/
│   │   ├── domain/
│   │   ├── services/
│   │   └── storage/
│   └── tests/
├── frontend/
│   ├── package.json
│   ├── package-lock.json
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── features/
│   │   ├── pages/
│   │   ├── workers/
│   │   └── test/
│   └── tests-e2e/
├── data/
│   ├── catalog.json
│   ├── images/
│   └── mediapipe/
├── runtime/
│   └── session.json
└── scripts/
    └── check.py
```

`runtime/`、前端构建产物、测试缓存、本地日志以及下载后的 MediaPipe 二进制资源必须加入 `.gitignore`。仓库提交 MediaPipe 资源清单、来源 URL、许可证说明和 SHA-256，不提交模型与 WASM 二进制；安装或构建步骤负责下载并校验，直播运行时只读取本地文件。

## 4. 领域数据模型

以下字段名为规范名称，Python 和 TypeScript 必须保持一致。

### 4.1 Product

```json
{
  "id": "fridge-haier-001",
  "category": "十字对开门",
  "name": "海尔 500L 十字对开门冰箱",
  "model": "BCD-500W",
  "image": "/assets/products/fridge-haier-001.webp",
  "specs": [
    {"label": "总容积", "value": "500 L"},
    {"label": "能效等级", "value": "一级"},
    {"label": "制冷方式", "value": "风冷"}
  ]
}
```

约束：

- `id`：稳定、唯一、URL 安全，长度 1 到 64。
- `category`、`name`、`model`：去除首尾空格后非空。
- `image`：只能是应用允许的本地静态资源路径。
- `specs`：有序键值数组，保留产品展示顺序；label 不得重复。
- 产品中不存在价格字段。

### 4.2 Money

- 状态中价格类型为 `int | null`。
- 整数单位为人民币“分”。
- `null` 表示“价格待定”。
- 最小值为 0。
- MVP 最大值为 99,999,999 分，即 999,999.99 元。
- 展示由前端统一格式化，不使用二进制浮点作为权威值。

### 4.3 SessionState

```json
{
  "schema_version": 1,
  "session_id": "uuid",
  "control_token_hash": "sha256-hex",
  "selected_product_id": null,
  "active_panel": "summary",
  "prices": {},
  "gesture": {
    "enabled": false,
    "last_accepted_at": null
  },
  "speech": {
    "phase": "idle",
    "target": "search",
    "draft": "",
    "deadline": null,
    "error_code": null
  },
  "revision": 0,
  "started_at": "RFC3339",
  "updated_at": "RFC3339"
}
```

约束：

- `selected_product_id` 必须存在于当前目录或为 `null`。
- `active_panel` 为 `summary | details`。
- `prices` 为 `{product_id: amount_in_cents}`。
- `revision` 每次持久状态成功变更后递增。
- 不在状态文件中保存明文控制令牌。
- 动画不是持久状态。

### 4.4 SpeechState

状态：

- `idle`：没有识别或草稿。
- `listening`：桌面 Chrome 正在识别。
- `reviewing`：已停止识别，草稿处于三秒确认窗口。
- `committing`：服务端正在解析和提交。
- `error`：最近一次语音流程失败。

合法转换：

```text
idle -> listening
listening -> reviewing
listening -> error
reviewing -> committing
reviewing -> idle          # 撤销
committing -> idle         # 成功
committing -> error        # 解析或业务失败
error -> idle
```

任何客户端不得直接设置 phase，只能发送命令，由服务端决定转换。

## 5. 产品目录与搜索

### 5.1 加载

- 启动时读取 `data/catalog.json`。
- 使用 Pydantic 完整校验。
- ID、名称和型号冲突应阻止启动，并输出可定位错误。
- 图片缺失作为启动警告；该产品使用占位图，不阻止启动。
- 启动后目录视为只读。

### 5.2 搜索

搜索由后端执行，输入先：

1. Unicode NFKC 规范化。
2. 去除首尾空格。
3. 英文字母转小写。

名称、型号和类型任一字段包含查询词即匹配。空查询返回全部产品，但仅供私有后台使用。结果按以下顺序排序：

1. 型号完全匹配。
2. 名称完全匹配。
3. 型号前缀匹配。
4. 名称、型号或类型包含匹配。
5. 原目录顺序。

## 6. 金额解析

金额解析必须在 Python 后端实现，前端只提供即时提示。

接受示例：

- `3999`
- `3999.00`
- `¥3999`
- `3999元`
- `三千九百九十九`
- `三千九百九十九元`
- `3999块`

拒绝示例：

- 负数。
- 多个无法确定关系的金额。
- 超过最大值。
- 只有“便宜”“待定”等非数字文本。
- 小数超过两位且无法无损转为分。

解析步骤：

1. NFKC 规范化并移除允许的货币符号与单位。
2. 优先识别严格阿拉伯数字格式。
3. 否则使用独立、可单元测试的中文数字解析器。
4. 转换为 `Decimal`，再转换为整数分。
5. 校验范围。

禁止使用 `eval`、浮点累加或不受控第三方在线解析服务。

## 7. 状态持久化

### 7.1 文件

- 权威运行文件：`runtime/session.json`。
- 临时文件：`runtime/session.json.tmp`。
- 损坏备份：`runtime/session.corrupt-<timestamp>.json`。

### 7.2 原子写入

1. 在同目录写入完整临时文件。
2. flush 并在支持的平台执行 fsync。
3. 使用原子 replace 替换目标文件。
4. 成功后再向客户端广播新 revision。

### 7.3 恢复

- 文件不存在：创建新场次。
- 文件合法：恢复未结束场次。
- schema 版本未知：拒绝静默降级，给出明确错误。
- JSON 损坏：移动为损坏备份，记录不含令牌的错误，创建新场次。
- 引用了已删除产品：清除该选择和对应无效价格，其余状态继续恢复。

### 7.4 结束场次

结束场次是原子业务操作：

- 创建新的 `session_id`。
- 清空 `selected_product_id` 和 `prices`。
- 面板重置为 `summary`。
- 手势重置为关闭。
- 语音重置为 `idle`。
- 生成新控制令牌，只持久化其哈希。
- 断开旧手机 WebSocket。
- 广播新场次状态给桌面。

## 8. HTTP API

所有响应采用 JSON。错误格式：

```json
{
  "error": {
    "code": "INVALID_PRICE",
    "message": "无法识别有效价格",
    "details": {}
  }
}
```

### 8.1 系统

- `GET /api/health`
  - 返回进程、目录和状态存储是否可用。
- `GET /api/bootstrap`
  - 返回公开配置、目录摘要、当前状态和 WebSocket 地址。
  - 不返回明文手机令牌。

### 8.2 产品

- `GET /api/products?q=<query>`
  - 返回私有界面使用的搜索结果。
- `GET /api/products/{product_id}`
  - 返回单个产品详情。

### 8.3 控制配对

- `POST /api/control-token`
  - 仅接受来自本机桌面会话的请求。
  - 返回当前明文令牌和手机 URL，用于显示二维码。
- `GET /api/control/validate?token=<token>`
  - 只返回令牌是否有效以及手机槽位状态。
  - 响应与日志不得回显令牌。

### 8.4 静态页面

- `GET /studio`
- `GET /control/{token}`
- `GET /assets/...`

生产模式中的未知前端路由回退到 `index.html`；`/api` 和 `/ws` 不参与回退。

## 9. WebSocket 协议

### 9.1 端点

- 桌面：`/ws/studio`
- 手机：`/ws/control?token=<token>`

桌面允许单个主连接；新桌面连接将替换旧桌面连接。手机严格只允许一个活动连接，新手机不能替换仍处于活动或重连宽限期内的旧手机。

### 9.2 信封

客户端命令：

```json
{
  "type": "command",
  "request_id": "uuid",
  "command": "select_product",
  "payload": {"product_id": "fridge-haier-001"},
  "expected_revision": 12
}
```

服务端事件：

```json
{
  "type": "state",
  "event_id": "uuid",
  "revision": 13,
  "state": {}
}
```

命令结果：

```json
{
  "type": "ack",
  "request_id": "uuid",
  "ok": true,
  "revision": 13,
  "error": null
}
```

### 9.3 命令

持久状态命令：

- `select_product {product_id}`
- `set_price {product_id, raw_value}`
- `set_panel {panel}`
- `set_gesture_enabled {enabled}`
- `speech_set_target {target}`
- `speech_started {}`
- `speech_interim {text}`
- `speech_stopped {text}`
- `speech_edit_draft {text}`
- `speech_confirm {}`
- `speech_cancel {}`
- `end_session {}`

瞬时命令：

- `trigger_animation {name}`
- `gesture_candidate {direction, observed_at, confidence, metrics}`

动画名称：

- `price_highlight`
- `product_spotlight`

### 9.4 并发与 revision

- 修改持久状态的命令必须携带 `expected_revision`。
- revision 不匹配时返回 `REVISION_CONFLICT` 和最新状态。
- 可幂等重试的命令使用 `request_id` 去重，后端保存有限长度的近期结果缓存。
- 动画允许重复触发，不通过 revision 去重，但仍通过 request_id 防止网络重发。
- 服务端写入成功后才广播状态。

### 9.5 心跳与重连

- 服务端每 15 秒发送 ping。
- 45 秒未收到 pong 则关闭连接。
- 客户端使用指数退避重连，最大间隔 10 秒。
- 重连后服务端立即发送完整状态快照，而不是依赖遗漏事件补放。
- 原手机在令牌有效且旧连接已失效时可恢复手机槽位。

## 10. 权限和控制规则

- 桌面可以执行所有命令。
- 手机可以搜索、选择、定价、切换面板、控制语音、动画和手势。
- `end_session` 默认只允许桌面执行。
- 手势 Worker 只能向桌面页面提交候选事件。
- 服务端不接受客户端直接提交完整状态对象。
- 手机令牌使用 `secrets.token_urlsafe` 生成，服务端只比较哈希。
- 明文令牌仅在桌面请求配对信息时短暂存在内存和响应中。

## 11. 桌面前端

### 11.1 路由与布局

`/studio` 使用一个页面，主要 DOM 结构：

```text
StudioPage
├── LiveCaptureFrame
│   └── LiveCanvas
│       ├── Background
│       ├── SummaryPanel
│       ├── DetailsPanel
│       └── AnimationLayer
└── PrivateConsole
    ├── SessionStatus
    ├── ProductSearch
    ├── ProductEditor
    ├── PanelControls
    ├── SpeechControls
    ├── GestureControls
    └── PairingPanel
```

硬性约束：

- `LiveCaptureFrame` 与 `PrivateConsole` 是兄弟节点。
- 私有组件不得通过 portal 渲染到直播区域。
- 直播区域使用 `aspect-ratio: 9 / 16`，基础设计坐标为 720×1280。
- 生产预设为 360×640、540×960、720×1280 和 1080×1920。
- 输出容器使用所选预设的真实逻辑像素尺寸；内部 720×1280 设计面按宽度比例缩放。
- 桌面预览再通过外层缩放适配可用屏幕高度，不改变输出容器的逻辑尺寸。
- 所选预设保存到浏览器 `localStorage`，刷新后恢复；默认值为 720×1280。
- 对窗口过小情况允许缩小直播区域，但不改变比例。
- 采集边界和安全间隔位于直播区域外，不会被设计为观众内容。

### 11.2 状态

- 服务端状态保存于单一客户端 store。
- UI 本地状态只用于搜索输入、展开状态和设备预览。
- 收到完整快照后替换权威状态。
- 乐观更新仅允许用于不会造成错误直播内容的控件；产品和价格默认等待 ack。

### 11.3 直播面板

- 摘要与详情均挂载在直播区域内。
- CSS transform 完成滑动，不使用会导致布局抖动的宽高动画。
- 动画尊重 `prefers-reduced-motion`，但直播模式仍提供简化可见反馈。
- 新产品没有价格时显示“价格待定”。
- 详情面板最多显示目录顺序中的前 8 项参数；MVP 示例数据不得造成滚动条。

## 12. 手机前端

- 手机页面首先校验令牌并申请手机槽位。
- 不缓存令牌到分析服务或日志。
- 页面离开或 WebSocket 正常关闭时释放槽位。
- 非正常断线保留 15 秒重连宽限期。
- 控件尺寸满足触摸操作，长按语音按钮应阻止默认选择菜单。
- `pointerdown` 开始语音，`pointerup`、`pointercancel` 和页面失焦均停止语音，避免永久 listening。
- 手机不直接调用 SpeechRecognition；只控制桌面适配器。
- 手机显示桌面语音能力状态，能力不可用时禁用长按按钮并保留文本输入。

## 13. 语音识别规格

### 13.1 适配器

定义前端接口：

```ts
interface SpeechRecognizerAdapter {
  isSupported(): boolean;
  start(language: "zh-CN"): Promise<void>;
  stop(): void;
  abort(): void;
  onInterim(callback: (text: string) => void): () => void;
  onFinal(callback: (text: string) => void): () => void;
  onError(callback: (error: SpeechError) => void): () => void;
}
```

生产实现包装 `window.SpeechRecognition ?? window.webkitSpeechRecognition`。测试实现由 Vitest 和 Playwright 注入。

### 13.2 远程启动

浏览器可能要求用户授权或用户激活。桌面页面必须提供“初始化语音”按钮：

1. 桌面用户点击按钮。
2. 适配器执行最小权限初始化。
3. UI 显示 `ready | unsupported | denied | unavailable`。
4. 只有 `ready` 时手机远程长按才可开始识别。

若目标 Chrome 在完成桌面初始化后仍拒绝由 WebSocket 事件触发 `start()`，该环境判定为“远程语音不可用”，手机语音按钮禁用并回退到手动输入。MVP 不通过持续监听绕过浏览器权限策略。

### 13.3 三秒提交

- `speech_stopped` 到达服务端时进入 `reviewing`。
- 服务端以单调时钟安排三秒 deadline。
- `speech_edit_draft` 更新草稿但不延长 deadline。
- `speech_confirm` 立即提交。
- `speech_cancel` 立即清空并回到 idle。
- deadline 到达时提交当时的最新草稿。
- 搜索目标提交后更新私有搜索词，不改变直播状态。
- 价格目标提交后调用与手动价格相同的解析和校验服务。
- 新的 listening 开始前必须取消旧 deadline。

## 14. MediaPipe 与滑动识别

### 14.1 运行位置

- Chrome 获取第二摄像头。
- 视频帧只在浏览器内处理。
- MediaPipe Gesture Recognizer 运行在 Web Worker。
- 后端不接收视频、图片或 landmark 全量流。
- Worker 只向主线程发送必要的识别摘要和调试指标。

### 14.2 模型职责

预训练模型用于识别 `Open_Palm` 等静态手势。左右滑动不是静态模型类别，由应用使用连续帧轨迹判断。

每帧摘要：

```ts
type HandFrame = {
  timestampMs: number;
  openPalmScore: number;
  handedness: "Left" | "Right" | "Unknown";
  x: number;
  y: number;
};
```

`x`、`y` 使用 wrist 与四个 MCP landmark（索引 0、5、9、13、17）的坐标平均值作为掌心中心，并归一化到 0 到 1。

### 14.3 初始滑动算法

候选轨迹仅收集 `openPalmScore >= 0.70` 的帧。

初始参数：

- 最少有效帧数：5。
- 持续时间：200ms 到 700ms。
- 横向绝对位移：至少 0.25。
- 纵向绝对位移：不超过 0.15。
- 有效相邻横向增量中，同方向比例至少 0.70。
- 平均 Open Palm 分数至少 0.70。
- 接受后冷却：1500ms。

方向：

- 坐标 x 减小为左滑，目标面板 `details`。
- 坐标 x 增大为右滑，目标面板 `summary`。
- 已位于目标面板时命令成功但不改变 revision，也不播放面板切换动画。

轨迹在以下情况重置：

- Open Palm 连续丢失超过 150ms。
- 超过最大持续时间。
- 纵向漂移过大。
- 手势被关闭。
- 摄像头中断或页面隐藏。

### 14.4 双层校验

浏览器先分类候选，服务端再检查：

- 手势是否启用。
- `observed_at` 是否在允许时钟偏差内。
- 是否仍在服务端冷却期。
- direction 是否为允许值。
- confidence 是否达到门槛。

允许的客户端与服务端时间偏差为前后 2 秒。超出范围的候选返回 `GESTURE_STALE`。

服务端不重新计算 landmark 轨迹，但记录不含图像的接受/拒绝原因用于调试。

### 14.5 性能

- 以 15 FPS 为目标送入识别器，调度允许的瞬时偏差为 5 FPS。
- 同一时刻最多有一个推理任务。
- 忙碌时丢弃旧帧，不排无限队列。
- Worker 初始化失败时显示错误并关闭手势功能。
- 页面隐藏时暂停摄像头推理。

## 15. MediaPipe 资源管理

- `package.json` 固定 MediaPipe 包版本。
- 模型和 WASM 下载到 `data/mediapipe`，前端构建时复制到构建后静态资源目录。
- 提供脚本下载指定 URL 并校验固定 SHA-256。
- 校验失败时构建失败。
- 应记录模型来源、版本、许可证和哈希。
- 生产代码不得回退到 CDN。
- 自动测试不下载模型；使用已提交的小型夹具或适配器 mock。

## 16. 动画事件

服务端事件：

```json
{
  "type": "animation",
  "event_id": "uuid",
  "name": "price_highlight",
  "product_id": "fridge-haier-001",
  "issued_at": "RFC3339"
}
```

规则：

- 成功设置当前产品价格时自动触发 `price_highlight`。
- 手动按钮可重复触发两种动画。
- 产品聚焦只作用于当前产品。
- 客户端按 event_id 去重。
- 重连不重播历史动画。

## 17. 错误代码

至少定义：

- `CATALOG_INVALID`
- `PRODUCT_NOT_FOUND`
- `INVALID_PRICE`
- `PRICE_OUT_OF_RANGE`
- `REVISION_CONFLICT`
- `CONTROL_TOKEN_INVALID`
- `CONTROL_SLOT_OCCUPIED`
- `COMMAND_FORBIDDEN`
- `GESTURE_DISABLED`
- `GESTURE_COOLDOWN`
- `GESTURE_STALE`
- `SPEECH_UNSUPPORTED`
- `SPEECH_PERMISSION_DENIED`
- `SPEECH_INVALID_STATE`
- `STATE_STORAGE_FAILED`
- `MODEL_LOAD_FAILED`

错误消息面向用户时使用中文；日志可包含技术上下文，但不得包含控制令牌、原始音频或摄像头帧。

## 18. 配置

使用环境变量和 `.env` 本地覆盖，默认值集中在 Pydantic Settings：

- `APP_HOST`
- `APP_PORT`
- `APP_DATA_DIR`
- `APP_RUNTIME_DIR`
- `APP_LOG_LEVEL`
- `APP_DEV_MODE`
- `APP_GESTURE_COOLDOWN_MS`
- `APP_SPEECH_REVIEW_MS`

业务默认值必须与本规格一致。配置错误应在启动阶段失败，不允许运行中静默采用不安全值。

## 19. 启动 CLI

目标命令：

```bash
uv run live-background
```

行为：

1. 校验配置、目录和前端构建产物。
2. 加载或恢复会话。
3. 选择可用局域网地址。
4. 启动 Uvicorn。
5. 输出桌面 URL。
6. 输出手机 URL 和终端二维码。

CLI 不自动安装浏览器扩展，不自动修改防火墙，不自动配置抖音直播伴侣。

## 20. 自动测试规格

### 20.1 后端

- 产品模型和目录失败用例。
- 搜索规范化和排序。
- 阿拉伯数字及中文金额解析。
- 状态转换、revision 冲突和幂等重试。
- JSON 原子写入、恢复、损坏文件和结束场次。
- REST 错误格式。
- WebSocket 桌面广播、单手机限制、重连和权限。
- 三秒语音状态机使用可控虚拟时钟。
- 手势候选服务端冷却校验。

### 20.2 前端

- 直播区域与私有后台 DOM 隔离。
- 摘要/详情互斥显示。
- 金额格式化和价格待定。
- 产品选择、价格、动画和重连状态。
- 手机控件及 pointer cancel。
- SpeechRecognizerAdapter 各能力状态。
- MediaPipe Worker 消息协议。
- 左滑、右滑、垂直移动、抖动、太慢、太快和冷却轨迹。

### 20.3 端到端

- 桌面加载和选择产品。
- 手机配对及第二手机拒绝。
- 手机控制面板和价格。
- 模拟语音三秒提交、修改和撤销。
- 模拟手势切换。
- WebSocket 断线后完整状态恢复。
- 结束场次清除价格和旧手机权限。
- 直播区域截图不包含私有搜索结果、令牌或设备预览。

### 20.4 非自动范围

以下使用人工检查清单，不作为每一步自动门禁：

- 真实摄像头识别质量。
- Chrome 中文语音服务。
- iPhone Safari 局域网行为。
- 抖音直播伴侣区域采集。

## 21. 完成定义

功能只有同时满足以下条件才算完成：

- 行为符合 PRD 和本规格。
- 类型检查、静态检查和相关自动测试通过。
- 新增失败路径有测试。
- 没有把私有信息渲染到直播区域。
- `PLAN.md` 对应步骤已记录测试日期、命令和结果。
