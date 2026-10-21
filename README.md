# Gali

一个安静的个人博客。部署在 Cloudflare Pages 上，前端无需构建，后端是 Pages Functions + D1（+ R2 或 KV 存文件）。

- **文章 / 碎片 / 页面** 三种写法：长文有标题和目录，碎片像随手记，页面可以挂到导航里
- **写作台**：Markdown 实时分栏预览、完整工具栏、快捷键、列表自动续行、专注模式、本地自动备份
- **上传**：按钮、拖拽、直接粘贴；图片 / 视频 / 音频自动嵌入，其它文件变成附件卡片；大图可在浏览器里先压成 WebP
- **口令**：只有输对口令才能进写作台和工作室；可以选择「在这台设备上记住我」，Cookie 保存 180 天
- **黑白两色**：只有白、黑两套，默认跟随系统，访客可在侧栏切换；没有彩色，只靠字重、灰度和留白
- **能改的地方**：站名、开篇自白、「此刻」状态、关于页、导航、外链、页脚、默认明暗、字体与字号、站名竖排、首页排布（目录 / 卡片 / 长流），以及全站自定义 CSS 和 `<head>` 注入
- 每一篇可以有自己的心绪符号、封面、版式（标准 / 宽幅 / 诗行）
- RSS：`/feed.xml`；文章链接分享时带标题、摘要和封面

## 部署到 Cloudflare Pages

1. **建项目**：Cloudflare 控制台 → Workers 和 Pages → 创建 → Pages → 连接到 Git，选这个仓库。
   - 框架预设：无
   - 构建命令：留空
   - 构建输出目录：`public`
2. **建数据库**：存储和数据库 → D1 → 创建，名字随意（比如 `galiblog`）。
3. **建文件存储**（二选一）：
   - R2 → 创建存储桶（推荐，单文件上限约 95MB；首次开通 R2 可能需要绑卡，免费额度 10GB）
   - 或 KV → 创建命名空间（不用绑卡，单文件 25MB 以内）
4. **绑定**：Pages 项目 → 设置 → 绑定，添加：
   - D1 数据库，变量名 **`DB`**
   - R2 存储桶，变量名 **`FILES`**；或者 KV 命名空间，变量名 **`FILES_KV`**
5. **口令**：Pages 项目 → 设置 → 变量和机密，添加 **`ADMIN_PASSWORD`**，类型选「密钥」。
   （可选再加一个 `SESSION_SECRET`，任意长随机字符串。改口令或改它，所有已登录设备都会被登出。）
6. 回到部署页面，**重新部署**一次让绑定生效。数据表会在第一次访问时自动创建。

打开站点，点页脚右下角的 ✎（或者直接访问 `/write`），输入口令即可开始写。管理入口是 `/studio`。

> 仓库里**不要**提交 `wrangler.toml`：Pages 发现它就会改用文件里的绑定，控制台里的设置会失效。`.gitignore` 已经忽略了它。

## 本地开发

```bash
npm install
cp wrangler.example.toml wrangler.toml   # 本地用，ID 随便填
cp .dev.vars.example .dev.vars           # 写入本地口令
npm run dev                              # http://localhost:8788
```

## 写作语法

在标准 Markdown（含表格、待办、删除线）之外：

| 写法 | 效果 |
| --- | --- |
| `==文字==` | 高亮 |
| `\|\|文字\|\|` | 黑幕，点击显示 |
| `{汉字\|hàn zì}` | 注音 |
| `正文[^1]` + 单独一行 `[^1]: 内容` | 脚注 |
| `::: note 标题` … `:::` | 提示块（`tip` `warn` `danger` `quote` 也可用，只是标题不同） |
| `::: details 点开` … `:::` | 折叠 |
| `::: center` / `::: right` | 居中 / 靠右 |
| `::: wide` / `::: aside` | 宽幅出血 / 旁注（宽屏下浮在右边距） |
| `![图注](图片 "标题")` | 单张图自动成 figure，有标题或说明时显示图注 |
| 一段里连续放多张图 | 自动拼成画廊 |
| `![](xxx.mp4)` / `![](xxx.mp3)` | 视频 / 音频播放器 |
| 直接写 `<iframe>`、`<span style>` 等 HTML | 原样保留 |

快捷键：`Ctrl+B` 粗体、`Ctrl+I` 斜体、`Ctrl+K` 链接、`Ctrl+E` 行内代码、`Ctrl+Alt+1~4` 标题、`Ctrl+S` 保存、`Ctrl+Enter` 发布、`Tab / Shift+Tab` 缩进。选中文字后粘贴网址会直接变成链接。

## 结构

```
public/            静态前端（直接发布，无需构建）
  assets/js/       app 路由与页面、editor 写作台、studio 工作室、md 渲染、media 媒体库
  assets/css/      样式（黑白两套，全部是 CSS 变量）
  assets/vendor/   marked、DOMPurify、highlight.js
functions/         Pages Functions
  api/[[path]].js  全部 API
  f/[[path]].js    上传文件的访问地址 /f/<id>/<文件名>（支持视频拖动进度）
  p/[slug].js      为文章页写入分享用的 meta 标签
  feed.xml.js      RSS
lib/               服务端共用代码：鉴权、数据库、存储
```
