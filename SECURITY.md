# 安全政策 / Security Policy

## 支持范围 / Supported versions

安全修复面向最新正式版本和当前 `main` 分支。旧版本可能不会单独修复，请先确认问题能否在最新代码中复现。

Security fixes target the latest release and the current `main` branch. Older versions may not receive separate fixes; first confirm whether the issue reproduces on current code.

## 私密报告 / Private reporting

请通过 GitHub 的 [私密漏洞报告](https://github.com/YueHua46/mcbes-manage-script/security/advisories/new) 提交安全问题。

Please use GitHub [Private Vulnerability Reporting](https://github.com/YueHua46/mcbes-manage-script/security/advisories/new) to report a security issue.

不要在公开 Issue、Discussion 或 Pull Request 中披露：

Do not disclose the following in a public Issue, Discussion, or Pull Request:

- 可直接利用的漏洞细节或攻击代码 / directly exploitable details or attack code
- 密钥、令牌或其他凭据 / keys, tokens, or other credentials
- 真实服务器地址或私有服务器配置 / real server addresses or private server configuration
- 玩家身份、行为记录或其他隐私数据 / player identity, activity records, or other private data

报告应尽量包含：

Please include:

- 受影响的项目版本或 commit / affected version or commit
- Minecraft 版本和部署环境 / Minecraft version and deployment environment
- 构建变体：普通版、Realms、BDS 增强版或 Backrooms / build variant: Standard, Realms, BDS enhanced, or Backrooms
- 安全影响和复现步骤 / impact and reproduction steps
- 已知缓解方式或修复建议（如有）/ known mitigations or proposed fixes, if available

维护者会在有条件时尽快确认报告、评估影响并协调披露，但目前不承诺固定响应时限。在修复发布或维护者同意公开之前，请保持报告私密。

Maintainers will acknowledge reports, assess impact, and coordinate disclosure when available, but no fixed response SLA is promised. Keep the report private until a fix is released or maintainers approve disclosure.
