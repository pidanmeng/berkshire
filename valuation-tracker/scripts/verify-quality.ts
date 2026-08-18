import { loadCompanies } from "../server/lib/research";

const companies = await loadCompanies(true);
let green = 0, yellow = 0, red = 0, none = 0;
for (const c of companies) {
  const v = c.qualityVerdict;
  if (v === "GREEN") green++;
  else if (v === "YELLOW") yellow++;
  else if (v === "RED") red++;
  else none++;
  console.log(`${v ?? "NULL".padEnd(4)}  score=${c.qualityScore ?? "NULL"}  ${c.name}`);
}
console.log(`\nGREEN=${green} YELLOW=${yellow} RED=${red} NULL=${none}`);