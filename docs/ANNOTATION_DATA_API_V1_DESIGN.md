# OHIF 单 CT 标注数据标准与接口设计

- 文档版本：1.4；契约版本：`annotation/v1`；更新日期：2026-10-13，Asia/Shanghai。
- 状态：新系统设计基线；人工单 CT 子集已实现，实际路由与字段见 [第一版实现记录](ANNOTATION_V1_IMPLEMENTATION.md)。本文包含后续演进目标。
- 实现仓库：[medhlab/OHIF-NIFTI](https://github.com/medhlab/OHIF-NIFTI)，源码参考基线 `ca7cf52cf1b049fdf0a5aa70b74d96dc35ebc1a6`。

首版围绕单次检查的单 CT，完成报告、Finding、Entity、mask 与人工处理闭环。复用 OHIF 的浏览、编辑和存储能力；没有旧数据兼容或迁移任务。本文替代 1.0 的旧数据映射及候选替换人工 mask 设计。

Finding 是报告或影像中的发现/陈述；Entity 是可定位、可关联和可编辑的标注对象/区域。二者都不等同于“病灶”或 lesion，不能从名称推断病理属性。界面仅使用 Finding / Entity；报告原文、模型观察词语及用户名称保持原样，不迁移现有记录。

当前实现的类别位于 Finding 和报告观察；顶部显示当前 Entity 的关联类别，可能为空或多个。此显示不会新建 Entity 类别字段，也不会把 Finding 类别复制为 Entity 固有属性。

## 1 已确认规则

- Finding 可以没有 Entity；Entity 可以暂未关联 Finding，也可以尚无非空 mask。
- Finding 与 Entity 多对多。描述同一对象/区域的 Finding 可由人工明确关联到共享 Entity，保留各 Finding 的原文证据。首版不实现自动对象识别、去重、合并或相关审核流程。
- 每 Entity 在参考 CT 上最多一个主 mask，保留不可变历史版本。不同 Entity 的二值 mask 可以重叠。
- 有人工 mask 的目标直接使用人工结果，自动模型流程跳过该目标，不生成替换候选，不覆盖人工内容。此规则作用于目标，不能据此跳过同病例其他未标注目标。
- 正式写入使用病例级修订控制；正式数据变化后需要重新确认完成。
- 当前任务处理完后，由用户标记病例完成；暂不区分标注者与审核者，不设二级审核。显示任务集合的完成百分比。
- 首版以 Entity 的空间标注为主，类别采用 ReXGroundingCT 公布的 14 类胸部异常。解剖结构直接使用 TotalSegmentator 结果作为辅助图层，不纳入人工 Entity 标注任务。

多序列、多模态、跨检查追踪、完整 ontology 图、训练交互档案及完整 ReX 导出不在首版范围。

## 2 数据对象与字段

新建稳定 ID 由服务端分配，不包含类别、名称、序号或文件路径。显示编号不作引用键。可变对象有 revision、createdAt、updatedAt；时间使用带时区的 RFC 3339。创建来源 origin 记录 human/model/imported 与可用的 producer/runId；来源与完成状态分别保存。未知为 null，无关联为空数组。

| 对象 | 核心字段 | 含义 |
| --- | --- | --- |
| Case | caseId、referenceVolumeId、revision、name、externalRefs | 单 CT 标注单元，不等同患者身份 |
| Volume | volumeId、contentHash、geometryHash、hashScheme、geometry | 不可变参考 CT，路径不作为身份 |
| ReportVersion | reportId、version、sections、contentHash | 报告原文的不可变版本；章节含 sectionId/name/text/textSha256 |
| Evidence | evidenceId、reportId、reportVersion、sectionId、start、end、quote | 精确原文证据 |
| Finding | findingId、text、evidenceIds、category、assertion、origin、revision | 发现或陈述，描述、原文及类别分开 |
| Entity | entityId、name、labels、anatomy、primaryMaskId、origin、revision | 显式关联的可定位标注对象或区域，不限定为 lesion |
| FindingEntityLink | linkId、findingId、entityId | 显式多对多关联，同一对最多一个有效关系 |
| Mask | maskId、entityId、volumeId、latestVersion、authority | Entity 主 mask；authority 为 draft 或 human |
| MaskVersion | maskId、version、parentVersion、geometryHash、fileSha256、voxelHash、voxelCount、isEmptyDraft、origin | 不可变二值内容版本 |
| AnatomyLayer | layerId、caseId、volumeId、assetRef、geometryHash、labelMap、modelInfo、source | 解剖辅助图层，保留模型来源，不冒充人工 Entity 标注 |
| Candidate | candidateId、caseId、revision、kind、producer、runId、sourceKey、payload、status | 待处理的模型/外部提议，与正式标注分开 |
| Decision | decisionId、candidateId、action、actorId、reason、createdAt | 接受或驳回记录 |
| Completion | caseId、completedRevision、actorId、createdAt | 针对指定病例修订的完成记录 |
| Worklist | worklistId、caseIds | 明确进度分母的任务集合，不按临时界面筛选改变 |

除 Volume、不可变版本和 Worklist 外，业务对象均属于指定 Case。报告版本引用、mask 引用和关系必须验证病例所有权。Case.revision 即接口 caseRevision。

Coding 统一为 `{system, version, code, display}`。Finding.category 可空；Entity.labels 和 anatomy 可为空或多个。类别变化不改变身份，也不自动复制到 Entity 标签。首版类别表见下文；实际使用的词表快照标识在实现时固定，不编造官方发布版本号。

Finding.assertion 为 present/absent/uncertain/unspecified，表达描述中的存在性，不能从有无 mask 推导。

### Finding 类别与结构图层

首版 Finding.category 使用 `system=urn:rexgroundingct:finding-category`，代码与官方公布的胸部异常类别一致。中文为界面译名，保留官方英文名称。暂未分类可为 null；不按类别创造新 Entity 身份。Entity 标签独立于 Finding 分类，初版不要求再填一套重复类别。

| 代码 | 类别 |
| --- | --- |
| 1a | 支气管壁增厚 |
| 1b | 支气管扩张 |
| 1c | 肺气肿 |
| 1d | 小叶间隔增厚／网状改变 |
| 1e | 微结节 |
| 1f | 其他非局灶性异常 |
| 2a | 线状异常，包括亚段肺不张、瘢痕和纤维化 |
| 2b | 肺不张／实变 |
| 2c | 磨玻璃影 |
| 2d | 肺结节／肿块 |
| 2e | 胸腔积液／胸膜增厚 |
| 2f | 蜂窝样改变 |
| 2g | 气胸 |
| 2h | 其他局灶性异常 |

该表覆盖局灶及弥漫性异常，不能要求每个 Entity 都是一个孤立结节。依据：[ReXGroundingCT 官方类别](https://rexrank.ai/ReXGroundingCT/)、[官方数据说明](https://huggingface.co/datasets/surajpaib/ReXGroundingCT)。

CT-RATE 官方仓库提供 [TotalSegmentator 结果目录](https://huggingface.co/datasets/ibrahimhamamci/CT-RATE/tree/main/dataset/ts_seg)，其中 `ts_total` 用于解剖结构；目录还列出结节及积液等专项结果，不将这些专项分割结果混入默认结构图层。远端提供结果不等于团队服务器已经下载、病例覆盖完整或网格已验证。接入时核验病例 ID、参考 CT 版本、尺寸、仿射及 label value 到结构名称映射；不能凭同名文件假定对齐。

AnatomyLayer 默认只读，可显示/隐藏和调整透明度；不自动创建 Finding/Entity，不标为 human mask，也不占用Entity 的主 mask。modelInfo 保存可核验的任务、模型版本和标签表版本，未知字段保持 null。优先复用数据集已提供结果；缺失时标记未提供，不据此自动启动推理。需要补跑时另行安排。

GET `/cases/{caseId}/context` 包含 anatomyLayers 描述，通过 GET `/cases/{caseId}/anatomy-layers/{layerId}/file` 读取受控资产。初版在数据注册时挂接已存在的结构结果，不要求开发完整自动分割调度接口。结构图层显示或加载变化不影响Entity 完成状态，结构结果缺失不阻塞Entity 完成。

## 3 原文与空间标准

Evidence 范围为章节完整原文的 Unicode code point 下标，采用 `[start,end)`。服务端必须验证 quote 与原文对应范围逐字相等；浏览器 UTF-16 下标转换后提交。不清理空白或改写原文后再计算位置。报告修改产生新版本，旧证据继续引用旧版本，重新关联须显式提交。

geometry 包含 dimensions `[nx,ny,nz]`、4×4 voxelToWorld、worldConvention=LPS、unit=mm、arrayOrder=x-fast。体素中心乘矩阵得到毫米 LPS 坐标，平坦索引为 `x + nx*(y+ny*z)`，后端数组为 `[z,y,x]`。尺寸相同不代表几何一致。

首版沿用 OHIF geometry/content 哈希算法，hashScheme 分别明确为 ohif-nifti-geometry-v1、ohif-nifti-content-v1；contentHash 不是文件字节 SHA-256。准确算法以基线 `monai-label/monailabel/utils/others/nifti_source.py` 为参考，实现时固定契约测试，不能凭相同字段名替换算法。章节 textSha256 对原样 UTF-8 text 计算；报告 contentHash 对有序 `[sectionId,name,textSha256]` 数组的无空白、Unicode 不转义、无尾换行 UTF-8 JSON 计算 SHA-256。

mask 保存为参考 CT 网格中的二值 NIfTI。fileSha256 校验存储文件字节，voxelHash 校验 x-fast uint8 体素字节；两者分开。零前景需声明 isEmptyDraft=true，不视为空间标注完成。恢复历史生成新版本，不覆盖或倒退版本。无损轴置换/翻转允许经校验后显式对齐并记录；首版不隐式插值或重采样。

## 4 人工与模型的工作边界

人工保存非空 mask 后，authority=human；AI 辅助绘制经人工保存后同样是人工结果，不能仅按创建来源判断可否自动覆盖。未确认的临时或模型预览保持 draft，不因文件存在视为人工标注。

自动推理提交和候选接受前均检查当前目标 authority。已有 human mask 时跳过，并返回 HUMAN_MASK_PRESENT；检查与写入必须在同一事务边界，避免推理期间新增人工标注后被覆盖。已有人工 mask 的后续修改走人工编辑保存，不作为自动候选替换流程。

模型可辅助尚无人工 mask 的目标。候选 status 为 pending/accepted/rejected；接受后创建或关联正式对象，mask 内容只有人工确认保存后成为 human。接受候选不自动完成整个病例。已知 Finding 的候选可显式关联；不按语义相似性猜测 Entity 共指。

候选来源身份为 `(caseId,producer,runId,sourceKey)`；相同身份同内容重放，不同内容冲突。重跑使用新 runId，不覆盖正式对象。首版不实现复杂候选替代链或人工 mask 的模型版本比较。

## 5 完成与百分比

病例完成由当前标注者操作，无独立复核阶段。病例完成需满足：没有未保存编辑或运行中的标注写入；当前纳入任务的候选均已接受或驳回；没有仍需绘制的 Entity。零 mask Entity 若无需空间标注，用户须明确记录“不需标注”及理由，不能用空草稿冒充完成。该处置单独保存为 Entity 的 annotationDisposition=`needs_annotation / not_required` 与 dispositionReason；新 Entity 默认 needs_annotation，非空人工 mask 满足该目标的标注要求。

满足以上条件后用户显式标记完成，不根据 mask 数量自动完成病例。Completion.completedRevision 等于当时 caseRevision；完成动作本身不递增该修订。

Finding、Entity、关联、报告当前版本、mask 内容等正式变更使原完成记录失效。新待处理候选出现后，病例显示需继续处理；候选处理完且正式修订未变时，可以恢复有效完成状态。历史完成记录不删除。显示颜色、排序或面板展开不影响完成。

进度默认以固定 Worklist 为单位：`完成百分比 = 当前有效完成病例数 / 总病例数 × 100%`，同时显示 `已完成数 / 总数`；空集合显示“暂无任务”，不显示 100%。这是百分比的首版实现口径，后续若需 Entity 级进度再单独定义，不混用候选处理率、病例完成率或Entity 数量。

## 6 接口

以下是完整接口的演进目标，前缀 `/api/annotation/v1`。第一版已实现人工闭环子集，元数据写入通过 `/cases/{caseId}/operations`；下载与历史复用原生接口。实际可调用路由、字段和响应格式见 [第一版实现记录](ANNOTATION_V1_IMPLEMENTATION.md)，本表不代表全部已提供。正式写请求携带 expectedCaseRevision；成功统一返回 `{apiVersion,caseId,caseRevision,data,requestId}`。所有变更请求要求 Idempotency-Key。同键同请求返回原结果，不再次写入；同键不同请求返回 409。

| 方法与路径 | 用途与主要请求字段 |
| --- | --- |
| POST `/cases` | 注册单 CT 单元，引用服务端已登记 volumeId；分配 caseId |
| GET `/cases/{caseId}/context` | 同一修订的报告、Finding、Entity、关系、主 mask 与 anatomyLayers 描述、候选数量和完成状态 |
| POST `/cases/{caseId}/reports` | 首次报告创建，sections/source |
| POST `/cases/{caseId}/reports/{reportId}/versions` | 新版本原文，保留旧证据 |
| GET `/cases/{caseId}/reports/{reportId}/versions/{version}` | 读取精确原文 |
| POST/PATCH `/cases/{caseId}/findings[/{findingId}]` | 创建/修改描述、类别、存在性及 Evidence 引用；新 Evidence 一起校验保存 |
| POST/PATCH `/cases/{caseId}/entities[/{entityId}]` | 创建/修改 Entity，创建可带 findingIds；修改可设置不需标注及理由 |
| POST/DELETE `/cases/{caseId}/finding-entity-links[/{linkId}]` | 显式建立/解除关系，不删除 Entity 或 mask |
| POST `/cases/{caseId}/uploads` | 暂存 mask 文件，绑定主体、Case 与 Volume；返回 uploadId，不改病例修订 |
| POST `/cases/{caseId}/entities/{entityId}/mask-versions` | 人工保存，uploadId、expectedMaskVersion、isEmptyDraft；首次预期版本为 0 |
| GET `/cases/{caseId}/masks/{maskId}/versions/{version}/file` | 指定不可变版本下载 |
| POST `/cases/{caseId}/masks/{maskId}/restores` | 人工恢复为新版本，fromVersion、expectedMaskVersion |
| POST `/cases/{caseId}/annotation-commits` | operations 原子组合保存元数据、关系和 mask |
| POST `/cases/{caseId}/candidate-imports` | producer/runId/items，幂等导入提议，不写正式对象 |
| GET `/cases/{caseId}/candidates` | 按 pending/accepted/rejected 查询 |
| POST `/cases/{caseId}/candidates/{candidateId}/decisions` | action、expectedCandidateRevision；接受另带 expectedCaseRevision 和显式对象关联 |
| POST `/cases/{caseId}/completion` | 处理完后标记当前修订完成；服务端核验待处理事项 |
| GET `/worklists/{worklistId}/progress` | totalCases、completedCases、completionPercent |

表中的方括号是文档缩写：POST 操作集合路径，PATCH/DELETE 操作带 ID 的对象路径，真实 URL 不含方括号。Volume 注册复用 OHIF 原图库，不用个人路径作为 API 参数。Worklist 由任务组织功能建立；创建/调整任务集合接口及认证角色在实现时补充，不扩大本次字段审定范围。

context 中返回完整的小型语义对象及 mask 描述，不返回体素字节。大候选集合分页；cursor 为不透明值。服务端能力接口公布请求/上传大小与批次上限，不静默截断。

## 7 保存与错误约定

组合保存先暂存并校验文件，再在同一病例写入控制下校验修订和对象所有权。Entity、关联与 mask 全部可见或全部不提交；一次组合仅递增一次 caseRevision。上传完成不等于正式保存。文件与元数据崩溃恢复方案由实现阶段补齐，不以普通文件复制冒充原子事务。

旧 OHIF 写入能力作为实现组件使用，必须接入同一病例版本控制，不能绕开 caseRevision。幂等重放先读取已成功结果，再处理旧修订冲突。发生冲突保留用户本地编辑，要求刷新后重新提交，不静默覆盖。

错误格式为 `{error:{code,message,details},requestId}`。主要状态：409 为病例/目标版本冲突或幂等冲突，422 为证据文本、网格或对象归属不符，413 为大小超限，404 为对象不存在，403 为写入权限不足。自动目标跳过 HUMAN_MASK_PRESENT 是任务结果，不应导致整批其他目标失败。

## 8 实现验收与剩余细节

验收至少覆盖：两 Finding 共享 Entity；无报告/未关联目标；同病例多个目标重叠；空草稿；人工 mask 目标被自动流程跳过；推理期间人工保存竞态；保存重试不重复；组合保存失败无半次结果；完成后修改失效；候选处理完后完成；固定任务集合百分比；结构图层不占Entity 主 mask、不进入Entity 完成分母。

用户已确认业务边界。实现阶段补充机器可读 schema/OpenAPI、固定 ReX 类别表快照、TotalSegmentator 结构标签映射、上传限制、任务集合入口、认证身份和文件提交恢复机制，避免继续扩大业务决策范围。

2026-10-13 已完成本地人工闭环实现和局部联调，详见第一版实现记录。未迁移数据、未推送或部署；完整 OHIF 影像验收与协作记录同步待执行，负责人为当前 Annotation 会话。
