import { readFileSync } from "node:fs";
import matter from "gray-matter";

const c = readFileSync("../Research/10-Knowledge/01-新能源/02-公司研究/宁德时代-公司研究.md", "utf-8");
const { data } = matter(c);
console.log("research_cutoff raw:", JSON.stringify(data.research_cutoff));
console.log("target raw:", JSON.stringify(data.target_market_cap_yi));
console.log("forward raw:", JSON.stringify(data.forward_pe));
