import { getMatchState } from "../lib/polymarket";

// A few known live/finished matches to sanity-check score parsing.
const slugs = [
  "atp-hubhur-tompau-2026-07-03", // "4-6, 7-6(7-5), 7-5, 6-2" period S4
  "atp-artfil-darbla-2026-03-20", // "6-2, 6-3" FT (Fils=long won both)
  "atp-mardam-alezve-2026-03-21", // "2-6, 4-6" (Damm=long lost)
];

for (const slug of slugs) {
  const s = await getMatchState(slug);
  console.log(`\n${slug}`);
  console.log(`  period=${s.period} completedSets=${s.completedSets}`);
  console.log(`  completed:`, s.completedSetScores.map((x) => `${x.long}-${x.short}`).join(", "));
  console.log(`  current:`, s.currentSet ? `${s.currentSet.long}-${s.currentSet.short}` : "none");
  const set1 = s.completedSetScores[0];
  if (set1) {
    console.log(`  long lost set1? ${set1.long < set1.short} (long got ${set1.long} games)`);
  }
}
