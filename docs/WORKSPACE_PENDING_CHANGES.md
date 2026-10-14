# 工作区改动与提交记录

更新：2026-10-14，Asia/Shanghai。分支 `codex/annotation-v1`。用户授权将截至目前的工作区改动全部整理提交。下面功能已提交并推送到应用分支；报告 pipeline 和产品设计仍可在后续迭代调整。

| 提交 | 内容 |
| --- | --- |
| 9da5928 | 右键拖动缩放方向与 ITK-SNAP 一致 |
| fb63880 | 首屏向上下持续扩散缓存直到整卷加载完，保留独立提交 |
| 74573f2 | CT 默认肺窗 1500/-600，图像与 VOI 元数据统一 |
| 60bd365 | 真实报告结果导入、Finding/观察证据、Entity 删除、nnInteractive seed 与 mask gzip 传输、版本/幂等回归 |
| 785e185 | 自动 Finding/Entity 工作台、术语与操作图标、顶部工具/图像信息、单 mask 编辑入口和退出、prompt 管理与过期结果保护、压缩保存进度 |
| 文档提交（紧随上述提交） | 设计与实现边界、验收和部署回退记录、历史部署副本、历史验收脚本、Finder 元数据忽略 |

## 验证与部署对应

提交的运行代码与已通过验收的源码快照 `60fc85c190c04dd1a80637071be6fef47256db7fabc1138eb8952fb999d3281b` 逐文件相等。完整 OHIF 构建通过，166 项 NIfTI 后端回归、54 项构建内前端测试通过；41 文件格式、36 模块解析与122条相对引用检查通过。缓存四文件与独立缓存提交一致。

真实公开 CT 验证了手工绘制、GPU 点提示、单目标编辑与切换、退出保留、保存继续编辑和重新打开。约61.9 MB 测试 mask 压缩后约98 KiB，约2.8秒保存；另一个939体素mask通过raw/gzip新版本像素哈希一致性检查。单例性能不代表所有网络或推理质量。

rtx4500 隔离预览 viewer/backend 为 `mask-save-60fc85c190`；本轮提交不重建或重启服务。正式服务保持原版本。部署冻结时使用的基线是 fb63880，当前运行代码对应本地 785e18519c62fe8a04d718466cee7a8d8aacf8ed；服务器镜像/回执中的“未提交”字段是冻结时历史状态，详见 [基础设施记录](INFRASTRUCTURE_HANDOFF.md)。

## 整理与保留边界

前端组件由 LesionPanel/Panel 改为 FindingEntityPanel/AnnotationToolbar，保留旧内部事件别名；sourceStore保留原换行。报告模型原文字词、输出协议和历史部署副本保持原样。deploy/rtx4500 是2026-10-12历史配置；report-findings-acceptance.cjs保存2026-10-13旧界面验收方式，不应作为当前UI自动验收入口。

在线 LLM 调度、自动图像定位、报告更新以及语义准确率评估尚未完成；提示历史仅限当前会话。真实 TotalSegmentator 结果仍待用户补充。提交保存当前已验证的实现，不代表这些功能或产品评审完成。

## 2026-10-14 Finding 内 Entity 编号验收完成

显示编号改为 Finding 内当前 Entity 顺序，从 E1 开始；统一卡片、共享关联选项和顶部编辑目标使用 F2-E1 等别名。默认新 Entity 名称按该组现有数量生成；既有自定义名称保留。无 Finding 的 Entity 使用独立 E 序号。共享 Entity 在每个 Finding 有本地别名，实际 UUID、links、mask 主版本不变；显示序号会随删除/解除关联重新排列，不是持久身份或导出主键。

4项局部编号单测（跨Finding独立、全删重建、共享别名、未关联组）与5项编辑目标描述回归通过。完整OHIF构建通过，构建内63项前端测试通过。独立公开CT工程Case 52eb0b26dd9844ab84819a3ceb5ab70b 先保留F1对象，在F2新增显示F2-E1，删除F2对象并确认浏览/尚无mask，再新增仍F2-E1；顶部明确编辑同一F2-E1，无前端error。测试删除动作曾返回浏览器自动化超时，随后实际UI及API确认删除已完成；未重复删除。未修改用户Case、未保存工程mask或启动推理。

隔离 viewer 更新为 entity-labels-da38443d75，快照 da38443d755c88ca6d9df278a536372e3db7ccdb705e7bddc80e44e419ab6773，基线364733d；两后端和正式viewer容器身份/启动时间不变。公共产物 rtx4500 /home/ant/projects/OHIF-NIFTI/releases/entity-labels-20261014/（源码哈希、构建、部署回执、工程fixture和截图）。回退用mask-save-20261014/compose.preview.json，仅 up -d --no-deps --no-build --pull never viewer；数据无需迁移。需刷新当前页取得新版，先保存有价值的未保存修改。此增量应用代码未提交。

团队同步待完成：GitHub DNS失败；计划已本地提交393578a，本节结论随后本地提交。负责人Annotation会话，网络恢复后普通fetch/push并核验远端。不得把本地记录当作团队已同步。

## 2026-10-14 全部改动发布准备

用户已明确授权提交并推送全部应用改动及团队记录。Entity显示编号修复现已提交为11b3172ad38e020fe144afb8002c7819a34d2e21，运行代码与entity-labels-da38443d75部署快照逐文件相等，沿用63项前端测试、完整OHIF构建及真实CT删除重建验收。此前“未提交/未推送”记录属于当时的历史状态，发布状态以Git远端核验及团队任务记录为准。本次只同步Git，不重启服务，不改变标注数据；正式与隔离服务继续保持其已验收镜像。

## 2026-10-14 远端发布核验

应用全部改动已普通推送到 medhlab/OHIF-NIFTI 的 codex/annotation-v1，已核验远端包含70484cc和全部先前提交；本节同步更新发布说明。此前“未提交”“尚未推送”及GitHub DNS失败待同步描述保留为历史状态，不表示当前仍未发布。运行代码提交11b3172对应已验收的entity-labels-da38443d75部署；此次没有更改服务或数据。

网络处理：临时SSH SOCKS读取远端成功，写连接中断；最终将rtx4500实时解析的GitHub地址用于单次Git连接参数，原域名TLS校验和本地认证保持。不修改系统DNS、全局Git配置或复制凭据。团队远端同步证据见 medhlab/cooperate_space 的任务记录。

## 2026-10-14 标注工具分组与状态卡片验收

技术状态：已完成，负责人Annotation会话。标注图标仍位于同一OHIF顶栏，新增16px左间距、独立底色与边框，保留原工具互斥及hover名称。右上角改为独立状态卡片：模式徽标、当前Entity/编号、mask与工具、关联类别和进度；保存（紫色主按钮）和退出编辑（独立次按钮）集中于卡片。移除顶栏及文件菜单重复保存入口，整页只保留一个“保存标注”。忙碌时两个按钮禁用，取消仍可用；保存继续编辑，退出回浏览并保留mask。

完整OHIF构建和既有63项前端回归通过。公开CT工程Case 52eb0b26dd9844ab84819a3ceb5ab70b，验证初始无mask的保存/退出禁用、F2-E1进入编辑、手工绘制、卡片保存时无损压缩阶段与按钮禁用、成功后继续编辑、退出后浏览工具与编辑工具禁用、重开已保存mask后再次进入。未调用模型，未操作用户病例。浏览器无error。最终正常布局与228px宽卡片均通过；窄布局两个按钮自动上下排列，scrollWidth=clientWidth，没有横向溢出。工具组计算margin-left=16px、底色rgb(37,27,53)，保存底色rgb(116,80,163)。第一次视觉检查发现原全局样式覆盖主按钮底色，已增大局部选择器优先级修正并重新构建。

隔离viewer当前status-card-ee304a8afd，快照ee304a8afd36ccf38a9cd39ef84f42a87309442bc7ba3bf4765a0024b5e73b30，基线a5d5e33。两后端及正式viewer身份/启动时间均未变。公共产物rtx4500 /home/ant/projects/OHIF-NIFTI/releases/status-card-20261014/：源码overlay/哈希、完整build.log、compose.preview.json/deployment.json、验收JSON和正常/窄侧栏截图。回退同项目entity-labels-20261014/compose.preview.json，仅 up -d --no-deps --no-build --pull never viewer，保留数据和模型。刷新页面取得新版前先保存有价值的修改。本次新增应用代码未提交，团队记录按既有授权同步。

## 2026-10-14 界面与工具栏整理提交

用户授权整理、提交、推送并同步团队记录。功能提交 `b8e7d9fda37ed5023cde2012e3882427fbd06a27`（codex/annotation-v1）涵盖紧凑标注状态卡片、保存/退出按钮归位、顶栏工具分组、互斥手工/AI模式、应用提示和目标隔离重试状态，以及手动更新提示后的待处理标记。8个源码与测试文件逐文件匹配已验收快照 `da657be3ae52694102b70608dc1fd95d4465685897f5df5e123fabe9ee527488`。

完整OHIF构建及65项测试已通过；此前真实CT页面确认模式/工具同步、自动时隐藏应用按钮、手动无提示禁用及有待处理提示启用。当前核验隔离viewer运行 `ohif-nifti-rtx4500-viewer:apply-prompts-da657be3ae`。公共产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/apply-prompts-20261014/`。本次仅提交与推送，不重启服务或修改标注数据；无需重复运行模型。此前“未提交”段落为历史记录，当前代码已提交；远端发布以本次推送核验为准。
