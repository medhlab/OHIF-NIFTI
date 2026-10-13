# 第一版部署与真实 CT 验收

## 2026-10-13 单 CT 病灶标注上线

- 当前应用：medhlab/OHIF-NIFTI `codex/annotation-v1`，部署提交 `9bfe0f10bc9f0ce4a8c5c10255825ed22b1682ec`；前后端成套镜像标签 `annotation-v1-9bfe0f1`，精确镜像 ID 见部署回执。
- 已部署源码：rtx4500 `/home/ant/projects/OHIF-NIFTI/source/` 现为指向 `/home/ant/projects/OHIF-NIFTI/releases/annotation-v1-20261013/source/` 的链接；旧 ca7cf52 快照保留于 `/home/ant/projects/OHIF-NIFTI/source-ca7cf52-20261013/`。
- 证据：rtx4500 `/home/ant/projects/OHIF-NIFTI/releases/annotation-v1-20261013/`，含三轮构建日志、real-ct-results.json、file-verification.json、production-smoke.json、deployment-receipt.json 和实际浏览器截图。
- 已验证真实 CT-RATE valid_1_a_2（512×512×502）：鼠标绘制、Save All v1/v2、体素哈希一致、刷新及新浏览器恢复、两 Finding 共享 Entity 且各保留证据、完成 1/25＝4%、编辑后完成失效。142 项后端回归及 13 个前端模块语法检查通过。
- 结构：两个合成标签各 2,000 体素，验证导入、显示、隐藏、只读和刷新恢复；修复 Cornerstone 锁定仍能向背景绘制的漏洞，编辑工具及快捷键激活均受只读保护。用户之后补真实 TotalSegmentator 文件，真实解剖结果对齐未验收。本次没有 GPU 推理。
- 生产 HTTPS 健康；真实 CT 工作台为空白新标注，进度 0/25。原有 v4 测试 mask 可加载。升级时保留原有索引；正式打开清单仅增加其 revision，影像/标注行、原始清单内容及 15 个不可变文件保持一致，未发布候选测试标注。
- 持久化仍为 `/home/ant/projects/OHIF-NIFTI/state/`。停写后备份原图库、SQLite、草稿和配置到 `/home/ant/projects/OHIF-NIFTI/releases/annotation-v1-20261013/production-backup/`。回退命令：`docker compose -f /home/ant/projects/OHIF-NIFTI/releases/annotation-v1-20261013/production-backup/compose.rollback.json up -d --no-build --pull never`；保留 state/，不删除新标注，旧代码不提供新病例语义功能。
- 试用入口：[25 病例工作台](https://ant-trx50-aero-d.tailb37712.ts.net/nifti?manifestId=bc1ed805723b4150ad6451bad378d955&caseId=valid_1_a_2)，进入后打开病灶工作台。

应用代码已推送任务分支，main 尚未合并。生产使用上述已验收提交。协作记录见 medhlab/cooperate_space 的 codex/annotation-v1-record 分支。
