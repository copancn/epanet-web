# EPANET Web · 管网水力模拟

**在浏览器中绘制供水管网并运行 EPANET 水力 / 水质（含 MSX 多组分）模拟。**
**Draw a water distribution network in the browser and run EPANET hydraulic & quality (incl. MSX multi-species) simulations.**

[中文](#中文) · [English](#english)

一个独立的 Web 应用：Go 后端通过纯 Go（无 cgo）的 syscall 绑定调用官方 `epanet2.dll` 引擎，并可选加载 `epanetmsx.dll` 实现多组分水质；前端为零依赖的原生 JavaScript 单页应用，所有资源经 `go:embed` 打包进单个可执行文件。

An independent web app: a Go backend calls the official `epanet2.dll` engine through a pure-Go (no cgo) syscall binding, and optionally loads `epanetmsx.dll` for multi-species quality. The frontend is a dependency-free vanilla JavaScript SPA. Everything is embedded into a single executable via `go:embed`.

---

## 中文

### 功能特性

- **组件库画布绘制**：手风琴组件库（节点 / 管段 / 全部 7 种阀门 PRV·PSV·PBV·FCV·TCV·GPV·PCV），点选组件即进入绘制并预填工程默认值，无需绘制后再配置；每种阀门有独立 SVG 图标与画布标记；平移、无级缩放、选择与属性编辑，保留快捷键。
- **EPANET 模拟**：一键运行水力与水质模拟，按时间步浏览结果；绘制与模拟阶段共用同一套渲染与悬停提示，画面一致、清晰（DPR 感知）。
- **EPANET-MSX 多组分水质**：内置余氯衰减（本体 + 壁面）预置；结构化编辑物种 / 系数 / 项 / 反应 / 源 / 初始水质，也可双向编辑原始 `.msx` 文本；经 `.hyd` 与水力耦合，工作进程加载 `epanetmsx.dll` 在进程池并行求解；结果提供多组分节点 / 管段浓度表、单元时间序列曲线与按 `msx:<物种>` 着色。可选能力，缺失 DLL 时自动降级。
- **漏损分析**：漏损率（对照 9% 考核阈值）、漏损 / 供水时间积分量、可调夜间最小流量（MNF）窗口并与 FAVAD 模型互校、管段漏损排名；管道属性提供材质 FAVAD 指数参考；PRV 分时调压向导由时间 - 压力曲线批量生成 CLOCKTIME 阀门设定控制。
- **明 / 暗主题**：整体界面切换，画布与地图底图同步适配，暗色下管线与标注依然清晰。
- **地图底图与地理配准**：可选 OpenStreetMap 底图，通过锚点节点、缩放、旋转、透明度将管网配准到真实坐标。
- **撤销 / 重做**：基于管网快照的历史栈。
- **管网检查 + 一键修复**：自动发现孤立节点、悬空管段、重复 ID、非法管径 / 长度、缺少水源等问题并给出可一键执行的修复。
- **结果导出与图表**：导出长格式 CSV（节点 / 管段 × 时间步），查看所选对象的时间序列曲线；求解统计面板与 EPANET 全文报告，可导出 `.rpt`；新增发射器流量、节点 / 管段漏损、实际供水、请求需水、源质量流入等 EPANET 2.3 指标，贯穿表格 / 悬停 / 着色 / 图表 / CSV。
- **GIS 导入**：导入 GeoJSON / CSV，自动或手动映射 ID、类型、高程、需水、经纬度字段，生成带地理参考的管网。
- **DEM 自动高程**：基于 Terrarium 高程瓦片，为选中或全部接点 / 水池自动赋值地面高程。
- **图形化数据编辑（标签页 + 树形主从）**：模式 / 曲线 / 控制 / 规则四类标签页，左侧树菜单 + 右侧编辑选中项；切换保留编辑、应用统一提交、关闭丢弃；增删改名实时更新并保证 ID 唯一。拖拽柱形需水模式（恒定 / 日变化 / 夜间预设）、拖拽点曲线（双击增删）、结构化简单控制（CONTROLS）与多行规则（RULES：IF / THEN / ELSE），无需手写文本。
- **设置面板与分阶段向导**：七类折叠（单开手风琴）设置；新建工程与编辑设置均有分阶段向导，每类一步、可跳过、未配置保留默认；向导与自动保存 / 撤销隔离，取消即恢复原管网。
- **水质反应与源**：主体 / 管壁 / 水池反应阶数与全局系数、限制浓度、粗糙度相关；节点水质源（浓度 / 质量注入 / 设定点 / 流量比例）含强度与模式。
- **压力驱动需水（PDA）**：DDA / PDA 切换与最低 / 必需压力、指数参数；结果含需水缺口。接点支持多需水类别（各自模式）。
- **水池 / 发射器 / 漏失**：水池混合模型（MIX1 / MIX2 / FIFO / LIFO）、混合区比例与溢流；接点发射器系数与倒流；管道漏失面积 / 膨胀系数。
- **水泵能量与效率**：效率曲线、电价与电价模式、需量电费；结果给出运行功率 (kW)、效率 (%) 与累计能耗 (kWh)。
- **高级选项**：压力单位、比重 / 粘度 / 扩散系数、发射器指数、默认需水模式、检查频率 / 阻尼 / 收敛阈值、水质与规则步长。
- **数值着色扩展**：节点按水位 / 需水缺口，管段按能耗 / 效率 / 设定值着色；并支持发射器流量、节点 / 管段漏损、实际 / 请求需水、源质量流入等着色。
- **INP 互通**：导入 / 导出 EPANET `.inp` 文件，保真解析反应 / 源 / 混合 / 能量等高级段。
- **双语界面**：中文 / English 即时切换；阀门类型下拉以本地化描述 + 标准代码显示（如 减压阀 PRV）。
- **并发模拟**：工作子进程池，多路模拟真正并行。

### 环境要求

- **操作系统**：Windows x64（引擎经 syscall 调用 `epanet2.dll`，无需 cgo / C 编译器）。
- **Go**：1.26 及以上（`go.mod` 声明 `go 1.26.5`）。
- **引擎**：仓库已随附官方 `epanet2.dll`（EPANET 2.x，当前引擎版本号 `20305`），开箱即用。
- **多组分（可选）**：随附 `epanetmsx.dll`（EPANET-MSX）；缺失时多组分水质自动禁用，其余功能不受影响。

### 快速开始

```bash
# 构建（在仓库根目录）
go build -o epanet-web.exe .

# 运行
./epanet-web.exe
```

启动后浏览器打开 <http://127.0.0.1:8770> 即可。也可以直接 `go run .`。

首次进入会自动加载示例管网（水库 + 水泵 + 水池 + 环状需水），点击「运行」即可看到模拟结果。

### 命令行参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-addr` | `127.0.0.1:8770` | HTTP 监听地址 |
| `-dll` | 自动查找 | `epanet2.dll` 路径 |
| `-msxdll` | 自动查找 | `epanetmsx.dll` 路径（多组分水质；缺失则禁用） |
| `-workers` | `min(CPU 核数, 8)` | 模拟工作进程数（并发模拟路数） |
| `-worker` | `false` | 内部使用：以模拟工作子进程模式运行 |

DLL 查找顺序：`-dll` 指定路径 → 可执行文件同目录 → 当前工作目录 → 已知 SDK 位置。`epanetmsx.dll` 同理（`-msxdll`）；缺失时多组分水质自动禁用，EPANET 仍可运行。

### 使用指南

1. **绘制**：左侧组件库点选节点 / 管段 / 阀门即进入绘制（预填工程默认值）；管段依次点击起点与终点。选中对象后在右侧属性面板编辑参数。
2. **数据**：打开数据编辑器，用模式 / 曲线 / 控制 / 规则四类标签页 + 左侧树菜单主从编辑，图形化设置需水模式、水泵曲线、简单控制（CONTROLS）与多行规则（RULES）。
3. **设置**：用手风琴设置面板或分阶段向导配置流量单位、水头损失公式、需水乘数、时间参数、统计与水质类型，以及需水模型（DDA / PDA）、反应、能量 / 成本与高级选项。
4. **模拟与结果**：点击「运行」，用时间滑块浏览各时间步；悬停 / 点击对象查看指标与时间序列曲线；结果面板含节点 / 管段表格、求解统计、全文报告、漏损分析与多组分水质。多组分先在 MSX 配置载入余氯预置或编辑物种 / 反应；PRV 分时调压向导可批量生成调压控制。
5. **检查 / 导出**：运行管网检查并一键修复；导出结果 CSV、EPANET 报告 `.rpt` 或管网 `.inp`。
6. **GIS / DEM**（可选）：开启地图底图并配准；导入 GeoJSON / CSV；用 DEM 为节点自动赋高程。

### HTTP API

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `{ready, version, workers, idle}` |
| GET | `/api/example` | — | 示例管网 JSON |
| POST | `/api/simulate` | 管网 JSON | 模拟结果 JSON（含 MSX，若启用） |
| POST | `/api/report` | 管网 JSON | 含全文报告与统计的模拟结果 JSON |
| POST | `/api/import` | `.inp` 文本 | 管网 JSON |
| POST | `/api/export` | 管网 JSON | `.inp` 文件（附件 `network.inp`） |
| GET | `/` | — | 内嵌 Web UI |

请求体上限 16 MB。

### 项目结构

```
epanet-web/
├── main.go            # 入口：命令行参数、嵌入 web、DLL/MSX 解析、进程池、优雅关闭
├── epanet/            # 纯 Go syscall 绑定 EPANET 2.x DLL（无 cgo）
├── msx/               # 纯 Go syscall 绑定 EPANET-MSX DLL（只读，多组分水质）
├── model/             # 管网数据模型、INP 解析/生成、MSX 配置/预置、示例管网、结果类型
├── pool/              # 模拟工作子进程池（真正并行，加载 EPANET + MSX）
├── server/            # HTTP 处理、内嵌 UI 服务、模拟编排（水力 + MSX 耦合）
├── web/               # 前端 SPA：app.js / i18n.js / style.css / index.html
├── reference/         # 本地参考：EPANET 引擎源码（MIT，已 gitignore，不参与构建）
├── epanet2.dll        # 随附的官方 EPANET 引擎
├── epanetmsx.dll      # 随附的 EPANET-MSX 引擎（可选，多组分水质）
└── go.mod
```

### 技术架构

- **无 cgo 的引擎绑定**：仅使用基于指针 / 整型的 toolkit 函数；管网数据通过 INP 文件传入，避免按值传递单精度浮点（Windows x64 syscall ABI 无法正确编组）。
- **MSX 多组分耦合**：只读 MSX syscall 绑定；先完成水力求解并保存 `.hyd`，再加载 MSX 化学文件耦合求解；工作进程同时加载 `epanet2.dll` 与 `epanetmsx.dll`，多组分模拟同样走进程池并行。MSX 为可选，DLL 缺失时自动降级为单组分水质。
- **进程池并行**：EPANET 传统 API 为全局单线程状态，每个工作子进程独立加载 DLL、一次服务一个模拟；进程池跨工作进程分发任务实现真正并行。父子进程通过 stdin/stdout 的换行分隔 JSON 流通信；父进程退出时管道关闭，工作进程随 EOF 退出，不会残留。
- **单可执行文件**：`go:embed web` 将前端打包进二进制，部署只需 `.exe` + `epanet2.dll`（多组分另需 `epanetmsx.dll`）。
- **前端**：原生 JavaScript，单个 DPR 感知的 2D 画布，CSS 自定义属性主题，`i18n.js` 提供中 / 英文案。

### 关于 EPANET 引擎与致谢

- **EPANET** 是美国环境保护署（US EPA）开发的公共领域（public domain）供水管网水力 / 水质模拟引擎。本仓库随附官方 `epanet2.dll`。
- **EPANET-MSX** 是 US EPA 的多组分（multi-species）水质扩展。本仓库随附 `epanetmsx.dll`（可选）。
- **引擎源码参考**：`reference/epanet-engine/` 为本地留存的上游 EPANET 引擎源码（MIT 许可），仅用于 API / 语义查阅，已 gitignore、不参与构建与分发。
- **地图瓦片**：© OpenStreetMap 贡献者（ODbL）。
- **高程瓦片**：Mapzen / Terrarium 高程瓦片（AWS 公共数据集）。

本项目为独立实现，未包含第三方 copyleft / 竞争性许可代码。项目自身代码的许可证尚未指定。

---

## English

### Features

- **Component-palette canvas editing**: an accordion component library (nodes / links / all 7 valve subtypes PRV·PSV·PBV·FCV·TCV·GPV·PCV). Clicking a component arms the draw tool and pre-fills engineering defaults, so elements need no post-draw configuration; each valve subtype has a distinct SVG icon and on-canvas mark. Pan, stepless zoom, selection and property editing, with keyboard shortcuts preserved.
- **EPANET simulation**: one-click hydraulic & quality runs with time-step browsing. Drawing and simulation share the same rendering and hover tooltips for a consistent, crisp (DPR-aware) view.
- **EPANET-MSX multi-species quality**: a built-in chlorine-decay (bulk + wall) preset; structured editors for species / coefficients / terms / reactions / sources / initial quality, plus bidirectional raw `.msx` text. Coupled to hydraulics via a saved `.hyd`; workers load `epanetmsx.dll` so multi-species runs execute in the process pool. Results offer multi-species node / link concentration tables, a per-element time-series chart and coloring by `msx:<species>`. Optional — gracefully disabled when the DLL is absent.
- **Leakage analysis**: leakage rate (vs a 9% target), integrated leakage / supply volumes, an adjustable minimum-night-flow (MNF) window cross-checked against the FAVAD model, and a per-pipe leakage ranking. Pipe properties include material reference chips for the FAVAD exponent; a PRV pressure wizard batch-generates CLOCKTIME valve-setting controls from a time-pressure profile for time-modulated pressure management.
- **Light / dark theme**: full UI switch; the canvas and map basemap adapt together so pipes and labels stay legible in dark mode.
- **Map basemap & georeferencing**: optional OpenStreetMap layer; align the network to real coordinates via an anchor node, scale, rotation and opacity.
- **Undo / redo**: network-snapshot history stack.
- **Network review + one-click fixes**: detects isolated nodes, dangling links, duplicate IDs, invalid diameters / lengths, missing sources and more, with actionable one-click fixes.
- **Results export & chart**: export long-format CSV (node / link × time step) and view a time-series chart for the selected object; a solver-statistics panel and the full EPANET text report, exportable as `.rpt`. Adds EPANET 2.3 metrics — emitter flow, node / pipe leakage, delivered demand, requested demand and source mass inflow — across tables, tooltips, color-by, charts and CSV.
- **GIS import**: import GeoJSON / CSV with automatic or manual mapping of ID, type, elevation, demand and lon/lat fields, producing a georeferenced network.
- **DEM auto-elevation**: assign ground elevation to selected or all junctions / tanks from Terrarium elevation tiles.
- **Graphical data editing (tabs + tree master-detail)**: four category tabs (patterns / curves / controls / rules) with a left tree menu and a right pane editing the selected item; switching preserves edits, Apply commits all, closing discards; add / delete / rename update the tree live with unique IDs. Drag-bar demand patterns (constant / diurnal / night presets), drag-point curves (double-click add/remove), a structured simple-controls (CONTROLS) builder and a multi-line rule (RULES: IF / THEN / ELSE) editor — no free-text typing required.
- **Settings panel & staged wizard**: seven collapsible (single-open accordion) settings categories; a step-by-step wizard for new projects and existing settings where each category is one skippable step and unconfigured steps keep defaults. Wizard edits are isolated from autosave / undo; cancel restores the prior network.
- **Quality reactions & sources**: bulk / wall / tank reaction orders and global coefficients, limiting concentration, roughness correlation; per-node quality sources (CONCEN / MASS / SETPOINT / FLOWPACED) with strength and pattern.
- **Pressure-driven demand (PDA)**: DDA / PDA switch with minimum / required pressure and exponent; results include demand deficit. Junctions support multiple demand categories (each with its own pattern).
- **Tanks / emitters / leakage**: tank mixing models (MIX1 / MIX2 / FIFO / LIFO), mixing fraction and overflow; junction emitter coefficient and backflow; pipe leak area / expansion.
- **Pump energy & efficiency**: efficiency curve, energy price and price pattern, demand charge; results report operating power (kW), efficiency (%) and cumulative energy (kWh).
- **Advanced options**: pressure units, specific gravity / viscosity / diffusivity, emitter exponent, default demand pattern, check frequency / damping / convergence thresholds, quality and rule time steps.
- **Extended value coloring**: color nodes by level / demand deficit and links by energy / efficiency / setting; also emitter flow, node / pipe leakage, delivered / requested demand and source mass inflow.
- **INP interop**: import / export EPANET `.inp` files with faithful parsing of advanced sections (reactions / sources / mixing / energy).
- **Bilingual UI**: instant Chinese / English switching; valve-type dropdowns show a localized description plus the standard code (e.g. Pressure reducing (PRV)).
- **Concurrent simulation**: a worker-subprocess pool runs multiple simulations truly in parallel.

### Requirements

- **OS**: Windows x64 (the engine is called via syscall on `epanet2.dll`; no cgo / C compiler needed).
- **Go**: 1.26+ (`go.mod` declares `go 1.26.5`).
- **Engine**: the official `epanet2.dll` (EPANET 2.x, reported engine version `20305`) is bundled in the repo — works out of the box.
- **Multi-species (optional)**: `epanetmsx.dll` (EPANET-MSX) is bundled; when absent, multi-species quality is disabled automatically and everything else still works.

### Quick start

```bash
# Build (from the repository root)
go build -o epanet-web.exe .

# Run
./epanet-web.exe
```

Then open <http://127.0.0.1:8770> in your browser. `go run .` also works.

On first load an example network (reservoir + pump + tank + looped demands) is loaded automatically — click **Run** to see simulation results.

### Command-line flags

| Flag | Default | Description |
| --- | --- | --- |
| `-addr` | `127.0.0.1:8770` | HTTP listen address |
| `-dll` | auto-detected | Path to `epanet2.dll` |
| `-msxdll` | auto-detected | Path to `epanetmsx.dll` (multi-species quality; disabled if absent) |
| `-workers` | `min(CPU count, 8)` | Number of simulation worker processes (parallel runs) |
| `-worker` | `false` | Internal: run as a simulation worker subprocess |

DLL search order: `-dll` path → next to the executable → working directory → known SDK location. `epanetmsx.dll` follows the same order (`-msxdll`); when absent, multi-species quality is disabled automatically and EPANET still runs.

### Usage

1. **Draw**: click a node / link / valve in the left component palette to arm drawing (engineering defaults pre-filled); for a link, click its start then end node. Edit parameters in the right-hand property panel after selecting an object.
2. **Data**: open the data editor and use the four category tabs (patterns / curves / controls / rules) with the left tree master-detail layout to graphically set demand patterns, pump curves, simple controls (CONTROLS) and multi-line rules (RULES).
3. **Settings**: use the accordion settings panel or the staged wizard to configure flow units, head-loss formula, demand multiplier, time parameters, statistic and quality type, plus the demand model (DDA / PDA), reactions, energy / cost and advanced options.
4. **Simulate & results**: click **Run**, scrub the time slider across time steps; hover / click an object for metrics and a time-series chart. The results panel includes node / link tables, solver statistics, the full report, leakage analysis and multi-species quality. For multi-species, load the chlorine preset or edit species / reactions in the MSX config first; the PRV pressure wizard can batch-generate pressure-management controls.
5. **Review / export**: run the network review and apply one-click fixes; export results CSV, the EPANET report `.rpt` or the network `.inp`.
6. **GIS / DEM** (optional): enable and georeference the map basemap; import GeoJSON / CSV; auto-assign node elevations from DEM.

### HTTP API

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `{ready, version, workers, idle}` |
| GET | `/api/example` | — | Example network JSON |
| POST | `/api/simulate` | Network JSON | Simulation result JSON (incl. MSX when enabled) |
| POST | `/api/report` | Network JSON | Simulation result JSON with full report & statistics |
| POST | `/api/import` | `.inp` text | Network JSON |
| POST | `/api/export` | Network JSON | `.inp` file (attachment `network.inp`) |
| GET | `/` | — | Embedded web UI |

Request body limit: 16 MB.

### Project structure

```
epanet-web/
├── main.go            # Entrypoint: flags, embedded web, DLL/MSX resolution, pool, graceful shutdown
├── epanet/            # Pure-Go syscall binding to the EPANET 2.x DLL (no cgo)
├── msx/               # Pure-Go syscall binding to the EPANET-MSX DLL (read-only, multi-species)
├── model/             # Network model, INP parse/write, MSX config/preset, example network, result types
├── pool/              # Simulation worker-subprocess pool (true parallelism, loads EPANET + MSX)
├── server/            # HTTP handlers, embedded UI serving, simulation orchestration (hydraulics + MSX)
├── web/               # Frontend SPA: app.js / i18n.js / style.css / index.html
├── reference/         # Local reference: EPANET engine source (MIT, gitignored, not built)
├── epanet2.dll        # Bundled official EPANET engine
├── epanetmsx.dll      # Bundled EPANET-MSX engine (optional, multi-species quality)
└── go.mod
```

### Architecture

- **No-cgo engine binding**: only pointer/int-based toolkit functions are used; network data is supplied through an INP file so no single-precision float is ever passed by value (which the Windows x64 syscall ABI cannot marshal correctly).
- **MSX multi-species coupling**: a read-only MSX syscall binding; hydraulics are solved first and saved to a `.hyd`, then the MSX chemistry file is loaded and coupled. Workers load both `epanet2.dll` and `epanetmsx.dll`, so multi-species runs also use the process pool. MSX is optional and degrades to single-species quality when the DLL is absent.
- **Process-pool parallelism**: the legacy EPANET API keeps global single-threaded state, so each worker subprocess loads its own DLL instance and serves one simulation at a time; the pool dispatches jobs across workers for true parallelism. Parent and workers communicate over a newline-delimited JSON stream on stdin/stdout; when the parent exits the pipe closes and workers exit on EOF, so they never orphan.
- **Single executable**: `go:embed web` packs the frontend into the binary — deployment needs only the `.exe` + `epanet2.dll` (plus `epanetmsx.dll` for multi-species).
- **Frontend**: vanilla JavaScript, a single DPR-aware 2D canvas, CSS custom-property theming, and `i18n.js` for Chinese / English strings.

### About the EPANET engine & acknowledgements

- **EPANET** is a public-domain water distribution hydraulic / quality simulation engine developed by the US Environmental Protection Agency (EPA). The official `epanet2.dll` is bundled in this repository.
- **EPANET-MSX** is the EPA's multi-species water-quality extension. `epanetmsx.dll` is bundled in this repository (optional).
- **Engine source reference**: `reference/epanet-engine/` holds a local copy of the upstream EPANET engine source (MIT license) for API / semantics lookup only; it is gitignored and not built or distributed.
- **Map tiles**: © OpenStreetMap contributors (ODbL).
- **Elevation tiles**: Mapzen / Terrarium elevation tiles (AWS public dataset).

This project is an independent implementation and contains no third-party copyleft / competing-license code. A license for the project's own code has not yet been specified.