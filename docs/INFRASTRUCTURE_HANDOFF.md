# OHIF-NIFTI 设备与服务交接清单

当前正式 OHIF：前端 9da5928、后端 d5f00fe，nnInteractive 已启用；Finding 隔离候选待评审、未替换正式服务。路径和回退以各自最新检查点为准，此前部署段落保留为历史。
更新日期：2026-10-12，Asia/Shanghai。适用对象：没有此前会话上下文、需要继续集成或维护标注流水线的 agent。

主副本保存在 `/Users/berntao/workdir/OHIF-NIFTI/docs/INFRASTRUCTURE_HANDOFF.md`，当前会话目录保留同名副本。后续更新以仓库副本为准，并同步会话目录副本。

项目目标是打通 **报告拆分 → Mention 与 Finding 提取 → 图像定位与空间 Entity 候选 → OHIF 人工审核与修正 → 标注版本保存**。主仓库是 Mac 上的 OHIF-NIFTI。当前分工已经确定：**rtx4500 承载标注服务与权威数据，chocola 承担流水线与图像 GPU 推理，vanilla 提供 GLM 语言模型服务，Mac 负责开发和人工访问**。

目前 OHIF 标注服务与 GLM 服务分别可用，但图像定位和统一任务队列尚未接入 OHIF。不要把“服务已部署”理解成整条自动流水线已完成。

## 设备清单与角色

| 设备别名 | Tailscale 地址 | SSH 用户 | 已核验资源 | 当前角色 |
|---|---|---|---|---|
| Mac 本地 | 当前开发电脑 | berntao | arm64，24 GiB 内存，10 个逻辑 CPU | 代码开发、Git、浏览器审核与本地结果检查 |
| rtx4500 | 100.104.172.26 | ant | x86_64，64 个逻辑 CPU，125 GiB 内存，1 张 RTX 4500 Ada，24570 MiB 显存 | OHIF 前端、NIfTI 后端、CT-RATE 主数据与标注持久化 |
| chocola | 100.79.96.17 | ubuntu | x86_64，384 个逻辑 CPU，约 1 TiB 内存，8 张 H200 NVL，每卡 143771 MiB 显存 | 报告流水线执行、图像定位模型评估与后续 GPU worker |
| vanilla | 100.110.156.71 | ubuntu | x86_64，384 个逻辑 CPU，约 1 TiB 内存，8 张 H200 NVL，每卡 143771 MiB 显存 | GLM-5.3 推理服务，处理报告文本 |

GPU 数量不代表可全部重新分配。vanilla 的 GLM 使用八卡张量并行；任何新推理任务开始前先检查实际 GPU 占用。两台 H200 机器的操作系统 hostname 都是 `ubuntu`，必须结合 IP 判断机器身份，不能只看 `hostname`。

### 磁盘与用途

以下可用空间是 2026-10-12 的检查快照，运行前应重新确认。

| 设备 | 挂载点 | 容量与可用空间 | 用途 |
|---|---|---|---|
| rtx4500 | `/` | 1.8T，总可用约 1.5T | 应用镜像、运行代码、标注状态和流式缓存 |
| rtx4500 | `/media/ant/新加卷1` | 17T，总可用约 8.9T | CT-RATE 数据 |
| chocola | `/data/cache` | 3.5T，总可用约 1.9T | 项目环境、热数据、流水线运行结果 |
| chocola | `/data/models` | 3.5T，总可用约 3.4T | 模型存储，具体定位模型权重仍需核实 |
| chocola | `/mnt/elements` | 15T，总可用约 7.1T | 已有 CT-RATE 副本 |
| vanilla | `/data/cache` | 3.5T，总可用约 1.4T | LLM 服务脚本、日志和其他既有项目 |
| vanilla | `/data/models` | 3.5T，总可用约 2.8T | GLM 等模型权重 |

## Mac 的连接方式

Mac 已配置 `/Users/berntao/.ssh/config`，以下命令已验证免密连接成功：

```bash
ssh rtx4500
ssh chocola
ssh vanilla
```

三个别名均使用默认 SSH 端口 22 和本地密钥文件 `/Users/berntao/.ssh/id_ed25519_server_vanilla`，配置了 `IdentitiesOnly yes`。别名及对应 IP 都在 Host 配置中；无需重新生成或上传密钥。

没有加载别名配置的客户端可以明确指定用户与密钥：

```bash
ssh -i ~/.ssh/id_ed25519_server_vanilla ant@100.104.172.26
ssh -i ~/.ssh/id_ed25519_server_vanilla ubuntu@100.79.96.17
ssh -i ~/.ssh/id_ed25519_server_vanilla ubuntu@100.110.156.71
```

`scp` 和 `rsync` 也可使用 Mac 的这些别名。Mac 的 SSH 别名和密钥不会自动出现在服务器上；服务器之间连接应使用相应 IP 和用户名，并核验该方向的认证方式。不要复制 Mac 私钥来解决服务器间连接。

所有访问依赖 Tailscale 连通。Mac 的 Wi-Fi 系统代理已为 `ant-trx50-aero-d.tailb37712.ts.net` 添加单独绕过规则。如果 curl 正常但浏览器连接被关闭，优先检查此规则是否被代理软件重置，不要据此重建服务。

2026-10-12 已修复 Clash Verge 默认绕过列表覆盖该例外的问题：在“设置 → 系统代理设置”关闭“始终使用默认绕过”，自定义列表保留全部 8 个原有默认条目，并新增上述精确域名。“验证代理绕过格式”保持开启。配置已保存到 `~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/verge.yaml`（`use_default_bypass: false` 和 `system_proxy_bypass`），系统 Wi-Fi 绕过列表也已核验。后续不要切回默认列表而遗漏该域名。

## 本地代码和交接产物

| 路径 | 内容与地位 |
|---|---|
| `/Users/berntao/workdir/OHIF-NIFTI/` | 唯一目标主仓库，后续整合提交应回到这里 |
| `/Users/berntao/workdir/deployment-source-20260920-181338/medical-imaging-studio/` | 待迁入的数据管理、标注和分析功能来源 |
| `/Users/berntao/workdir/deployment-source-20260920-181338/lesion_harvest/` | 报告提取、原文证据对齐、候选关联等代码来源 |
| `/Users/berntao/workdir/OHIF-NIFTI/deploy/rtx4500/` | 本次 rtx4500 部署的 Compose、Dockerfile、Nginx、病例准备与验收脚本、运行记录 |
| `/Users/berntao/Documents/ChatGPT/Annotation/rtx4500-deploy/` | 本地部署准备文件、浏览器验收脚本、JSON 结果和截图 |
| `/Users/berntao/Documents/ChatGPT/Annotation/report-pilot-20261011/` | 另一个会话完成的报告试跑代码与结果，包含独立修改的 pipeline 副本 |
| `/Users/berntao/Documents/ChatGPT/Annotation/glm53_validation_chocola.jsonl` | 从 chocola 调用 GLM 的既有冒烟验证结果 |

2026-10-12 已将 Mac 的 main 快进同步并更新服务器源码快照至 OHIF-NIFTI 提交 `ca7cf52cf1b049fdf0a5aa70b74d96dc35ebc1a6`，前端已重建上线。后端代码在这两次提交中没有变化，沿用原有 `6603691` 镜像。截至本次检查，Mac 的 `deploy/rtx4500/` 仍是未提交目录。先检查 `git status`，不要假定交接配置已经进入 Git 历史。

rtx4500 的 `source/` 是没有 `.git` 的部署快照，并非另一个开发主仓库。远端修复应整理回 Mac 主仓库；部署包、权重、原图和运行产物应留在仓库外。其他机器已有 OHIF 旧目录不代表它们是本项目的正式标注入口。

## rtx4500 标注服务

### 访问入口与运行目录

正式入口：[OHIF NIfTI](https://ant-trx50-aero-d.tailb37712.ts.net/nifti)。

已注册的 25 例 CT-RATE 验证工作台：[打开病例与报告列表](https://ant-trx50-aero-d.tailb37712.ts.net/nifti?manifestId=bc1ed805723b4150ad6451bad378d955)。首例为 `valid_1_a_2`，可在链接后追加 `&caseId=valid_1_a_2` 直接打开。

Tailscale Serve 已由用户配置：HTTPS 443 转发到 `http://127.0.0.1:1026`，仅 tailnet 内访问。无需再次执行管理员配置。原 HTTP 地址 `http://100.104.172.26:1026` 可用于诊断；日常浏览器使用 HTTPS，渐进加载需要浏览器安全上下文。

```text
/home/ant/projects/OHIF-NIFTI/
  source/                  部署源码快照
  deployment/              compose.yml、Dockerfile、nginx.conf、运行记录
    manifests/             病例 JSON 清单
  state/
    images/                注册原图、病例清单、已保存 mask 与版本记录
    stream-cache/          可重建的逐层加载缓存
    studies/               MONAI studies 状态
    drafts/                编辑草稿
    predictions/           预测产物目录
    acceptance/            合成验收数据
```

Compose 项目名是 `ohif-nifti-rtx4500`，前端容器是 `ohif-nifti-rtx4500-viewer-1`，后端容器是 `ohif-nifti-rtx4500-backend-1`。后端端口 8002 只在 Docker 网络内，前端通过 `/monai/` 代理访问。部署用 Compose 是服务器 `deployment/compose.yml`，不是仓库根目录的历史 Compose。

本地 `deploy/rtx4500/` 配置按服务器 `source/` 与 `deployment/` 并列的目录布局编写。不能直接在 Mac 的这个目录执行 Compose 并期待获得相同部署；Linux 镜像构建和运行在 rtx4500 上完成。

### 数据位置和持久化

CT-RATE 主数据目录是：

```text
/media/ant/新加卷1/ct-rate-v2/dataset/
  train_fixed/
  valid_fixed/
  radiology_text_reports/train_reports.csv
  radiology_text_reports/validation_reports.csv
  metadata/
```

容器内同一数据目录为 `/datasets/ct-rate`，挂载为只读。报告子目录名是 `radiology_text_reports`，不是 `reports`。路径解析应通过数据根目录配置完成，避免把某台机器的绝对路径当作病例身份。

`state/images/` 中保存的原图引用、清单、mask 与历史版本是需要保留的状态。服务重建不应删除 `state/`，模型重跑也不应覆盖人工标注。`state/stream-cache/` 是派生缓存，不能当作原始数据或已审核标注。

现有 `orthancPACS` 是独立旧服务，端口绑定在本机 `127.0.0.1:4242` 和 `127.0.0.1:8042`，本次 NIfTI 部署没有接入它。`/home/ant/projects/OHIF-AI/` 也是旧代码目录；维护新标注服务时避免误操作这些服务和目录。

### 已验证能力和配置

已验证真实 CT 逐层加载、25 例列表、报告显示、手工编辑、mask 版本保存、浏览器刷新恢复以及后端重启后的持久化。合成验收 mask 的 v4 是测试结果，不能计入真实病例标注。

当前启用 NIfTI library、editing、streaming 和 nnInteractive AI，后端固定 RTX 4500 GPU；VoxTell、MedGemma 和 SAM 接口保持关闭。

前端构建包含 ONNX `__filename` 的浏览器兼容修复；Nginx 为直接刷新工作台配置了 NIfTI 加载入口重定向，并缓存带内容哈希的前端资源。重新构建应沿用 `deploy/rtx4500/frontend.Dockerfile` 和 `nginx.conf`，否则可能重新引入刷新黑屏。

镜像名为 `ohif-nifti-rtx4500-viewer:20261012-ca7cf52` 和 `ohif-nifti-rtx4500-backend:20261011`。准确镜像 ID、挂载和验收记录见本地及服务器的 `deployment.json`。构建依赖 rtx4500 已有的 `webapp:latest`、`monai:latest` 基础镜像；这些镜像并不包含在 Git 仓库中。

## vanilla 语言模型服务

| 项目 | 当前配置 |
|---|---|
| API base URL | `http://100.110.156.71:30000/v1` |
| 模型名 | `GLM-5.3` |
| 健康入口 | `http://100.110.156.71:30000/health` |
| 模型列表 | `http://100.110.156.71:30000/v1/models` |
| 权重 | `/data/models/GLM-5.3`，FP8，既有检查约 704 GiB |
| 推理环境 | `/home/ubuntu/.venvs/sglang` |
| 启动脚本 | `/data/cache/ohif-llm/glm53/start.sh` |
| 日志与 PID 文件 | 同目录 `server.log`、`server.pid` |
| GPU 与并发 | `tp=8`，显存比例 0.8，8192 token 上下文，最多 4 个运行请求 |

服务绑定 **100.110.156.71:30000**，没有绑定 `127.0.0.1:30000`。在 vanilla 本机检查时同样要使用 Tailscale 地址；localhost 连接拒绝不表示服务停止。

2026-10-12 已确认健康检查 HTTP 200，Mac 可以读取模型列表，模型 ID 为 `GLM-5.3`。此前从 chocola 的推理验证和 20 份报告试跑已经完成。服务通过后台脚本运行，尚未配置开机自启；重启机器后应重新检查进程，PID 文件可能过期。脚本参数和实际监听优先于历史脚本中的 48 并发设置。

vanilla 负责报告文本理解和结构化提取。原文 span 校验、稳定 ID、Finding 候选关系与落库由流水线代码完成；正常报告请求无需传 CT 或 mask。现有试跑使用 `reasoning_effort: low` 与 JSON 输出格式，最终回答和模型推理内容需要分别解析。

vanilla 还运行旧 OHIF、MONAI、Orthanc 等容器。它们不是当前正式标注服务，不应仅因为看到同名端口或目录就替换它们。GLM 使用八卡，维护或重新分配 GPU 要依据当前用户任务，不要把交接文档当作重启授权。

## chocola 流水线与图像推理

chocola 已有 CT-RATE 副本 `/mnt/elements/ct-rate-v2/dataset`，以及另一套 `/data/cache/datasets/CT-RATE/dataset`。这两处目录不应未经比较就视为同版本或完全一致。rtx4500 是本项目确定的主数据与标注服务位置；chocola 的本地数据可用于推理，采用 volume ID、数据版本和内容及几何标识建立关联。

当前已存在：

```text
/data/cache/projects/rex-text-guided/                  既有项目与环境
/data/cache/ohif-pipeline/runs/report-pilot-20261011/   报告试跑代码和结果
/mnt/elements/ct-rate-v2/dataset/                     已有 CT-RATE 副本
/data/models/                                        模型磁盘
```

`/data/cache/projects/OHIF-NIFTI/` 和 `/data/models/ohif-pipeline/` 是适合后续统一的拟建位置，尚不能当作已部署目录。图像定位 worker 与统一持久化任务队列也尚未部署。用户要求先评估现有 VoxTell，再决定是否沿用；不要直接把它认定为最终定位模型。

拟采用的数据流为：rtx4500 管理病例与审核状态；chocola 按任务读取或缓存所需 CT，调用 vanilla 提取报告信息，执行图像定位；定位候选回传 rtx4500，由 OHIF 展示和人工审核。缺失数据的补传在两台服务器之间进行，先检查本地副本再按病例传输，避免经过 Mac 中转全量 CT。

模型输出需要记录原图标识、geometry hash、方向及坐标变换、模型与配置版本、Finding ID 和候选 ID。Mention 是报告的一次原文提及，Finding 可关联多个 Mention，Spatial Entity 是图像空间候选；mask 连通块和候选数量不能直接当作独立病灶数量。

## 当前报告试跑与下一步

另一个会话已使用 lesion_harvest 和 GLM-5.3，完成 20 份不同报告、对应 35 个 CT 体积的试跑。完整数据清单是 987 个体积，对应 562 份按报告原文去重后的不同报告，未全量推理。

本地结果入口为 `report-pilot-20261011/pilot-20/review/index.html`，原始输出和逐体积 JSON 在同一试跑目录。此试跑未做图像定位，也未做 SNOMED 映射。已知问题包括否定规则误判、类别码带描述导致枚举拒绝、同一 Finding 的多次提及尚未归并。

当前优先顺序是修复并验证上述报告提取问题，评估 VoxTell 的代码与权重可运行性，再建立小样本“报告候选 → 定位候选 → OHIF 审核”的闭环。25 例 OHIF 验证工作台与 20 份报告试跑是两套独立验收集合，尚未自动合并。

## 新 agent 的首次只读检查

以下命令从 Mac 执行，只检查状态，不启动批量推理或重建服务。

```bash
cd /Users/berntao/workdir/OHIF-NIFTI
git status --short
cat deploy/rtx4500/deployment.json

ssh -o BatchMode=yes rtx4500 hostname
ssh -o BatchMode=yes chocola hostname
ssh -o BatchMode=yes vanilla hostname

ssh rtx4500 'cd /home/ant/projects/OHIF-NIFTI/deployment && docker compose ps'
ssh rtx4500 'tailscale serve status'
curl -fsS --max-time 15 https://ant-trx50-aero-d.tailb37712.ts.net/monai/health

curl -fsS --max-time 15 http://100.110.156.71:30000/health
curl -fsS --max-time 15 http://100.110.156.71:30000/v1/models

ssh chocola nvidia-smi
ssh vanilla nvidia-smi
```

需要看标注服务日志时：

```bash
ssh rtx4500 'cd /home/ant/projects/OHIF-NIFTI/deployment && docker compose logs --tail=100'
```

设备状态、空闲空间和进程会变化。开始实际修改前，结合当前用户任务、仓库适用的 AGENTS.md 和上述实时检查确定操作范围。历史文档中的部署命令、旧分工和本交接清单提供上下文，不构成新的删除数据、重启服务、占用 GPU 或外发数据授权。用户已经明确将正式 OHIF 标注服务放在 rtx4500，早期“部署在 chocola”的方案已被取代。

### 2026-10-12 部署更新

更新 `6603691 → ca7cf52`，包含病例切换修复及统一侧栏界面。正式 HTTPS 上已验证 CT 流式渲染、25 病例与报告、切换病例并返回（仅保留当前 display set）、面板收起与展开、已有测试标注读取及刷新恢复。

回退前端：在 `/home/ant/projects/OHIF-NIFTI/deployment` 执行 `docker compose -f compose.rollback-6603691.yml up -d --no-deps viewer`。旧源码保留在 `../source-6603691`，旧前端镜像另标记为 `ohif-nifti-rtx4500-viewer:rollback-6603691`。回退时保留 `state/`；后续重新构建前先核对所用源码提交与 Compose 镜像标签。

## 2026-10-13 单 CT 病灶标注上线

- 当前应用：medhlab/OHIF-NIFTI `codex/annotation-v1`，部署提交 `9bfe0f10bc9f0ce4a8c5c10255825ed22b1682ec`；前后端成套镜像标签 `annotation-v1-9bfe0f1`，精确镜像 ID 见部署回执。
- 已部署源码：rtx4500 `/home/ant/projects/OHIF-NIFTI/source/` 现为指向 `/home/ant/projects/OHIF-NIFTI/releases/annotation-v1-20261013/source/` 的链接；旧 ca7cf52 快照保留于 `/home/ant/projects/OHIF-NIFTI/source-ca7cf52-20261013/`。
- 证据：rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/annotation-v1-20261013/`，含三轮构建日志、real-ct-results.json、file-verification.json、production-smoke.json、deployment-receipt.json 和实际浏览器截图。
- 已验证真实 CT-RATE valid_1_a_2（512×512×502）：鼠标绘制、Save All v1/v2、体素哈希一致、刷新及新浏览器恢复、两 Finding 共享 Entity 且各保留证据、完成 1/25＝4%、编辑后完成失效。142 项后端回归及 13 个前端模块语法检查通过。
- 结构：两个合成标签各 2,000 体素，验证导入、显示、隐藏、只读和刷新恢复；修复 Cornerstone 锁定仍能向背景绘制的漏洞，编辑工具及快捷键激活均受只读保护。用户之后补真实 TotalSegmentator 文件，真实解剖结果对齐未验收。本次没有 GPU 推理。
- 生产 HTTPS 健康；真实 CT 工作台为空白新标注，进度 0/25。原有 v4 测试 mask 可加载。升级时保留原有索引；正式打开清单仅增加其 revision，影像/标注行、原始清单内容及 15 个不可变文件保持一致，未发布候选测试标注。
- 持久化仍为 `/home/ant/projects/OHIF-NIFTI/state/`。停写后备份原图库、SQLite、草稿和配置到 `/home/ant/projects/OHIF-NIFTI/releases/annotation-v1-20261013/production-backup/`。回退命令：`docker compose -f /home/ant/projects/OHIF-NIFTI/releases/annotation-v1-20261013/production-backup/compose.rollback.json up -d --no-build --pull never`；保留 state/，不删除新标注，旧代码不提供新病例语义功能。
- 试用入口：[25 病例工作台](https://ant-trx50-aero-d.tailb37712.ts.net/nifti?manifestId=bc1ed805723b4150ad6451bad378d955&caseId=valid_1_a_2)，进入后打开病灶工作台。

## 手工编辑入口修复（2026-10-13，13:27 Asia/Shanghai）

- 已部署前端 `b40509990d5ea7d17c91f2a078e3bd76f770e9ec`，镜像 `ohif-nifti-rtx4500-viewer:annotation-manual-b405099`；后端仍为 `9bfe0f10bc9f0ce4a8c5c10255825ed22b1682ec`。仅重建前端容器，后端及生产 state/ 保持原位。
- 根因：按钮仅切换模式；页面默认 manual，但无目标、画笔禁用，重复点击立即返回。修复后单击注册/恢复同一业务病例、准备可编辑目标并启用画笔；没有目标时新建本地病灶目标，Save All 登记 Entity 和主 mask。有已保存病灶时先恢复它。重复点击复用目标并继续绘制。只读结构和锁定病灶显示提示并切回浏览。
- 两轮完整 yarn build 通过，13 个前端模块语法检查通过。最终真实 CT-RATE valid_1_a_2 的 7 项隔离回归通过：单击入口、重复复用、实际绘制 4,765 体素、Save All、刷新恢复同 Entity 与体素哈希、锁定提示/浏览、结构只读提示/哈希不变。正式 HTTPS 的入口、重复点击和实际绘制 3 项通过，正式环境没有保存验收 mask。无未捕获 JS 错误。
- 公共源码与证据：rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/annotation-manual-20261013/`；source/ 链接现指向此处的 source/。包含最终构建日志、manual-acceptance.json、manual-production.json、deployment-receipt.json、浏览器截图和独立候选 state-final/；测试标注没有发布到正式状态。
- 回退本次前端：`docker compose -f /home/ant/projects/OHIF-NIFTI/releases/annotation-manual-20261013/compose.rollback.json up -d --no-deps --no-build --pull never viewer`。源码入口如需回退，恢复 source/ 链接到前一 release 的 source/；应用回退不删除 state/。首版前后端升级的完整回退和历史证据见下面首版部署记录。
- 用户操作：刷新页面 → 标注与 AI → 手工编辑 → 在 CT 上拖动画笔 → Save All。真实 TotalSegmentator 文件仍由用户之后补充，本次结构回归使用明确标注“非解剖”的合成标签，没有 GPU 推理。

## nnInteractive 正式启用（2026-10-13，15:03 Asia/Shanghai）

- 当前前后端均为 OHIF-NIFTI `d5f00fee2c522fe88cd74f6536982ee58fcffa4d`，镜像标签 `nninteractive-d5f00fe`；实际 ID 与回退入口见 `deploy/nifti/nninteractive-deployment.json`。正式 HTTPS 已通过真实 CT 首次与连续 GPU 推理，生产未保存验收 mask。
- 启用前端 `enableNiftiAI` 和后端 `ENABLE_NIFTI_AI` / `ENABLE_NNINTERACTIVE`，GPU 固定为 RTX 4500 UUID GPU-53ea6923-163a-660e-73e0-d18bd8ea5458、CUDA_VISIBLE_DEVICES=0。torch 2.8.0+cu128、CUDA 12.8、nnInteractive 1.1.3；其他模型仍关闭。公共权重只读挂载 `/home/ant/projects/OHIF-NIFTI/models/nnInteractive_v1.0/`，checkpoint SHA-256 `b3ac4421f85457bbd1aa0d87f5e67bcb7bc8e2ce6b824b6ac45077cc5d630ea9`。
- 143 项后端回归、13 项前端语法检查、完整 OHIF 构建通过。真实 CT-RATE valid_1_a_2（512×512×502）隔离 9 项与正式 HTTPS 3 项通过，无未捕获 JS 错误。非空人工种子哈希匹配，AI 只更新选中病灶；负提示延续 session；画笔修改后重新播种；同 Entity/mask 保存 v2，v1 不变；刷新恢复；失败、重置及只读结构保护通过。
- GPU 采样利用率峰值 100%，总显存峰值 5837 MiB（含桌面显示）；最终后端进程显存 1,622 MiB，与容器 PID 一致。正式模型加载 1.731 秒，首次端点推理 4.948 秒、连续 0.594 秒。正式浏览器首次 86.730 秒、连续 4.911 秒；前者含 132 MB 人工种子上传，不能用 GPU 耗时代替用户等待时间。
- 稀疏二值预测使用推理路由专用 HTTP gzip；实测 131,597,113 解码字节 → 1,239,469 传输字节，协议与完整 131,596,288 体素网格校验通过。首次/画笔修改后的种子仍以原二值数据上传；后续会话不再上传种子。
- 公共源码、浏览器 JSON/截图、构建日志、权重清单、GPU 采样、状态校验与部署回执：rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/nninteractive-20261013/`。source/ 指向该 release/source；生产 state/ 保持原位。3 个原图、5 个既有 mask 版本、25 个病例与 26 个快照记录不变，5 个 mask 文件与部署前副本逐字节哈希一致。病例清单仅 revision 16→18，新增 2 条注册请求幂等记录。
- 回退：`python3 /home/ant/projects/OHIF-NIFTI/releases/nninteractive-20261013/rollback_remote.py`，恢复前一 Compose、前端构建配置、Nginx、deployment.json 与 source/ 链接并重建应用容器；不恢复/删除当前 state/。一致 SQLite 备份在 production-backup/，仅作恢复依据。候选已停止，正式后端通过 `flock -n -F /code/runtime/nninteractive-gpu.lock` 持有锁，宿主 runtime/ 绑定到 /code/runtime；其他 GPU 程序必须检查实际占用，文件锁不约束绕过入口的程序。
- 设备分工例外：按用户本次授权，rtx4500 增加交互 nnInteractive GPU 服务，保障标注低延迟；chocola 的流水线与 vanilla 的 GLM 服务未调整。
- 用户入口：[试用真实 CT](https://ant-trx50-aero-d.tailb37712.ts.net/nifti?manifestId=bc1ed805723b4150ad6451bad378d955&caseId=valid_1_a_2)。刷新 → 标注与 AI → 手工编辑准备/选择病灶 → AI 提示 → 包含/排除点 → 运行 AI → 等“已更新当前 mask。” → Save All。自动开关用于连续提示自动推理；首次或画笔修改后的上传等待较长。AI 编辑仍是当前病灶的人工操作，保存保持 human authority，不创建独立模型候选。
- 限制：仅一例真实 CT 的工程闭环；鼠标绘制的验收区域不代表病灶诊断或准确率。真实 TotalSegmentator 结果仍待用户补充，只读结构使用明确标记“非解剖”的合成标签验收。初次正式浏览器网络暂停已重试通过，不归因于模型质量。

## 右键缩放方向（2026-10-13）

2026-10-13 15:34 Asia/Shanghai：前端 9da5928、后端 d5f00fe。当前 rtx4500 源码 `/home/ant/projects/OHIF-NIFTI/releases/zoom-direction-20261013/source/`；证据及 viewer 回退见 `/home/ant/projects/OHIF-NIFTI/releases/zoom-direction-20261013/receipt.json`。回退 `python3 /home/ant/projects/OHIF-NIFTI/releases/zoom-direction-20261013/release.py rollback`。真实 CT 浏览/手工/AI 右键交互通过，后端未重启，mask 像素不变。详见 ZOOM_DIRECTION_FIX.md。

## Finding 真实报告隔离候选（2026-10-13）

rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/finding-real-100-20261013/`：真实 GLM-5.3 的 100 份报告映射 184 个 CT，导入/显示/人工关联候选。仅回环 1028，SSH 转发供评审；未发布新 HTTPS 服务。CPU 后端关闭 AI，正式 nnInteractive 后端未重启。代码工作区未提交，基线 d80ac2a；运行快照 499ab8c65669b10ba625b7dca015f7657762d3fc2262a4bd72fd979c7532f169，不将 Git HEAD 当作候选全部代码。状态 已完成（工程验收；应用待评审），详见 [迭代实验](experiments/2026-10-13-ohif-finding-real-100.md)。此目录独立 state/，正式 deployment/、state/ 与 source/ 不变。

当前正式版本以前端 9da5928、后端 d5f00fe 为准；以上候选不替换正式入口。100 份输入的当前 chocola 入口已同步此检查点，个人环境说明保留在既有副本。

## 自动打开工作台完成（2026-10-13T17:21:58+08:00）

用户反馈进入 CT 后仍需点击工作台。已改为 CT 及病例切换提交完成后自动登记/恢复同一 Case 并加载报告；原打开按钮移除，只在失败时显示“重试加载工作台”。并发自动/手工入口共享登记请求，请求前固定清单身份，过期直链响应不改新病例 URL；新 CT 初始化时不显示上一例报告。

应用代码保持未提交、未推送，基线 d80ac2a；12 个实现/单元测试文件运行快照 SHA256 60c77863858b0cd6e48c9a63929bc2bae8178bd77257fab08214c925e6eaa663。本轮修改 LesionPanel.tsx 和 annotationClient.ts，复验脚本同步取消额外点击。5 项局部浏览器检查通过；最终完整 OHIF 构建通过，真实 CT 首次进入、左侧切换至零候选病例并返回、刷新自动恢复全部通过。四次进入只发出四次登记，同一批已有 caseId 保持一致，没有创建 Entity/Link/mask，无未捕获 JS 错误。未重跑模型或扩大语义/分割质量结论。

隔离候选仅更新 viewer，候选后端和正式后端均未重启；正式 viewer 9da5928 也未替换。继续复用原 100 报告预览的 state/ 与回环 1028，manifestId 576a3ff5bcbe40b9b9dc354942129f63。当前 viewer 镜像 finding-auto-60c7786385；源码、frontend-build-final.log、preview-update-receipt.json、local-results.json、full-ui-results.json 和截图在 rtx4500 /home/ant/projects/OHIF-NIFTI/releases/finding-auto-open-20261013/。Compose 项目仍为 ohif-finding-real-100；新 viewer 配置 compose.preview.json，backend 镜像保持 finding-499ab8c656。

原 Finding 报告的构建和 mask 闭环证据保留为前一快照的工程结果；新的自动加载验证单独记录。用户直接进入 CT 即可试用，无需点击打开；代码仍待评审。


## 默认肺窗验收完成（2026-10-13T17:38:51+08:00）

Annotation 会话；状态：已完成（工程验收，应用待评审）。CT 默认使用 OHIF Lung 预设窗宽 1500 HU、窗位 -600 HU，图像、VOI 元数据和内部实例一致，非 CT 保留原范围。完整 viewer 构建与两例真实 CT（train_10382_a_1 512×512、train_11272_a_1 1024×1024）首次进入、切换、返回、刷新、手动拖动调窗及滚动保留调窗共 6 项检查通过，无未捕获 JS 错误。Cornerstone 按 DICOM LINEAR 公式得到范围宽 1499、中心 -600.5；图像/元数据及界面读数为 1500/-600，符合既有预设。

仅替换既有隔离预览 viewer 为 finding-lung-1f63142697，源码快照 SHA256 1f6314269723fd18a6f4ab502731cd16c54e17f3274e142bd86d6a5530c638ae（13 文件，应用基线 d80ac2a，未提交/未推送）。公共源码、构建日志、compose.preview.json、preview-update-receipt.json、check.cjs、full-ui-results.json 与截图位于 rtx4500 /home/ant/projects/OHIF-NIFTI/releases/finding-lung-window-20261013/。复用回环 1028、原 manifest 和 state/；两个后端未重启，正式 viewer 未替换，未修改 mask 或调用模型。回退 viewer 可用上一目录 finding-auto-open-20261013/compose.preview.json 在相同项目执行 up -d --no-deps viewer，保留状态。


## 病灶删除与 nnInteractive 提示管理完成（2026-10-13T18:27:21+08:00）

Annotation 会话；状态：已完成（工程验收，应用待评审）。病灶工作台中关联和未关联 Entity 均有删除按钮；deleteEntity 操作核对 Case revision、幂等提交，解除其 Finding 关联并移除当前 mask/提示，保留 Finding/证据、不可变 mask 历史、所有权和删除快照；已删除 Entity 的旧保存入口不能复活它。选择病灶时直接绑定当前编辑目标。

参考 medical-imaging-studio 的提示快照/替换思路，新增按病灶的包含/排除提示列表、定位、显示/隐藏、删除、清空和撤销/重做、推理状态；隐藏只改显示，删除/撤销后从本轮 AI 前的人工基线重放剩余提示，清空恢复该基线。人工编辑后旧提示归入已有 mask，新提示从当前像素开始；基线受内存预算约束，目标移除后释放。过期响应和无事件的像素修改也受保护。Prompt 首次 ADDED 时 IJK 为 null，坐标完成时 UPDATED 的事件合并，真实单点只发一次推理；缓存统计及重复添加不触发重放。提示撤销历史限当前编辑会话，尚未随 mask 版本持久化；mask 保存与重开已验证。

验证：152 项原生 NIfTI 后端回归、46 项真实 CommandsManager/controller/editor 回归及最终完整 OHIF 构建通过。train_10382_a_1（512×512×236）用独立工程 Case 验证新建空病灶真实 GPU 推理、正负提示、显示/定位、删除重放、撤销/重做、清空/恢复、两个病灶隔离、保存/重开、关联/未关联病灶删除共 11 项（快照 8ff65fb0733f15599bc004e236b467071cd177aa99b64a9b8e7cb3923b9c709b）；最终增加无事件人工修改保护，4 项真实 GPU 检查验证过期结果丢弃、新人工 seed 和清空恢复，快照 5fad641de4e050756ce24bd9b2862920b21260359503752eea6a36e55c27ccb6，均无未捕获 JS 错误。早期失败含验收脚本读取大响应、体素取整断言及发现的重复完成事件；已修正并最终通过。初次完整 seed 传输仍较慢，模型计算约半秒；不据工程点位评价病灶分割质量。

原 100 报告预览此前 AI 关闭，现在启用独立 nnInteractive GPU 实例与独立运行锁，复用原 state/、清单与回环 1028。当前 viewer prompts-5fad641de4，backend prompts-8aed824ec0；模型 ready，RTX4500 两实例显存总占用约 3.9 GiB，未修改正式 viewer/backend、正式 state 或 Serve。21 个实现/测试文件快照 5fad641de4e050756ce24bd9b2862920b21260359503752eea6a36e55c27ccb6，应用基线 d80ac2a，代码未提交/未推送。公共源码、compose.preview.json、状态备份、构建日志、frontend-tests.log、backend-tests.log、full-ui.cjs/full-ui-results.json、final-smoke.cjs/final-smoke-results.json、截图与 final-receipt.json 位于 rtx4500 /home/ant/projects/OHIF-NIFTI/releases/lesion-ai-prompts-20261013/。final-receipt.json 核验原 184 个 worklist Case 元数据未被工程测试修改，测试用独立 Case，已完成测试的 Entity 删除后只保留历史。

回退整个预览可使用 finding-lung-window-20261013/compose.preview.json 在相同 ohif-finding-real-100 项目执行 up -d --no-build --pull never，会恢复旧 CPU 后端/关闭预览 AI，保留 state/；正式服务不参与回退。仅 viewer 回退使用对应历史 Compose 的 up -d --no-deps viewer。用户先保存编辑再刷新当前完整 CT 预览。后续由用户评审，应用不自动提交。


## nnInteractive 延迟优化核验（2026-10-13T19:00:58+08:00）

原隔离预览 viewer/backend 更新至 nn-latency-06f34f912b，复用回环 1028、state/ 与 nnInteractive GPU，正式服务不变。动态能力协商开启无损 gzip seed；62 MB 空 seed 约 60 KB，热启动首点实测 2.32 s、重算 1.95 s，冷启动 5.62 s；完整构建、211 项回归与 15 项真实 UI 检查通过，GPU raw/gzip 全体素相等。公共产物 rtx4500 /home/ant/projects/OHIF-NIFTI/releases/nn-latency-20261013/，快照 06f34f912bf79097b966356a1f65937878213003e0c163b12a7428ce91c87a15，应用未提交。保存编辑再刷新浏览器；回退使用前版 lesion-ai-prompts-20261013/compose.preview.json 在同一 Compose 项目 up -d --no-build --pull never，保留状态。详见 [团队延迟验收](https://github.com/medhlab/cooperate_space/blob/codex/annotation-v1-record/results/shared/2026-10-13-ohif-nn-latency.md)。


## 病灶操作图标核验（2026-10-13T19:55:40+08:00）

仅隔离 viewer 更新为 lesion-icons-6b6d90c5ff，定位后依次为解除关联/删除图标，未关联病灶同样使用删除图标；保留原确认和操作逻辑。完整构建、7 项 UI 布局/点击验收通过，两个后端与正式 viewer 未变，无模型调用，应用未提交。公共源码与证据 rtx4500 /home/ant/projects/OHIF-NIFTI/releases/lesion-icon-actions-20261013/，源码快照 6b6d90c5ff014c18f267d92ffd94fbe22855277b66c73b00dfb2a8308e8ad785；回退仅 viewer 使用前版 nn-latency-20261013/compose.preview.json 的 up -d --no-deps --no-build --pull never viewer，状态保留。


## Finding / Entity 顶部工具栏核验（2026-10-13T22:27:06+08:00）

隔离 viewer 已更新为 toolbar-entity-cbe36623ee。界面统一 Finding / Entity，所有标注与 AI 功能移至顶部可展开工具；当前 Entity 和关联类别持续可见，右侧原工具页改“图像信息”。完整构建和 24 项真实 CT UI 检查通过，结构仅同网格非解剖合成标签，真实 TotalSegmentator 待补充。两个后端与正式 viewer 未改变。应用未提交；源快照 cbe36623ee15e19c35f31b97ef586fd7fb19093c46f3d8fadb6224074186436f。公共源码/构建/脚本/结果/回执 rtx4500 /home/ant/projects/OHIF-NIFTI/releases/toolbar-entity-20261013/；含按用户公开数据授权同步的最终截图和合成结构文件。回退只更新 viewer，使用前版 lesion-icon-actions-20261013/compose.preview.json，up -d --no-deps --no-build --pull never viewer，保留状态与后端。


## OHIF 原工具行标注图标核验（2026-10-13T22:55:40+08:00）

隔离 viewer 当前为 toolbar-inline-e829661459，ImageID sha256:9dfaaf601c24dfcaebf6ae3734e3481a7d958a572e150b6b166d3c7b00b6ea1c。取消第二行，标注图标与移动/测量同排；复用原生工具按钮、下拉、hover 和互斥；当前 Entity/类别在右侧固定标题。完整构建和 26 项公开 CT UI 验收通过；结构仅合成工程标签。源快照 e829661459fd5ae5ab5521812d65a19e7fb679db58cb10f07f753b9a733234ad，应用未提交。公共源码、构建、脚本、结果、截图、回执位于 rtx4500 /home/ant/projects/OHIF-NIFTI/releases/toolbar-inline-20261013/。两个后端与正式服务未改变，保留 nnInteractive 压缩种子传输。回退至 toolbar-entity-20261013/compose.preview.json，仅 up -d --no-deps --no-build --pull never viewer；保留后端与状态。


## OHIF CT 持续扩散缓存核验（2026-10-13T23:35:17+08:00）

隔离 viewer 当前为 progressive-cache-df25741ab0，ImageID sha256:1d50de6bd9a4d8ba69d1343621c62b49e08f7f2f523790418ff77803100a8532。首屏显示后持续向两侧扩散至整卷；显示帧优先，顶部原图加载状态支持进度、暂停和继续。16 项单测、完整构建及 8 项公开 CT UI 检查通过，真实 236 层不滚动达到 100%。源快照 df25741ab02cdc3c9b0a2b5602fe295c1d9161c8cd36d01fdb11aeb7f5b7db08，应用未提交。公共源码、构建、脚本、结果、截图、回执位于 rtx4500 /home/ant/projects/OHIF-NIFTI/releases/progressive-cache-20261013/。两个后端及正式 viewer 未改变，本轮无 GPU 推理。回退至 toolbar-inline-20261013/compose.preview.json，仅 up -d --no-deps --no-build --pull never viewer，保留后端与状态。

## 2026-10-14 编辑会话与 mask 保存更新

隔离预览（ohif-finding-real-100，回环1028）viewer/backend 当前为 mask-save-60fc85c190，冻结快照 60fc85c190c04dd1a80637071be6fef47256db7fabc1138eb8952fb999d3281b。新增明确的单 mask 编辑入口、目标和退出状态；保存继续编辑。二值 mask 无损压缩上传、阶段与百分比进度、90秒停滞终止及幂等重试。真实 CT 保存、全像素一致性、重开和 GPU 点提示通过；约61.9MB测试grid以约98KiB上传，约2.8s保存。完整构建、166后端、54前端测试通过，应用代码未提交。正式服务容器未改变、health ready。

公共产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/mask-save-20261014/`，包括源码哈希、完整构建、部署回执、验收JSON、日志及截图。回退使用同项目 `releases/editing-session-20261014/compose.preview.json`，仅 up -d --no-deps --no-build --pull never backend viewer，恢复 editing-83c53bf37f / nn-latency-06f34f912b，保留状态与权重。刷新页面取得新版。TotalSegmentator真实结果仍待提供。

## 2026-10-14 工作区提交整理

用户已授权提交截至目前全部改动。肺窗 74573f2e6bc8f3ec695713add05cb98712b1c347、后端 60bd365d9675c094e9bc171782140079a9412267、前端 785e18519c62fe8a04d718466cee7a8d8aacf8ed 已本地提交（应用分支未推送）。运行代码与既有 mask-save-60fc85c190 验收快照逐文件一致，沿用其完整构建、166后端/54前端及真实CT证据，本次没有重新部署。本文前述“未提交”描述保留为当时的历史状态，当前状态以本节及工作区提交记录为准。Finding/pipeline 剩余设计和真实结构结果仍待后续处理。

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

### 2026-10-14 紧凑卡片预览部署
缩小内外边距、按钮高度，合并 Entity 标题并移除重复 mask 名。完整前端构建及既有测试通过；浏览状态卡片实测高 147px，无横向溢出。预览镜像 `ohif-nifti-rtx4500-viewer:compact-card-ec3d4f666f`；产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/compact-card-20261014/`。部署脚本确认两套 backend 与正式 viewer 未重启。回退使用上一版 `status-card-20261014/compose.preview.json` 仅更新 viewer。应用改动未提交。

### 2026-10-14 工具栏模式分组完成
预览镜像 `ohif-nifti-rtx4500-viewer:tool-modes-2bebd5fddf`，产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/tool-modes-20261014/`。完整构建与既有前端回归通过。工程 CT Entity 验证：进入编辑同步 AI 模式；切换手工直接激活画笔；手工菜单可选；切回 AI 激活点提示；选择框选后状态卡片显示框选，设置仅显示 AI 提示设置；无浏览器错误。未发起 GPU 推理。两套 backend 和正式 viewer 均未重启。回退可用 `compact-card-20261014/compose.preview.json` 仅更新 viewer。应用代码未提交。

### 2026-10-14 应用提示与重试按钮完成
预览镜像 `ohif-nifti-rtx4500-viewer:apply-prompts-da657be3ae`；产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/apply-prompts-20261014/`。完整构建与 65 项回归通过（含失败重试、成功清除错误及目标切换隔离）。真实 CT 工程页面确认自动推理时隐藏应用按钮、手动无提示时禁用、添加待推理点后启用；浏览器无错误，未运行 GPU 推理或保存新增提示。两套 backend 与正式 viewer 未重启。回退可用 `tool-modes-20261014/compose.preview.json` 仅更新 viewer。应用代码未提交。

## 2026-10-14 界面与工具栏整理提交

用户授权整理、提交、推送并同步团队记录。功能提交 `b8e7d9fda37ed5023cde2012e3882427fbd06a27`（codex/annotation-v1）涵盖紧凑标注状态卡片、保存/退出按钮归位、顶栏工具分组、互斥手工/AI模式、应用提示和目标隔离重试状态，以及手动更新提示后的待处理标记。8个源码与测试文件逐文件匹配已验收快照 `da657be3ae52694102b70608dc1fd95d4465685897f5df5e123fabe9ee527488`。

完整OHIF构建及65项测试已通过；此前真实CT页面确认模式/工具同步、自动时隐藏应用按钮、手动无提示禁用及有待处理提示启用。当前核验隔离viewer运行 `ohif-nifti-rtx4500-viewer:apply-prompts-da657be3ae`。公共产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/apply-prompts-20261014/`。本次仅提交与推送，不重启服务或修改标注数据；无需重复运行模型。此前“未提交”段落为历史记录，当前代码已提交；远端发布以本次推送核验为准。

### 2026-10-14 病例完成入口归位完成
预览镜像 `ohif-nifti-rtx4500-viewer:case-status-29644545b6`；完整构建与既有65项回归通过。真实CT工程病例确认左侧当前病例卡片显示本例待完成和标记完成，右侧仅显示2个Entity，无病例状态或任务百分比。点击左侧标记完成，原校验正确返回“还有 Entity 尚未保存非空 mask”，病例保持待完成。整体百分比移至清单列表页。完成校验沿用既有API；已完成病例修改后自动恢复待完成，未新增显式重新打开API。两套backend及正式viewer未重启。回退用 `apply-prompts-20261014/compose.preview.json` 仅更新viewer。产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/case-status-20261014/`。本次应用增量未提交。

### 2026-10-14 Entity 总数同行显示完成
Entity 总数已移到“Entity 标注”标题旁小徽标，取消独立统计行。完整构建通过，真实CT页面确认标题同行显示2，病例完成入口仍在左侧。当前隔离viewer `ohif-nifti-rtx4500-viewer:entity-count-1a99546190`，产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/entity-count-20261014/`；两backend及正式viewer未重启。回退使用 `case-status-20261014/compose.preview.json` 仅更新viewer。应用增量未提交。

### 2026-10-14 报告补录入口底部布局完成
完整构建通过，真实CT页面确认“添加报告原文”位于 Finding / Entity 面板末尾，在未关联Entity、刷新及编辑说明之后。未提交报告或运行模型。补录仅保存原文，不自动拆分或生成Finding/Entity；模型提取结果独立导入。隔离viewer `ohif-nifti-rtx4500-viewer:report-entry-d9edee7fb3`；产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/report-entry-20261014/`。回退用 `entity-count-20261014/compose.preview.json` 仅更新viewer。两backend与正式viewer未重启；应用增量未提交。

### 2026-10-14 同级标题统一完成
报告原文与 Findings 共用 SectionHeading，图标、箭头、字体及计数一致。完整构建通过；真实CT页面确认 Findings 折叠后隐藏搜索和列表，左侧定位 F1 后自动展开。隔离viewer `ohif-nifti-rtx4500-viewer:section-headings-ea5ddbe8f7`；产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/section-headings-20261014/`。回退用 `report-entry-20261014/compose.preview.json` 仅更新viewer。两backend及正式viewer未重启；应用增量未提交。

### 2026-10-14 标题去重完成
完整构建通过，真实CT页面核验 Entity 标注大标题数量为0，报告分区标题文字仅“报告原文”，Findings 计数及折叠保留。隔离viewer `ohif-nifti-rtx4500-viewer:clean-headings-6f8f6f9f9d`；产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/clean-headings-20261014/`。回退用 `section-headings-20261014/compose.preview.json` 仅更新viewer。两backend及正式viewer未重启；应用增量未提交。

### 2026-10-14 Finding/Entity 行内操作合并验收完成
最终快照 `059486f69ad8e0c5be3c84333661c83f34a6155411e8346a7aba6443131b3284`，隔离viewer `ohif-nifti-rtx4500-viewer:entity-inline-059486f69a`；产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/entity-inline-20261014/`。完整构建及67项测试通过（新增未保存绘制/擦空/未加载mask空状态测试）。初次新测试因Cornerstone模块mock解析失败，改为virtual mock后通过。
真实CT工程Case确认F1/F2初始折叠，F1标题仅一个新增Entity加号，F1类别直接选择2c成功后恢复2d；Entity首击选中、再击名称出现行内输入，Esc取消正常；空Entity名称旁显示暂无标注虚线圆，待绘制独立行和Entity信息/无需标注入口均移除。模型报告结果整段移除。浏览器无error。未进行GPU推理或改动用户病例。
行内改名取代原生prompt，回车保存、Esc或失焦取消。保留既有服务端字段兼容，不迁移数据。回退使用 `clean-headings-20261014/compose.preview.json` 仅更新viewer；两backend及正式viewer未重启。应用增量未提交。

### 2026-10-14 报告提示单行与移除共享选择
按用户要求将报告提示标签与内容置于同一行，nowrap且横向溢出可滚动；移除Finding和报告提示详情内选择已有/共享Entity的入口及回调，不修改现有关联数据。完整构建通过。真实100报告清单中train_10382_a_1的F1提示实测高27px、nowrap、overflow-x auto；关联已有Entity下拉数量0。仅查看真实病例，未改其标注。
隔离viewer `ohif-nifti-rtx4500-viewer:report-hints-eb48249c83`；快照 eb48249c839f0c553655949a9dd337e2cf7235692f8c1352f51cce08ba2032cc；产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/report-hints-20261014/`。两backend及正式viewer未重启，回退用 `entity-inline-20261014/compose.preview.json` 仅更新viewer。应用增量未提交。

### 2026-10-14 状态按钮右置与 Findings 单一计数完成
保存标注、退出编辑位于状态信息右侧，使用两列布局且不再增加独立按钮行。Findings 标题仅显示 context.findings.length，去掉 Entity 数量。完整 OHIF 构建通过；真实100报告清单 train_10382_a_1 标题显示7，DOM中实际7条Finding，无Entity总数提示。状态卡片浏览模式实测高100px，按钮与状态信息左右排列。未改病例标注数据。
最终隔离viewer `ohif-nifti-rtx4500-viewer:finding-count-0de58eecc3`，快照 `0de58eecc32a09c92e591e2597d8ce70547bb91d74fca0915ae8b46f63a8504a`；产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/finding-count-20261014/`。状态栏中间版本在 `status-inline-20261014/`，已由最终版覆盖。两backend及正式viewer未重启；回退本轮用 `report-hints-20261014/compose.preview.json` 仅更新viewer。应用增量未提交。

### 2026-10-14 状态卡片图标操作验收完成
模式徽标贴齐卡片右上角；保存标注、退出编辑改为30px纯图标按钮，复用顶部工具栏 Tooltip 及 aria-label，移除按钮文字/数量。完整OHIF构建通过。真实CT报告页确认徽标距右边11px、顶边9px；两个按钮可见文本均为空，名称标签保留，卡片高100px。无病例数据写入。
隔离viewer `ohif-nifti-rtx4500-viewer:status-icons-c3ab173952`，快照 `c3ab173952c0c989c526c10e5b18ac29386d2c798d14206aa6fe5620823a36dc`；产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/status-icons-20261014/`。两backend与正式viewer未重启；回退 `finding-count-20261014/compose.preview.json` 仅更新viewer。应用增量未提交。

### 2026-10-14 鼠标工具单一高亮验收完成
移除手工编辑/AI提示工具组入口的 aria-pressed 与常亮样式，保留实际ToolButton激活高亮；移除同组选择提前返回，浏览后再次点击当前工具组可启用默认工具。完整OHIF构建通过。真实CT工程Case验证画笔→浏览→同组画笔→AI点提示→浏览，高亮随实际鼠标工具切换，最终可见顶部pressed按钮仅浏览。未绘制或保存mask。
隔离viewer `ohif-nifti-rtx4500-viewer:active-tool-de19ee1b3a`，快照 `de19ee1b3a65d0397dc0f20395ed21bb6d2bd24872dda47da42815e47aa9ba47`；产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/active-tool-20261014/`。两backend及正式viewer未重启；回退 `status-icons-20261014/compose.preview.json` 仅更新viewer。应用增量未提交。

### 2026-10-14 流水线原文排序与干净重导入完成
修复实际流水线快照：在graph/context生成后，按Findings→Impressions、证据start、end稳定排序mentions与lesions，相同跨度保留原顺序。processingVersion=`report-qc/2026-10-14-source-order`；代码SHA256 `ced019eb30f4957258f789a597c7b45d797ba455cc87931a367472a47f3f5569`。旧模型原始输出及冻结产物不改写。新公共运行根 chocola `/data/cache/ohif-pipeline/runs/report-source-order-20261014/`，包含pipeline源码、补丁、离线重放脚本、pilot-100/cases、source.json、replay-receipt.json及完整结果包report-source-order-results.tar.gz；后续应从此修复版本继续运行。
100份报告/184体积使用原始模型缓存重放，0模型请求。逐例验证忽略列表顺序、processingVersion和新增orderingPolicy后所有内容完全相等；919 accepted、44 rejected、641文本Finding候选、202跨章节候选及169暂存Impression数不变。4份报告对应8体积的Finding顺序改变。所有184体积的mentions与lesions满足排序。
按用户“标注都是测试，无需保留”要求新建干净任务，未迁入旧Entity/mask关联。新manifest `9ce3d83a1ab345fdb85e044ca1cad420`，runId=`report-source-order-20261014`。184病例API核验全部原文排序、精确证据一致、Entity/links为空且未完成；真实CT train_10382_a_1页面验证原F6成为F1，左右列表一致。旧manifest `576a3ff5bcbe40b9b9dc354942129f63` 仍为旧测试任务，不作为新入口；未删除底层旧文件。
rtx4500回执/截图 `/home/ant/projects/OHIF-NIFTI/releases/report-source-order-20261014/`。没有重启前后端或模型服务。应用仓库保存deploy/nifti/report-source-order.patch、replay-source-order.py及使用说明，增量尚未提交；团队同步以记录commit为准。此前人工质量问题不因排序修复而消失。

## 2026-10-14 Finding/Entity界面与流水线整理发布

用户授权整理全部改动、推送并创建PR。界面功能提交 `10eabe4`，流水线排序修复及离线重放工具提交 `c959808`。包含病例完成状态归位、任务列表进度、统一可折叠标题与Finding默认收起、行内类别/Entity改名、空mask提示、单行报告提示、移除共享选择及冗余内容、紧凑图标状态卡片和鼠标工具唯一高亮。此前工具栏/应用提示提交 `b8e7d9f` 同属本次相对main增量。

18个运行源码与测试文件逐文件匹配已部署 `active-tool-de19ee1b3a` 快照 `de19ee1b3a65d0397dc0f20395ed21bb6d2bd24872dda47da42815e47aa9ba47`。沿用完整OHIF构建、67项前端测试与真实CT界面验收。报告缓存重放100份/184体积，逐例内容/ID/关系不变、0模型调用；全量新导入API核验原文顺序与干净Entity/links。当前manifest `9ce3d83a1ab345fdb85e044ca1cad420`，流水线公共版本见deploy/nifti/report-source-order.md。

本次仅Git整理发布，不重启服务或改变已导入数据。此前未提交描述均为历史状态，发布证据以远端提交和PR为准。在线LLM调度、自动图像定位、真实TotalSegmentator结果及人工语义质量验收仍不在本次完成范围。后端历史annotationDisposition兼容仍保留，本次移除其UI入口。

### 2026-10-14 纯图标展开式编辑模式组验收完成
按用户进一步要求，展开矩形内也不保留手工/AI文字，仅模式图标、当前工具图标和下拉箭头，名称通过Tooltip/aria-label提供。当前编辑模式整组紫色高亮，内部ToolButton不独立高亮；图像工具未激活底色统一中性，取消绿色功能分类。未进入Entity编辑时只显示两个禁用入口（悬停提示选择Entity），活动模式展开；浏览/退出时收起；手工橡皮擦归入同一下拉。点击已活动模式不重置内部工具。
完整OHIF构建及67项测试通过。真实CT工程Case验证初始0内部工具、AI整体紫色且子按钮透明/无文字、手工下拉橡皮擦切换、浏览收起、AI重新展开、退出后0内部工具且模式入口禁用。未绘制保存或推理。初次布局出现图像工具通用CSS误覆盖子按钮底色，排除NiftiAnnotation容器后最终验证整组同色。
最终隔离viewer `ohif-nifti-rtx4500-viewer:mode-groups-3b3c0dbc45`；快照 `3b3c0dbc456772b5d25cf3954b18d867f251cade4c0206b168f6eeeb5e4c8fd8`；产物rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/mode-groups-20261014/`。两backend及正式viewer未重启；回退active-tool-20261014/compose.preview.json仅更新viewer。本次是在PR #2创建后的新UI增量，应用尚未提交，不能将当前PR head当作本次运行快照。

### 2026-10-14 Entity图标与固定紧凑右栏验收完成
Entity行移除编辑中文字，仅铅笔高亮；空mask图标位于编号后、名称前，工程Case验证通过。右栏改为固定状态/标签页与内部报告、Findings滚动，外层overflow hidden。状态卡片实测67px，标签页37px；底部未关联Entity、刷新、补录报告收纳到默认折叠的其他功能，实测27px，字号11px。真实CT长报告和7个Findings验证外层clientHeight=scrollHeight=1384、内部列表可滚动；辅助功能展开/收起可访问。
完整OHIF构建及67项测试通过（3条webpack warning）。当前隔离viewer `ohif-nifti-rtx4500-viewer:sidebar-fixed-a93b696af2`，快照 `a93b696af232bd082821f9c9851344648a7481fe4dd3aed560a0322be47d674a`；产物 rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/sidebar-fixed-20261014/`，回退entity-status-icons-20261014/compose.preview.json仅更新viewer。两backend及正式viewer未重启。应用新UI增量尚未提交，不属于PR #2现有head。

原文居中验收完成：真实CT点击F3，高亮片段中心与原文容器中心偏差-0.344px。完整OHIF构建和67项测试通过（3条webpack warning）。隔离viewer为 `ohif-nifti-rtx4500-viewer:report-center-1dc9e9809c`；产物rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/report-center-20261014/`，回退sidebar-fixed-20261014/compose.preview.json。两backend及正式viewer未重启；应用增量尚未提交。

### 2026-10-14 标题加号与Finding单项展开验收完成
补充Finding改为标题右侧加号，默认不占独立行；点击开关表单，报告原文增加44px上限（当前窗口实测388px）。唯一expandedFindingId管理展开和高亮。真实CT验证F1→F2自动收起、点击原文文字切换到对应Finding、收起后0高亮、再选编号恢复单项展开，加号表单开关正常。未提交数据。完整OHIF构建和67项测试通过（3条webpack warning）；隔离viewer `ohif-nifti-rtx4500-viewer:finding-single-dd0d003d5e`，产物rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/finding-single-20261014/`；回退report-center-20261014/compose.preview.json。两backend及正式viewer未重启；应用增量尚未提交。

### 2026-10-14 高度分隔条验收完成
报告与Findings之间新增10px拖动条，pointer capture支持跨区域拖动；比例限制10–70%，双击恢复35%。真实CT拖动100px：原文427→527px、Findings同步缩小，外层无溢出；70%上限仍留198px Findings，双击回到35%。完整OHIF构建及67项测试通过（3条webpack warning）。隔离viewer `ohif-nifti-rtx4500-viewer:report-split-0e77d46396`；产物rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/report-split-20261014/`；回退finding-single-20261014/compose.preview.json。两backend及正式viewer未重启；应用增量尚未提交。

### 2026-10-14 搜索同行及类别箭头验收完成
搜索框移入Findings标题右侧，与加号同行；真实CT搜索emphysema仅F3、清空恢复7项。类别名称静态展示，箭头原生select区域20px宽，距名称2px且不重叠；点击名称焦点仍为BODY，点击箭头AX确认下拉expanded，Escape关闭未改分类。完整OHIF构建及67项测试通过（3条webpack warning）。当前隔离viewer `ohif-nifti-rtx4500-viewer:finding-category-6af068a82c`；产物rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/finding-category-20261014/`；回退report-split-20261014/compose.preview.json。两backend及正式viewer未重启；应用增量尚未提交。

### 2026-10-14 界面增量提交整理
此前各节“应用增量尚未提交”为当时状态，本轮统一整理为独立界面PR，基于已合并PR #2的main。范围包括纯图标编辑模式组、Entity状态图标、固定紧凑右栏和辅助功能折叠、原文居中、单项Finding展开、标题加号及搜索、类别箭头点击和可拖动高度分隔条。19个运行源码/测试文件逐文件匹配finding-category-6af068a82c部署快照；沿用已通过的完整构建、67项测试和真实CT交互验收，本次Git整理不重启服务、不改数据。

### 2026-10-14 其他报告提示并入列表验收完成
真实CT验证rf-extra是rf-findings-scroll最后一个子项、前一项F7，展开包含3条报告提示，max-height为none、overflow为visible，跟随列表滚动，不占独立固定区域。完整OHIF构建及67项测试通过（3条webpack warning）。隔离viewer `ohif-nifti-rtx4500-viewer:finding-hints-7a678d4492`；产物rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/finding-hints-20261014/`；回退finding-category-20261014/compose.preview.json。两backend及正式viewer未重启；本次为PR #3之后的独立增量提交。


## 2026-10-15 数据集、Finding 多标签与预加载整理发布

本批包含 ReXGroundingCT 原生读取/可恢复批量导入、CT-RATE 原报告、Dataset 与 split 筛选、编辑设置归组与 Finding 定位、滚动过期请求修正、按导航位置重新排序加载、Finding 多标签体积和后续两例压缩帧缓存。服务器仍按 Entity 保存二值 mask 版本，无数据迁移；目前只导入三例 ReX，未全量导入。

当前预览 viewer 为 `ohif-nifti-rtx4500-viewer:concurrency-93d92596dd`，backend 为 `ohif-nifti-rtx4500-backend:datasets-2fd51b77b5`。当前 CT 后台3/总4并发，后续病例2并发，解码worker3；工作预算1.5GiB，压缩帧磁盘缓存512MiB，当前CT完整后预取后续两例。预览部署及回退材料：rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/concurrency-20261015/`；回退使用该目录 `rollback.compose.json`。正式服务未改变。本轮只整理Git，不重启服务或改标注。

43个前端改动文件逐文件匹配最终部署快照，96项前端回归和完整OHIF构建通过（3个已有webpack警告）。真实CT验证缓存切换、加载完后无Loading闪烁；独立病例验证nnInteractive GPU推理、同Finding其他label保留、跨Finding共享Entity同步，以及保存重开导出逐体素哈希一致。验收材料位于同级 `packed-prefetch-20261015/`。单例CT+标签数组从924MiB降至462MiB，不代表浏览器总内存或GPU峰值；未做同条件整例A/B测速。详细数据与阶段记录见 cooperate_space 的三个2026-10-14/15数据集、导入和预加载任务文档。
