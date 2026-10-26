# CyberStrike Skill Import

当前项目通过精选 manifest 导入 CyberStrike 知识资产，不整体复制其 CIS、NIST、MITRE 树。

## Prerequisites

`CYBERSTRIKE_SOURCE_ROOT` 默认为当前项目上两级目录中的 `CyberStrike-main`。如果源目录不同，请先设置：

```powershell
$env:CYBERSTRIKE_SOURCE_ROOT = "C:\path\to\CyberStrike-main"
```

## Import

```powershell
node scripts\import-cyberstrike-skills.ts
node scripts\generate-builtin-assets.ts
```

第一条命令根据 `packages/core/src/config/skills/skill-manifest.ts` 复制精选 `SKILL.md`，并生成：

- `frameworks-mitreattack.json`
- `frameworks-nist.json`
- `frameworks-cis.json`

第二条命令刷新 `packages/core/src/config/builtin-assets.generated.ts`。

## Rules

- 如果目标 skill 已经存在，导入脚本会跳过，不会覆盖当前项目已有 skill。
- 导入脚本只复制 `SKILL.md`，不会复制 `.docx`、图片、Python 缓存或无关脚本。
- 框架 map 只是轻量索引，完整框架内容仍在 CyberStrike 源目录按需读取。

## License

CyberStrike 使用 AGPL-3.0。当前导入主要用于本地授权测试，不应作为闭源项目的一部分对外分发；如果后续需要对外提供，请保留来源与许可证说明。
