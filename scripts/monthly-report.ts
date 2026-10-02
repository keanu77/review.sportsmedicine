import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { uniquePapers, sourceInput } from '../src/identity.ts';
import { enrichItems, createBibliographyIndex } from '../src/enrich.ts';
import type { ReviewsData, BibliographyData } from '../src/types.ts';
import { buildOverlayHealth, readOverlay, readOverlayBaseline } from './overlay-health.ts';
// `maintenance` writes its own file; the day-1 sync report stays the month's data baseline.
const mode = process.argv[2] === 'maintenance' ? 'maintenance' : 'sync';
const data: ReviewsData = JSON.parse(await readFile('public/data/reviews-index.json', 'utf8'));
const bibliography: BibliographyData = JSON.parse(await readFile('public/data/bibliography.json', 'utf8'));
const now = new Date(), month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).slice(0, 7);
const lookup = createBibliographyIndex(bibliography.records);
const items = uniquePapers(enrichItems(data.items, {}, {}, lookup));
const missingAuthors = items.filter(item => !item.authors?.length).length;
const missingIds = items.filter(item => !sourceInput(item)).length;
const [summaries, tags] = await Promise.all([readOverlay('summaries'), readOverlay('tags')]);
const previousMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
const previous = await readFile(`docs/maintenance/${previousMonth}.md`, 'utf8').catch(() => '');
const health = buildOverlayHealth(data.items, lookup, summaries, tags, data.meta.updated, readOverlayBaseline(previous));
const report = `# Review monthly maintenance — ${month}\n\nChecked at: ${now.toISOString()}\n\n- Upstream literature date: ${data.meta.updated}\n- Unique papers: ${items.length}\n- Papers with authors: ${items.length - missingAuthors}\n- Papers missing usable identifiers: ${missingIds}\n- Papers missing authors: ${missingAuthors}\n\n## Recurring work\n\n- Day 1 at 03:00 Asia/Taipei (catch-up at 12:00 and day 2 at 01:00 if upstream is late): validate this month's upstream literature, preserve bibliography overlay, refresh newly available citations (a Europe PMC outage publishes the verified part and retries the rest next run), test and publish.\n- Day 2 at 03:00 Asia/Taipei: update dependencies within declared compatible ranges, test and build, audit all dependencies including build tools, then publish allowlisted passing updates in a separate minimal job.\n- Every run retains logs and artifacts in GitHub Actions, including failures.\n\n## Follow-up priorities\n\n${missingIds ? `- Manually resolve ${missingIds} papers without safe identifiers; title-only guesses must not be published.\n` : ''}${missingAuthors ? `- Verify missing author metadata for ${missingAuthors} papers from primary records.\n` : ''}- Review browser regression failures and dependency advisories in this run before any manual retry.\n- Layout redesigns and medical conclusions require a separate scoped implementation; this schedule performs measurable maintenance.\n\nThis report contains public index statistics only. It does not access private workbench jobs, drafts, files, model credentials or analytics.\n`;
await mkdir('docs/maintenance', { recursive: true });
const fullReport = `${report}\n${health.markdown}`;
// Must match reportFile() in monthly-bundle.mjs, which only publishes these names.
await writeFile(`docs/maintenance/${month}${mode === 'maintenance' ? '-maintenance' : ''}.md`, fullReport);
console.log(fullReport);
