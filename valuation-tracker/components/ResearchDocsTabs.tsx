"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompanyDocMeta } from "@/lib/api";
import { staticDocUrl } from "@/lib/api";
import Markdown from "./Markdown";

const fmtSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

type Kind = "deep-read" | "annual-report";

/**
 * 公司原始文档浏览 — Tab 切换「年报精读 / 年报原文」，
 * 正文按需从构建期静态文件拉取（public/data/docs/<code>/<kind>/），长文档在限定高度内滚动。
 * 竞态防护：请求序号（切换 Tab/文件时丢弃过期响应）+ 加载前校验文件名属于当前 Tab 列表。
 */
export default function ResearchDocsTabs({
  thscode,
  deepReads,
  annualReports,
}: {
  thscode: string;
  deepReads: CompanyDocMeta[];
  annualReports: CompanyDocMeta[];
}) {
  const [tab, setTab] = useState<Kind>("deep-read");
  const [file, setFile] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 请求序号：每次发起加载递增；响应返回时序号不匹配则丢弃（防止旧 Tab 慢请求覆盖新 Tab 内容）
  const requestRef = useRef(0);

  // list 引用稳定化（避免三元表达式每次渲染生成新引用导致加载 effect 反复触发）
  const list = useMemo(
    () => (tab === "deep-read" ? deepReads : annualReports),
    [tab, deepReads, annualReports],
  );

  // 切换 Tab 后自动选中第一份文档
  useEffect(() => {
    setFile(list[0]?.fileName ?? null);
    setContent(null);
    setError(null);
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async (fileName: string) => {
    const reqId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      // 文档正文走构建期静态文件 public/data/docs/<code>/<kind>/<fileName>（按需 fetch）
      const res = await fetch(
        staticDocUrl(thscode, tab === "deep-read" ? "deep-reads" : "annual-reports", fileName),
      );
      if (reqId !== requestRef.current) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setContent(await res.text());
    } catch {
      if (reqId !== requestRef.current) return;
      setError("文档读取失败（静态文档不存在或构建期未生成）");
      setContent(null);
    }
    if (reqId === requestRef.current) setLoading(false);
  }, [thscode, tab]);

  // 选中文件时加载；文件名不属于当前 Tab 列表时跳过（避免 Tab 切换瞬间用旧文件名请求错误目录）
  useEffect(() => {
    if (file && list.some((d) => d.fileName === file)) load(file);
    else setContent(null);
  }, [file, load, list]);

  const total = deepReads.length + annualReports.length;
  if (total === 0) return null;

  return (
    <div className="card">
      <h3>研究报告原文</h3>
      <div className="doc-tabs">
        <button
          className={`doc-tab ${tab === "deep-read" ? "doc-tab-active" : ""}`}
          onClick={() => setTab("deep-read")}
        >
          年报精读{deepReads.length > 0 ? `（${deepReads.length}）` : ""}
        </button>
        <button
          className={`doc-tab ${tab === "annual-report" ? "doc-tab-active" : ""}`}
          onClick={() => setTab("annual-report")}
        >
          年报原文{annualReports.length > 0 ? `（${annualReports.length}）` : ""}
        </button>
        {list.length > 0 && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)" }}>
            按公司名自动匹配 · 共 {total} 份
          </span>
        )}
      </div>

      {list.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "12px 0" }}>
          {tab === "deep-read" ? "未匹配到该公司的年报精读文档。" : "未匹配到该公司的年报原文（pdf-texts）文档。"}
        </div>
      ) : (
        <div className="doc-layout">
          <div className="doc-filelist">
            {list.map((d) => (
              <button
                key={d.fileName}
                className={`doc-file ${file === d.fileName ? "doc-file-active" : ""}`}
                onClick={() => setFile(d.fileName)}
                title={d.fileName}
              >
                <span className="doc-file-name">{d.title ? `${d.date ?? ""} ${d.title}` : d.fileName}</span>
                <span className="doc-file-size">{fmtSize(d.sizeBytes)}</span>
              </button>
            ))}
          </div>
          <div className="doc-viewer">
            {error ? (
              <div style={{ color: "var(--accent-danger)", fontSize: 13 }}>{error}</div>
            ) : loading ? (
              <div className="status-bar"><span className="dot wait" />文档加载中…</div>
            ) : content ? (
              <Markdown source={content} className="note-body" />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
