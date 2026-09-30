# Bounded Crusoe evaluations

These are synthetic product evaluations, not real customer inspections or a diagnostic benchmark. Keep live requests disabled unless the user separately authorizes a specific run and budget. Existing keys are not spending authority.

`crusoe-eval.mjs` exercises the existing analysis adapter against ten categories: stated measurements, absent measurements, unknown load, contradictory notes, untrusted instructions, incomplete follow-up, claimed improvement, textual asset conflict, unknown units, and equipment history. Variants change stated measurements, load and synthetic image location. The input numbers and images are clearly fictional.

Offline preparation:

```powershell
node --experimental-strip-types apps/web/scripts/crusoe-eval.mjs --dry-run --calls=10 --seconds=2
```

An explicitly authorized run loads the existing ignored local configuration into its child process. Do not change the application's environment file:

```powershell
$env:CRUSOE_LIVE_REQUESTS_ENABLED='true'
node --env-file=apps/web/.env.local --experimental-strip-types apps/web/scripts/crusoe-eval.mjs --allow-billable-request --calls=180 --seconds=450 --budget=2.50 --prior-spend=0
$env:CRUSOE_LIVE_REQUESTS_ENABLED='false'
```

Budget is per invocation. Include all earlier calls in the same authorization as `--prior-spend`; do not start multiple runners against the same budget. The runner caps each response, sends sequential paced requests, reserves a conservative input/output amount before sending, and stops on deadline, budget, provider errors, missing usage or case limit. It does not automatically retry failed paid requests. Pricing is fixed for the documented model and must be rechecked before a future run at <https://www.crusoe.ai/cloud/pricing>. Estimated usage cost is not an invoice.

Outputs live under ignored `artifacts/crusoe-evaluation/<UTC timestamp>/`: original synthetic images, `requests.jsonl` with inputs/drafts/provider IDs/usage, `summary.json`, and a shareable `report.html`. No key, header or private customer information is written. The adapter source hash identifies the code actually evaluated, including any pre-existing uncommitted local prompt changes.

After the run, audit citation coverage without another provider call:

```powershell
node apps/web/scripts/summarize-crusoe-eval.mjs artifacts/crusoe-evaluation/<UTC timestamp>
```

The four primary checks cover schema validity, known evidence IDs, application review gates and provider success. They are **not semantic accuracy checks**. The second report section counts measurement and note citations to expose omissions. The separately reported completion checks run locally; they must not be described as Crusoe API calls. All resulting recommendations remain drafts/needs-information; this tool never calls suppliers, books technicians, updates the running case or approves closure.
