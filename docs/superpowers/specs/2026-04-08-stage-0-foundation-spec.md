# Stage 0 — 基础设施铺底 · Spec

**日期**：2026-04-08
**所属路线图**：`2026-04-08-cc-switch-full-port-roadmap.md`
**阶段编号**：0 / 10
**前置依赖**：无
**后续阶段**：阶段 1（数据层与 Provider 模型）

---

## 1. 目标

为后续 9 个 cc-switch 移植阶段准备好编译环境、依赖、目录骨架、样式隔离机制和 i18n 全量迁移。**本阶段不引入任何 AI 业务功能**，但要交付一个可见的"烟雾测试组件"以验证全链路通顺。

强约束：gwshell 现有所有界面（终端 / SFTP / Sidebar / TitleBar / Modals / Settings 现状）**零回归**。

## 2. 范围与决策（Stage 0 特有）

| # | 决策点 | 选择 | 备注 |
|---|---|---|---|
| 0.1 | 是否引入日语 | **B** — 不引入 | cc-switch 的 `ja.json` 暂不搬；只迁移 zh/en |
| 0.2 | tailwind 隔离方式 | **B** — `important: '.ai-scope'` + 不改 cc-switch className | preflight 仍禁用；通过根选择器把所有 tailwind 规则限定在 AI 子树内 |
| 0.3 | 主题变量映射 | **A** — AI 区独立 CSS 变量 | 监听 gwshell `data-theme` 切换 `.ai-scope` 上的 `.dark` 类 |
| 0.4 | lucide 版本冲突 | **B** — 双装别名 | `lucide-react@^1.7` 给 gwshell；`lucide-ai: npm:lucide-react@^0.542` 给 AI 区 |
| 0.5 | 烟雾测试组件 | **A** — 引入 Button + 一张假 ProviderCard | 验证 Radix + tailwind + i18next + lucide alias 全链路 |

## 3. 交付物

### 3.1 前端依赖（`package.json`）
**新增 dependencies**：
- 样式：`tailwindcss@^3.4.17`、`postcss@^8.4.49`、`autoprefixer@^10.4.20`、`class-variance-authority@^0.7.1`、`clsx@^2.1.1`、`tailwind-merge@^3.3.1`
- shadcn/Radix（暂只装 Stage 0 烟雾测试需要的，其余阶段按需追加）：`@radix-ui/react-slot@^1.2.3`、`@radix-ui/react-label@^2.1.7`
- 状态/校验/查询（暂只在 AI 区域用，留待后续阶段实际引用）：先**不装**——避免无引用 import 警告。Stage 0 只装样式 + i18next + lucide alias + slot/label
- i18n：`i18next@^25.5.2`、`react-i18next@^16.0.0`
- 图标别名：`lucide-ai: npm:lucide-react@^0.542.0`（保留现有 `lucide-react@^1.7.0`）

**新增 devDependencies**：
- `@tailwindcss/typography`（可选，先不装）
- 不动现有 vite/typescript

**React 19 兼容性确认**：
- `react-i18next@^16` 官方支持 React 19 ✅
- `@radix-ui/react-slot@^1.2.3` 支持 React 19 ✅
- `@radix-ui/react-label@^2.1.7` 支持 React 19 ✅
- 后续阶段引入更多 Radix 包时再单独验证

### 3.2 tailwind / postcss 配置

**新增 `tailwind.config.cjs`**（项目根目录）：
```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  // 限定扫描范围：只编译 AI 子树的 className
  content: ['./src/components/ai/**/*.{ts,tsx}'],
  // 让所有 utility 仅在 .ai-scope 子树内生效
  important: '.ai-scope',
  // 关闭全局 reset，防止破坏 gwshell 终端/SFTP/Sidebar 现有样式
  corePlugins: { preflight: false },
  // 暗色模式由 .ai-scope.dark 类驱动（独立于 gwshell 的 data-theme）
  darkMode: ['class', '.ai-scope.dark'],
  theme: {
    extend: {
      // 完整复制 cc-switch 的 theme.extend（colors / boxShadow / borderRadius / fontFamily / animation / keyframes）
      // 见路线图附录 A，此处省略——实现时直接 1:1 复制 cc-switch/tailwind.config.cjs 的 theme.extend 块
    },
  },
  plugins: [],
};
```

**新增 `postcss.config.cjs`**（项目根）：
```js
module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

**新增 `src/components/ai/styles/ai.css`**：
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* AI 区独立 CSS 变量（HSL 三元组），与 gwshell data-theme 互不干扰 */
.ai-scope {
  --background: 0 0% 100%;
  --foreground: 240 10% 3.9%;
  --primary: 240 5.9% 10%;
  --primary-foreground: 0 0% 98%;
  /* ... 其余 cc-switch 的 :root 变量 ... 实现时直接复制 cc-switch/src/index.css 的 :root 块 */
}
.ai-scope.dark {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  /* ... 复制 cc-switch 的 .dark 块 ... */
}
```

### 3.3 目录骨架

```
src/components/ai/
├── AiSection.tsx              # 顶层容器
├── styles/
│   └── ai.css                 # tailwind 入口
├── ui/                        # shadcn 组件占位（Stage 0 只放 button.tsx）
│   └── button.tsx             # 从 cc-switch/src/components/ui/button.tsx 直接拷贝
├── i18n/
│   ├── index.ts               # i18next 实例（注册 gwshell + ai 两个 namespace）
│   └── locales/
│       ├── ai.zh.json         # 从 cc-switch/src/i18n/locales/zh.json 拷贝
│       ├── ai.en.json         # 从 cc-switch/src/i18n/locales/en.json 拷贝
│       ├── gwshell.zh.json    # 从 gwshell src/i18n/zh.ts 转换
│       └── gwshell.en.json    # 从 gwshell src/i18n/en.ts 转换
└── _smoke/
    └── SmokeCard.tsx          # 烟雾测试：一张假 ProviderCard，使用 Button + lucide-ai 图标 + i18next

src-tauri/src/ai/
└── mod.rs                     # 空模块（pub mod ai;），后续阶段填充
```

### 3.4 i18next 全量迁移（决策 4 落地）

**步骤**：
1. **新建 `src/components/ai/i18n/index.ts`** —— 实际作为**全项目**的 i18next 实例（虽然路径在 ai/ 下，但导出后供整个 app 使用）：
   ```ts
   import i18n from 'i18next';
   import { initReactI18next } from 'react-i18next';
   import gwshellZh from './locales/gwshell.zh.json';
   import gwshellEn from './locales/gwshell.en.json';
   import aiZh from './locales/ai.zh.json';
   import aiEn from './locales/ai.en.json';

   i18n.use(initReactI18next).init({
     resources: {
       zh: { gwshell: gwshellZh, ai: aiZh },
       en: { gwshell: gwshellEn, ai: aiEn },
     },
     lng: detectLocaleFromStorage(), // 复用现有 detectLocale 的逻辑
     fallbackLng: 'en',
     defaultNS: 'gwshell',
     interpolation: { escapeValue: false, prefix: '{', suffix: '}' }, // 兼容现有 {var} 占位风格
   });

   export default i18n;
   ```
   **路径选择说明**：虽然 i18next 实例为整个项目服务，但所有 cc-switch 移植代码都放在 `src/components/ai/` 下，i18n 资源文件也放在那里更内聚。`src/i18n/index.ts`（旧）会改为重导出这个新实例，旧的 `getT()` 删除。

2. **改造 `src/i18n/index.ts`**：
   - 删除 `getT()`、`translations` 字典
   - 删除 `import zh from './zh'`、`import en from './en'`
   - 改为：`export { default } from '../components/ai/i18n'; export { detectLocale } from '../components/ai/i18n/detect';`
   - 保留 `Locale` 与 `TranslationKeys` 类型导出（`TranslationKeys` 改为从 gwshell.zh.json 推导的 union 类型）

3. **删除** `src/i18n/zh.ts`、`src/i18n/en.ts`（其内容已转换为 JSON 资源）

4. **改造 `src/stores/appStore.ts`**：
   - `locale` 字段保留
   - `t` 字段废弃 —— 改为暴露 `getT(): TFunction`，内部从 i18next 取；或者直接让 consumer 改用 `useTranslation()`
   - **更简单的过渡方案**：保留 `t` 字段但改为 i18next 的 `t` 函数：`t: i18n.getFixedT(get().locale, 'gwshell')`，并在 `setLocale` 中刷新这个引用
   - `setLocale(loc)` 改为：`i18n.changeLanguage(loc).then(() => set({ locale: loc, t: i18n.getFixedT(loc, 'gwshell') }))`
   - 订阅 i18next 的 `languageChanged` 事件，把外部触发的语言切换回写到 store

5. **改造 12 个 consumer 文件**：
   - **保留 `useAppStore().t(...)` 调用方式**（最小改动） — 因为 store 上的 `t` 现在指向 i18next 的 t 函数，签名兼容（key + params 占位符）
   - **不需要**把 12 个文件全部改成 `useTranslation()`，这降低了 Stage 0 的风险
   - **要做的小修补**：i18next 的 `t(key, params)` 第二参数是 options，与原 `getT` 的纯 params 略有差异，但只要 params 是普通对象就向后兼容
   - 占位符：i18next 默认 `{{var}}`，但通过 `interpolation.prefix='{', suffix='}'` 配置成 `{var}`，与原 `getT` 一致

6. **App.tsx 顶层包 `<I18nextProvider i18n={i18n}>`**：放在最外层，包住所有现有内容

7. **持久化**：i18next 不引入 `i18next-browser-languagedetector`；初始语言从 gwshell 现有 localStorage 路径读取，由 `detectLocale()` 决定

### 3.5 烟雾测试组件（决策 0.5 落地）

**`src/components/ai/_smoke/SmokeCard.tsx`**：
- 内容：一张固定的假 ProviderCard，显示 "Claude Sonnet 4.5"、一个 Button、一个 lucide-ai 的 `Bot` 图标、一段从 `ai` namespace 取的文案
- 使用 `useTranslation('ai')` 取 cc-switch 的 `app.title` 这种已存在的 key
- 使用 cc-switch 风格 className（`bg-card border-border rounded-lg shadow-sm p-4 ai-`-prefixed via important）

**`src/components/ai/AiSection.tsx`**：
```tsx
import './styles/ai.css';
import { useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { SmokeCard } from './_smoke/SmokeCard';

export function AiSection() {
  const theme = useAppStore(s => s.theme);
  // 把 gwshell 的 theme 同步到 ai-scope 的 dark 类
  useEffect(() => {
    const root = document.querySelector('.ai-scope');
    if (!root) return;
    root.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return (
    <div className="ai-scope">
      <SmokeCard />
    </div>
  );
}
```

### 3.6 SettingsModal 集成

- 在 `src/components/Settings/SettingsModal.tsx` 内，把"AI"标签页（如果不存在则新增一个 tab）的内容改为 `lazy(() => import('@/components/ai/AiSection').then(m => ({ default: m.AiSection })))`
- 不动 SettingsModal 的其它 tab（旧的 ProviderEditor / McpManager / PromptsManager / UsageDashboard 在 Stage 1-5 里逐步退役）
- 烟雾测试组件位于 AI tab 下方，验收时通过

### 3.7 后端骨架

- `src-tauri/src/lib.rs`：新增 `mod ai;`
- `src-tauri/src/ai/mod.rs`：空文件或一行注释
- **不**新增 Cargo 依赖（留到 Stage 1 一次性加）

## 4. 实施步骤（按顺序）

1. **依赖安装**：更新 `package.json`，运行 `npm install`，验证 `npm run dev` 启动正常
2. **tailwind/postcss 配置**：建文件，验证 `npm run build` 编译通过
3. **目录骨架**：建空文件
4. **i18next 实例 + 资源文件**：
   - 把 `src/i18n/zh.ts` 转成 `gwshell.zh.json`（脚本或手工）
   - 把 `src/i18n/en.ts` 转成 `gwshell.en.json`
   - 拷贝 `cc-switch/src/i18n/locales/zh.json` → `ai.zh.json`，`en.json` → `ai.en.json`
   - 写 `i18n/index.ts`
5. **改造 `src/i18n/index.ts`** 为重导出
6. **改造 `appStore.ts`**：`t` 字段改用 i18next；`setLocale` 触发 `changeLanguage`
7. **删除** `src/i18n/zh.ts`、`src/i18n/en.ts`
8. **App.tsx 顶层加 I18nextProvider**
9. **手动冒烟**：启动 `npm run tauri dev`，逐一访问：TitleBar、Sidebar、TabBar、StatusBar、SessionPanel、AssetTable、NewSessionModal、DockerModal、SettingsModal、所有 Sidebar 子项菜单 —— 中英切换两次，确认所有文案和原来完全一致
10. **建 AiSection + SmokeCard + 拷贝 button.tsx**
11. **接入 SettingsModal**
12. **最终冒烟**：打开 Settings → AI tab，看到带主题色的烟雾卡片；切换 gwshell 主题，烟雾卡片背景色跟着变；切换语言，卡片内文案同步变

## 5. 验收准则

| # | 检查项 | 方法 |
|---|---|---|
| 1 | `npm run dev` 启动无错 | 终端无报错；浏览器无控制台红字 |
| 2 | `npm run build` 编译通过 | 退出码 0 |
| 3 | `npm run tauri dev` 启动无错 | 窗口正常显示，splash 正常 |
| 4 | gwshell 现有界面零视觉回归 | 人工对比阶段 0 实施前的截图（TitleBar、Sidebar、SessionPanel、TabBar、StatusBar、AssetTable、4 个 Modals、SettingsModal 的非 AI tab） |
| 5 | gwshell 现有界面零文案回归 | 中英切换两次，每个界面文案与原来完全一致 |
| 6 | gwshell 主题切换无回归 | 切换 light/dark，所有原有界面正常 |
| 7 | i18next 实例可用 | `useTranslation('gwshell')` 与 `useTranslation('ai')` 都能取到值 |
| 8 | 烟雾测试卡片正常 | Settings → AI tab 显示一张带主题色 / Button / lucide 图标 / i18n 文案的卡片 |
| 9 | 烟雾测试卡片主题跟随 | gwshell 切 dark，卡片切 dark；切回 light，卡片切回 |
| 10 | tailwind 样式不外溢 | 终端、SFTP、Sidebar 等区域的字体、边距、颜色与原来完全一致 |
| 11 | 后端 `cargo build` 通过 | tauri build 不报新增模块错 |

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `important: '.ai-scope'` 与 Radix 内联样式冲突 | Stage 0 烟雾组件只用 Button + 一张 div 卡片，不触发复杂 Radix 浮层；如果发现冲突，立即在 spec 中更新方案（回退到 prefix 方案 0.2-A） |
| i18next interpolation 配成 `{var}` 后，cc-switch 资源里的 `{{var}}` 不工作 | cc-switch 的 `ai.zh.json` / `ai.en.json` 资源里如果有 `{{var}}`，需要预处理时正则替换为 `{var}`；或者保留 `{{var}}` 并在 `gwshell` namespace 上单独覆盖。**实施时先 grep cc-switch 资源**判断哪种占位风格 |
| 12 个 consumer 改 `t` 函数签名后参数不兼容 | i18next `t(key, options)` 中 options 直接当作插值变量，与 `getT(key, params)` 兼容；测试覆盖即可 |
| `lucide-ai` 别名在 vite 下解析失败 | 验证 `npm install` 后 `node_modules/lucide-ai` 存在；vite 默认支持 npm 别名，无需额外配置 |
| TS 类型推导丢失 `TranslationKeys` | 用 `import gwshellZh from './locales/gwshell.zh.json' assert { type: 'json' }` + `type TranslationKeys = keyof typeof gwshellZh` |
| 现有 12 个 consumer 中存在 `useAppStore().t` 之外的写法 | 实施步骤 9 的全量手动冒烟会发现；如有遗漏的 `getT()` 直接 import 调用，统一改为 store.t |

## 7. 不在范围内

- 任何 cc-switch 业务功能（provider/MCP/usage/proxy 等都留给后续阶段）
- 后端 Cargo 依赖增加（留给 Stage 1）
- 删除 gwshell 旧的 `ai_config.rs` / `mcp_config.rs` / `usage_tracker.rs`（留给 Stage 4/5）
- 引入日语 `ja.json`
- shadcn 组件全量搬运（只搬 button.tsx 一个）
- React 19 与全部 Radix 包的兼容性测试（只验证 Stage 0 用到的两个 slot/label）
- 后续阶段才需要的 react-query / react-hook-form / zod / framer-motion / recharts / codemirror 等依赖（按需追加，避免无引用）

## 8. 完成标志

- 11 条验收准则全部通过
- git 工作区干净
- 提交记录包含：「Stage 0: foundation — i18next migration + tailwind scoped + smoke card」
- 准备进入 **Stage 1（数据层与 Provider 模型）** spec 编写
