# 牛来备忘录

带桌宠的待办事项与工作流管理工具（Windows / Electron）。

## 功能

- **重要事项**：按 次要 / 重要 / 非常重要 分级，支持行内编辑
- **工作流程**：多步骤流程，按住序号可拖动排序；卡片左上角 ✎ 可随时编辑；一键清空已完成
- **桌宠**：跟随鼠标跑动、点击互动、闲置每 5 秒轮播待办气泡、完成待办涨经验升级、4 套外观
- **悬浮模式**：最小化时收缩为桌面悬浮宠物，悬停展开待办面板，可自由拖动
- **弹弓彩蛋**：在主窗内按住宠物拖拽后松手，触发愤怒的小鸟式弹射（Matter.js 物理）
- **自动更新**：启动时静默检查，下载校验后自动替换并重启，无需重装

## 开发

```bash
cd app
npm install
npm start          # 开发运行
```

## 发布新版本

```bash
node scripts/release.js patch   # patch / minor / major
```

会依次：升版本号 → 构建 portable exe → 计算 sha256 → 生成 `update.json` → 用 `gh` 上传到 GitHub Release。
已安装的旧版本会在下次启动或 6 小时内自动更新。

需要先安装并登录 GitHub CLI（`gh auth login`）。

## 数据位置

`%APPDATA%/niulai-memo/store.json`（自动保留一份 `.bak` 备份）

## 许可

MIT
