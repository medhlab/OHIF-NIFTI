# OHIF-NIFTI / OHIF-AI

基于 OHIF 3.10.4、Cornerstone 3.33.5 与 MONAI Label 的医学影像研究工作台，支持既有 DICOM 流程及原生三维 NIfTI 浏览、分割编辑、nnInteractive 和版本化 mask。

当前里程碑：**[v0.1.0](https://github.com/medhlab/OHIF-NIFTI/tree/v0.1.0)**（2026-10-15）。这是研究与调试版本。
功能范围、验证和限制见 [v0.1.0 功能与状态](docs/V0_1_0.md)，操作步骤见 [使用指南](docs/NIFTI_USER_GUIDE.md)，变更见 [CHANGELOG](CHANGELOG.md)。

## 当前功能

- 原生三维 NIfTI 浏览、本地文件和服务器原图库；数据集组织、split 筛选、搜索与分页。
- 单 CT Finding / Entity 标注闭环：报告证据、ReX 14 类、共享 Entity、绘制、版本化保存、重开及病例完成状态。Finding / Entity 不等同于病灶。
- 报告原文与 Findings 联动，单项展开、原文高亮居中、可拖动模块高度；点击 Finding 加载全部已保存 Entity，并提前定位首个非空目标。
- 顶部手工/AI 编辑工具组、提示管理及明确的单 mask 编辑状态；右上角集中保存和退出；Entity 编号旁显示颜色或空 mask 虚线图例。
- nnInteractive 点、框、涂画提示及当前 mask 精修；已有结构结果作为只读辅助层导入。
- 每 Finding 一个多标签体积，同一 Finding 内 Entity 不重叠；共享 Entity 同步，服务端仍按 Entity 保存二值 mask 版本。
- CT 默认肺窗；当前切片向两侧持续加载，滚动或定位后重新排序；当前病例完成加载后预加载后续两例。
- 512 MiB 压缩 CT 本地磁盘缓存，刷新复用并恢复切片；“Mask 与文件”菜单提供清理和占用显示。
- 保留 DICOM、MPR、测量、历史版本和 NIfTI 导出等原有能力；旧工具入口不作为当前 NIfTI 操作指南。

## 文档入口

| 目的 | 文档 |
| --- | --- |
| 当前功能、验收和未完成事项 | [v0.1.0 功能与状态](docs/V0_1_0.md) |
| 标注与缓存操作 | [原生 NIfTI 使用指南](docs/NIFTI_USER_GUIDE.md) |
| ReXGroundingCT 格式与批量导入 | [导入说明](deploy/datasets/rexgroundingct/IMPORT.md) |
| 报告流水线顺序 | [原文顺序与离线重放](deploy/nifti/report-source-order.md) |
| 设备、部署、回退与验收证据 | [基础设施交接](docs/INFRASTRUCTURE_HANDOFF.md) |
| 数据/API 设计及演进目标 | [设计文档](docs/ANNOTATION_DATA_API_V1_DESIGN.md)（不是全部已实现功能） |

## 本地开发

使用 Docker Desktop Linux 引擎；AI 需要兼容 NVIDIA GPU 与本地模型权重。

```powershell
.\deploy\local\Start-Local.ps1
```

浏览器打开 `http://127.0.0.1:1026/nifti`。这个入口使用源码挂载与热更新。
当前开发 Compose 依赖本机已存在的 `monai:latest`、`webapp:latest` 和 Orthanc 镜像；从全新机器启动还需准备镜像和权重，不能将本快照视作离线即用安装包。

详见 [本地启动与 Tailscale](deploy/local/README.md)、[原生 NIfTI 部署与回退](deploy/nifti/README.md)、[ReX 标注导入](deploy/datasets/rexgroundingct/IMPORT.md)。

## 配置与数据

源码库不包含影像、已有标注、模型权重、Docker 数据卷、认证文件或 TLS 私钥。
ReX 数据和机器专属挂载由准备脚本生成，参见 [数据准备与导入说明](deploy/datasets/rexgroundingct/IMPORT.md)。

项目根目录的旧生产 Compose 与 `deploy/local` 是不同部署入口。使用旧入口前：

1. 将 `.env.example` 复制为 `.env`，填写 DICOMweb 用户名和密码。
2. 将 `Viewers/platform/app/.recipes/Nginx-Orthanc/config/orthanc.example.json` 复制为同目录 `orthanc.json`，使 `RegisteredUsers` 与 `.env` 一致。
3. 按部署说明自行准备 `.htpasswd` 与 TLS 材料；这些文件均被 Git 忽略。

不要删除现有数据卷来重置开发环境。Git 源码备份不能代替原图库、SQLite 索引及 mask 版本的独立备份。

## 来源与许可

上游为 [CCI-Bonn/OHIF-AI](https://github.com/CCI-Bonn/OHIF-AI)。本目录由不含 `.git` 的源码包发展而来；其原始基线为 `5688e619f33f6e0b885e36999846903074a6b71e`，详见 [来源记录](SOURCE_PACKAGE.md)。当前仓库从本次快照建立历史，不声称包含上游全部 Git 提交。

保留根目录及各子项目中的 LICENSE 与第三方版权声明。
