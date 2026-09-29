# Evidence: the repair crew ran on Band

Captured 2026-09-29T21:51Z by Isaac's coding assistant. This file records one real run so teammates can
see what happened without a Band account.

## What this shows

Five separately registered Band agents coordinated the fictional job `JOB-001` in a Band chat
room, from the kickoff message to the final report.

| | |
|---|---|
| Platform | Band (app.band.ai), free plan, `@band-ai/sdk` 0.4.7 |
| Room | `7b8856bd-82e1-4a6b-ad59-e73c2071d305` |
| First message | 2026-09-29T21:36:12Z |
| Last message | 2026-09-29T21:37:01Z |
| Messages and thoughts captured | 18 |
| Code at | `codex/isaac-repair-coordination` |

## What was real and what was simulated

| Part | Status |
|---|---|
| Agent identities, room, @mention routing, message delivery | real, on Band |
| Agents joining and leaving the room | real, on Band |
| The critic's verdicts gating the order and the booking | real logic, real messages |
| Supplier quote and order | SIMULATED. Nothing was bought. |
| Message to the technician and to the manager | SIMULATED. Nobody was contacted. |
| The technician's acceptance | SIMULATED with `npm run band:accept`. |
| Schedule workbook update | SIMULATED stand-in, not the Excel adapter. |
| AI model | none. The agents follow fixed rules. |

No money was spent.

## How it was captured

The conversation was read from Band's Agent API (`GET /chats/<room>/context`) with each
agent's own key and merged by message id. `PartsSourcer` had left the room by then, so its
own view returned 404; its messages appear because other agents received them. Thoughts of
`PartsSourcer` that mentioned nobody are therefore missing.

Changes made to the text: the machine-readable block under each message was removed, mention
tokens were replaced by names, and the person's name was replaced by "Isaac".

## Conversation

```text
[2026-09-29T21:36:12Z] Isaac
    @RepairCoordinator coordinate JOB-001

[2026-09-29T21:36:15Z] RepairCoordinator (thought)
    Job JOB-001 on asset DEMO-A: 1 approved part(s), parts status not_ordered. Parts must be sourced first. Recruited: AuthorityCritic, PartsSourcer, TechDispatcher.

[2026-09-29T21:36:15Z] RepairCoordinator
    @PartsSourcer Source the approved parts for job JOB-001.

[2026-09-29T21:36:16Z] PartsSourcer
    @AuthorityCritic Verdict needed before I do this: Order 1 each of DEMO-PART-01 from Demo Supplier A for 125.00 USD.

[2026-09-29T21:36:16Z] AuthorityCritic (thought)
    Verdict on JOB-001-VRD-0001: approved.
    pass: the request is recorded for this job and still open
    pass: the request in the room matches the recorded request
    pass: the approval still covers the job
    pass: the approval names the current version
    pass: the simulated approval covers a simulated action
    pass: an authority is configured
    pass: the authority has not expired
    pass: the authority allows parts_order
    pass: the simulated authority covers a simulated action
    pass: the part is in the approved scope
    pass: the quantity is the approved quantity
    pass: the specification is the approved specification
    pass: the supplier is an allowed supplier
    pass: the supplier is not blocked by policy
    pass: the currency is the authority currency
    pass: the order fits the remaining authority

[2026-09-29T21:36:16Z] AuthorityCritic
    @PartsSourcer APPROVED JOB-001-VRD-0001. All 16 checks passed.

[2026-09-29T21:36:17Z] PartsSourcer
    @TechDispatcher Parts for job JOB-001 are ordered. The latest delivery estimate is 2026-09-30T21:36:17.352Z. Plan the appointment after it.

[2026-09-29T21:36:18Z] TechDispatcher
    @RepairCoordinator I offered 2026-09-30T22:36:17.352Z to Dana Demo for job JOB-001.

[2026-09-29T21:36:18Z] RepairCoordinator
    @Isaac Appointment offered to Dana Demo (job JOB-001).
    - Proposed: 2026-09-30T22:36:17.352Z to 2026-10-01T00:36:17.352Z.
    - Planned after the parts estimate 2026-09-30T21:36:17.352Z handed over by the parts specialist.
    - A reply is due by 2026-09-29T22:36:18.071Z.

[2026-09-29T21:36:57Z] Isaac
    @RepairCoordinator update JOB-001

[2026-09-29T21:36:57Z] RepairCoordinator (thought)
    Job JOB-001 is coordinating. Something changed, so the dispatcher looks at the appointment.

[2026-09-29T21:36:57Z] RepairCoordinator
    @TechDispatcher Job JOB-001 changed. Review the appointment.

[2026-09-29T21:36:58Z] TechDispatcher
    @AuthorityCritic Verdict needed before I do this: Confirm the booking with Dana Demo for 2026-09-30T22:36:17.352Z.

[2026-09-29T21:36:58Z] AuthorityCritic (thought)
    Verdict on JOB-001-VRD-0002: approved.
    pass: the request is recorded for this job and still open
    pass: the request in the room matches the recorded request
    pass: the approval still covers the job
    pass: the approval names the current version
    pass: the simulated approval covers a simulated action
    pass: an authority is configured
    pass: the authority has not expired
    pass: the authority allows booking
    pass: the simulated authority covers a simulated action
    pass: the technician was shortlisted from the approved roster
    pass: the technician accepted this appointment
    pass: the parts handoff was received
    pass: the appointment starts after the handed-over parts estimate

[2026-09-29T21:36:58Z] AuthorityCritic
    @TechDispatcher APPROVED JOB-001-VRD-0002. All 13 checks passed.

[2026-09-29T21:36:59Z] TechDispatcher (thought)
    ScheduleReporter could not join (ForbiddenError
    Status code: 403
    Body: {
      "error": {
        "code": "limit_reached",
        "message": "Participant limit reached for this chat room. Upgrade to add more.",
        "details": {
          "key": "max_chat_room_participants",
          "limit": 5,
          "current": 5
        },
        "request_id": "de6a1f60587c1ee124548fd078e088b5"
      }
    }). PartsSourcer has finished its work and leaves the room to free a seat.

[2026-09-29T21:37:00Z] TechDispatcher
    @ScheduleReporter Job JOB-001 is booked with Dana Demo for 2026-09-30T22:36:17.352Z. Update the schedule and report.

[2026-09-29T21:37:01Z] ScheduleReporter
    @Isaac Job JOB-001 is scheduled and published. Recommendation: no action is needed.
    - Status: scheduled. Parts: ordered.
    - Technician: Dana Demo, 2026-09-30T22:36:17.352Z to 2026-10-01T00:36:17.352Z (confirmed).
    - Schedule workbook: updated (simulated).
    - Manager update: sent (simulated).
```

## Job state after the run

Read from the local job store.

| Field | Value |
|---|---|
| Runtime | band |
| Status | scheduled |
| Parts | ordered |
| Booking | confirmed with Dana Demo |
| Parts estimate handed over | 2026-09-30T21:36:17.352Z |
| Appointment start | 2026-09-30T22:36:17.352Z |

Verdicts:

| Request | Action | Verdict | Decided by |
|---|---|---|---|
| `JOB-001-VRD-0001` | parts_order | approved | AuthorityCritic |
| `JOB-001-VRD-0002` | booking | approved | AuthorityCritic |

Action receipts:

| Action | Status | Mode |
|---|---|---|
| supplier_quote | confirmed | simulated |
| parts_order | confirmed | simulated |
| technician_contact | confirmed | simulated |
| booking | confirmed | simulated |
| schedule_sync | confirmed | simulated |
| manager_notify | confirmed | simulated |

## Check it yourself without Band

```bash
git fetch origin
git switch --track origin/codex/isaac-repair-coordination
cd packages/coordination
npm install --no-package-lock
npm test            # 26 tests
npm run demo        # baseline runtime, no Band
npm run band:demo   # the same crew in a simulated room
```

`npm run band:demo` also shows the critic blocking a purchase. That path has not been run on
Band itself.

## Limits of this evidence

- One flow ran on Band: kickoff to booking and report.
- It is a text record. Band itself is the source; this file is a copy.
- It does not show the coordinator working with the Excel, analysis or intake packages.
