// Read-only analysis of captured provider output. Never calls an external API.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const directory = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Pass the evaluation output directory.');
const rows = (await readFile(join(directory, 'requests.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const categories = [...new Set(rows.map(row => row.category))];
const quality = categories.map(category => {
  const samples = rows.filter(row => row.category === category);
  return { category, calls: samples.length,
    findings_citing_nonimage_evidence: samples.filter(row => row.recommendation.findings.some(finding => finding.evidence_ids.some(id => id !== 'EV-IMAGE'))).length,
    findings_citing_measurements: samples.filter(row => row.recommendation.findings.some(finding => finding.evidence_ids.includes('EV-MEASURE'))).length,
    findings_citing_followup: samples.filter(row => row.recommendation.findings.some(finding => finding.evidence_ids.includes('EV-FOLLOWUP'))).length };
});
const audit = { scope: 'Deterministic citation coverage audit of saved drafts. Not an electrical-accuracy score.', calls: rows.length,
  quality, limitations: [
    'Schema validity, known source IDs and application approval gates do not establish semantic completeness or diagnostic accuracy.',
    'All images and measurements are synthetic. No customer traffic, actual repairs, purchases or professional reviews are represented.',
    'Completion checks in the main report are local deterministic checks, not extra Crusoe calls.',
    'An omitted citation is a review signal; it does not by itself prove that the model ignored every part of the associated evidence.',
  ], next_action: 'Review drafts for omitted measurement and follow-up findings before claiming full multimodal evidence coverage. Test a prompt that explicitly requests separate findings for image, measurement and note evidence.' };
await writeFile(join(directory, 'quality-audit.json'), JSON.stringify(audit, null, 2));
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const reportPath = join(directory, 'report.html');
const report = await readFile(reportPath, 'utf8');
const section = `<section id="quality-audit"><h2>Evidence coverage: review needed</h2><p>Passing the structural checks does not establish a complete analysis. This audit counts which supplied sources the returned findings actually cite.</p><table><tr><th>Scenario</th><th>Calls</th><th>Non-image citations</th><th>Measurement citations</th><th>Follow-up citations</th></tr>${quality.map(row => `<tr><td>${escape(row.category)}</td><td>${row.calls}</td><td>${row.findings_citing_nonimage_evidence}</td><td>${row.findings_citing_measurements}</td><td>${row.findings_citing_followup}</td></tr>`).join('')}</table><p>${escape(audit.next_action)}</p><ul>${audit.limitations.map(item => `<li>${escape(item)}</li>`).join('')}</ul></section>`;
await writeFile(reportPath, report.replace(/<section id="quality-audit">[\s\S]*?<\/section>/, '').replace('</html>', `${section}</html>`));
console.log(JSON.stringify(audit));
