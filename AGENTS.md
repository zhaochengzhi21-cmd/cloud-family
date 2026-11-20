# Agent channel (云族谱 Closed Alpha)

When helping a user fill or tidy a family archive via API:

1. Discover work with `GET /api/v1/families/{familyId}/agent` (optional `?since=` / `?limit=`) — follow `playbook` when present.
2. Prefer `POST …/agent/propose` for a full OCR/page extract (people + edges + facts + optional evidence). Use batch endpoints if only one section is needed.
3. Always use `originType: AI_EXTRACTION` or `IMPORT` for drafts. Creates are **待确认 (PROPOSED)** — never call accept / `claims/review-batch` unless the **human** explicitly asked to confirm.
4. Send `Idempotency-Key` on retries and optional `X-Client-Agent` (e.g. `cursor`) for audit.
5. Product language only toward end users: 人物资料 / 资料来源 / 智能整理 / 不同说法 — never expose model names or Claim jargon.
6. Do not invent 资料来源; attach real evidence or leave unsourced for a human.
7. After proposing, poll `/agent?since=` for `recentDecisions`; do not invent acceptances.

Humans confirm from the overview (**确认 N 条智能整理** / **不采用这些**) or the records tab.
