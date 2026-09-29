# Product scope: inspection to completed repair

Working name: ThermalDesk. This is an implementation proposal, not a built application or validated business. The team can refine the name and customer positioning without removing either workflow.

## Customer and purchase reason

Initial customer hypothesis: commercial electrical service companies that both inspect and repair equipment. The buyer is the operations manager. The product should reduce coordination work and help the company complete approved repairs. Willingness to pay and actual time savings still require customer interviews and a paid pilot; no revenue, diagnostic accuracy, or investment commitment is claimed.

## Both workflows are required

1. Thermal images, equipment history, and technician voice notes become traceable inspection evidence. AI assists with findings and proposed next steps. A qualified person reviews the evidence and approves the exact repair scope and part specifications.
2. That approval becomes an active repair job. The system sources specified parts, contacts qualified technicians from the company's roster, confirms availability and delivery, books the work, updates an actual Excel schedule, and informs the manager. It follows cancellations and delays, gathers receipts, photos and completion comments, compares them with the original scope, and records a qualified verification decision before closure. The final report includes unresolved items and feeds the equipment history.

## First usable demonstration

One contractor, one site, one equipment asset, one repair, one schedule workbook, one report. Show the whole loop and one disruption. Use fictional data; use an authorized teammate for real recording or test communications. The first fixtures deliberately lack radiometric data, so the analysis must request more information instead of inventing a diagnosis. A separate clearly labeled synthetic approval allows the execution workflow to be demonstrated without pretending the incomplete inspection was professionally approved.

The product's distinction to test is continuity: each finding remains connected to the approved scope, parts, technician, appointment, actual action outcomes, and completion evidence. Generic AI summaries alone do not deliver that value. Competitive differentiation is not yet established.

## Scope boundaries

- Crusoe is the selected inference integration. Plaud supplies field recordings/transcripts; it is not the outbound calling provider.
- A persistent job store, evidence storage, review gates, technician/parts adapters, workbook writes, and a report are necessary for this product.
- BAND and Neo4j are optional and deferred unless the core loop works and the team deliberately adds them. No artificial heavy-compute workload is required.
- No autonomous electrical certification, invented part sizing, public technician marketplace, ERP replacement, mobile SDK application, model training, or multi-site optimization in the first build.
- A real purchase or call requires configured, explicit authority. The coding prompts do not authorize transactions or contacting unrelated people.

## Evidence needed after the demo

Interview the buyer about their last actual inspection-to-repair job. Measure coordination time, waiting time, incomplete jobs, and repeated spreadsheet entry using their records. Seek a scoped paid pilot and compare those measures before/after. Treat pricing and ROI as hypotheses until supported.
