# 单 CT Finding / Entity 标注第一版

更新时间：2026-10-13，Asia/Shanghai。实现仓库 `medhlab/OHIF-NIFTI`，分支 `codex/annotation-v1`，基线 `ca7cf52`。本版已完整构建、完成真实 CT 工程验收并部署到 rtx4500；[部署与验收记录](ANNOTATION_V1_DEPLOYMENT.md)。

## 范围与入口

第一版到**单 CT 的人工 Entity 标注闭环**为止：报告原文 → Finding → 人工关联 Entity → 编辑主 mask → 保存/重新打开 → 标记完成与任务完成率。现有 OHIF 绘制、MPR、历史和交互 AI 继续复用。没有独立复核角色。

- 从原图库或病例清单打开 CT，右侧自动加载“Finding / Entity”工作台。非 CT 不进入该流程。
- 粘贴报告原文并保存；病例清单已提供的报告在首次登记时导入。清单中的文本片段按独立章节保存，不编造缺失的完整报告位置。
- 在只读原文框选文字，创建 Finding，并选择 ReXGroundingCT 14 类之一；允许暂未分类或无原文的影像发现。
- 为 Finding 新增 Entity，或选取已有 Entity 建立共享关联。两条 Finding 可共享一个 Entity，原文证据独立保留。
- 点击 Entity 后使用顶部“标注工具”中的“手工编辑”启用画笔；绘制后使用顶部“保存”（Save All）。工作台继续显示。一个 Entity 有一份主二值 mask，多个 Entity 的 mask 可重叠。保存保留不可变版本，历史恢复生成新版本。
- 当前编辑保存后点击“标记完成”。需要空间标注的 Entity 必须有非空已保存 mask；无需空间标注时显式填写原因。空草稿不能通过完成检查。
- 从固定病例清单登记 Worklist，按整个清单的病例数显示 `已完成/总数` 与百分比，包含尚未打开的病例。直接打开单个 CT 显示病例状态，不虚构任务分母。
- 修改报告、Finding、Entity、关联或 mask 内容后需要重新标记完成。只改变显示颜色、透明度或加载结构图层不使完成状态失效。

也可在顶部“标注工具”点击“手工编辑”：入口自动登记同一业务病例，并恢复已有 Entity或准备新本地目标；保存时登记 Entity。重复点击不新增目标。结构只读及锁定目标会显示提示。

直接原图登记的病例通过 URL 中 `annotationCaseId` 恢复；病例清单使用清单 ID 与外部病例 ID 显式映射。相同影像内容不推断为同一临床病例。重新打开后工作台自动加载，再点击 Entity 加载其主 mask。

## 解剖结构

顶部“图层与结构”中提供“解剖结构 · 只读辅助图层”。上传已有 TotalSegmentator 多标签 NIfTI，提供**该结果实际使用的**整数标签值 → 结构名称 JSON 映射。服务端验证网格与标签覆盖，复用无损轴置换/翻转校验，不隐式重采样。

结构结果独立保存、加载后锁定，可调整可见性与透明度；不可解锁编辑、恢复历史或复制为 Entity 标注。结构图层不创建Entity，不进入Entity 完成条件。缺失结构结果不阻塞Entity 标注。

本版不自动扫描或下载 CT-RATE 的 `ts_total`，不补跑 TotalSegmentator，不包含批量病例到结构结果的注册脚本。公共数据覆盖率和实际标签版本需要在数据接入阶段核验。

## 实际接口与字段

前缀 `/api/annotation/v1`，经现有反向代理访问时通常是 `/monai/api/annotation/v1`。前端根据 `niftiApiRoot` 推导同一服务根地址。启用现有 `ENABLE_NIFTI_LIBRARY` 与 `ENABLE_NIFTI_EDITING`；沿用现有代理认证，没有引入新的角色系统。

| 方法与路径 | 实际功能 |
| --- | --- |
| GET `/categories` | ReX 14 类代码及中文界面名，系统和本地快照版本 |
| POST `/worklists` | `{manifestId}` 固定登记整个原生病例清单，重复调用返回同一映射 |
| POST `/cases` | `{sourceId,caseId?}` 登记 CT 或绑定未打开的清单病例；要求 Idempotency-Key |
| GET `/cases/{caseId}/context` | 病例语义状态和参考 CT 描述 |
| POST `/cases/{caseId}/operations` | `{operation,expectedCaseRevision,...}`；要求 Idempotency-Key |
| POST `/cases/{caseId}/entities/{entityId}/mask-versions` | multipart 原始 x-fast uint8 二值体素，expectedCaseRevision、expectedMaskVersion、geometryHash、label、labelOnly、provenance；要求 Idempotency-Key |
| POST `/cases/{caseId}/anatomy-layers` | multipart NIfTI、labelMap、可选 modelVersion；显式导入结构资产 |
| GET `/worklists/{worklistId}/progress` | totalCases、completedCases、completionPercent |

`operations` 支持 `report`、`finding`、`updateFinding`、`entity`、`link`、`unlink`、`entityMetadata`、`complete`。每次调用是一项原子元数据操作；首次 Entity 创建与之后的 mask 绘制保存是分开的用户动作。不是多文件、多对象组合提交接口。

元数据成功响应为 `{apiVersion,caseId,caseRevision,data}`。Case 使用 `caseId/sourceId/revision`；Case 内的报告、章节、Evidence、Finding、Entity、Link 使用 `id`。Entity 主 mask 字段为 `maskId`，Finding 类别暂用代码字符串或 null；类别系统与版本从 `/categories` 获取。原文范围使用 Unicode code point 的 `[start,end)`；服务端逐字核验 quote。

Case 包含 reports、evidence、findings、entities、links、anatomyLayers、worklistId、completedRevision。mask 返回沿用原生 `{items,caseRevision}`，记录 entityId、annotationCaseId、authority、version、parentVersion、labelOnly、geometryHash、voxelCount、voxelHash、fileSha256。下载和历史恢复复用 `/nifti-images/{sourceId}/masks/...`；登记过的主 mask 恢复必须携带病例/Entity 与预期病例修订。

首版原文只支持新增不可变报告，不提供报告原地编辑。数据模型的完整 Coding 对象、逐对象 revision/origin、报告改版、候选接受/驳回、组合提交及完整 ReX 导出留待后续。设计文档第 6 节完整资源接口是演进目标，不能当作本版已提供路由。

错误沿用 FastAPI 的 `{detail:{code,message}}`；原生影像校验可能返回字符串 detail。409 表示版本、归属或幂等冲突；422 为文本、标签或网格校验失败。冲突保留本地编辑，刷新后重试，不静默覆盖。

## 持久化与保护

新增 annotation_* 表放在现有原图库 SQLite 索引内，首次请求自动创建；没有旧数据迁移。病例级预期修订检查和正式写入在同一事务内。mask 文件沿用已有不可变版本、fsync、目录重命名和失败清理；主 mask 绑定与 mask 索引提交共用事务。进程中断可能留下未索引文件，后续分配新版本，不覆盖该文件。

幂等注册、元数据操作及主 mask 保存均记录成功响应；重放先查原结果，再判断预期修订。同键不同内容冲突。Save All 保留待重试的原始请求，响应丢失后不会重复增加 mask 版本。

已有原生保存/恢复路径不能绕过已登记 Entity的病例修订控制。病例上下文中加载已保存 mask 仅包含当前病例的主 mask 与结构图层；复制历史标注使用新的目标身份。人工交互编辑继续允许，自动候选或批量模型流程本版尚未接入，不能据此声称已验收“自动跳过人工 mask”。

## 验证与后续验收

2026-10-13 本地验证：

- 原生 NIfTI 后端回归 **142 项通过**，含新增 8 项病灶业务测试；覆盖精确 Unicode 原文、共享 Entity、幂等注册/保存、冲突、空草稿、保存失败回滚、完成后修改失效、颜色保存保持完成、结构只读及固定分母。
- 13 个变更前端模块语法转译通过。
- 真实 React 病灶面板 + 真实 FastAPI 接口的无头浏览器联调通过：原文选区、共享病灶、完成拒绝、非空 mask API 保存、50% 进度、类别修改失效、重新打开身份与证据保留。
- 实际 `saveAll` 函数联调通过：服务器已保存但随后的 context 响应丢失，重试后版本仅从 1 增至 2；自动登记 Entity 的成功响应丢失后，重试也只创建一个新 Entity。浏览器无未捕获错误。

以上局部联调用合成 CT 和影像引擎替身。后续已补全完整 OHIF 构建及真实 Cornerstone/鼠标/持久化验收，见部署记录。真实 TotalSegmentator 全量图层与 GPU AI 未验收，用户稍后补结构文件。

后端复验（Python 3.10+，安装项目运行依赖及 pytest/httpx，Node 在 PATH）：

```sh
PYTHONPATH=monai-label python -m pytest monai-label/tests/nifti_native -q -o log_cli=false
```

已保留生产状态及回退配置，成套升级前后端；实际测试代码见 deploy/nifti/lesion-v1-acceptance.cjs，正式 HTTPS 冒烟见 deploy/nifti/lesion-v1-production-smoke.cjs。无 GPU 模型运行，真实解剖资产验收仍待文件。

同步状态：应用任务分支已推送，已验收提交已部署；main 尚未合并。团队部署记录同步到 cooperate_space 的 codex/annotation-v1-record。

手工编辑入口回归脚本：`deploy/nifti/lesion-v1-manual-entry-acceptance.cjs`；默认测试回环 11027 的隔离候选并保存测试 mask。仅正式冒烟时显式设 `PRODUCTION_SMOKE=true`，该模式只在浏览器临时绘制、不保存 mask。运行依赖与结构合成文件参照已有真实 CT 验收说明。

## 报告 Finding 迭代草稿（2026-10-13，待评审）

本轮工作区修改未提交、未推送、未替换正式服务。参考 medical-imaging-studio 的原文高亮、Finding 卡片、报告观察和共享 Entity 设计。

- 新增缓存结果导入：`operations` 的 `reportExtraction` 操作携带 `expectedCaseRevision/runId/reportSource/result`；沿用 Idempotency-Key。逐字验证完整 Findings/Impressions 的 SHA256、Unicode 范围、观察/关系引用及计数，核验体积与清单病例对应；不覆盖已有提取和人工标注。
- 返回 `reportExtraction`（来源、运行与输入哈希、观察、关系、拒绝项、计数）；模型 Finding 带 origin/sourceFindingId/observationIds/extractionRunId。人工创建或关联 Entity 时可提交 observationIds，Entity 保留 reportObservations 快照。导入不创建 Entity 或 mask。
- 原文和 Finding 双向定位；观察显示部位、确定性和跨章节关系；语义观察与拒绝项保留独立提示。零候选不视为无异常。当前病例树使用同一已加载标注状态，未打开病例不显示虚构的零计数。
- 批量入口 `deploy/nifti/import-report-results.py`：提供 base-url、data-dir、run-id、output，可选 image-root/manifest-id。先校验所有 CT 路径，再登记清单并幂等导入。缓存目录须包含 source.json 和 cases/；来源为已批准的 GLM 报告试跑，不由前端重新发起 LLM 请求。

隔离验收使用真实 GLM-5.3 的 100 份不同报告，映射 184 个 CT 体积：919 条观察、641 个模型 Finding 候选、44 条拒绝项、202 个跨章节候选、169 条暂存摘要。150 项后端回归和 100 份真实 React 展示通过；完整 OHIF 构建及代表性 CT 的报告、绘制、保存、共享 Entity、恢复测试见公共 `releases/finding-real-100-20261013/` 的最终回执。

复验入口 `deploy/nifti/report-findings-acceptance.cjs`，使用 Playwright/Chrome，设置 BASE_URL、IMPORT_RECEIPT、OUTPUT_DIR 和可选 SNAPSHOT_SHA256；测试会在隔离状态创建工程 mask，请使用独立候选，勿指向正式服务。浏览器及库路径通过 CHROME_PATH/PLAYWRIGHT_MODULE 提供。

仍未提供在线 LLM 调度、报告版本更新、跨章节自动合并、候选逐条审核、图像自动定位或语义准确率评估；模型原有否定/关系问题作为提示保留，人工决定 Entity 关联。候选使用 CPU 服务并关闭 nnInteractive，正式 GPU 服务继续运行。完成校验仍沿用 Entity/mask 条件，尚未增加逐 Finding 的处理决定。

报告 Finding 候选现自动打开：CT 与病例切换提交完成后自动登记/恢复并显示报告，失败时只显示重试；并发登记共享结果，固定请求病例身份。隔离完整构建与真实 CT 初入/切换/返回/刷新通过。本轮及此前 Finding 修改仍未提交，正式服务保持现版本。

CT 默认窗口采用 OHIF 肺窗 1500/-600 HU，图像、VOI 元数据与内部实例统一。完整构建及两例真实 CT 的首次打开、切换/返回、刷新、手动调窗与切片保留检查通过。当前隔离预览已更新，应用代码仍未提交。

新增 Entity 删除操作 `deleteEntity`：expectedCaseRevision + entityId，沿用 Idempotency-Key；删除当前 Entity 与 links，保留 Finding/证据、mask 历史与所有权记录，deletedEntities 快照记录 deletedRevision；所有旧写入口继续拒绝已删除 Entity。前端移除其编辑 mask 和提示。

nnInteractive 提示按 Entity 管理：列表、定位、显隐、删除、清空和撤销/重做；删除后重放剩余提示，清空恢复本轮 AI 前的人工基线；人工编辑更新基线，过期结果不覆盖当前像素。已启用原 100 报告隔离预览 GPU 实例，正式服务不变。提示撤销历史目前限本次编辑会话，不随 mask 版本持久化。152 后端、46 前端回归及 11+4 项真实 CT 检查通过，代码未提交。

Native nnInteractive 性能优化：descriptor.capabilities.nnSeedEncodings 声明 raw/gzip；前端在 v2 能力协商后对大 seed 使用 CompressionStream，nn_seed_encoding 标识格式，旧环境保留 raw。后端限制解压 grid 大小并验证 CRC/长度/二进制体素，新增 Server-Timing 与 nn_timings 分段证据。mask 坐标、人工基线、prompt 重放和会话复用未改变；raw/gzip GPU 预测逐体素相等，保存重开通过。当前仅隔离预览更新，应用未提交。


## Finding / Entity 顶部工具栏（2026-10-13，待评审）

Finding 是发现/陈述，Entity 是显式关联的标注对象/区域，均不等同于 lesion。界面标题、创建/定位/删除操作、提示管理、固定服务端错误的前端呈现使用 Finding / Entity；报告原文、模型术语及用户名称保持原样。

右侧保留 Finding / Entity 工作台，原“标注与 AI”改为“图像信息”，展示当前原图几何、体素间距、当前层/窗宽窗位、数据类型、像素范围、内存、加载状态和身份。顶部持续显示当前 Entity 及其关联 Finding/报告观察类别；未分类、多个类别、未绑定 mask 和只读结构分别明确显示。

编辑和 AI 提示/参数/历史位于顶部“标注工具”；新建/导入/上传/保存/标注历史/导出/完整加载与重试位于“Mask 与文件”；mask 选择、颜色、可见性、透明度、锁定、移除、复制和结构导入/加载位于“图层与结构”。顶部直接提供“保存”。下拉关闭保留活动工具与提示会话；选中 Entity 不切走工作台。仅隔离预览 viewer 更新，后端和正式服务保持运行；应用改动未提交。验收证据另见团队 Finding 实验记录。


### 顶部图标与 OHIF 原工具栏同一行

按使用反馈取消第二行标注栏。原生 ToolButton / ToolButtonList 直接承载手工工具、橡皮擦、AI 提示形状和运行 AI；参数及提示管理、文件、结构与保存用同尺寸图标，hover 显示功能名称，工具选择继续走 OHIF toolbarService。当前 Entity/关联类别和操作状态放到右侧固定面板标题，切换图像信息或滚动仍可见。小屏工具行横向滚动，不换行；菜单与 tooltip 使用 portal，避免裁剪。


### CT 后台扩散加载

首张实际显示的切片确定后台加载起点，按 +1/-1、+2/-2 依次向上下扩散，持续填满已分配的原图体数据。当前显示切片及其邻近预加载高于后台完整加载的优先级，队列最多 3 个请求、后台最多 2 个，翻页可使用预留槽位且同一帧请求共享。滚动不会中止完整加载队列或重置起点。单帧失败保留错误并继续其他帧；可从原图加载状态查看百分比、暂停或重新加载未完成部分。暂停不丢弃已加载数据，切换/释放病例会取消队列和解码，不污染下一病例。MPR/插值等必需完整数据的操作继续等待全部帧到齐。


当前未提交改动的代码入口、依赖和整理验证见 [待提交改动清单](WORKSPACE_PENDING_CHANGES.md)。缓存已在 fb63880 单独本地提交，其余功能保留待评审。

### 2026-10-14 显式编辑及压缩保存

新增Entity自动进入编辑；已有Entity/mask通过铅笔按钮进入；当前目标和primary tool固定显示。只有一个mask处于编辑会话，退出切回浏览并保留像素；保存后继续编辑。会话epoch防止旧AI回写，重复选择点提示不切回Pan。

capabilities.maskEncodings声明raw/gzip；前端压缩二值grid后沿用原事务/版本/幂等保存协议，后端有限解压并验证二值像素与几何。保存显示准备、上传百分比和服务端保存；连续90秒无进度终止并保留编辑。完整构建、166后端/54前端构建内测试及真实CT保存重开通过，仅隔离预览更新，应用未提交。

## 2026-10-14 工作区提交整理

用户已授权提交截至目前全部改动。肺窗 74573f2e6bc8f3ec695713add05cb98712b1c347、后端 60bd365d9675c094e9bc171782140079a9412267、前端 785e18519c62fe8a04d718466cee7a8d8aacf8ed 已本地提交（应用分支未推送）。运行代码与既有 mask-save-60fc85c190 验收快照逐文件一致，沿用其完整构建、166后端/54前端及真实CT证据，本次没有重新部署。本文前述“未提交”描述保留为当时的历史状态，当前状态以本节及工作区提交记录为准。Finding/pipeline 剩余设计和真实结构结果仍待后续处理。
