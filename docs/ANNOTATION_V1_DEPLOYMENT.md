# 第一版部署与真实 CT 验收

> 历史部署记录。以下“当前版本”是该阶段当时的版本；最新里程碑见 [v0.1.0](V0_1_0.md)，后续隔离预览与回退见 [基础设施交接](INFRASTRUCTURE_HANDOFF.md)。

当前版本已启用 nnInteractive，前端 9da5928、后端 d5f00fe；最新前端验证和回退见 [缩放方向验收](ZOOM_DIRECTION_FIX.md)，模型启用验收见 [nnInteractive 部署记录](NNINTERACTIVE_DEPLOYMENT.md)。下面保留手工编辑与首版的历史部署。

## 手工编辑入口修复（2026-10-13，13:27 Asia/Shanghai）

- 已部署前端 `b40509990d5ea7d17c91f2a078e3bd76f770e9ec`，镜像 `ohif-nifti-rtx4500-viewer:annotation-manual-b405099`；后端仍为 `9bfe0f10bc9f0ce4a8c5c10255825ed22b1682ec`。仅重建前端容器，后端及生产 state/ 保持原位。
- 根因：按钮仅切换模式；页面默认 manual，但无目标、画笔禁用，重复点击立即返回。修复后单击注册/恢复同一业务病例、准备可编辑目标并启用画笔；没有目标时新建本地病灶目标，Save All 登记 Entity 和主 mask。有已保存病灶时先恢复它。重复点击复用目标并继续绘制。只读结构和锁定病灶显示提示并切回浏览。
- 两轮完整 yarn build 通过，13 个前端模块语法检查通过。最终真实 CT-RATE valid_1_a_2 的 7 项隔离回归通过：单击入口、重复复用、实际绘制 4,765 体素、Save All、刷新恢复同 Entity 与体素哈希、锁定提示/浏览、结构只读提示/哈希不变。正式 HTTPS 的入口、重复点击和实际绘制 3 项通过，正式环境没有保存验收 mask。无未捕获 JS 错误。
- 公共源码与证据：rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/annotation-manual-20261013/`；source/ 链接现指向此处的 source/。包含最终构建日志、manual-acceptance.json、manual-production.json、deployment-receipt.json、浏览器截图和独立候选 state-final/；测试标注没有发布到正式状态。
- 回退本次前端：`docker compose -f /home/ant/projects/OHIF-NIFTI/releases/annotation-manual-20261013/compose.rollback.json up -d --no-deps --no-build --pull never viewer`。源码入口如需回退，恢复 source/ 链接到前一 release 的 source/；应用回退不删除 state/。首版前后端升级的完整回退和历史证据见下面首版部署记录。
- 用户操作：刷新页面 → 标注与 AI → 手工编辑 → 在 CT 上拖动画笔 → Save All。真实 TotalSegmentator 文件仍由用户之后补充，本次结构回归使用明确标注“非解剖”的合成标签，没有 GPU 推理。


## 首版部署历史：2026-10-13 单 CT 病灶标注上线

- 当前应用：medhlab/OHIF-NIFTI `codex/annotation-v1`，部署提交 `9bfe0f10bc9f0ce4a8c5c10255825ed22b1682ec`；前后端成套镜像标签 `annotation-v1-9bfe0f1`，精确镜像 ID 见部署回执。
- 已部署源码：rtx4500 `/home/ant/projects/OHIF-NIFTI/source/` 现为指向 `/home/ant/projects/OHIF-NIFTI/releases/annotation-v1-20261013/source/` 的链接；旧 ca7cf52 快照保留于 `/home/ant/projects/OHIF-NIFTI/source-ca7cf52-20261013/`。
- 证据：rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/annotation-v1-20261013/`，含三轮构建日志、real-ct-results.json、file-verification.json、production-smoke.json、deployment-receipt.json 和实际浏览器截图。
- 已验证真实 CT-RATE valid_1_a_2（512×512×502）：鼠标绘制、Save All v1/v2、体素哈希一致、刷新及新浏览器恢复、两 Finding 共享 Entity 且各保留证据、完成 1/25＝4%、编辑后完成失效。142 项后端回归及 13 个前端模块语法检查通过。
- 结构：两个合成标签各 2,000 体素，验证导入、显示、隐藏、只读和刷新恢复；修复 Cornerstone 锁定仍能向背景绘制的漏洞，编辑工具及快捷键激活均受只读保护。用户之后补真实 TotalSegmentator 文件，真实解剖结果对齐未验收。本次没有 GPU 推理。
- 生产 HTTPS 健康；真实 CT 工作台为空白新标注，进度 0/25。原有 v4 测试 mask 可加载。升级时保留原有索引；正式打开清单仅增加其 revision，影像/标注行、原始清单内容及 15 个不可变文件保持一致，未发布候选测试标注。
- 持久化仍为 `/home/ant/projects/OHIF-NIFTI/state/`。停写后备份原图库、SQLite、草稿和配置到 `/home/ant/projects/OHIF-NIFTI/releases/annotation-v1-20261013/production-backup/`。回退命令：`docker compose -f /home/ant/projects/OHIF-NIFTI/releases/annotation-v1-20261013/production-backup/compose.rollback.json up -d --no-build --pull never`；保留 state/，不删除新标注，旧代码不提供新病例语义功能。
- 试用入口：[25 病例工作台](https://ant-trx50-aero-d.tailb37712.ts.net/nifti?manifestId=bc1ed805723b4150ad6451bad378d955&caseId=valid_1_a_2)，进入后打开病灶工作台。

应用代码已推送任务分支，main 尚未合并。生产使用上述已验收提交。协作记录见 medhlab/cooperate_space 的 codex/annotation-v1-record 分支。
