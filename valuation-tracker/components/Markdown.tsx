/**
 * 轻量 Markdown 渲染器（服务端组件，无外部依赖）
 * 支持：标题 / 表格 / 无序有序列表 / 引用 / 代码块 / 行内样式（粗体 斜体 行内代码 链接）/ 分隔线
 * 内容为内部研究笔记，仍做 HTML 转义以防意外注入。
 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 行内样式：**粗体** _斜体_ `代码` [文本](url) [[双链]] */
function inline(text: string): string {
  let out = esc(text);
  out = out.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, (_m, p1: string) => `<code>${esc(p1)}</code>`);
  out = out.replace(/`([^`]+)`/g, (_m, p1: string) => `<code>${esc(p1)}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return out;
}

/** 解析表格行 → HTML 片段 */
function renderTable(lines: string[], i: number): { html: string; next: number } {
  const rows: string[][] = [];
  while (i < lines.length && lines[i].trim().startsWith("|")) {
    const cells = lines[i]
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => inline(c.trim()));
    // 跳过对齐分隔行 |---|:---:|
    if (!cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/<[^>]*>/g, "")))) {
      rows.push(cells);
    }
    i++;
  }
  const head = rows[0] ?? [];
  const body = rows.slice(1);
  let html = "<table><thead><tr>";
  for (const h of head) html += `<th>${h}</th>`;
  html += "</tr></thead><tbody>";
  for (const r of body) {
    html += "<tr>";
    for (let k = 0; k < head.length; k++) html += `<td>${r[k] ?? ""}</td>`;
    html += "</tr>";
  }
  html += "</tbody></table>";
  return { html, next: i };
}

/** 解析若干行 → HTML 字符串（供 dangerouslySetInnerHTML 使用） */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    // 代码块
    if (t.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 跳过结束 ``` 
      html.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    // 标题
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    // 表格
    if (t.startsWith("|")) {
      const r = renderTable(lines, i);
      html.push(r.html);
      i = r.next;
      continue;
    }
    // 分隔线
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      html.push("<hr />");
      i++;
      continue;
    }
    // 引用块
    if (t.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        buf.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      html.push(`<blockquote>${inline(buf.join("\n"))}</blockquote>`);
      continue;
    }
    // 无序列表
    if (/^[-*]\s+/.test(t)) {
      const buf: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        buf.push(inline(lines[i].trim().replace(/^[-*]\s+/, "")));
        i++;
      }
      html.push(`<ul>${buf.map((x) => `<li>${x}</li>`).join("")}</ul>`);
      continue;
    }
    // 有序列表
    if (/^\d+\.\s+/.test(t)) {
      const buf: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        buf.push(inline(lines[i].trim().replace(/^\d+\.\s+/, "")));
        i++;
      }
      html.push(`<ol>${buf.map((x) => `<li>${x}</li>`).join("")}</ol>`);
      continue;
    }
    // 空行
    if (t === "") {
      i++;
      continue;
    }
    // 普通段落（合并到空行）
    const buf: string[] = [inline(t)];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,4}\s|\||```|>|[-*]\s|\d+\.\s)/.test(lines[i].trim())) {
      buf.push(inline(lines[i].trim()));
      i++;
    }
    html.push(`<p>${buf.join("<br />")}</p>`);
  }
  return html.join("\n");
}

export default function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={className} dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} />
  );
}
