# 网页聊天窗（零依赖前端组件）

一个能直接挂到独立站上的客服聊天窗。**纯前端、无第三方依赖、默认不联网、客户数据不出浏览器。**

工作方式分两层：**能自己答的自己答（不花钱），答不上来的才交给 AI（可选）。**

---

## 两层是怎么分工的

|        | 第一层 · 本地匹配  | 第二层 · AI 兜底                   |
| ------ | ----------- | ----------------------------- |
| 什么时候触发 | 知识库里有命中的条目  | 本地没命中，**且**配置了 `aiEndpoint`   |
| 原理     | 关键词 + 字词相似度 | 大模型基于知识库作答                    |
| 成本     | **0**       | 按 token 计费                    |
| 延迟     | 0           | 1–3 秒                         |
| 能不能关掉  | —           | **能**。不配 `aiEndpoint` 就是纯本地模式 |

**为什么要分两层**：日常咨询里"问物流、问政策、问尺寸"这类占了大部分，让它们零成本、零延迟地答掉；只有真正没见过的新问法才花钱。**又快又便宜。**

**AI 层是可选的。** 不配置 `aiEndpoint`，这个组件就是一个纯本地匹配器 —— 一分钱不花，一点数据都不往外传。

---

## 它到底能干什么（先看清楚，别期望错）

**能：**

- 读一份知识库 JSON，认出客户问的是哪一类问题
- 中英文都能匹配，大小写、标点、错别字有一定的容错
- 能答的自己答；**不该答的一律转人工**（退款、赔付、承诺日期、议价、投诉）
- 不联网时，客户的消息不会离开他的浏览器
- **配了 AI 后端之后**：能听懂没写进知识库的问法、能答阿语/西语等语种、能用自然语言作答
- **AI 后端挂了会自动降级** —— 回落到"转人工"，不白屏、不丢消息

**不能（这些是当前版本的天花板）：**

- **不能查订单。** 它不知道"订单 #1234 在哪"，只能告诉客户去哪儿查
- **知识库里没有的，它不编。** 本地不会编；交给 AI 时也被硬性要求"只依据知识库"，编不出来就转人工
- **不做多轮对话。** 每一条消息独立判断，不记上下文。"那它多少钱？"这种指代式追问会转人工

> ⚠️ **别把 API Key 写进这个文件。** 前端代码任何人按 F12 都能看到，Key 等于公开。  
> AI 调用必须走你自己的后端代理（接口契约见 `../server-contract.md`），前端只调你自己的接口。

---

## 文件说明

| 文件                            | 作用                                                           |
| ----------------------------- | ------------------------------------------------------------ |
| `chat-widget.js`              | 组件本体。核心逻辑 + 界面，一个文件搞定，样式自动注入                                 |
| `knowledge-base.example.json` | 示例知识库（15 条）。**格式就是 `prompts/build-knowledge-base.md` 输出的格式** |
| `index.html`                  | 演示页，带 4 组共 26 个测试问题，点一下就能试                                   |
| `selftest.js`                 | 匹配引擎自测。改完知识库跑一遍，看有没有踩红线                                      |

---

## 四种用法

### 用法一 · 纯本地（最短路径，先跑这个）

把这两个文件放到你的网站目录：

```
chat-widget.js
knowledge-base.json      ← 你自己的知识库
```

在页面 `</body>` 前加：

```html
<script src="/chat-widget.js"></script>
<script>
  window.AICS_CONFIG = {
    kbUrl: "/knowledge-base.json",
    title: "客服",
    greeting: "您好，有什么可以帮您？",
    handoff: {
      whatsapp: "your-whatsapp-number",
      email: "hello@example.com"
    }
  };
</script>
```

打开页面，右下角就会出现聊天窗。**没有别的步骤，也不会产生任何费用。**

### 用法二 · 加上 AI 兜底

先按 `../server-contract.md` 把后端代理部署好，拿到地址，然后加一行 `aiEndpoint`：

```html
<script>
  window.AICS_CONFIG = {
    kbUrl: "/knowledge-base.json",
    aiEndpoint: "https://aics-proxy.你的账号.workers.dev/api/chat",   // ← 就加这一行
    title: "客服"
  };
</script>
```

这样：知识库能答的照旧本地答，答不上来的自动转给 AI。

### 用法三 · 手动挂载（想控制时机的时候）

```html
<script src="/chat-widget.js"></script>
<script>
  fetch("/knowledge-base.json").then(r => r.json()).then(kb => {
    AICS.mount({ kb: kb, title: "客服", aiEndpoint: "https://.../api/chat" });
  });
</script>
```

### 用法四 · Shopify 主题里挂

1. 把 `chat-widget.js` 和 `knowledge-base.json` 传到 Shopify 的 **Assets** 目录
2. 后台 → 在线商店 → 主题 → 编辑代码 → `theme.liquid`
3. 在 `</body>` 前插入：

```html
{{ 'chat-widget.js' | asset_url | script_tag }}
<script>
  window.AICS_CONFIG = {
    kbUrl: "{{ 'knowledge-base.json' | asset_url }}",
    aiEndpoint: "https://aics-proxy.你的账号.workers.dev/api/chat",
    title: "客服"
  };
</script>
```

---

## 配置项

| 字段                   | 必填 | 默认         | 说明                                               |
| -------------------- | -- | ---------- | ------------------------------------------------ |
| `kb` / `kbUrl`       | 是  | —          | 知识库。可以直接给数组，也可以给 JSON 文件路径                       |
| `aiEndpoint`         | 否  | —          | **AI 后端地址。不填 = 纯本地模式**                           |
| `aiTimeout`          | 否  | `12000`    | AI 请求超时（毫秒）。超了就转人工                               |
| `thinkingText`       | 否  | `稍等，我看一下…` | 等 AI 回答时的占位文案                                    |
| `title`              | 否  | `客服`       | 面板标题                                             |
| `greeting`           | 否  | —          | 打开时第一条问候                                         |
| `placeholder`        | 否  | `输入您的问题…`  | 输入框提示                                            |
| `fallback`           | 否  | —          | 匹配不上时的回复                                         |
| `handoffIntro`       | 否  | —          | 需要人工时的过渡语                                        |
| `handoff`            | 否  | —          | `{ whatsapp, email, liveChat, text }`，转人工时给客户的出口 |
| `threshold`          | 否  | `42`       | 本地匹配阈值。**调高 = 更保守（更多走 AI），调低 = 更大胆**             |
| `accent`             | 否  | `#111827`  | 主色                                               |
| `position`           | 否  | `right`    | `right` 或 `left`                                 |
| `showScore`          | 否  | `false`    | 显示命中条目和来源。**调试时打开，上线关掉**                         |
| `onAI` / `onAIError` | 否  | —          | 回调。可用来埋点统计"AI 兜底了多少次"                            |

---

## 知识库格式

```json
[
  {
    "id": "KB-001",
    "category": "物流",
    "question": "多久能收到货？",
    "match_phrases": [
      "How long does shipping take?",
      "还要多久能到？"
    ],
    "answer": "普通订单通常 7–15 个工作日送达。",
    "auto_reply": true,
    "handoff_when": "客户已超过 20 个工作日未收到",
    "notes": ""
  }
]
```

`auto_reply` 三个取值，**这是整个组件的安全阀，别乱填**：

| 值           | 行为                            |
| ----------- | ----------------------------- |
| `true`      | 机器自己答                         |
| `"handoff"` | 先给答案，然后提示可以转人工                |
| `false`     | **不给答案**，直接转人工。退款、赔付、法律类一律用这个 |

> 这三态**在 AI 层同样生效**：标了 `false` 的条目根本不会走到 AI；后端还会再拦一道（见 `../server-contract.md` 的「三条线」）。

---

## 怎么改知识库

1. 按 `templates/faq-template.md` 填好你自己店铺的 FAQ
2. 用 `prompts/build-knowledge-base.md` 转成 JSON
3. 存成 `knowledge-base.json`，替换掉示例文件
4. **跑一遍自测**：

```bash
node selftest.js
```

它会告诉你：20 个典型问题里，哪些自动答了、哪些转人工了、有没有踩红线。

> `selftest.js` 目前读的是示例知识库。换成你自己的之后，把 `knowledge-base.example.json`  
> 改成你的文件名，顺便把 `CASES` 里的问题换成你店里真实的客户问法。

---

## 本地看演示

**只看纯本地模式**（不需要后端，30 秒跑起来）：

```bash
cd widget
python -m http.server 8000
```

打开 `http://localhost:8000`。此时没配后端，第 4 组问题会走"转人工"。

> 直接双击 `index.html` 不行 —— 浏览器安全策略会拦住本地读 JSON。

想看 **AI 兜底**的效果，直接访问仓库主页 README 顶部的**在线 Demo**；想自己接，先按 `../server-contract.md` 部署后端。

---

## 已知短板（老实说）

1. **本地匹配靠字面，不懂语义。** 客户说"我的东西什么时候能到手上"，知识库写的是"多久能收到货"——能匹配上；但"我等得花儿都谢了"就匹配不上。**转人工是安全的，但体验一般。**（配了 AI 后端后，这类会交给 AI 处理）
2. **没有多轮对话。** 每条消息独立判断，不记上下文。
3. **AI 层不做流式输出。** 用户要先等 1–3 秒，看到的是"稍等，我看一下…"。
4. **知识库全文每次都要发给模型。** 15 条的规模没问题；超过 100 条要改用向量检索。
5. **AI 后端的安全网是关键词匹配，不是语义判断。** 明说的"退款/折扣/投诉"能拦住，绕着说的拦不住。别当成万无一失。
6. **`selftest.js` 的 20 个问题是一般性样本**，不是你店铺的真实问法。上线前拿真实聊天记录再跑一轮。

---

## 许可

MIT。拿去改、拿去商用都行。
