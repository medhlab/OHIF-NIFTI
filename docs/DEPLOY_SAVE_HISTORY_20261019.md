# 2026-10-19 保存与历史流程修复部署

- 已推送代码：`d577531fd2d8ddcc897d896e361b49f07f85a38f`，分支 `codex/finding-selection-popover`；合入 `35a2236` 的 mask 保存版本与历史修复。
- rtx4500 发布目录：`/home/ant/projects/OHIF-NIFTI/releases/save-history-20261019/`。
- viewer/backend 镜像均为 `ohif-nifti-rtx4500-{viewer,backend}:save-history-20261019`，更新百例标注服务 1028，正式 1026 两个容器未变。
- 部署基线为线上 natural-case-20261019，覆盖此次合并的 36 个文件；保留已上线 case-v2 和自然排序。当前工作区未提交 Ontology 等内容不在本次发布范围内。
- 验证：完整前端构建、既有回归及保存/历史专项通过；一次性测试容器补齐 pytest/Node 后，后端 188 passed。初次失败来自测试挂载路径和缺少运行时，修正后全量通过。
- 已备份数据库到发布目录 predeploy-backup/index.sqlite3；57 个既有 mask.nii.gz 哈希一致。未在真实病例上执行保存或生成推理，保存行为通过隔离测试验证。
- 发布目录保留 files.json、build.log、backend-tests.log、deployment-receipt.json、compose.preview.json、rollback.compose.json。
- 回退：在发布目录运行 `docker compose -f rollback.compose.json up -d --no-build --pull never backend viewer`。回退只切换镜像，数据库备份保留供必要时核验，勿覆盖后续人工标注。
