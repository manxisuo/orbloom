# 星球值日生 · Orbloom

转动昼夜，照料属于你的微小世界。

一颗几十米大小的星球，只有朝向太阳的一面获得阳光。你通过拖动旋转星球，为不同区域分配白天、黄昏与黑夜，并在此基础上播种、引兽、降雨，建立会自行运转的微型生态。

## 当前版本（MVP）

- 可拖动旋转 / 滚轮缩放的低多边形星球
- 固定太阳 + 昼夜分界可视化
- 点击球面种树、种草、引入兔子、降下小雨
- 植物按光照与水分生长；湖泊会蒸发
- 兔子沿球面游荡、觅食、进食、夜晚睡眠
- 星尘资源与生态稳定度
- 时间暂停 / 1× / 2× / 4×
- 星球日志
- IndexedDB 存档（自动 + 手动），启动时可「继续值日 / 新星球」

## 开发

```bash
npm install
npm run dev
```

浏览器打开终端提示的本地地址（默认 `http://localhost:5173`）。

```bash
npm run build   # 类型检查 + 生产构建
npm test        # Vitest（存档层）
npm run preview
```

## 技术栈

- Vite + Vue 3 + TypeScript + Pinia
- Three.js（WebGLRenderer）
- 模拟层（`src/simulation`）不依赖 Three.js / Vue，便于单独演进
- 存档层（`src/persistence`）只依赖 `StorageAdapter` 接口

## 存档架构

```text
SaveRepository
    └── StorageAdapter          # 抽象：get / set / delete / keys
            ├── IndexedDbStorageAdapter   # 默认
            ├── LocalStorageAdapter       # 回退 / 证明可切换
            └── MemoryStorageAdapter      # 测试
```

- 存档带 `schemaVersion` 与 `seed`，结构变更时走 `migrations.ts`
- 自动存档：每 45 秒、页面隐藏（关闭时尽力保存，不保证完成）
- 默认槽位 `autosave`；`SaveRepository` 也支持多槽 `listSaves` / `deleteSave`

## 目录结构

```text
src/
├── app/            # Vue UI（HUD、工具、日志、启动层）
├── game/           # 游戏编排、输入 → 命令、自动存档
├── persistence/    # 存储抽象 + IndexedDB / LocalStorage / Memory
├── rendering/      # Three.js 星球与实体表现
├── simulation/     # 气候 / 生态 / 行为（纯逻辑）
└── shared/         # 类型与球面数学
```

## 操作

| 操作 | 效果 |
| --- | --- |
| 拖动画布 | 旋转星球（控制各地昼夜） |
| 滚轮 | 缩放 |
| 左侧工具 + 点击球面 | 种树 / 种草 / 引兔 / 降雨 |
| 右上角速度 | 暂停与加速 |

## 设计文档

- 完整创意见 [游戏描述.md](./游戏描述.md)
- 技术选型与架构见 [技术栈.md](./技术栈.md)
