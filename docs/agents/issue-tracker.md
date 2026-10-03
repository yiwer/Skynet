# Issue tracker: GitHub

任务和规格位于 [yiwer/Skynet 的 GitHub Issues](https://github.com/yiwer/Skynet/issues)。
使用 `gh` CLI；以下命令在仓库根目录执行。

## Conventions

- 创建：`gh issue create --title "标题" --body-file <正文文件>`
- 读取：`gh issue view <编号> --json number,title,body,state,labels,comments`
- 列表：`gh issue list --state open --json number,title,body,labels,comments`
- 更新正文：`gh issue edit <编号> --body-file <正文文件>`
- 评论：`gh issue comment <编号> --body-file <正文文件>`
- 添加或移除标签：`gh issue edit <编号> --add-label "标签"` 或 `--remove-label "标签"`
- 关闭：`gh issue close <编号>`

多行正文先写入 UTF-8 文件，保留实际换行，再通过 `--body-file` 传入。
`gh` 从 `git remote` 推断仓库；在其他目录执行时指定 `--repo yiwer/Skynet`。

技能要求“发布到 issue tracker”时创建 GitHub Issue；
要求“获取相关 ticket”时读取对应 Issue 的正文、标签和评论。

## Existing specifications

- V1：Issue #1；产品正文维护在 `docs/requirements/PRD.md`。
- V2：Issue #2；产品正文维护在 `docs/requirements/PRD-v2.md`。

修改产品正文时同步对应 Issue，沿用已有编号。

## Pull requests as a triage surface

**PRs as a request surface: no.**
