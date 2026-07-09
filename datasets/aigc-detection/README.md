# AIGC Detection Novel Dataset

这个目录保存 AIGC 检测数据集的小说正样本候选。

## 当前内容

- `books/`：已从本地合集复制入仓的精选 100 本小说文件。
- `manifest.tsv`：已入仓小说清单，包含排名、书名、作者、题材、评分、原始路径、仓库内路径、文件大小和 SHA256。
- `source-selected-100.tsv`：原始精选 100 本 TSV 清单副本。
- `to-supplement.tsv`：当前合集缺失或只有残卷、需要后续补充的作品记录。

## 生成口径

- 来源目录：`C:\Users\notnotype\Downloads\网络小说超级合集`
- 入仓范围：上一轮筛出的 100 本精选作品。
- 可用文本格式：`.epub`、`.mobi`、`.txt`
- 当前已入仓：100 本，约 666.88 MB。
- 路径校验：入仓前按原始 TSV 的真实文件路径逐条校验，缺失 0 条。

## 使用建议

训练脚本优先读取 `manifest.tsv` 的 `dataset_relative_path` 字段定位文件；需要补齐语料时，先查看 `to-supplement.tsv`，补到 `books/` 后再更新 `manifest.tsv`。
