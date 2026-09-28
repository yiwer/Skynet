# Domain Docs

## Layout

采用 single-context：

- `CONTEXT.md`：领域术语及边界。
- `docs/adr/`：架构决策记录。

本文中的路径均相对仓库根目录。

## Before exploring

1. 阅读 `CONTEXT.md`，使用已定义术语。
2. 阅读 `docs/adr/` 中与当前任务有关的决策。
3. 通过 `README.md` 定位相关需求、架构和验收文档。

领域文档缺失时继续工作，不要求预先补齐。
术语或决策得到明确结论后，由 `domain-modeling` 按需维护。

## Product references

- V1 实施与验收读取 `docs/requirements/PRD.md` 和 `docs/requirements/v1-acceptance.md`。
- V2 工作同时读取 `docs/requirements/PRD-v2.md`，按其中“与既有文档的关系”处理版本覆盖。
- `prototypes/web-platform/` 仅作界面与口径参考；使用合成数据，原型代码不进入产品。

## Vocabulary and decisions

输出中的领域概念沿用 `CONTEXT.md`，避免其明确排除的同义词。
缺少必要术语时记录缺口，供 `domain-modeling` 澄清。

方案与现有 ADR 冲突时，明确指出对应决策、冲突点及重审理由。
