# 抖音直播冰箱咨询互动背景 MVP 开发计划

## 1. 执行规则

本计划是 [PRD.md](PRD.md) 和 [SPEC.md](SPEC.md) 的实施清单，不得覆盖上游文档。

必须遵守：

1. 严格按步骤顺序开发；若需调整顺序，先修改本计划并说明依赖关系。
2. 每一步只在该步骤的专项测试和要求的回归测试全部通过后勾选完成。
3. 失败测试不得通过删除断言、跳过测试或放宽需求来规避。
4. 测试发现规格问题时，先修订 `PRD.md` 或 `SPEC.md`，再修改代码。
5. 每一步在“测试记录”中填写日期、提交或工作区标识、实际命令和结果。
6. 真实摄像头、Chrome 在线语音、iPhone 和抖音直播伴侣按最终人工检查执行，不作为逐步自动测试门禁。

## 2. 统一质量命令

项目建立后，提供跨平台 Python 检查入口：

```bash
uv run python scripts/check.py
```

该命令最终应依次执行：

```text
ruff check
ruff format --check
mypy
pytest
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

开发早期尚未建立某一子项目时，步骤门禁只运行已经存在的检查；不得保留永久性的“未实现即跳过”。

## 3. 开发步骤

### 步骤 1：工程骨架与质量基础

- [x] 完成

实现内容：

- 建立 `pyproject.toml`、Python 包、FastAPI 最小应用和 CLI 入口。
- 使用 `uv` 生成并提交锁文件。
- 建立 Vite、React、TypeScript 前端。
- 配置 Ruff、mypy、pytest、ESLint、Vitest 和 Playwright。
- 建立 `scripts/check.py`，使用 Python subprocess 顺序运行检查，正确传递退出码。
- 更新 `.gitignore`，排除 `runtime/`、构建产物和测试缓存。
- 提供最小 `/api/health` 和前端健康页面。

完成标准：

- `uv run live-background` 能启动开发后端。
- 后端健康接口返回成功。
- 前端可构建。
- Python 和 TypeScript 严格检查可运行。

专项测试：

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy backend
uv run pytest backend/tests/test_health.py
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run
npm --prefix frontend run build
```

测试记录：

- 日期：2026-06-11
- 工作区/提交：本地工作区，尚未提交
- 命令：`uv sync`; `npm install`; `uv run python scripts/check.py`; 临时设置 `APP_PORT=8765` 和 `APP_DEV_MODE=false` 后启动 `.venv\Scripts\live-background.exe` 并请求 `GET /api/health`
- 结果：Python 3.12.13、Node 24.16.0 和 npm 11.13.0 环境可用；Ruff、format check、mypy、pytest、ESLint、TypeScript、Vitest 和 Vite production build 全部通过；CLI 成功输出桌面/手机地址和 ASCII 二维码，健康接口返回 200。
- 失败与处理：首次 CLI 重定向输出时 qrcode Unicode 块字符在 Windows CP1252 下失败；改为纯 ASCII 二维码并加入回归测试。统一检查脚本在 Windows 改用 `npm.cmd`。

### 步骤 2：产品目录、搜索与金额解析

- [x] 完成

实现内容：

- 定义 Product、ProductSpec 和 Money 领域模型。
- 建立至少 6 个示例冰箱，覆盖不少于 4 种类型。
- 加入本地占位产品图和缺图回退。
- 实现目录加载、完整校验、搜索规范化及排序。
- 实现阿拉伯数字、人民币符号、单位和常见中文金额解析。
- 实现产品 REST 查询接口。

完成标准：

- 非法目录阻止启动并提供字段级错误。
- 搜索符合 SPEC 排序。
- 所有合法金额转为整数分，非法金额返回稳定错误代码。
- 产品 JSON 中不存在价格字段。

专项测试：

```bash
uv run pytest backend/tests/domain/test_catalog.py backend/tests/domain/test_money.py backend/tests/api/test_products.py
uv run ruff check backend
uv run mypy backend
```

回归测试：

```bash
uv run pytest backend/tests/test_health.py
```

测试记录：

- 日期：2026-06-11
- 工作区/提交：本地工作区，尚未提交
- 命令：`uv run pytest backend/tests/domain/test_catalog.py backend/tests/domain/test_money.py backend/tests/api/test_products.py backend/tests/test_health.py`; `uv run ruff check backend`; `uv run ruff format --check backend`; `uv run mypy backend`; `uv run python scripts/check.py`
- 结果：6 个示例冰箱覆盖 4 类；目录模型、冲突校验、缺图占位、NFKC 搜索和排序、阿拉伯/中文金额解析及产品 REST 接口完成。完整检查通过：28 个 Python 测试、ESLint、TypeScript、Vitest 和生产构建均成功。
- 失败与处理：首次完整检查发现导入顺序和一处格式问题，使用 Ruff 修复后全部通过。

### 步骤 3：会话状态机与 JSON 持久化

- [x] 完成

实现内容：

- 定义 SessionState、GestureState、SpeechState 和 revision。
- 实现新场次创建、状态命令应用和状态快照。
- 实现 `runtime/session.json` 原子写入。
- 实现合法恢复、损坏文件备份、未知 schema 失败和删除产品修复。
- 实现结束场次及控制令牌旋转。
- 确保明文令牌不写入状态文件或日志。

完成标准：

- 每次有效持久变更只增加一次 revision。
- 写入失败不会广播未持久化状态。
- 异常重启可恢复价格和当前产品。
- 结束场次清空全部临时状态。

专项测试：

```bash
uv run pytest backend/tests/domain/test_session.py backend/tests/storage/test_session_store.py
uv run ruff check backend
uv run mypy backend
```

回归测试：

```bash
uv run pytest backend/tests/domain backend/tests/api/test_products.py
```

测试记录：

- 日期：2026-06-11
- 工作区/提交：本地工作区，尚未提交
- 命令：`uv run pytest backend/tests/domain/test_session.py backend/tests/storage/test_session_store.py`; `uv run pytest backend/tests/domain/test_session.py backend/tests/storage/test_session_store.py backend/tests/domain backend/tests/api/test_products.py`; `uv run ruff check backend`; `uv run ruff format --check backend`; `uv run mypy backend`; `uv run python scripts/check.py`
- 结果：完成 SessionState、GestureState、SpeechState、revision 命令应用、按产品价格、新场次、结束场次、令牌哈希、原子 JSON 写入、异常恢复、损坏备份、未知 schema 拒绝和删除产品修复。完整检查通过：44 个 Python 测试、ESLint、TypeScript、Vitest 和生产构建均成功。
- 失败与处理：初次静态检查发现 schema literal 类型、未使用导入和临时文件清理写法问题；修正后通过。补充验证了结束场次写入失败时内存状态和令牌不旋转。

### 步骤 4：REST、WebSocket 与单手机授权

- [x] 完成

实现内容：

- 实现 bootstrap、配对令牌和令牌校验接口。
- 实现桌面和手机 WebSocket。
- 实现命令信封、ack、错误和状态事件。
- 实现 expected revision、request ID 幂等和完整状态广播。
- 实现单桌面主连接、单手机槽位、断线宽限和重连。
- 实现权限矩阵，禁止手机结束场次。
- 加入心跳和超时清理。

完成标准：

- 第二个手机收到 `CONTROL_SLOT_OCCUPIED`。
- 旧 revision 命令不改变状态。
- 重复 request ID 不重复执行。
- 重连立即得到完整状态。
- 日志和错误不泄露令牌。

专项测试：

```bash
uv run pytest backend/tests/api/test_bootstrap.py backend/tests/ws
uv run ruff check backend
uv run mypy backend
```

回归测试：

```bash
uv run pytest backend/tests
```

测试记录：

- 日期：2026-06-11
- 工作区/提交：本地工作区，尚未提交
- 命令：`uv run pytest backend/tests/api/test_bootstrap.py backend/tests/ws/test_realtime.py backend/tests/test_logging.py`; `uv run ruff check backend`; `uv run ruff format --check backend`; `uv run mypy backend`; `uv run python scripts/check.py`
- 结果：完成 bootstrap、桌面配对令牌、令牌校验、桌面/手机 WebSocket、完整状态快照、revision 冲突、request_id 幂等、状态广播、动画事件、单桌面替换、单手机槽位、15 秒重连宽限、心跳、手机权限限制和结束场次断开。客户端状态和错误均隐藏令牌哈希，日志过滤器脱敏 token 查询值。完整检查通过：61 个 Python 测试、ESLint、TypeScript、Vitest 和生产构建均成功。
- 失败与处理：心跳测试最初使用 100ms 超时，在 Windows 测试线程调度下过短；调整为 50ms ping 和 1 秒测试超时，并模拟真实客户端处理交错 ping 后稳定通过。

### 步骤 5：桌面工作台与直播隐私边界

- [x] 完成

实现内容：

- 建立 `/studio` 页面和实时客户端 store。
- 实现 LiveCaptureFrame 与 PrivateConsole 兄弟节点布局。
- 实现 9:16 直播区域、背景、占位状态和采集辅助线。
- 实现连接状态、错误提示和重连。
- 建立禁止私有组件 portal 到直播区域的组件约束。

完成标准：

- 直播区域比例在目标窗口尺寸下保持正确。
- 搜索、令牌、摄像头和错误详情不在直播容器 DOM 中。
- WebSocket 重连后 UI 使用服务端完整快照。
- 页面缩放不会把后台挤入直播区域。

专项测试：

```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run src/pages/studio src/features/session
npm --prefix frontend run build
```

回归测试：

```bash
uv run pytest backend/tests
npm --prefix frontend run test -- --run
```

测试记录：

- 日期：2026-06-11
- 工作区/提交：本地工作区，尚未提交
- 命令：`npm --prefix frontend run lint`; `npm --prefix frontend run typecheck`; `npm --prefix frontend run test -- --run src/pages/studio src/features/session`; `npm --prefix frontend run build`; `uv run python scripts/check.py`; Browser DOM/geometry checks at 1280×720 and 700×900
- 结果：完成 typed bootstrap/WebSocket 客户端、ping/pong、指数退避重连、完整快照替换、LiveCaptureFrame 与 PrivateConsole 兄弟布局、9:16 直播区域、采集辅助线、连接与设备状态。61 个 Python 测试、4 个前端测试、lint、typecheck 和生产构建通过。浏览器验证两种视口均保持 9:16、无重叠、无横向溢出、无文字裁切，控制台无警告或错误。
- 失败与处理：浏览器截图命令连续发生 CDP capture 超时，无法保存截图；改用可重复的 DOM、边界矩形、比例、溢出和控制台检查完成视觉结构验证，并修正了窄视口标题的 3px 字体度量溢出。

### 步骤 6：产品摘要、详情与动画

- [x] 完成

实现内容：

- 实现摘要面板和详情面板。
- 实现互斥滑动切换及保持当前面板规则。
- 实现人民币金额格式和“价格待定”。
- 实现价格高亮和产品聚焦动画。
- 实现动画事件去重和重连不重播。
- 限制参数数量和文本溢出，避免直播区域滚动条。

完成标准：

- 任一时刻只有一个面板对观众可见。
- 切换产品不改变 active panel。
- 当前产品成功定价自动触发价格动画。
- 动画不永久遮挡核心信息。

专项测试：

```bash
npm --prefix frontend run test -- --run src/features/live
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

回归测试：

```bash
uv run pytest backend/tests
npm --prefix frontend run test -- --run
```

测试记录：

- 日期：2026-06-11
- 工作区/提交：本地工作区，尚未提交
- 命令：`npm --prefix frontend run test -- --run src/features/live src/features/session src/pages/studio`; `npm --prefix frontend run lint`; `npm --prefix frontend run typecheck`; `npm --prefix frontend run build`; `uv run pytest backend/tests/ws/test_realtime.py`; `uv run python scripts/check.py`; Browser DOM/computed-style checks at 1280×720 and 700×900
- 结果：完成本地产品图片、摘要/详情双面板、transform 滑动、面板保持、人民币格式、价格待定、最多 8 项参数、价格高亮、产品聚焦、event_id 去重和当前产品定价自动动画。完整检查通过：62 个 Python 测试、8 个前端测试、lint、typecheck 和生产构建。浏览器确认活动详情面板 opacity 1/transform 0、摘要面板隐藏、图片加载成功、两种视口无溢出或文字裁切，动画事件不增加 revision。
- 失败与处理：初次前端测试使用全局文本查询，因双面板按规格同时挂载而命中隐藏面板；改为在活动面板内断言。价格格式函数移至独立模块，消除 Fast Refresh 警告。

### 步骤 7：桌面私有操作

- [x] 完成

实现内容：

- 实现搜索框、结果列表、产品选择。
- 实现价格手动输入、错误反馈和当前产品编辑。
- 实现摘要/详情按钮、动画按钮和手势开关占位状态。
- 实现配对二维码、连接状态和结束场次确认。
- 所有业务修改通过 WebSocket 命令，不直接修改客户端权威状态。

完成标准：

- 搜索结果永不进入直播容器。
- 产品和价格在 ack 后反映到直播区域。
- revision 冲突时刷新状态并提示操作员。
- 结束场次后旧价格和旧手机授权消失。

专项测试：

```bash
npm --prefix frontend run test -- --run src/features/catalog src/features/controls
npm --prefix frontend run lint
npm --prefix frontend run typecheck
```

回归测试：

```bash
uv run pytest backend/tests
npm --prefix frontend run test -- --run
```

测试记录：

- 日期：2026-06-11
- 工作区/提交：本地工作区，尚未提交
- 命令：`npm --prefix frontend run test -- --run`; `uv run pytest -q`; `uv run python scripts/check.py`; Browser 交互与 DOM/geometry 检查（1280×720、700×900）
- 结果：完成后端目录搜索、产品选择、手动价格、摘要/详情切换、价格高亮、产品聚焦、手势开关、手机配对二维码和结束场次确认。完整检查通过：62 个 Python 测试、11 个前端测试、Ruff、format check、mypy、ESLint、TypeScript 和生产构建。浏览器逐项验证状态实时同步，确认框可安全取消，两种视口均保持精确 9:16、无横向溢出，私有操作和配对令牌不进入直播容器，控制台无警告或错误。
- 失败与处理：前端测试最初未在用例后卸载组件，导致多个私有控制台实例累积并产生重复元素；在全局测试设置中加入 React Testing Library `cleanup` 后全部通过。
- 失败与处理：

### 步骤 8：iPhone 手机控制端

- [x] 完成

实现内容：

- 建立 `/control/{token}`。
- 实现令牌校验、手机槽位、占用提示和重连宽限。
- 实现移动端产品搜索、选择、价格输入、面板和动画控制。
- 实现手势开关和语音目标控件。
- 适配 iPhone Safari 触控尺寸、安全区域和页面失焦。
- 确保 token 不进入前端错误上报或控制台日志。

完成标准：

- 唯一手机可以执行全部允许命令。
- 第二手机只能看到占用提示。
- 原手机短暂断线后恢复状态。
- 手机不能执行结束场次。

专项测试：

```bash
npm --prefix frontend run test -- --run src/pages/control src/features/mobile
npm --prefix frontend run lint
npm --prefix frontend run typecheck
uv run pytest backend/tests/ws/test_control_slot.py
```

回归测试：

```bash
uv run pytest backend/tests
npm --prefix frontend run test -- --run
```

测试记录：

- 日期：2026-06-11
- 工作区/提交：本地工作区，尚未提交
- 命令：`npm --prefix frontend run test -- --run src/features/mobile`; `npm --prefix frontend run lint`; `npm --prefix frontend run typecheck`; `uv run pytest backend/tests/ws/test_control_slot.py`; `uv run python scripts/check.py`; Browser 手机交互与 geometry 检查（390×844）
- 结果：完成 `/control/{token}`、令牌校验、稳定手机 client_id、占用/失效提示、指数退避重连、产品搜索选择、价格输入、面板与动画、手势开关和语音目标。手机页面不提供结束场次，token 不进入可见 UI。完整检查通过：66 个 Python 测试、14 个前端测试、Ruff、format check、mypy、ESLint、TypeScript 和生产构建。真实配对页面在 390×844 下无横向溢出，所有操作按钮至少 48px，高频状态实时同步到桌面。
- 失败与处理：Windows PowerShell 的 `npm` 包装命令一次异常挂起，改用 `npm.cmd` 后检查正常；浏览器插件当前只提供一个活动标签页，第二手机场景改由专门的 WebSocket 测试验证活动占用、正常释放、同 client_id 宽限期恢复和手机结束场次禁令。
- 失败与处理：

### 步骤 9：桌面语音识别与三秒提交

- [x] 完成

实现内容：

- 定义 SpeechRecognizerAdapter 及 Chrome 实现。
- 实现桌面“初始化语音”权限流程和能力状态。
- 手机 pointer 事件控制桌面开始/停止。
- 实现 interim/final 草稿同步。
- 后端实现三秒 reviewing deadline、编辑、确认、撤销和自动提交。
- 搜索和价格目标复用既有业务服务。
- 使用可控时钟和 mock 适配器完成自动测试。

完成标准：

- 不支持或拒绝权限时明确降级到手动输入。
- `pointercancel`、断线和页面失焦均能停止识别。
- 修改草稿不延长三秒 deadline。
- 非法价格不会覆盖当前值。
- 应用不保存原始音频。

专项测试：

```bash
uv run pytest backend/tests/domain/test_speech.py backend/tests/ws/test_speech_commands.py
npm --prefix frontend run test -- --run src/features/speech
npm --prefix frontend run typecheck
```

回归测试：

```bash
uv run pytest backend/tests
npm --prefix frontend run test -- --run
```

测试记录：

- 日期：2026-06-11
- 工作区/提交：本地工作区，尚未提交
- 命令：`uv run pytest backend/tests/domain/test_speech.py backend/tests/ws/test_speech_commands.py`; `npm --prefix frontend run test -- --run src/features/speech src/features/mobile`; `npm --prefix frontend run typecheck`; `uv run python scripts/check.py`; Browser 私有语音状态、倒计时、自动提交、错误降级与 DOM/geometry 检查
- 结果：完成 SpeechRecognizerAdapter 与 Chrome 包装、桌面显式初始化、能力状态实时同步、手机按住说话、pointerup/pointercancel/失焦停止、interim/final 草稿、三秒 reviewing deadline、编辑不延期、确认、撤销和自动提交。搜索草稿提交后驱动私有目录筛选；价格草稿复用金额解析且非法输入不覆盖旧值。完整检查通过：73 个 Python 测试、17 个前端测试、Ruff、format check、mypy、ESLint、TypeScript 和生产构建。浏览器确认 review/error UI 不进入直播容器、无横向溢出、控制台无错误。
- 失败与处理：浏览器自动化不代替真实麦克风授权，未请求或接受麦克风权限；通过 mock 适配器覆盖支持、拒绝、interim/final 和停止行为，真实 Chrome 中文语音服务保留在最终人工检查。浏览器验证时临时将 review deadline 调为 15 秒便于观察，完成后已恢复默认 3000ms。

### 步骤 10：MediaPipe Worker 与滑动识别

- [ ] 完成

实现内容：

- 固定 MediaPipe Tasks Vision 版本。
- 添加模型/WASM 下载、许可证记录和 SHA-256 校验脚本；只提交资源清单和哈希，不提交二进制资源。
- 实现摄像头选择、权限、预览和资源释放。
- 在 Web Worker 中初始化 Gesture Recognizer。
- 实现帧限速、忙碌丢帧和页面隐藏暂停。
- 实现 Open Palm 门禁和滑动轨迹分类器。
- 实现主线程候选事件、后端冷却复核和面板命令。
- 提供固定 landmark 轨迹与图片夹具；自动测试不得依赖真实摄像头。

完成标准：

- 左滑、右滑和无效轨迹符合 SPEC 参数。
- 关闭手势、冷却期间或低置信度事件不切换面板。
- Worker 失败不会破坏手机和桌面按钮控制。
- 生产运行不从 CDN 加载模型或 WASM。

专项测试：

```bash
npm --prefix frontend run test -- --run src/features/gesture src/workers
npm --prefix frontend run typecheck
npm --prefix frontend run build
uv run pytest backend/tests/domain/test_gesture.py backend/tests/ws/test_gesture_commands.py
```

回归测试：

```bash
uv run pytest backend/tests
npm --prefix frontend run test -- --run
```

测试记录：

- 日期：
- 工作区/提交：
- 命令：
- 结果：
- 失败与处理：

### 步骤 11：异常处理与恢复

- [ ] 完成

实现内容：

- 完成错误代码到中文 UI 的映射。
- 覆盖目录错误、状态文件损坏、写入失败和 revision 冲突。
- 覆盖手机断线、桌面断线、摄像头拒绝、模型加载失败和语音失败。
- 实现错误边界，保证私有错误不会渲染到直播区域。
- 加入结构化日志和令牌脱敏。
- 验证各可选能力失败时桌面基本控制仍可工作。

完成标准：

- 已定义错误代码均有自动测试或明确不可达说明。
- 损坏状态文件不会阻止安全启动。
- 日志中不存在明文令牌。
- 直播区域不会显示错误堆栈。

专项测试：

```bash
uv run pytest backend/tests -k "error or corrupt or reconnect or token"
npm --prefix frontend run test -- --run
npm --prefix frontend run lint
npm --prefix frontend run typecheck
```

回归测试：

```bash
uv run pytest backend/tests
npm --prefix frontend run test -- --run
npm --prefix frontend run build
```

测试记录：

- 日期：
- 工作区/提交：
- 命令：
- 结果：
- 失败与处理：

### 步骤 12：端到端验收与本地交付

- [ ] 完成

实现内容：

- 完成 FastAPI 提供生产前端静态文件。
- 完成 `uv run live-background` 的地址和二维码输出。
- 编写 Playwright 场景，模拟桌面、手机、语音和手势。
- 加入直播区域截图和 DOM 隐私断言。
- 加入结束场次、异常重启和断线重连端到端场景。
- 完善 README 启动、构建、测试及真实设备检查说明。
- 执行统一检查脚本。

完成标准：

- 新环境可按 README 安装、构建并启动。
- 所有自动测试通过。
- 生产模式不依赖 Vite 开发服务器或 CDN。
- PRD 的自动化 MVP 验收标准全部有对应测试证据。

专项测试：

```bash
npm --prefix frontend run test:e2e
uv run python scripts/check.py
```

最终测试记录：

- 日期：
- 工作区/提交：
- Python 版本：
- Node 版本：
- 浏览器版本：
- 命令：
- 结果：
- 未解决问题：

## 4. 最终人工检查

自动测试全部通过后，在目标本地电脑执行：

- [ ] Chrome 可授权并读取第二摄像头。
- [ ] 真实手势可稳定区分左滑和右滑，普通动作不会频繁误触。
- [ ] Chrome 中文语音识别可初始化并被手机长按流程控制。
- [ ] iPhone Safari 可通过局域网配对、控制和重连。
- [ ] 抖音直播伴侣只采集直播区域，没有后台泄露。
- [ ] 1080×1920 预览中产品名称、型号、价格和参数可读。
- [ ] 长时间运行中摄像头、Worker、WebSocket 和内存占用稳定。

人工检查结果不反向降低自动测试标准。发现产品或技术规格问题时，按文档优先级修订后重新执行相关步骤。
