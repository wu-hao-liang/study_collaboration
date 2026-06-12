# 抖音直播冰箱咨询互动背景

本项目是在本地 Windows 电脑运行的抖音直播互动背景 MVP。当前实现从
`PLAN.md` 的步骤 1 开始，提供 Python/FastAPI 后端骨架、CLI、健康接口和
React/Vite 前端工程骨架。

## 本地启动

```powershell
uv sync
uv run live-background
```

启动后访问：

- 桌面工作台：`http://127.0.0.1:8000/studio`
- 健康接口：`http://127.0.0.1:8000/api/health`

## 检查

```powershell
uv run python scripts/check.py
```

Win11 环境需要可用的 `npm` 才能执行前端 lint、typecheck、test 和 build。
