// 把 vite 构建结果打包成一个独立的 HTML 文件（release/level-layout-designer.html），
// 双击就能在浏览器里打开，也可以直接发布成在线网页。先运行 `npm run build`。
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";

const js = readdirSync("dist/assets").filter((f) => f.endsWith(".js"));
if (js.length !== 1) throw new Error("dist/assets 里应该正好有一个 .js 文件，请先运行 npm run build");
const script = readFileSync(`dist/assets/${js[0]}`, "utf8").replace(/<\/script/gi, "<\\/script");
const css = readFileSync("src/style.css", "utf8");
const html = readFileSync("index.html", "utf8");
const body = html.slice(html.indexOf("<canvas"), html.indexOf("<script"));

mkdirSync("release", { recursive: true });
writeFileSync(
  "release/level-layout-designer.html",
  `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>关卡 Layout 设计器</title>
<style>
:root { color-scheme: dark; }
${css}</style>
</head>
<body>
${body}<script type="module">
${script}
</script>
</body>
</html>
`,
);
console.log("已生成 release/level-layout-designer.html");
