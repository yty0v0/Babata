# SecSkills

渗透测试、漏洞扫描、代码审计、安全研究等网络安全相关的 Skills。

## Curated CyberStrike Imports

当前目录通过 `packages/core/src/config/skills/skill-manifest.ts` 管理精选导入，不包含 CyberStrike 的全部 CIS、NIST、MITRE 树。

已补充：

- OWASP WSTG 聚合方法：`wstg-recon-config`、`wstg-injection`、`wstg-auth-session`、`wstg-logic-client-api`
- Web 专项攻击：SSRF、SSTI、JWT、XXE、CORS、GraphQL、Host Header、Request Smuggling、Race Condition、WebSocket、IDOR、Open Redirect、Prototype Pollution、Cache Poison、Rate Limit Bypass、Subdomain Takeover
- 后渗透与内网：Windows、Linux、AD、Kerberos
- 云与云原生：AWS、Azure、GCP、Kubernetes、CI/CD
- 新兴方向：LLM Security、eBPF Attacks

框架内容仅保存为 `frameworks-*.json` 轻量索引，按需读取。

## Import

```bash
node scripts/import-cyberstrike-skills.ts
node scripts/generate-builtin-assets.ts
```

可通过 `CYBERSTRIKE_SOURCE_ROOT` 指定 CyberStrike 源码目录。
