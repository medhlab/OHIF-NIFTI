# 单 CT 病灶标注第一版

更新时间：2026-10-13，Asia/Shanghai。实现仓库 `medhlab/OHIF-NIFTI`，分支 `codex/annotation-v1`，基线 `ca7cf52`。本版已完整构建、完成真实 CT 工程验收并部署到 rtx4500；[部署与验收记录](ANNOTATION_V1_DEPLOYMENT.md)。

## 范围与入口

第一版到**单 CT 的人工病灶标注闭环**为止：报告原文 → Finding → 人工关联 Entity → 编辑主 mask → 保存/重新打开 → 标记完成与任务完成率。现有 OHIF 绘制、MPR、历史和交互 AI 继续复用。没有独立复核角色。

- 从原图库或病例清单打开 CT，右侧选择“病灶工作台”，点击“打开病灶工作台”。非 CT 不进入该流程。
- 粘贴报告原文并保存；病例清单已提供的报告在首次登记时导入。清单中的文本片段按独立章节保存，不编造缺失的完整报告位置。
- 在只读原文框选文字，创建 Finding，并选择 ReXGroundingCT 14 类之一；允许暂未分类或无原文的影像发现。
- 为 Finding 新增病灶，或选取共享病灶建立关联。两条 Finding 可共享一个 Entity，原文证据独立保留。
- 点击病灶进入“标注与 AI”，点击“手工编辑”启用画笔；绘制后使用 **Save All**。一个 Entity 有一份主二值 mask，多个 Entity 的 mask 可重叠。保存保留不可变版本，历史恢复生成新版本。
- 当前编辑保存后点击“标记完成”。需要空间标注的 Entity 必须有非空已保存 mask；无需空间标注时显式填写原因。空草稿不能通过完成检查。
- 从固定病例清单登记 Worklist，按整个清单的病例数显示 `已完成/总数` 与百分比，包含尚未打开的病例。直接打开单个 CT 显示病例状态，不虚构任务分母。
- 修改报告、Finding、Entity、关联或 mask 内容后需要重新标记完成。只改变显示颜色、透明度或加载结构图层不使完成状态失效。

也可直接在“标注与 AI”点击“手工编辑”：入口自动登记同一业务病例，并恢复已有病灶或准备新本地目标；保存时登记 Entity。重复点击不新增目标。结构只读及锁定目标会显示提示。

直接原图登记的病例通过 URL 中 `annotationCaseId` 恢复；病例清单使用清单 ID 与外部病例 ID 显式映射。相同影像内容不推断为同一临床病例。重新打开后点击“打开病灶工作台”，再点击病灶加载其主 mask。

## 解剖结构

“标注与 AI”中提供“解剖结构 · 只读辅助图层”。上传已有 TotalSegmentator 多标签 NIfTI，提供**该结果实际使用的**整数标签值 → 结构名称 JSON 映射。服务端验证网格与标签覆盖，复用无损轴置换/翻转校验，不隐式重采样。

结构结果独立保存、加载后锁定，可调整可见性与透明度；不可解锁编辑、恢复历史或复制成病灶。结构图层不创建病灶 Entity，不进入病灶完成条件。缺失结构结果不阻塞病灶标注。

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

已有原生保存/恢复路径不能绕过已登记病灶的病例修订控制。病例上下文中加载已保存 mask 仅包含当前病例的主 mask 与结构图层；复制历史标注使用新的目标身份。人工交互编辑继续允许，自动候选或批量模型流程本版尚未接入，不能据此声称已验收“自动跳过人工 mask”。

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
