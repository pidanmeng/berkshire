import Dashboard from "@/components/Dashboard";
import { readStaticCompanies } from "@/lib/static-data";

export default function HomePage() {
  // SSG：构建期读取静态 JSON（generate-static-data 产物），不再依赖后端 /api/companies
  // list + docsIndex 一次性注入 Dashboard：内嵌看板点击公司时直接复用，零客户端全量请求
  const data = readStaticCompanies();
  const initial = { list: data?.list ?? [], docsIndex: data?.docsIndex ?? {}, fetchedAt: 0 };

  return (
    <div className="page-wrapper page-wrapper-wide">
      <Dashboard initial={initial} />
    </div>
  );
}
