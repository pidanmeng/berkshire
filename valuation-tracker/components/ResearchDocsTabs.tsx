"use client";

import { useCallback, useEffect, useState } from "react";
import type { CompanyDocMeta } from "@/lib/api";
import { getCompanyDoc } from "@/lib/api";
import Markdown from "./Markdown";

const fmtSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

type Kind = "deep-read" | "annual-report";

/**
 * 公司原始文档浏览 — Tab 切换「年报精读 / 年报原文」，
 * 正文按需（选择文件时）从后端拉取，长文档在限定高度内滚动。
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

  const list = tab === "deep-read" ? deepReads : annualReports;

  // 切换 Tab 后自动选中第一份文档
  useEffect(() => {
    const first = list[0]?.fileName ?? null;
    setFile(first);
    setContent(null);
    setError(null);
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async (fileName: string) => {
    setLoading(true);
    setError(null);
    try {
      const doc = await getCompanyDoc(thscode, tab, fileName);
      setContent(doc.content);
    } catch {
      setError("文档读取失败（Elysia 后端不可达或文件不存在）");
      setContent(null);
    }
    setLoading(false);
  }, [thscode, tab]);

  useEffect(() => {
    if (file) load(file);
    else setContent(null);
  }, [file, load]);

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
