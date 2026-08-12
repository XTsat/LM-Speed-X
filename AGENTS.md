# AGENTS.md — LM-Speed-X 项目协作规范

> 本文件会在每次 AI 会话中自动加载，作为所有代码改动、文档更新的唯一行为准则。
> 任何 AI 助手（opencode / Cursor / Claude Code 等）在修改本仓库前必须先阅读并遵守本文件。

---

## 1. 项目概览

**LM-Speed-X** — LLM API 测速分析工具（Next.js 16 + React 19 + TypeScript + TailwindCSS 4）。

- 无需数据库：测试结果存于浏览器 localStorage
- 国际化：next-intl，语言文件位于 `messages/en.json` 与 `messages/zh-CN.json`
- 组件库：shadcn/ui 风格（Radix UI + CVA + `cn()`），位于 `src/components/ui/`
- 仓库：`https://github.com/XTsat/LM-Speed-X`

---

## 2. 样式统一规范（最高优先级）

### 2.1 组件使用规则

- **尽量复用** `src/components/ui/` 中的现有组件（Button / Card / Input / Badge / Dialog / Select 等）与既有页面写法，保持整体风格一致；**不强制复用**，个别场景可自由发挥，但视觉风格需与相邻页面保持一致。
- 若决定**新建基础组件或更改现有组件/页面写法**，必须先向用户询问确认，再动手实现。
- 新 UI 组件建在 `src/components/ui/` 下时，风格对齐现有 shadcn/ui 模式（Radix Primitive + `forwardRef` + CVA `variant`/`size` 变体）。
- 组件导出使用命名导出（`export const X = ...`），默认导出仅用于 Next.js 页面（`export default function Page()`）。
- 服务端/客户端边界：交互组件以 `'use client'` 开头；纯展示组件默认服务端组件，不要多余加 `'use client'`。

### 2.2 Tailwind 与样式写法

- 类名合并一律使用 `@/lib/utils` 中的 `cn()`，禁止字符串拼接。
- 主题色、圆角、字体全部取自 `src/app/globals.css` 中的 `@theme` 变量（`--color-primary`、`--radius` 等），**禁止** 硬编码十六进制颜色或魔数圆角。
- 颜色语义化：`primary` / `muted` / `destructive` / `border` / `card` 等，按 Tailwind 语义类（`bg-primary`、`text-muted-foreground`、`border-border`）使用。
- 项目使用 Tailwind v4（`@import "tailwindcss"`），**不要** 使用 v3 的 `tailwind.config` 扩展写法。
- 动效只使用 `tailwindcss-animate` / CSS transition，不引入新的动效库。

### 2.3 国际化（i18n）规则

- **所有页面的文本都必须双语言**：任何面向用户的文案（页面标题、按钮、提示、错误信息、占位符等）必须同时提供中文（`messages/zh-CN.json`）与英文（`messages/en.json`），**禁止** 只写单一语言或硬编码文案到组件里。
- 文案统一走 next-intl：`useTranslations('Namespace')` 或 `getTranslations`，禁止把中英文写死在组件中。
- 新增文案必须 **同步** 修改 `messages/zh-CN.json` 和 `messages/en.json` 两个文件，键名保持一致（camelCase），两个语言文件缺一不可。
- 页面/区块文案按命名空间组织（如 `Changelog`、`HomePage`、`RankPage`），新功能追加到对应命名空间，不新建碎片命名空间。
- 修改 `messages/*.json` 后必须用 `tsc --noEmit` / `pnpm build` 校验 key 类型（next-intl 会做类型检查）。

### 2.4 代码风格

- TypeScript 严格模式，**禁止** `any`、`@ts-ignore`、`@ts-expect-error`。
- 函数组件 + Hook，统一单引号、行尾无分号（与现有代码一致），格式化以 ESLint/Prettier 配置为准。
- 文件组织遵循现有目录：页面 `src/app/[locale]/...`、业务组件 `src/components/`、工具 `src/lib/`。
- **修改涉及多文件时，必须检查并遵循相邻相似文件的既有写法，保持整体一致性。**

---

## 3. 更新日志（Changelog）维护规范

更新日志有 **三处** 需要同步修改，缺一不可：

### 3.1 修改清单（每次发版/功能提交时）

| # | 文件 | 操作 |
|---|------|------|
| 1 | `src/app/[locale]/changelog/page.tsx` | 在 `entries` 数组**最上方**新增一条 `ChangelogEntry`，格式见下 |
| 2 | `messages/zh-CN.json` → `Changelog.entries` | 新增 `vX_Y_Z` 条目及对应文案键 |
| 3 | `messages/en.json` → `Changelog.entries` | 新增同键名的英文条目 |
| 4 | `package.json` → `version` | 提升版本号与日志版本一致 |
| 5 | `README.md` + `README_zh.md` | 若该版本涉及用户可见的新功能/行为变化，同步更新（见第 4 节） |

### 3.2 `page.tsx` 条目格式（严格遵循现有结构）

```tsx
{
  version: '0.8.0',
  date: 'YYYY-MM-DD',
  types: ['feature' | 'improvement' | 'fix'],   // 可组合多个
  tag: 'v0.8.0',
  changes: [
    { text: t('entries.v0_8_0.xxx'), sub: [t('entries.v0_8_0.yyy'), ...] },  // sub 可选
  ],
},
```

要点：
- **永远插入到 `entries` 数组第 0 位**（最新在最上），禁止插到中间或末尾。
- `types` 取值仅限：`feature` / `improvement` / `fix` / `original`（original 只用于 v0.1.0）。
- `tag` 为该版本对应的 **Git tag 名称**（`v` + version，如 `v0.8.0`），页面自动链接到 `https://github.com/XTsat/LM-Speed-X/releases/tag/<tag>`。**发布时只需打 `git tag vX.Y.Z` 即可生效**，无需在 changelog 回填 commit hash。
- `changes` 内所有文案通过 `t()` 引用 i18n key，**禁止** 在 page.tsx 写死中文/英文。
- `sub` 用于子项列表，无子项时省略该字段。

### 3.3 i18n 文案格式

- key 命名：`entries.v0_8_0.<camelCase短描述>`，如 `v0_8_0.modelVerify`。
- zh-CN 用中文、en 用英文，语义对应，**禁止** 机翻腔；保持与相邻条目一致的文案风格。
- 例（zh-CN.json）：
  ```json
  "v0_8_0": {
    "modelVerify": "模型真实性测试：内置重复性、自洽性、数学能力三重验证",
    "verifyRepeat": "重复性验证：检测模型回答的稳定性",
    "verifySelf": "自洽性验证：检查回答是否逻辑一致"
  }
  ```

### 3.4 版本号规范

- 采用语义化版本：新功能 → `minor` 递增；bug 修复/小改进 → `patch` 递增。
- `package.json` version 与 changelog 最新条目 version 必须一致。
- 一条 changelog 记录对应一次功能/修复提交，**不要** 合并多条不相关改动。

---

## 4. README 维护规范

### 4.1 双语文档同步

本仓库维护 **两个** README，任何修改必须两文件同步：

| 文件 | 语言 |
|------|------|
| `README.md` | 英文（默认） |
| `README_zh.md` | 中文 |

规则：
- 章节结构必须保持一致（见下方目录对照），新增章节两个文件都要加。
- 中文版章节标题使用 `## 中文标题 | English Title` 双语言格式（沿用现有惯例）。
- 翻译质量：中文版使用自然中文，英文版使用地道英文，**禁止** 逐字机翻、禁止留下半翻译的句子。
- 修改时逐条 diff，确保无内容遗漏或错位。

### 4.2 README 章节对照

README 采用四大板块结构：① 功能特点 ② 与原版对比 ③ 功能截图 ④ 其它内容。修改时必须保持两文件章节一一对应。

| 英文 `README.md` | 中文 `README_zh.md` |
|---|---|
| `## Features` | `## 功能特点 \| Features` |
| `## Comparison with the Original` | `## 与原版对比 \| Comparison with the Original` |
| `## Screenshots` | `## 功能截图 \| Screenshots` |
| `## More` | `## 其它内容 \| More` |
| `### Quick Start` | `### 快速开始 \| Quick Start` |
| `### URL Parameters Usage` | `### URL 参数使用说明 \| URL Parameters Usage` |
| `### Tech Stack` | `### 技术栈 \| Tech Stack` |
| `### Contributing` | `### 贡献指南 \| Contributing` |
| `### License` | `### 许可证 \| License` |

补充说明：
- `## Features` 必须基于当前代码实际功能维护（测速 / 稳定性 / 并发 / 连通性 / 模型验证 / 排行榜等），新增功能时同步更新。
- `## Screenshots` 板块使用占位图指向 `docs/screenshots/` 目录（如 `![Speed Test](docs/screenshots/speed-test.png)`），截图由维护者放入该目录后引用，禁止引用过期的外部旧图链接。

### 4.3 何时需要更新 README

以下情况 **必须** 同步更新两个 README：
- 新增用户可见功能（如新的测试模式、排行榜、URL 参数）
- 修改快速开始步骤、部署方式、环境变量
- 技术栈变更（Next.js/React/Tailwind 版本升级、新增主要依赖）
- 项目定位/标语/链接变化

以下情况 **不需要** 更新 README：
- 纯内部重构、样式调整、bug 修复（除非修复改变了用户可见行为）

---

## 5. 提交与发布流程

1. **每次提交后先更新 changelog 三件套**（page.tsx + 两个 json），再提交，保证「代码改动」与「日志」在同一 commit 或紧邻 commit。
   - 推荐做法：先完成功能代码 → 跑通验证 → 更新 changelog 与 README → 提交。changelog 条目只填 `tag`（`v` + version），**无需回填 commit hash**，发布时打 `git tag vX.Y.Z` 后链接自动生效。
2. commit message 遵循仓库现有风格（中文简洁描述，如 `模型真实性测试`、`bug fix`、`连通性测试 更新日志`）。
3. 完成任何代码/文档修改后，运行验证：
   ```bash
   pnpm build     # 构建 + 类型检查
   ```
   确保无 TypeScript 错误、next-intl key 类型检查通过。
4. 标签/tag 流程：版本发布时打 `git tag vX.Y.Z`（如 `git tag v0.8.0`），推送 tag 后 changelog 中的 tag 链接即可访问。

---

## 6. 最终检查清单（每次任务完成前）

- [ ] 样式：优先复用现有 ui 组件与相邻页面写法；若新建/更改组件或页面写法，已先询问用户
- [ ] i18n：所有页面文案均双语言，zh-CN / en 两文件已同步新增 key，无硬编码文案
- [ ] Changelog：page.tsx 最新条目在首位、格式正确（`tag` 为 `v` + version），两个 json 已同步
- [ ] README：涉及用户可见变更时两个文件已同步
- [ ] 版本号：`package.json` version 与 changelog 最新版本一致
- [ ] 构建：`pnpm build` 通过
