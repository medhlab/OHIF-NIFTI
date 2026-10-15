# ReXGroundingCT 原始标注导入

入口：`import_annotations.py`，依赖 Python 3.9+ 和 NumPy。脚本复用后端原生读取模块 `monailabel/utils/others/nifti_rexgroundingct.py`，不需要手工拆分四维 NIfTI；当前提供命令行批量入口，普通网页的三维 CT 上传入口仍只接受三维图像。

## 已核实的数据

vanilla：
- 标注及元数据：`/data/cache/datasets/ReXGroundingCT`
- 配对 CT：`/data/cache/datasets/CT-RATE/dataset`
- 2026-10-14，`dataset.json` train 2992 例、val 50 例，共 7802 个 Finding 的 CT/mask 文件和头信息核查通过。test 100 例没有公开 mask，不导入空标注。
- 14 个类别代码与界面协议一致：1a–1f、2a–2h。不同 release 的 split 不合并。
- dataset.json SHA256：`78c112ecb07b264fec7b79e26b47aeea0aaa358541068b4fd9940d1ee6047385`。

## 格式与映射

明确指定 ReX 格式，读取配套 JSON 的单病例 record。原始 shape 为 `(Finding, X, Y, Z)`；每通道的非零 uint8 数值为 Entity 标签，允许不连续编号。校验通道数、类别、尺寸、体素计数和完整载荷。Entity 数量声明与实际标签不一致时记录 warning，以实际非零标签为准。

ReX 文件 affine 不能直接当成三维 CT affine。mask 在严格匹配尺寸后沿用配对 CT 网格，不进行重采样；导入时再次核对服务端 CT 的 geometryHash 和 canonical contentHash。普通四维图像不会自动识别成 ReX。单病例内完全一致的二值 mask 共享 Entity，单纯重叠不合并。

按 JSON 的通道编号保留 Finding 顺序和原始类别。ReX 描述只保存为 Finding，不再拼接成报告，也不创建指向拼接文本的证据；同时按完整 VolumeName 读取 CT-RATE radiology_text_reports/train_reports.csv 和 validation_reports.csv，保留 Clinical Information、Technique、Findings、Impressions 原文及空白。未找到报告时 originalReport 为 null，需检查准备包；ReX 描述保留在 Finding 中；未核实的临床报告原文片段不建立高亮关联。不会调用报告模型或自动标记病例完成。

## 使用

在仓库根目录运行；`python` 必须带 NumPy。vanilla 可使用 `/home/ubuntu/.venvs/sglang/bin/python`。

```sh
# 全量只读头核查，无 API 写入
python deploy/datasets/rexgroundingct/import_annotations.py plan \
  --output /data/cache/ohif-imports/rex-audit

# 先准备一个真实病例（原始 CT、原始四维 mask 和 JSON 自动配对）
python deploy/datasets/rexgroundingct/import_annotations.py prepare \
  --case train_1935_a_1.nii.gz \
  --output /data/cache/ohif-imports/rex-sample

# 批量准备：去掉 --case；默认 train + val。逐例生成压缩二值 mask。
# 显式写入：API 地址应替换为实际可达后端。
python deploy/datasets/rexgroundingct/import_annotations.py import \
  --output /data/cache/ohif-imports/rex-sample \
  --base-url http://127.0.0.1:8000 \
  --server-ct-root /datasets/ct-rate
```

`--server-ct-root` 是后端容器内 CT-RATE dataset 路径，应包含 train_fixed/valid_fixed，并已配置为允许的导入目录。脚本不传输 CT；跨机器时可复制准备目录，服务端必须已有对应 CT。

prepare 的 `package.json.issues` 记录跳过病例；导入前检查这些条目。部分有效的包允许导入。大批量准备会占用磁盘，应按 split 或 --limit 分批，每批使用新输出目录。

import 新建独立工作清单，不合并现有病例。`import-journal.json` 保存精确请求和幂等键，失败后用相同参数、相同目录重试；不要同时运行同一目录或删除日志。首次清单创建若响应丢失会停止，须先核实服务端已创建的清单，再恢复日志，避免重复清单。准备包和 mask 被修改会拒绝继续。

`case.json` / `package.json` 保留 release、来源 mask 哈希、原始 record 和通道/标签映射；`receipt.json` 记录导入的 caseId。后端 mask 保存原始文件、原始标签和导入分组；完整来源记录保存在准备包中，需一并保留。

## 验证

测试脚本 `test_import_annotations.py` 使用真实后端路由和临时数据库，CPU 执行，无模型和 GPU。覆盖体素拆分、共享 Entity、非连续标签、计数异常、错误网格/截断载荷、普通四维拒绝、API 保存/下载几何及像素一致、响应丢失恢复、重复导入和文件篡改拒绝。运行它需要后端的 FastAPI/httpx/NumPy 环境。

全量头核查不等于全量体素验收；每例 prepare 才会完整验证载荷。现有服务尚未执行批量导入。

## 数据集与 split

`Dataset → Case` 单独持久化，工作清单仍负责打开原图。默认 release 注册一个 `rexgroundingct` 数据集；train/val/test 来自该 release 的 JSON split，不根据 CT 文件名前缀猜测。同一 release 的不同 split 或批次归入同一数据集；其他发布版本使用独立 ID，防止把不同官方划分混在一起。

API：`POST /api/annotation/v1/datasets` 登记稳定 id/name/version；`POST /datasets/{id}/members` 以 items:[{caseId,split}] 关联已登记清单病例；`GET /datasets` 获取数据集与 split 统计；`GET /datasets/{id}/cases?split=val&search=&offset=0&limit=25` 获取病例和筛选后的完成进度。归属变更不修改 annotation revision。相同请求可以重复；原有 split 或外部病例标识发生冲突时整批拒绝。新批次重复包含已登记病例时会在创建清单前拒绝，应从新批次排除这些病例；断点续传使用原日志。

NIfTI 首页默认显示数据集列表，支持全部、训练集、验证集、测试集、未指定筛选、搜索和分页。数字只统计已导入病例，不代表上游数据集全量数量。

已被旧脚本导入的拼接报告可用 remove_synthetic_reports.py 按明确 caseId 清理：默认预检，--apply 写入前保存备份，并保留 annotation revision 历史；仅清理与原 Finding 拼接文本完全一致的报告，修改过的报告会拒绝自动处理。
