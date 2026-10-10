/*!
 * AI 客服聊天窗 · 零依赖前端组件
 * ---------------------------------------------------------------
 * 特点：纯前端、无第三方依赖、本地匹配优先、客户数据不出浏览器
 * 许可：MIT
 * 用法：见同目录 README.md
 *
 * 工作方式（两层）：
 *   第一层 · 本地匹配 —— 命中知识库就直接答。零成本、零延迟、不联网。
 *   第二层 · AI 兜底 —— 只有本地没命中，才把问题发给你的后端代理，
 *                        由大模型基于知识库作答。后端地址填 aiEndpoint。
 *
 * 设计约束（别改，改了会出事）：
 *  1. 前端永不内嵌大模型 API Key —— 那等于公开泄露。AI 一律走后端代理。
 *  2. auto_reply === false 的条目，绝不自动作答，直接转人工。
 *  3. auto_reply === "handoff" 的条目，先给答案，再提示可转人工。
 *  4. AI 后端不可用时，降级成「转人工」，绝不白屏或丢消息。
 * ---------------------------------------------------------------
 */

(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  if (typeof window !== "undefined") {
    window.AICS = api;
    var boot = function () {
      if (window.AICS_CONFIG) { api.mount(window.AICS_CONFIG); }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else { boot(); }
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "1.1.0";
  var instance = null;

  /* ============================ 文本处理 ============================ */

  // 全角转半角（中文客户经常打出全角字母数字）
  function toHalfWidth(s) {
    return String(s == null ? "" : s).replace(/[\uFF01-\uFF5E]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
  }

  // 归一化：转半角 → 小写 → 去掉所有标点和符号 → 压空格
  // 保留所有语言的字母和数字（含中日韩），所以 \p{L} 一定要带 u 标志
  function normalize(s) {
    var t = toHalfWidth(s).replace(/\u3000/g, " ").toLowerCase();
    t = t.replace(/[^\p{L}\p{N}]+/gu, " ");
    return t.replace(/\s+/g, " ").trim();
  }

  // 英文/带空格语言按词切
  function tokens(s) {
    var t = normalize(s);
    return t ? t.split(" ") : [];
  }

  // 中日韩没有词边界，用字符 n-gram 兜底
  function grams(s, n) {
    n = n || 2;
    var t = normalize(s).replace(/\s+/g, "");
    var out = {};
    if (!t) { return out; }
    if (t.length <= n) { out[t] = true; return out; }
    for (var i = 0; i + n <= t.length; i++) { out[t.slice(i, i + n)] = true; }
    return out;
  }

  function toKeyMap(arr) {
    var m = {};
    for (var i = 0; i < arr.length; i++) { if (arr[i]) { m[arr[i]] = true; } }
    return m;
  }

  function jaccard(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    if (!ka.length || !kb.length) { return 0; }
    var setB = toKeyMap(kb);
    var inter = 0;
    for (var i = 0; i < ka.length; i++) { if (setB[ka[i]]) { inter++; } }
    var union = ka.length + kb.length - inter;
    return union ? inter / union : 0;
  }

  /* ============================ 匹配引擎 ============================ */

  /**
   * 给单条知识库记录打分（0-100）
   * 优先级：完全相同 > 包含短语 > 被短语包含 > 词重合 > 二字组重合
   */
  function scoreEntry(text, entry) {
    var q = normalize(text);
    if (!q) { return 0; }

    var cands = [entry.question].concat(entry.match_phrases || []);
    var qTokenMap = toKeyMap(tokens(q));
    var qGramMap = grams(q);
    var best = 0;

    for (var i = 0; i < cands.length; i++) {
      var p = normalize(cands[i]);
      if (!p) { continue; }

      if (p === q) { return 100; }

      // 客户的整句话里包含了某条标准问法 —— 最可靠的正向命中
      if (p.length >= 3 && q.indexOf(p) !== -1) {
        best = Math.max(best, 92);
        continue;
      }

      // 客户只打了半句，被标准问法包含
      if (q.length >= 4 && p.indexOf(q) !== -1) {
        best = Math.max(best, 80);
        continue;
      }

      var byToken = jaccard(toKeyMap(tokens(p)), qTokenMap) * 100 * 0.85;
      var byGram = jaccard(grams(p), qGramMap) * 100;
      best = Math.max(best, byToken, byGram);
    }

    return Math.round(best);
  }

  /**
   * 在整份知识库里找最佳匹配
   * @returns {{entry: object|null, score: number}}
   */
  function match(text, kb, opts) {
    opts = opts || {};
    var threshold = opts.threshold == null ? 42 : opts.threshold;
    var best = null, bestScore = 0;

    for (var i = 0; i < (kb || []).length; i++) {
      var s = scoreEntry(text, kb[i]);
      if (s > bestScore) { bestScore = s; best = kb[i]; }
    }

    if (!best || bestScore < threshold) { return { entry: null, score: bestScore }; }
    return { entry: best, score: bestScore };
  }

  /* ============================ 加载知识库 ============================ */

  function load(source) {
    if (Array.isArray(source)) { return Promise.resolve(source); }
    return fetch(source, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) { throw new Error("加载知识库失败：HTTP " + r.status); }
      return r.json();
    });
  }

  /* ============================ 样式 ============================ */

  function injectStyles(cfg) {
    if (document.getElementById("aics-style")) { return; }
    var accent = cfg.accent || "#111827";
    var css =
      ".aics-bubble{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:28px;" +
      "background:" + accent + ";color:#fff;border:0;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.18);" +
      "font-size:24px;line-height:1;z-index:2147483000;transition:transform .15s}" +
      ".aics-bubble:hover{transform:scale(1.06)}" +
      ".aics-bubble.aics-left{left:20px;right:auto}" +
      ".aics-panel{position:fixed;right:20px;bottom:88px;width:360px;max-width:calc(100vw - 32px);" +
      "height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:14px;overflow:hidden;" +
      "box-shadow:0 12px 40px rgba(0,0,0,.22);display:none;flex-direction:column;z-index:2147483001;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}" +
      ".aics-panel.aics-left{left:20px;right:auto}" +
      ".aics-panel.aics-open{display:flex}" +
      ".aics-head{background:" + accent + ";color:#fff;padding:14px 16px;font-size:15px;font-weight:600;" +
      "display:flex;justify-content:space-between;align-items:center}" +
      ".aics-head button{background:none;border:0;color:#fff;font-size:20px;cursor:pointer;line-height:1;opacity:.85}" +
      ".aics-body{flex:1;overflow-y:auto;padding:14px;background:#f7f7f8}" +
      ".aics-msg{max-width:82%;margin-bottom:10px;padding:9px 12px;border-radius:12px;font-size:14px;" +
      "line-height:1.55;white-space:pre-wrap;word-break:break-word}" +
      ".aics-msg-bot{background:#fff;color:#1f2328;border:1px solid #e5e7eb;border-top-left-radius:4px}" +
      ".aics-msg-user{background:" + accent + ";color:#fff;margin-left:auto;border-top-right-radius:4px}" +
      ".aics-msg-thinking{color:#9ca3af;font-style:italic}" +
      ".aics-trace{font-size:11px;color:#9ca3af;margin:-6px 0 10px 2px}" +
      ".aics-handoff{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:13px;" +
      "padding:9px 12px;border-radius:10px;margin-bottom:10px;line-height:1.5}" +
      ".aics-handoff a{color:#9a3412;font-weight:600}" +
      ".aics-form{display:flex;border-top:1px solid #e5e7eb;background:#fff}" +
      ".aics-form input{flex:1;border:0;padding:13px 14px;font-size:14px;outline:none;background:transparent;color:#1f2328}" +
      ".aics-form button{border:0;background:none;color:" + accent + ";font-weight:600;padding:0 16px;" +
      "cursor:pointer;font-size:14px}" +
      "@media (max-width:420px){.aics-panel{height:calc(100vh - 120px);width:calc(100vw - 24px);right:12px}" +
      ".aics-panel.aics-left,.aics-bubble.aics-left{left:12px;right:auto}}";

    var el = document.createElement("style");
    el.id = "aics-style";
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* ============================ 界面 ============================ */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function mount(cfg) {
    if (typeof document === "undefined") { return null; }
    cfg = cfg || {};

    if (instance) { instance.destroy(); }
    injectStyles(cfg);

    var state = { kb: [], open: false, ready: false };

    var bubble = document.createElement("button");
    bubble.className = "aics-bubble" + (cfg.position === "left" ? " aics-left" : "");
    bubble.type = "button";
    bubble.setAttribute("aria-label", "打开客服");
    bubble.textContent = cfg.icon || "💬";

    var panel = document.createElement("div");
    panel.className = "aics-panel" + (cfg.position === "left" ? " aics-left" : "");
    panel.innerHTML =
      '<div class="aics-head"><span>' + esc(cfg.title || "客服") + "</span>" +
      '<button type="button" aria-label="关闭">×</button></div>' +
      '<div class="aics-body"></div>' +
      '<form class="aics-form"><input type="text" autocomplete="off" ' +
      'placeholder="' + esc(cfg.placeholder || "输入您的问题…") + '"><button type="submit">发送</button></form>';

    document.body.appendChild(bubble);
    document.body.appendChild(panel);

    var body = panel.querySelector(".aics-body");
    var form = panel.querySelector(".aics-form");
    var input = form.querySelector("input");

    function addMsg(role, text, extraClass) {
      var d = document.createElement("div");
      d.className = "aics-msg aics-msg-" + role + (extraClass ? " " + extraClass : "");
      d.innerHTML = esc(text);
      body.appendChild(d);
      body.scrollTop = body.scrollHeight;
      return d;
    }

    // 替换已存在的消息（用来把「稍等」换成真正的回答）
    function setMsg(el, text) {
      if (!el) { return; }
      el.className = "aics-msg aics-msg-bot";
      el.innerHTML = esc(text);
      body.scrollTop = body.scrollHeight;
    }

    function addTrace(text) {
      var d = document.createElement("div");
      d.className = "aics-trace";
      d.textContent = text;
      body.appendChild(d);
      body.scrollTop = body.scrollHeight;
    }

    function addHandoff() {
      var h = cfg.handoff || {};
      var parts = [];
      if (h.whatsapp) { parts.push('<a href="https://wa.me/' + esc(String(h.whatsapp).replace(/[^\d]/g, "")) + '" target="_blank" rel="noopener">WhatsApp</a>'); }
      if (h.email) { parts.push('<a href="mailto:' + esc(h.email) + '">发邮件</a>'); }
      if (h.liveChat) { parts.push('<a href="' + esc(h.liveChat) + '" target="_blank" rel="noopener">在线客服</a>'); }
      var tip = h.text || "需要人工帮您处理？";
      var line = parts.length ? tip + " " + parts.join(" · ") : tip;
      var d = document.createElement("div");
      d.className = "aics-handoff";
      d.innerHTML = line;
      body.appendChild(d);
      body.scrollTop = body.scrollHeight;
    }

    /* -------- 第二层：AI 兜底 -------- */

    function askAI(question) {
      var placeholder = addMsg("bot", cfg.thinkingText || "稍等，我看一下…", "aics-msg-thinking");

      var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) { ctrl.abort(); } }, cfg.aiTimeout || 12000);

      fetch(cfg.aiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question }),
        signal: ctrl ? ctrl.signal : undefined
      })
        .then(function (r) {
          if (!r.ok) { throw new Error("HTTP " + r.status); }
          return r.json();
        })
        .then(function (res) {
          clearTimeout(timer);
          if (!res || !res.answer) { throw new Error("返回格式不对"); }
          setMsg(placeholder, res.answer);
          if (cfg.showScore) { addTrace("AI 兜底 · " + (res.source || "model")); }
          if (res.handoff) { addHandoff(); }
          if (typeof cfg.onAI === "function") { try { cfg.onAI(res, question); } catch (e) {} }
        })
        .catch(function (err) {
          clearTimeout(timer);
          // 降级：AI 不可用就老老实实转人工，不丢消息、不白屏
          setMsg(placeholder, cfg.fallback || "这个问题我暂时答不上来，已经记下来了，稍后人工回复您。");
          if (cfg.showScore) { addTrace("AI 不可用 → 转人工（" + ((err && err.message) || err) + "）"); }
          addHandoff();
          if (typeof cfg.onAIError === "function") { try { cfg.onAIError(err, question); } catch (e) {} }
        });
    }

    /* -------- 主流程 -------- */

    function respond(text) {
      var clean = String(text || "").trim();
      if (!clean) { return; }

      addMsg("user", clean);

      // 知识库还没加载完：有 AI 后端就先交给它，否则提示等一会儿
      if (!state.ready) {
        if (cfg.aiEndpoint) { askAI(clean); return; }
        addMsg("bot", cfg.loadingText || "知识库还在加载，稍等一下再问一次。");
        return;
      }

      var r = match(clean, state.kb, { threshold: cfg.threshold });
      var e = r.entry;

      /* 第一层未命中 → 交给第二层 AI */
      if (!e) {
        if (cfg.aiEndpoint) {
          if (cfg.showScore) { addTrace("本地未命中（最高 " + r.score + "）→ 交给 AI"); }
          askAI(clean);
          return;
        }
        addMsg("bot", cfg.fallback || "这个问题我暂时答不上来，已经记下来了，稍后人工回复您。");
        addHandoff();
        return;
      }

      // 红线：标记为不可自动回复的，直接转人工，不给答案
      if (e.auto_reply === false) {
        addMsg("bot", cfg.handoffIntro || "这个问题需要人工来处理，我帮您转过去。");
        if (cfg.showScore) { addTrace("命中：" + (e.category || "-") + " · 匹配度 " + r.score); }
        addHandoff();
        return;
      }

      addMsg("bot", e.answer);
      if (cfg.showScore) {
        addTrace("命中：" + (e.id || "-") + " " + (e.category || "") + " · 匹配度 " + r.score);
      }

      // 半自动：先给答案，再提示可以转人工
      if (e.auto_reply === "handoff") { addHandoff(); }
    }

    function toggle(open) {
      state.open = open == null ? !state.open : open;
      if (state.open) { panel.classList.add("aics-open"); input.focus(); }
      else { panel.classList.remove("aics-open"); }
    }

    bubble.addEventListener("click", function () { toggle(); });
    panel.querySelector(".aics-head button").addEventListener("click", function () { toggle(false); });
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      respond(input.value);
      input.value = "";
    });

    addMsg("bot", cfg.greeting || "您好，有什么可以帮您？直接打字问就行。");

    var api = {
      version: VERSION,
      submit: respond,
      open: function () { toggle(true); },
      close: function () { toggle(false); },
      kbSize: function () { return state.kb.length; },
      setKB: function (kb) { state.kb = kb || []; state.ready = true; return state.kb.length; },
      getKB: function () { return state.kb; },
      setAIEndpoint: function (url) { cfg.aiEndpoint = url; return url; },
      destroy: function () {
        bubble.remove(); panel.remove();
        var st = document.getElementById("aics-style");
        if (st) { st.remove(); }
        instance = null;
      }
    };

    instance = api;

    var src = cfg.kb || cfg.kbUrl;
    if (src) {
      load(src).then(function (kb) {
        api.setKB(kb);
      }).catch(function (err) {
        // 知识库挂了：有 AI 后端还能用，没有才报错
        if (cfg.aiEndpoint) { state.ready = true; return; }
        addMsg("bot", "知识库加载失败：" + err.message + "。请检查 kbUrl 路径。");
      });
    }

    return api;
  }

  return {
    version: VERSION,
    normalize: normalize,
    tokens: tokens,
    grams: grams,
    scoreEntry: scoreEntry,
    match: match,
    query: function (text, kb, opts) { return match(text, kb, opts); },
    load: load,
    mount: mount,
    // 面板开关：转发到当前实例。没有实例时静默忽略，不抛错。
    open: function () { if (instance) { instance.open(); } },
    close: function () { if (instance) { instance.close(); } },
    // 提问：自动打开面板，免得调用方忘了先 open 而看不到回答
    ask: function (text) {
      if (!instance) { return; }
      instance.open();
      instance.submit(text);
    }
  };
});
