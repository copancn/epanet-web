# EPANET Web · 管网水力模拟

**在浏览器中绘制供水管网并运行 EPANET 水力 / 水质模拟。**
**Draw a water distribution network in the browser and run EPANET hydraulic & quality simulations.**

[中文](#中文) · [English](#english)

一个独立的 Web 应用：Go 后端通过纯 Go（无 cgo）的 syscall 绑定调用官方 `epanet2.dll` 引擎，前端为零依赖的原生 JavaScript 单页应用，所有资源经 `go:embed` 打包进单个可执行文件。

An independent web app: a Go backend calls the official `epanet2.dll` engine through a pure-Go (no cgo) syscall binding, while the frontend is a dependency-free vanilla JavaScript SPA. Everything is embedded into a single executable via `go:embed`.

---

## 中文

### 功能特性

- **画布绘制管网**：节点（接点 / 水库 / 水池）与管段（管道 / 水泵 / 阀门 PRV·PSV·PBV·FCV·TCV·GPV·PCV），平移、无级缩放、选择与属性编辑。
- **EPANET 模拟**：一键运行水力与水质模拟，按时间步浏览结果；绘制与模拟阶段共用同一套渲染与悬停提示，画面一致、清晰（DPR 感知）。
- **明 / 暗主题**：整体界面切换，画布与地图底图同步适配，暗色下管线与标注依然清晰。
- **地图底图与地理配准**：可选 OpenStreetMap 底图，通过锚点节点、缩放、旋转、透明度将管网配准到真实坐标。
- **撤销 / 重做**：基于管网快照的历史栈。
- **管网检查 + 一键修复**：自动发现孤立节点、悬空管段、重复 ID、非法管径 / 长度、缺少水源等问题并给出可一键执行的修复。
- **结果导出与图表**：导出长格式 CSV（节点 / 管段 × 时间步），查看所选对象的时间序列曲线；另有求解统计面板与 EPANET 全文报告，可导出 `.rpt`。
- **GIS 导入**：导入 GeoJSON / CSV，自动或手动映射 ID、类型、高程、需水、经纬度字段，生成带地理参考的管网。
- **DEM 自动高程**：基于 Terrarium 高程瓦片，为选中或全部接点 / 水池自动赋值地面高程。
- **图形化数据编辑**：时间模式（需水乘数）拖拽柱形编辑并内置恒定 / 日变化 / 夜间预设；数据曲线拖拽点编辑、双击增删；简单控制（CONTROLS）结构化构建（下拉 + 数字 / 时间输入）与多行规则（RULES：IF / THEN / ELSE）编辑，无需手写文本。
- **水质反应与源**：主体 / 管壁 / 水池反应阶数与全局系数、限制浓度、粗糙度相关；节点水质源（浓度 / 质量注入 / 设定点 / 流量比例）含强度与模式。
- **压力驱动需水（PDA）**：DDA / PDA 切换与最低 / 必需压力、指数参数；结果含需水缺口。接点支持多需水类别（各自模式）。
- **水池 / 发射器 / 漏失**：水池混合模型（MIX1 / MIX2 / FIFO / LIFO）、混合区比例与溢流；接点发射器系数与倒流；管道漏失面积 / 膨胀系数。
- **水泵能量与效率**：效率曲线、电价与电价模式、需量电费；结果给出运行功率 (kW)、效率 (%) 与累计能耗 (kWh)。
- **高级选项**：压力单位、比重 / 粘度 / 扩散系数、发射器指数、默认需水模式、检查频率 / 阻尼 / 收敛阈值、水质与规则步长。
- **数值着色扩展**：节点按水位 / 需水缺口、管段按能耗 / 效率 / 设定值着色。
- **INP 互通**：导入 / 导出 EPANET `.inp` 文件，保真解析反应 / 源 / 混合 / 能量等高级段。
- **双语界面**：中文 / English 即时切换。
- **并发模拟**：工作子进程池，多路模拟真正并行。

### 环境要求

- **操作系统**：Windows x64（引擎经 syscall 调用 `epanet2.dll`，无需 cgo / C 编译器）。
- **Go**：1.26 及以上（`go.mod` 声明 `go 1.26.5`）。
- **引擎**：仓库已随附官方 `epanet2.dll`（EPANET 2.x，当前引擎版本号 `20305`），开箱即用。

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
| `-workers` | `min(CPU 核数, 8)` | 模拟工作进程数（并发模拟路数） |
| `-worker` | `false` | 内部使用：以模拟工作子进程模式运行 |

DLL 查找顺序：`-dll` 指定路径 → 可执行文件同目录 → 当前工作目录 → 已知 SDK 位置。

### 使用指南

1. **绘制**：左侧工具选择节点 / 管段类型，在画布点击放置；管段依次点击起点与终点。选中对象后在右侧属性面板编辑参数。
2. **数据**：打开「模式 / 曲线 / 控制」弹窗，用图形化编辑器设置需水模式、水泵曲线、简单控制（CONTROLS）与多行规则（RULES）。
3. **设置**：在设置面板选择流量单位、水头损失公式、需水乘数、时间参数（起始时刻用时间选择器）、统计方式与水质类型；并可配置需水模型（DDA / PDA）、反应参数、能量 / 成本与高级选项。
4. **模拟**：点击「运行」，用结果栏的时间滑块浏览各时间步；悬停对象查看指标，点击对象查看时间序列图表；在结果面板查看节点 / 管段表格、求解统计与全文报告。
5. **检查 / 导出**：运行管网检查并一键修复；导出结果 CSV、EPANET 报告 `.rpt` 或管网 `.inp`。
6. **GIS / DEM**（可选）：开启地图底图并配准；导入 GeoJSON / CSV；用 DEM 为节点自动赋高程。

### HTTP API

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `{ready, version, workers, idle}` |
| GET | `/api/example` | — | 示例管网 JSON |
| POST | `/api/simulate` | 管网 JSON | 模拟结果 JSON |
| POST | `/api/report` | 管网 JSON | 含全文报告与统计的模拟结果 JSON |
| POST | `/api/import` | `.inp` 文本 | 管网 JSON |
| POST | `/api/export` | 管网 JSON | `.inp` 文件（附件 `network.inp`） |
| GET | `/` | — | 内嵌 Web UI |

请求体上限 16 MB。

### 项目结构

```
epanet-web/
├── main.go            # 入口：命令行参数、嵌入 web、DLL 解析、进程池、优雅关闭
├── epanet/            # 纯 Go syscall 绑定 EPANET 2.x DLL（无 cgo）
├── model/             # 管网数据模型、INP 解析/生成、示例管网、结果类型
├── pool/              # 模拟工作子进程池（真正并行）
├── server/            # HTTP 处理、内嵌 UI 服务、模拟编排
├── web/               # 前端 SPA：app.js / i18n.js / style.css / index.html
├── reference/         # 本地参考：EPANET 引擎源码（MIT，已 gitignore，不参与构建）
├── epanet2.dll        # 随附的官方 EPANET 引擎
└── go.mod
```

### 技术架构

- **无 cgo 的引擎绑定**：仅使用基于指针 / 整型的 toolkit 函数；管网数据通过 INP 文件传入，避免按值传递单精度浮点（Windows x64 syscall ABI 无法正确编组）。
- **进程池并行**：EPANET 传统 API 为全局单线程状态，每个工作子进程独立加载 DLL、一次服务一个模拟；进程池跨工作进程分发任务实现真正并行。父子进程通过 stdin/stdout 的换行分隔 JSON 流通信；父进程退出时管道关闭，工作进程随 EOF 退出，不会残留。
- **单可执行文件**：`go:embed web` 将前端打包进二进制，部署只需 `.exe` + `.dll`。
- **前端**：原生 JavaScript，单个 DPR 感知的 2D 画布，CSS 自定义属性主题，`i18n.js` 提供中 / 英文案。

### 关于 EPANET 引擎与致谢

- **EPANET** 是美国环境保护署（US EPA）开发的公共领域（public domain）供水管网水力 / 水质模拟引擎。本仓库随附官方 `epanet2.dll`。
- **引擎源码参考**：`reference/epanet-engine/` 为本地留存的上游 EPANET 引擎源码（MIT 许可），仅用于 API / 语义查阅，已 gitignore、不参与构建与分发。
- **地图瓦片**：© OpenStreetMap 贡献者（ODbL）。
- **高程瓦片**：Mapzen / Terrarium 高程瓦片（AWS 公共数据集）。

本项目为独立实现，未包含第三方 copyleft / 竞争性许可代码。项目自身代码的许可证尚未指定。

---

## English

### Features

- **Canvas network editing**: nodes (junction / reservoir / tank) and links (pipe / pump / valves PRV·PSV·PBV·FCV·TCV·GPV·PCV), with pan, stepless zoom, selection and property editing.
- **EPANET simulation**: one-click hydraulic & quality runs with time-step browsing. Drawing and simulation share the same rendering and hover tooltips for a consistent, crisp (DPR-aware) view.
- **Light / dark theme**: full UI switch; the canvas and map basemap adapt together so pipes and labels stay legible in dark mode.
- **Map basemap & georeferencing**: optional OpenStreetMap layer; align the network to real coordinates via an anchor node, scale, rotation and opacity.
- **Undo / redo**: network-snapshot history stack.
- **Network review + one-click fixes**: detects isolated nodes, dangling links, duplicate IDs, invalid diameters / lengths, missing sources and more, with actionable one-click fixes.
- **Results export & chart**: export long-format CSV (node / link × time step) and view a time-series chart for the selected object; plus a solver-statistics panel and the full EPANET text report, exportable as `.rpt`.
- **GIS import**: import GeoJSON / CSV with automatic or manual mapping of ID, type, elevation, demand and lon/lat fields, producing a georeferenced network.
- **DEM auto-elevation**: assign ground elevation to selected or all junctions / tanks from Terrarium elevation tiles.
- **Graphical data editing**: drag-bar demand-pattern editor with constant / diurnal / night presets; drag-point curve editor with double-click add/remove; a structured simple-controls (CONTROLS) builder (dropdowns + numeric / time inputs) plus a multi-line rule (RULES: IF / THEN / ELSE) editor — no free-text typing required.
- **Quality reactions & sources**: bulk / wall / tank reaction orders and global coefficients, limiting concentration, roughness correlation; per-node quality sources (CONCEN / MASS / SETPOINT / FLOWPACED) with strength and pattern.
- **Pressure-driven demand (PDA)**: DDA / PDA switch with minimum / required pressure and exponent; results include demand deficit. Junctions support multiple demand categories (each with its own pattern).
- **Tanks / emitters / leakage**: tank mixing models (MIX1 / MIX2 / FIFO / LIFO), mixing fraction and overflow; junction emitter coefficient and backflow; pipe leak area / expansion.
- **Pump energy & efficiency**: efficiency curve, energy price and price pattern, demand charge; results report operating power (kW), efficiency (%) and cumulative energy (kWh).
- **Advanced options**: pressure units, specific gravity / viscosity / diffusivity, emitter exponent, default demand pattern, check frequency / damping / convergence thresholds, quality and rule time steps.
- **Extended value coloring**: color nodes by level / demand deficit and links by energy / efficiency / setting.
- **INP interop**: import / export EPANET `.inp` files with faithful parsing of advanced sections (reactions / sources / mixing / energy).
- **Bilingual UI**: instant Chinese / English switching.
- **Concurrent simulation**: a worker-subprocess pool runs multiple simulations truly in parallel.

### Requirements

- **OS**: Windows x64 (the engine is called via syscall on `epanet2.dll`; no cgo / C compiler needed).
- **Go**: 1.26+ (`go.mod` declares `go 1.26.5`).
- **Engine**: the official `epanet2.dll` (EPANET 2.x, reported engine version `20305`) is bundled in the repo — works out of the box.

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
| `-workers` | `min(CPU count, 8)` | Number of simulation worker processes (parallel runs) |
| `-worker` | `false` | Internal: run as a simulation worker subprocess |

DLL search order: `-dll` path → next to the executable → working directory → known SDK location.

### Usage

1. **Draw**: pick a node / link type from the left toolbar and click on the canvas to place it; for a link, click its start then end node. Edit parameters in the right-hand property panel after selecting an object.
2. **Data**: open the *Patterns / Curves / Controls* modal and use the graphical editors to set demand patterns, pump curves, simple controls (CONTROLS) and multi-line rules (RULES).
3. **Settings**: choose flow units, head-loss formula, demand multiplier, time parameters (start clock uses a time picker), statistic and quality type; also configure the demand model (DDA / PDA), reactions, energy / cost and advanced options.
4. **Simulate**: click **Run**, scrub the result-bar time slider across time steps; hover an object for metrics, click it for a time-series chart; inspect node / link tables, solver statistics and the full report in the results panel.
5. **Review / export**: run the network review and apply one-click fixes; export results CSV, the EPANET report `.rpt` or the network `.inp`.
6. **GIS / DEM** (optional): enable and georeference the map basemap; import GeoJSON / CSV; auto-assign node elevations from DEM.

### HTTP API

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `{ready, version, workers, idle}` |
| GET | `/api/example` | — | Example network JSON |
| POST | `/api/simulate` | Network JSON | Simulation result JSON |
| POST | `/api/report` | Network JSON | Simulation result JSON with full report & statistics |
| POST | `/api/import` | `.inp` text | Network JSON |
| POST | `/api/export` | Network JSON | `.inp` file (attachment `network.inp`) |
| GET | `/` | — | Embedded web UI |

Request body limit: 16 MB.

### Project structure

```
epanet-web/
├── main.go            # Entrypoint: flags, embedded web, DLL resolution, pool, graceful shutdown
├── epanet/            # Pure-Go syscall binding to the EPANET 2.x DLL (no cgo)
├── model/             # Network data model, INP parse/write, example network, result types
├── pool/              # Simulation worker-subprocess pool (true parallelism)
├── server/            # HTTP handlers, embedded UI serving, simulation orchestration
├── web/               # Frontend SPA: app.js / i18n.js / style.css / index.html
├── reference/         # Local reference: EPANET engine source (MIT, gitignored, not built)
├── epanet2.dll        # Bundled official EPANET engine
└── go.mod
```

### Architecture

- **No-cgo engine binding**: only pointer/int-based toolkit functions are used; network data is supplied through an INP file so no single-precision float is ever passed by value (which the Windows x64 syscall ABI cannot marshal correctly).
- **Process-pool parallelism**: the legacy EPANET API keeps global single-threaded state, so each worker subprocess loads its own DLL instance and serves one simulation at a time; the pool dispatches jobs across workers for true parallelism. Parent and workers communicate over a newline-delimited JSON stream on stdin/stdout; when the parent exits the pipe closes and workers exit on EOF, so they never orphan.
- **Single executable**: `go:embed web` packs the frontend into the binary — deployment needs only the `.exe` + `.dll`.
- **Frontend**: vanilla JavaScript, a single DPR-aware 2D canvas, CSS custom-property theming, and `i18n.js` for Chinese / English strings.

### About the EPANET engine & acknowledgements

- **EPANET** is a public-domain water distribution hydraulic / quality simulation engine developed by the US Environmental Protection Agency (EPA). The official `epanet2.dll` is bundled in this repository.
- **Engine source reference**: `reference/epanet-engine/` holds a local copy of the upstream EPANET engine source (MIT license) for API / semantics lookup only; it is gitignored and not built or distributed.
- **Map tiles**: © OpenStreetMap contributors (ODbL).
- **Elevation tiles**: Mapzen / Terrarium elevation tiles (AWS public dataset).

This project is an independent implementation and contains no third-party copyleft / competing-license code. A license for the project's own code has not yet been specified.