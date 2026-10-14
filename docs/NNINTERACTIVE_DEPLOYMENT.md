# nnInteractive 部署与验收

当前前端 9da5928、后端 d5f00fe；最新前端源码及回退见 [缩放方向验收](ZOOM_DIRECTION_FIX.md)。下面记录 nnInteractive 启用时的验收。

## nnInteractive 正式启用（2026-10-13，15:03 Asia/Shanghai）

- 本次启用时前后端均为 OHIF-NIFTI `d5f00fee2c522fe88cd74f6536982ee58fcffa4d`，镜像标签 `nninteractive-d5f00fe`；实际 ID 与回退入口见 `deploy/nifti/nninteractive-deployment.json`。正式 HTTPS 已通过真实 CT 首次与连续 GPU 推理，生产未保存验收 mask。
- 启用前端 `enableNiftiAI` 和后端 `ENABLE_NIFTI_AI` / `ENABLE_NNINTERACTIVE`，GPU 固定为 RTX 4500 UUID GPU-53ea6923-163a-660e-73e0-d18bd8ea5458、CUDA_VISIBLE_DEVICES=0。torch 2.8.0+cu128、CUDA 12.8、nnInteractive 1.1.3；其他模型仍关闭。公共权重只读挂载 `/home/ant/projects/OHIF-NIFTI/models/nnInteractive_v1.0/`，checkpoint SHA-256 `b3ac4421f85457bbd1aa0d87f5e67bcb7bc8e2ce6b824b6ac45077cc5d630ea9`。
- 143 项后端回归、13 项前端语法检查、完整 OHIF 构建通过。真实 CT-RATE valid_1_a_2（512×512×502）隔离 9 项与正式 HTTPS 3 项通过，无未捕获 JS 错误。非空人工种子哈希匹配，AI 只更新选中病灶；负提示延续 session；画笔修改后重新播种；同 Entity/mask 保存 v2，v1 不变；刷新恢复；失败、重置及只读结构保护通过。
- GPU 采样利用率峰值 100%，总显存峰值 5837 MiB（含桌面显示）；最终后端进程显存 1,622 MiB，与容器 PID 一致。正式模型加载 1.731 秒，首次端点推理 4.948 秒、连续 0.594 秒。正式浏览器首次 86.730 秒、连续 4.911 秒；前者含 132 MB 人工种子上传，不能用 GPU 耗时代替用户等待时间。
- 稀疏二值预测使用推理路由专用 HTTP gzip；实测 131,597,113 解码字节 → 1,239,469 传输字节，协议与完整 131,596,288 体素网格校验通过。首次/画笔修改后的种子仍以原二值数据上传；后续会话不再上传种子。
- 公共源码、浏览器 JSON/截图、构建日志、权重清单、GPU 采样、状态校验与部署回执：rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/nninteractive-20261013/`。启用时 source/ 指向该 release/source；生产 state/ 保持原位。3 个原图、5 个既有 mask 版本、25 个病例与 26 个快照记录不变，5 个 mask 文件与部署前副本逐字节哈希一致。病例清单仅 revision 16→18，新增 2 条注册请求幂等记录。
- 回退：`python3 /home/ant/projects/OHIF-NIFTI/releases/nninteractive-20261013/rollback_remote.py`，恢复前一 Compose、前端构建配置、Nginx、deployment.json 与 source/ 链接并重建应用容器；不恢复/删除当前 state/。一致 SQLite 备份在 production-backup/，仅作恢复依据。候选已停止，正式后端通过 `flock -n -F /code/runtime/nninteractive-gpu.lock` 持有锁，宿主 runtime/ 绑定到 /code/runtime；其他 GPU 程序必须检查实际占用，文件锁不约束绕过入口的程序。
- 设备分工例外：按用户本次授权，rtx4500 增加交互 nnInteractive GPU 服务，保障标注低延迟；chocola 的流水线与 vanilla 的 GLM 服务未调整。
- 用户入口：[试用真实 CT](https://ant-trx50-aero-d.tailb37712.ts.net/nifti?manifestId=bc1ed805723b4150ad6451bad378d955&caseId=valid_1_a_2)。刷新 → 标注与 AI → 手工编辑准备/选择病灶 → AI 提示 → 包含/排除点 → 运行 AI → 等“已更新当前 mask。” → Save All。自动开关用于连续提示自动推理；首次或画笔修改后的上传等待较长。AI 编辑仍是当前病灶的人工操作，保存保持 human authority，不创建独立模型候选。
- 限制：仅一例真实 CT 的工程闭环；鼠标绘制的验收区域不代表病灶诊断或准确率。真实 TotalSegmentator 结果仍待用户补充，只读结构使用明确标记“非解剖”的合成标签验收。初次正式浏览器网络暂停已重试通过，不归因于模型质量。

## 复现入口

`deploy/nifti/nninteractive-acceptance.cjs`：BASE_URL 指向隔离候选，STRUCTURE_FILE 使用 `lesion-v1-synthetic-structure.py` 的同几何合成文件，OUTPUT_DIR 指向验收产物；PRODUCTION_SMOKE=true 仅作临时浏览器绘制与真实推理，不保存。隔离模式会创建工程标注，必须使用独立 state。脚本要求 PLAYWRIGHT_MODULE/CHROME_PATH 指向可用运行环境，完整请求与种子哈希保存到 JSON。

`deploy/nifti/nninteractive-viewer.Dockerfile` 保留现有 Cornerstone/dcmjs/VTK 补丁、stack labelmap 与 interpolation 安装校验、ONNX 浏览器兼容及 streaming 开关；依赖服务器已有带指纹的 builder 和 webapp 镜像。后端基于已有 monai 镜像覆盖应用代码。`deploy/nifti/nginx.nninteractive.conf` 为实际已验收代理配置；稀疏推理响应压缩只作用于 infer 路由。完整 Compose 以服务器 deployment/compose.yml 为准。

前端后续更新：2026-10-13 15:34 Asia/Shanghai，仅缩放方向升级至 9da5928，后端与模型保持 d5f00fe。当前源码及 viewer 回退见 [缩放方向验收](ZOOM_DIRECTION_FIX.md)。
