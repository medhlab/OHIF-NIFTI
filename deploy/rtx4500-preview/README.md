# 1028 开发版部署

本入口保存已运行的 case-v2、Ontology v1/v2 映射及病例自然排序代码，同时包含开发分支已有的报告选区创建 Finding、mask 保存与历史修复。

报告观察、术语概念与空间 Entity 分别保存；映射候选和部分映射不生成 mask。导入使用来源 hash、病例 revision 和旧映射 hash 检查，保留人工对象与映射历史。`runtime-source-sha256.json` 记录从运行版核实的 30 个待同步代码/测试文件，fixture 为合成数据。

## 当前部署条件

这是已有 rtx4500 环境的升级入口。前端依赖预装的 `ohif-prompt-test-builder:20261013` 和 `webapp:latest`，后端继承 `ohif-nifti-rtx4500-backend:ontology-refinement-20261020` 的推理依赖。它不是全新主机的独立安装包；`prepare.py` 会核实这些基础镜像的 ID。

源码必须从 GitHub 的固定完整 commit 下载到独立 release 的 `source/`，不要从未提交的工作区打包构建。影像、数据库、映射结果、权重和缓存均位于 Git 仓库之外，不随源码发布；本次只升级应用，不执行数据导入或模型推理。

## 构建、验证与切换

1. 把该固定 commit 的 GitHub 源码解压到新 release 的 `source/`。
2. 在服务器执行 `python3 source/deploy/rtx4500-preview/prepare.py --revision <完整commit> --release-dir <release>`。该命令从正在运行的 `ohif-finding-real-100` 容器定位现有 Compose，保存原配置和镜像身份，再生成只替换两项镜像的 `compose.preview.json`。所有环境、端口、GPU、网络和状态挂载保持原值。
3. 在 release 执行 `docker compose -f compose.preview.json config -q`，按 `build-commands.json` 依次构建 backend/viewer。前端构建执行已有回归和完整 webpack 构建；另用新后端镜像运行 `monai-label/tests/nifti_native`，测试只写隔离临时目录，不挂载线上状态。
4. 切换前记录正式 1026 容器 ID，对 1028 数据库使用 SQLite 在线备份 API 保存一致快照，记录 mask 文件 SHA256。备份保存在 release 外部材料或 release 的非源码子目录，不上传 GitHub。
5. 检查健康和全部测试后执行 `docker compose -f compose.preview.json up -d --no-build --pull never backend viewer`，只更新 1028。核对健康、页面和 API、镜像 revision、挂载、病例对象与 mask 保持情况。

保留 GitHub commit、基础/结果镜像 ID、构建/测试日志、备份/完整性清单、切换回执和回退配置。1026 正式项目不在该命令的范围内。

## 回退

在同一个 release 执行 `docker compose -f rollback.compose.json up -d --no-build --pull never backend viewer` 恢复旧镜像。先核对旧镜像标签仍对应 `before-containers.json` 的镜像 ID。只回退应用，不能用旧数据库覆盖上线后的人工修改。

1028 保持绑定 `127.0.0.1`。沿用现有 SSH 隧道访问 `/nifti`；部署不会把该入口改成公网服务，也不会改变默认 HTTPS 入口。
