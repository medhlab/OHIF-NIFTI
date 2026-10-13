# OHIF 右键缩放方向验收

- 核验时间：2026-10-13 15:34 Asia/Shanghai；负责人：Annotation 会话；已完成并部署。
- 前端提交：`9da5928cc8605b84b955cfb33ee106e57cf245b0`；后端仍为 `d5f00fee2c522fe88cd74f6536982ee58fcffa4d`。
- 改动：NIfTI 默认和 MPR 工具组 Zoom `invert: true`，右键上拖放大、下拖缩小，与 [ITK-SNAP 手册](https://www.itksnap.org/docs/TutorialSectionViewingImages.php) 一致。
- 真实 CT：CT-RATE `valid_1_a_2`，512×512×502；manifest `bc1ed805723b4150ad6451bad378d955`。
- 基线复现：上拖 60px，缩放倍率 1 → 0.7418，方向相反。
- 候选及正式服务验收通过：浏览、手工 CircularBrush、AI Probe2 模式的实际右键上/下拖；左键平移、滚轮切层；默认及 MPR 的配置；mask 像素不变；无页面异常。
- 临时非 localhost 的 HTTP 候选入口出现 `getRegistrations` 浏览器异常而中止（candidate-http-aborted.json）；通过 localhost 安全上下文重新验收成功，正式 HTTPS 无异常。
- 未执行模型推理、未保存测试 mask；MPR 本次核验配置，实际多平面拖动未单独验收。
- 仅更新 viewer；后端容器 ID、镜像和启动时间完全一致，nnInteractive 健康状态仍为 ready。
- 正式入口：[OHIF](https://ant-trx50-aero-d.tailb37712.ts.net/nifti)。用户刷新页面即可试用。
- rtx4500 证据：`/home/ant/projects/OHIF-NIFTI/releases/zoom-direction-20261013/` 的 `baseline.json`、`candidate-results.json`、`production-results.json`、`receipt.json`、`build.log`。
- 前端镜像：`ohif-nifti-rtx4500-viewer:zoom-9da5928`，ID `sha256:a9870060f1f872f8d667baaa570b4349b8b76640245d2913c6ffa2bcbadf3f10`。
- 回退：`python3 /home/ant/projects/OHIF-NIFTI/releases/zoom-direction-20261013/release.py rollback`，只恢复 viewer 与部署元数据，保留后端和 state/。
