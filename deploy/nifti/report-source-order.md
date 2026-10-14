# 报告原文排序修复

当前流水线运行源码：chocola `/data/cache/ohif-pipeline/runs/report-source-order-20261014/pipeline/`。
原版提取器SHA256：`d182eadb5a5cb917f7a8cecaee19f45c2a960f9967d7bb0e13e23635be5d6ccd`。
本目录 `report-source-order.patch` 可在包含原版 `pipeline/` 的运行根执行 `patch -p1 < report-source-order.patch`；不要再次应用于修复版本。

`replay-source-order.py` 需放在运行根（与pipeline目录并列）。使用同一环境的requests依赖；仅读取原始缓存，不调用模型：

```sh
python3 replay-source-order.py --input /data/cache/ohif-pipeline/runs/report-pilot-100-20261013/pilot-100 --output pilot-100-new
```

输出目录必须不存在。脚本对每个体积从raw模型响应重新构建结果，并比较除顺序/版本/orderingPolicy以外的全部字段，确保关系和ID不变；遇到差异中止，不将部分目录视为完成结果。排序发生在graph/context构造后，避免模型原始索引失效。排序键为章节顺序、证据start、end，相同键保持稳定。

新任务导入沿用 `import-report-results.py`，不指定manifest-id即创建干净任务。不要覆盖已经有人工数据的任务。此次用户确认旧标注均是测试，仍采用新任务避免混入旧数据；现使用manifest `9ce3d83a1ab345fdb85e044ca1cad420`，旧入口保持历史状态。

验证：100份报告、184体积全量语义等价；4份报告/8体积Finding顺序改变；184导入病例API均有序且Entity/links为空；真实CT页面核对F1与原文顺序一致。没有LLM或图像推理、没有前后端服务重启。
