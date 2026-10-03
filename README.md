# 压感笔迹页（React + Canvas + Web Worker）

本地手写/批注页面：支持压感笔、缩放与平移，单文档最多 **20,000** 个采样点，
橡皮按整条笔画擦除并支持分组撤销，笔画平滑在 Worker 中按代次回收。

## 运行

```bash
npm install
npm run dev      # 开发
npm test         # 34 个单测
npm run build    # 类型检查 + 生产构建（Worker 独立分包）
```

## 交互

- **笔**：压感自动生效（`pointerType=pen` 用真实 pressure，0 回退 0.5；鼠标固定 0.5）。
- **预测点**：蓝色虚线临时预览，松笔即清，**不进入保存 / 擦除 / 导出**。
- **橡皮**：工具栏选择，或直接用笔尾 `pointerType=eraser` / 笔的桶状按钮。一次擦除手势
  经过的所有笔画合并为**一个可撤销操作**。
- **缩放**：Ctrl/Cmd + 滚轮（以光标为锚）；**平移**：滚轮或抓手工具（也支持中键拖拽）。
- **撤销/重做、1:1 复位、导出 JSON、Worker 平滑开关**均在工具栏。

## 架构与关键不变量

```
PointerEvent
  → pointerAdapter   读 coalesced（真实）/ predicted（预测）/ 按钮橡皮
  → ingest           IngestSession：合并分批、压感归一化、坐标换算、取消语义
  → docReducer       提交 / 擦除分组 / 撤销重做 / 代次裁决（纯函数）
        ├─ Worker    smoothStroke(samples) → {id, gen, points}
        └─ render    只读重绘（raw + smoothed + 预测 overlay），绝不回写 samples
  → export           只序列化权威采样
```

| 需求 | 实现位置 |
| --- | --- |
| 合并 Pointer Events，分批结果一致 | `ingest.ts` `mergeBatch`（时间戳/几何去重，保序） |
| 预测点只做临时预览 | `IngestSession.predicted`，从不 push 进 `samples`；导出无此字段 |
| 压力与坐标绑定笔画 | 归一化后与坐标打包进同一 `Sample`，在 down 时即换算文档坐标 |
| 抬笔提交完整笔画 | `finish()` 一次性 `commit`；取消/丢失捕获 `cancel()` 丢弃整条 |
| 20,000 点上限 | 提交时按整笔判定，超限整笔拒绝并提示 |
| 橡皮命中删整条 + 单次撤销 | `strokeHit` 命中测试；一次手势累积 ids，单个 `erase` UndoEntry |
| Worker 结果按笔画+代次接收 | 每笔画带 `gen`；复活（撤销/重做）重打 gen 并清平滑缓存，旧结果丢弃 |
| 重绘不改保存采样 | `render.ts` 只读；`smoothed` 为独立显示缓存，导出不含 |
| 坐标变换 | 采样存文档坐标，`screenToDocument/zoomAt/pan` 统一换算 |

## 测试覆盖

- `geometry.test.ts`：文档↔屏幕互逆、锚点缩放、平移、线段距离、**变换后的橡皮命中**。
- `ingest.test.ts`：**不同事件分批产生相同笔画**、去重、压感绑定/回退、
  **预测点隔离与不支持时回退**、cancel / 重复 finish。
- `docReducer.test.ts`：上限、整笔拒绝、**擦除分组撤销/重做**、**旧 gen Worker 结果
  不能复活笔画**、平滑采纳不改原始采样。
- `smoothing.test.ts`：确定性、端点保持、导出字段白名单。
- `integration.test.ts`：缩放视图下书写→坐标换算→擦除→一次撤销恢复→导出的全链路。
