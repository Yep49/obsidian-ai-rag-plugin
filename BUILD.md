# 构建和部署指南

## ❓ 编译后源码会消失吗？

**不会！** 源码永远保留在 `src/` 目录下。

### 编译过程说明

```
编译前：
├── src/              ← 源码（TypeScript）
│   ├── main.ts
│   ├── services/
│   ├── views/
│   └── types/
├── manifest.json
├── package.json
└── styles.css

编译后：
├── src/              ← 源码依然存在！
│   ├── main.ts
│   ├── services/
│   ├── views/
│   └── types/
├── main.js           ← 新增：编译产物（JavaScript）
├── main.js.map       ← 新增：Source Map（调试用）
├── manifest.json
├── package.json
└── styles.css
```

### 编译做了什么？

1. **读取** `src/` 下的 TypeScript 源码
2. **编译** 成 JavaScript
3. **打包** 所有模块到一个文件
4. **输出** `main.js`（这是 Obsidian 实际运行的文件）

**源码不会被删除或修改！**

---

## 🚀 构建步骤

### 1. 安装依赖

```bash
cd C:\Users\20495\obsidian-ai-rag-plugin-source
npm install
```

### 2. 开发模式（实时编译）

```bash
npm run dev
```

- 监听文件变化
- 自动重新编译
- 生成 Source Map（方便调试）

### 3. 生产构建

```bash
npm run build
```

- 一次性编译
- 不生成 Source Map
- 代码优化

### 4. 类型检查（不编译）

```bash
npm run typecheck
```

---

## 📦 部署到 Obsidian

### 方法 1：手动复制

```bash
# 编译
npm run build

# 复制文件到 Obsidian 插件目录
# 需要复制 3 个文件：
# - main.js
# - manifest.json
# - styles.css

# Windows 示例：
copy main.js "C:\Users\YourName\YourVault\.obsidian\plugins\obsidian-ai-rag-plugin\"
copy manifest.json "C:\Users\YourName\YourVault\.obsidian\plugins\obsidian-ai-rag-plugin\"
copy styles.css "C:\Users\YourName\YourVault\.obsidian\plugins\obsidian-ai-rag-plugin\"
```

### 方法 2：符号链接（推荐开发时使用）

```bash
# 在 Obsidian 插件目录创建符号链接
mklink /D "C:\Users\YourName\YourVault\.obsidian\plugins\obsidian-ai-rag-plugin" "C:\Users\20495\obsidian-ai-rag-plugin-source"

# 然后运行 dev 模式
npm run dev

# 修改代码后，Obsidian 中按 Ctrl+R 重新加载插件
```

---

## 📤 上传到 GitHub

### 需要上传的文件

```
✅ 必须上传：
├── src/                  ← 源码
├── manifest.json         ← 插件信息
├── package.json          ← npm 配置
├── tsconfig.json         ← TypeScript 配置
├── esbuild.config.mjs    ← 构建配置
├── version-bump.mjs      ← 版本管理脚本
├── versions.json         ← 版本兼容性
├── styles.css            ← 样式
├── README.md             ← 说明文档
├── LICENSE               ← 开源协议
├── .gitignore            ← Git 忽略规则
└── BUILD.md              ← 构建指南（本文件）

❌ 不要上传（.gitignore 已配置）：
├── node_modules/         ← npm 依赖（太大）
├── main.js               ← 编译产物（用户自己编译）
├── main.js.map           ← Source Map
└── .obsidian/            ← Obsidian 工作区
```

### 上传步骤

```bash
# 1. 初始化 Git（如果还没有）
git init

# 2. 添加所有文件
git add .

# 3. 提交
git commit -m "Initial commit: AI RAG Search Enhanced Plugin"

# 4. 关联远程仓库
git remote add origin https://github.com/yourusername/obsidian-ai-rag-plugin.git

# 5. 推送
git push -u origin main
```

---

## 🔧 常见问题

### Q: 编译后 main.js 很大怎么办？
A: 正常现象。main.js 包含了所有代码和依赖，通常 100-500KB。

### Q: 修改代码后 Obsidian 没反应？
A: 在 Obsidian 中按 `Ctrl+R` 重新加载插件。

### Q: 编译报错怎么办？
A:
1. 检查 `npm install` 是否成功
2. 运行 `npm run typecheck` 查看类型错误
3. 查看错误信息，通常会指出具体文件和行号

### Q: 用户如何安装我的插件？
A: 用户需要：
1. 下载你的 Release（包含 main.js, manifest.json, styles.css）
2. 解压到 `.obsidian/plugins/obsidian-ai-rag-plugin/`
3. 在 Obsidian 设置中启用插件

### Q: 如何发布 Release？
A:
1. 编译：`npm run build`
2. 在 GitHub 创建 Release
3. 上传 3 个文件：main.js, manifest.json, styles.css
4. 用户下载这 3 个文件即可使用

---

## 📝 开发工作流

```bash
# 1. 修改源码
vim src/services/Retriever.ts

# 2. 自动编译（如果运行了 npm run dev）
# 或手动编译
npm run build

# 3. 在 Obsidian 中重新加载插件
# 按 Ctrl+R

# 4. 测试功能

# 5. 提交代码
git add .
git commit -m "feat: improve retrieval accuracy"
git push
```

---

## 🎯 总结

- ✅ **源码永远保留** - 在 `src/` 目录
- ✅ **main.js 是编译产物** - 可以随时重新生成
- ✅ **上传源码到 GitHub** - 不上传 main.js
- ✅ **用户下载 Release** - 包含编译好的 main.js
