// 匹配引擎自测 —— 用 examples/test-cases.md 里的 20 个模拟买家问题跑一遍
//
// 运行：node selftest.js
// 用途：改完知识库或匹配逻辑后，先跑这个，再上线。
//      它会告诉你：哪些问题机器能答、哪些会转人工、有没有踩红线。

const path = require("path");
const A = require(path.join(__dirname, "chat-widget.js"));
const kb = require(path.join(__dirname, "knowledge-base.example.json"));

const CASES = [
  ["1  催单", "Where is my order?"],
  ["2  超期抱怨", "it's been 3 weeks and nothing. this is ridiculous"],
  ["3  中文问物流", "我的货到哪了？都两周了"],
  ["4  全大写", "WHEN WILL MY PACKAGE ARRIVE"],
  ["5  威胁差评", "This is a scam. I'm reporting you and leaving 1 star."],
  ["6  愤怒", "terrible service, never buying again!!!"],
  ["7  中文投诉", "你们就是骗子，我要投诉"],
  ["8  要退款", "I want a refund"],
  ["9  退款到账", "how long does the refund take to show up in my account?"],
  ["10 货损", "It arrived broken. What are you going to do about it?"],
  ["11 退货运费", "我要退货，运费谁出？"],
  ["12 发沙特", "Do you ship to Saudi Arabia?"],
  ["13 尺寸", "Will this fit a 65 inch TV?"],
  ["14 货到付款", "支持货到付款吗"],
  ["15 兼容性", "does it work with iPhone 15 pro max"],
  ["16 散装英语", "helo i want buy ship to malaysia can?"],
  ["17 阿语", "هل الدفع عند الاستلام متاح؟"],
  ["18 西语", "¿Hacen envíos a México?"],
  ["19 要求保证日期", "Can you guarantee it will arrive before Dec 25?"],
  ["20 要折扣", "If I order now, do I get a discount?"]
];

// 这几类问题永远不许机器自己拍板
const NEVER_AUTO = /refund|guarantee|discount|退款|保证|折扣|投诉|scam|reporting/i;

let auto = 0, handoff = 0, miss = 0;
const redLines = [];

console.log("序号  处理方式          得分  命中条目     客户原话");
console.log("-".repeat(112));

for (const [label, text] of CASES) {
  const r = A.match(text, kb, { threshold: 42 });
  const e = r.entry;

  let kind, tag;
  if (!e) { kind = "转人工(未命中)"; tag = "—"; miss++; }
  else if (e.auto_reply === false) { kind = "转人工(拦截)"; tag = e.id + " " + e.category; handoff++; }
  else if (e.auto_reply === "handoff") { kind = "答+转人工"; tag = e.id + " " + e.category; handoff++; }
  else { kind = "自动作答"; tag = e.id + " " + e.category; auto++; }

  if (e && e.auto_reply === true && NEVER_AUTO.test(text)) { redLines.push(label + " → " + e.id); }

  console.log(label.padEnd(6) + kind.padEnd(18) + String(r.score).padStart(4) + "  " +
    tag.padEnd(13) + text);
}

console.log("-".repeat(112));
console.log("自动作答 " + auto + " 条 ｜ 转人工 / 半自动 " + handoff + " 条 ｜ 未命中 " + miss + " 条");

if (redLines.length) {
  console.log("❌ 红线告警：以下问题被机器自动作答了，必须改成 false 或 handoff ——");
  redLines.forEach(function (x) { console.log("   · " + x); });
  process.exitCode = 1;
} else {
  console.log("✅ 红线检查通过：退款 / 保证日期 / 折扣 / 投诉类问题，无一被自动作答。");
}
