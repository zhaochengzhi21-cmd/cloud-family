/**
 * Closed Alpha E2E seeded with public 西递明经胡氏 sample facts.
 * Disposable family only — not private living-person data.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  requireV1Env,
  insertFakeUser,
  insertMembership,
  loginAs,
  cleanupAllV1TestData,
  tableCounts,
  closeDb,
  apiJson,
  trackMedia,
} from "./helpers/v1";
import { MINGJING_HU_SAMPLE } from "./fixtures/mingjing-hu";

test.beforeAll(() => {
  requireV1Env();
});

test.afterAll(async () => {
  try {
    await cleanupAllV1TestData();
    const counts = await tableCounts();
    const nonzero = Object.entries(counts).filter(([, n]) => n !== 0);
    if (nonzero.length) {
      throw new Error(
        `cleanup leftover: ${JSON.stringify(Object.fromEntries(nonzero))}`
      );
    }
  } finally {
    try {
      await closeDb();
    } catch {
      /* ignore */
    }
  }
});

type SeedClaim = {
  claimType: string;
  text: string;
  narrator?: string;
};

async function createFamily(
  page: Page,
  baseURL: string,
  displayName: string,
  surname: string
) {
  const ownerId = await insertFakeUser();
  await loginAs(page, ownerId, baseURL);
  await page.goto("/alpha/families");
  await page.getByRole("button", { name: /创建第一个家族档案|创建家族档案/ }).click();
  await page.getByLabel("家族名称 *").fill(displayName);
  await page.getByLabel("姓氏（可选）").fill(surname);
  const createResp = page.waitForResponse(
    (r) =>
      r.url().includes("/api/v1/families") &&
      r.request().method() === "POST" &&
      !r.url().includes("/persons")
  );
  await page.getByRole("button", { name: "创建" }).click();
  expect((await createResp).ok(), "create family API").toBeTruthy();
  await expect(page).toHaveURL(/\/alpha\/families\/[0-9a-f-]{36}/i, {
    timeout: 60_000,
  });
  return page.url().split("/").pop()!;
}

async function createFamilyOwned(
  page: Page,
  baseURL: string,
  displayName: string,
  surname: string
) {
  const ownerId = await insertFakeUser();
  await loginAs(page, ownerId, baseURL);
  await page.goto("/alpha/families");
  await page.getByRole("button", { name: /创建第一个家族档案|创建家族档案/ }).click();
  await page.getByLabel("家族名称 *").fill(displayName);
  await page.getByLabel("姓氏（可选）").fill(surname);
  const createResp = page.waitForResponse(
    (r) =>
      r.url().includes("/api/v1/families") &&
      r.request().method() === "POST" &&
      !r.url().includes("/persons")
  );
  await page.getByRole("button", { name: "创建" }).click();
  expect((await createResp).ok(), "create family API").toBeTruthy();
  await expect(page).toHaveURL(/\/alpha\/families\/[0-9a-f-]{36}/i, {
    timeout: 60_000,
  });
  return { familyId: page.url().split("/").pop()!, ownerId };
}

async function seedPerson(
  page: Page,
  familyId: string,
  person: {
    preferredName: string;
    gender: string;
    livingStatus: string;
  },
  claims: readonly SeedClaim[]
) {
  const personRes = await apiJson(page, `/api/v1/families/${familyId}/persons`, {
    method: "POST",
    body: {
      preferredName: person.preferredName,
      gender: person.gender,
      livingStatus: person.livingStatus,
      privacyLevel: "INHERIT",
    },
  });
  expect(personRes.status, JSON.stringify(personRes.body)).toBe(201);
  const personId = (personRes.body as { person: { id: string } }).person.id;

  for (const c of claims) {
    const value =
      c.claimType === "STORY" && c.narrator
        ? { text: c.text, narrator: c.narrator }
        : { text: c.text };
    const created = await apiJson(page, `/api/v1/families/${familyId}/claims`, {
      method: "POST",
      body: {
        subjectType: "PERSON",
        subjectId: personId,
        claimType: c.claimType,
        value,
        originType: "MANUAL",
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const claimId = (created.body as { claim: { id: string } }).claim.id;
    const accepted = await apiJson(
      page,
      `/api/v1/families/${familyId}/claims/${claimId}/accept`,
      { method: "POST", body: {} }
    );
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  }
  return personId;
}

test("明经胡氏公开史料：人物页生平显示祖籍与职业", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    sample.familyDisplayName,
    sample.surname
  );

  const wg = sample.wenGuang;
  const personId = await seedPerson(page, familyId, wg, wg.claims);

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: wg.preferredName })
  ).toBeVisible({ timeout: 60_000 });

  const life = page.getByRole("region", { name: "生平" });
  await expect(life.getByRole("heading", { name: "出生" })).toBeVisible();
  await expect(life.getByText("约明嘉靖年间")).toBeVisible();
  await expect(life.getByText("安徽黟县西递")).toBeVisible();

  await expect(life.getByRole("heading", { name: "辈分" })).toBeVisible();
  await expect(life.getByText("文")).toBeVisible();

  await expect(life.getByRole("heading", { name: "祖籍" })).toBeVisible();
  await expect(life.getByText("江西婺源考水")).toBeVisible();

  await expect(life.getByRole("heading", { name: "职业" })).toBeVisible();
  await expect(life.getByText("万载知县，后升胶州刺史")).toBeVisible();

  await expect(life.getByRole("heading", { name: "字号" })).toBeVisible();
  await expect(life.getByRole("button", { name: "补充字号" })).toBeVisible();
  await life.getByRole("button", { name: "补充字号" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(personId);
  await expect(page.locator("#claim-type")).toHaveValue("ALIAS", {
    timeout: 15_000,
  });
  await expect(page.locator("#claim-text")).toBeFocused();
  await page.getByRole("button", { name: "收起" }).click();

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: wg.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  const life2 = page.getByRole("region", { name: "生平" });
  await expect(life2.getByRole("heading", { name: "去世" })).toBeVisible();
  await expect(life2.getByText("约明万历年间")).toBeVisible();
  await expect(life2.getByText("未记录")).toHaveCount(0);
  await expect(life2.getByRole("button", { name: "补充安葬地" })).toBeVisible();
  await life2.getByRole("button", { name: "补充安葬地" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(personId);
  await expect(page.locator("#claim-type")).toHaveValue("BURIAL_PLACE", {
    timeout: 15_000,
  });
  await expect(page.locator("#claim-text")).toBeFocused();

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: wg.preferredName })
  ).toBeVisible({ timeout: 60_000 });

  const facts = page.getByRole("region", { name: "档案" });
  await expect(facts.getByText("文")).toBeVisible();
  await expect(facts.getByText("万载知县，后升胶州刺史")).toBeVisible();
  await expect(facts.getByText("未记录")).toHaveCount(0);

  await expect(page.getByText(/文光刺史美名扬/)).toBeVisible();

  const stories = page.getByRole("region", { name: "故事与口述" });
  await expect(stories.getByText(/文光刺史美名扬/)).toBeVisible();
  await expect(stories.getByText("讲述：据西递口碑整理")).toBeVisible();
  await expect(
    stories.getByRole("button", { name: "再添一段故事" })
  ).toBeVisible();
});

test("明经胡氏：人物页空录音区直达口述来源表单", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·空录音（测试）",
    sample.surname
  );

  const personId = await seedPerson(page, familyId, sample.guanSan, [
    { claimType: "BIRTH_DATE", text: "约清乾隆年间" },
  ]);

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: sample.guanSan.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  const audios = page.getByRole("region", { name: "口述录音" });
  await expect(audios.getByRole("button", { name: "补充录音" })).toBeVisible();
  await audios.getByRole("button", { name: "补充录音" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(personId);
  await expect(page.getByRole("button", { name: "保存来源" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator("#ev-type")).toHaveValue("ORAL_HISTORY");
});

test("明经胡氏：人物页空照片区直达照片来源表单", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·空照片（测试）",
    sample.surname
  );

  const personId = await seedPerson(page, familyId, sample.guanSan, [
    { claimType: "BIRTH_DATE", text: "约清乾隆年间" },
  ]);

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: sample.guanSan.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  const photos = page.getByRole("region", { name: "照片" });
  await expect(photos.getByRole("button", { name: "补充照片" })).toBeVisible();
  await photos.getByRole("button", { name: "补充照片" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(personId);
  await expect(page.getByRole("button", { name: "保存来源" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator("#ev-type")).toHaveValue("PHOTO");
});

test("明经胡氏：字辈表单可从行辈歌取字", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·行辈歌（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.yuanXi,
    sample.yuanXi.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  await page.getByRole("button", { name: "+ 添加人物资料" }).click();
  await page.locator("#claim-type").selectOption("GENERATION_WORD");
  await page
    .getByRole("button", { name: "粘贴行辈歌，从中取一字" })
    .click();
  await page
    .locator("#generation-song")
    .fill(sample.generationSongSnippet);
  await expect(page.getByRole("group", { name: "行辈歌字" })).toBeVisible();
  await page.getByRole("group", { name: "行辈歌字" }).getByRole("button", { name: "清" }).click();
  await expect(page.locator("#claim-text")).toHaveValue("清");
});

test("明经胡氏：概览待确认直达对应资料卡片", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·待确认（测试）",
    sample.surname
  );

  const personId = await seedPerson(page, familyId, sample.wenGuang, []);
  const created = await apiJson(page, `/api/v1/families/${familyId}/claims`, {
    method: "POST",
    body: {
      subjectType: "PERSON",
      subjectId: personId,
      claimType: "OCCUPATION",
      value: { text: "万载知县，后升胶州刺史" },
      originType: "MANUAL",
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const claimId = (created.body as { claim: { id: string } }).claim.id;

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const pending = page.getByRole("region", { name: /待确认资料/ });
  await expect(pending).toBeVisible({ timeout: 60_000 });
  await pending
    .getByRole("button", { name: /胡文光.*职业|万载知县/ })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(personId);
  await expect(page.getByRole("button", { name: /^待确认/ })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.locator(`[data-claim-id="${claimId}"]`)).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.locator(`[data-claim-id="${claimId}"]`).getByText("万载知县，后升胶州刺史")
  ).toBeVisible();
});

test("明经胡氏：智能整理提议进入待确认且 agent 通道可见", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const ownerId = await insertFakeUser();
  await loginAs(page, ownerId, baseURL!);
  await page.goto(`${baseURL}/alpha/families`);

  const fam = await apiJson(page, `/api/v1/families`, {
    method: "POST",
    body: {
      displayName: "西递明经胡氏·智能整理（测试）",
      surname: sample.surname,
    },
  });
  expect(fam.status, JSON.stringify(fam.body)).toBe(201);
  const familyId = (fam.body as { family: { id: string } }).family.id;

  const personId = await seedPerson(page, familyId, sample.wenGuang, []);
  const created = await apiJson(page, `/api/v1/families/${familyId}/claims`, {
    method: "POST",
    body: {
      subjectType: "PERSON",
      subjectId: personId,
      claimType: "OCCUPATION",
      value: { text: "万载知县，后升胶州刺史" },
      originType: "AI_EXTRACTION",
      confidence: 0.82,
    },
    headers: { "X-Client-Agent": "cursor-e2e" },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const claim = (
    created.body as {
      claim: { id: string; status: string; originType: string };
    }
  ).claim;
  expect(claim.status).toBe("PROPOSED");
  expect(claim.originType).toBe("AI_EXTRACTION");

  const agent = await apiJson(page, `/api/v1/families/${familyId}/agent`);
  expect(agent.status, JSON.stringify(agent.body)).toBe(200);
  const channel = (
    agent.body as {
      agent: {
        principles: string[];
        claimTypes: { type: string; valueShape: string }[];
        capabilities: { id: string }[];
        tasks: { kind: string; claimId?: string; originType?: string }[];
      };
    }
  ).agent;
  expect(channel.principles.length).toBeGreaterThan(0);
  expect(channel.claimTypes.some((t) => t.type === "OCCUPATION")).toBe(true);
  expect(channel.capabilities.some((c) => c.id === "propose_claim")).toBe(
    true
  );
  expect(
    channel.tasks.some(
      (t) =>
        t.kind === "REVIEW_CLAIM" &&
        t.claimId === claim.id &&
        t.originType === "AI_EXTRACTION"
    )
  ).toBe(true);

  // UI badge path (overview → 资料). Soft timeout — Neon stalls shouldn't fail the channel contract.
  await page.goto(`/alpha/families/${familyId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "概览" }).click();
  const pending = page.getByRole("region", { name: /待确认资料/ });
  await expect(pending).toBeVisible({ timeout: 90_000 });
  const row = pending.getByRole("button", {
    name: /胡文光.*职业|万载知县/,
  });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByText("智能整理")).toBeVisible();
  await row.click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  const card = page.locator(`[data-claim-id="${claim.id}"]`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText("智能整理")).toBeVisible();
  await expect(card.getByRole("button", { name: "确认这条资料" })).toBeVisible();
});

test("明经胡氏：批量智能整理 + Idempotency-Key 可安全重试", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const ownerId = await insertFakeUser();
  await loginAs(page, ownerId, baseURL!);
  // Same-origin page so mutation Origin checks pass for apiJson.
  await page.goto(`${baseURL}/alpha/families`);

  const fam = await apiJson(page, `/api/v1/families`, {
    method: "POST",
    body: {
      displayName: "西递明经胡氏·批量智能整理（测试）",
      surname: sample.surname,
    },
  });
  expect(fam.status, JSON.stringify(fam.body)).toBe(201);
  const familyId = (fam.body as { family: { id: string } }).family.id;

  const personsBatch = await apiJson(
    page,
    `/api/v1/families/${familyId}/persons/batch`,
    {
      method: "POST",
      body: {
        persons: [
          {
            preferredName: sample.wenGuang.preferredName,
            gender: sample.wenGuang.gender,
            livingStatus: sample.wenGuang.livingStatus,
            clientItemId: "wg",
          },
          {
            preferredName: "胡氏侧证（批量测试）",
            gender: "UNKNOWN",
            livingStatus: "DECEASED",
            clientItemId: "side",
          },
        ],
      },
      headers: { "Idempotency-Key": `e2e-persons-${Date.now()}` },
    }
  );
  expect(personsBatch.status, JSON.stringify(personsBatch.body)).toBe(201);
  const personsBody = personsBatch.body as {
    created: number;
    results: Array<{ ok: boolean; person?: { id: string }; clientItemId?: string }>;
  };
  expect(personsBody.created).toBe(2);
  const personId = personsBody.results.find((r) => r.clientItemId === "wg")!
    .person!.id;
  const sideId = personsBody.results.find((r) => r.clientItemId === "side")!
    .person!.id;

  const relBatch = await apiJson(
    page,
    `/api/v1/families/${familyId}/relationships/batch`,
    {
      method: "POST",
      body: {
        relationships: [
          {
            fromPersonId: personId,
            toPersonId: sideId,
            relationshipType: "BIOLOGICAL_PARENT",
            clientItemId: "edge-1",
          },
        ],
        onDuplicate: "reuse",
      },
      headers: { "Idempotency-Key": `e2e-rels-${Date.now()}` },
    }
  );
  expect(relBatch.status, JSON.stringify(relBatch.body)).toBe(201);
  expect((relBatch.body as { created: number }).created).toBe(1);

  const idem = `e2e-batch-${Date.now()}`;

  const body = {
    claims: [
      {
        subjectType: "PERSON",
        subjectId: personId,
        claimType: "OCCUPATION",
        value: { text: "万载知县，后升胶州刺史" },
        originType: "AI_EXTRACTION",
        confidence: 0.9,
        clientItemId: "occ-1",
      },
      {
        subjectType: "PERSON",
        subjectId: personId,
        claimType: "STORY",
        value: { text: "西递明经胡氏支系人物事迹摘录（测试）" },
        originType: "AI_EXTRACTION",
        confidence: 0.7,
        clientItemId: "story-1",
      },
    ],
    onDuplicate: "reuse",
  };

  const first = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/batch`,
    {
      method: "POST",
      body,
      headers: {
        "Idempotency-Key": idem,
        "X-Client-Agent": "cursor-e2e",
      },
    }
  );
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  const firstBody = first.body as {
    created: number;
    reused: number;
    failed: number;
    results: Array<{ ok: boolean; claim?: { id: string }; reused?: boolean }>;
  };
  expect(firstBody.created).toBe(2);
  expect(firstBody.failed).toBe(0);
  const claimIds = firstBody.results
    .filter((r) => r.ok && r.claim)
    .map((r) => r.claim!.id);
  expect(claimIds).toHaveLength(2);

  const replay = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/batch`,
    {
      method: "POST",
      body,
      headers: {
        "Idempotency-Key": idem,
        "X-Client-Agent": "cursor-e2e",
      },
    }
  );
  expect(replay.status).toBe(201);
  expect(replay.replayed).toBe("true");
  const replayBody = replay.body as { created: number };
  expect(replayBody.created).toBe(2);

  // Same facts without idempotency key → reuse path, no new rows
  const again = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/batch`,
    { method: "POST", body: { ...body, onDuplicate: "reuse" } }
  );
  expect(again.status).toBe(201);
  const againBody = again.body as {
    created: number;
    reused: number;
    results: Array<{ ok: boolean; reused?: boolean; claim?: { id: string } }>;
  };
  expect(againBody.created).toBe(0);
  expect(againBody.reused).toBe(2);
  expect(
    againBody.results.every(
      (r) => r.ok && r.reused && claimIds.includes(r.claim!.id)
    )
  ).toBe(true);

  const acceptId = claimIds[0]!;
  const accepted = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/${acceptId}/accept`,
    { method: "POST", body: {} }
  );
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);

  const agent = await apiJson(page, `/api/v1/families/${familyId}/agent`);
  expect(agent.status, JSON.stringify(agent.body)).toBe(200);
  const channel = (
    agent.body as {
      agent: {
        capabilities: { id: string }[];
        claimTypes: { type: string }[];
        recentDecisions: Array<{
          decision: string;
          claimId: string;
        }>;
      };
    }
  ).agent;
  expect(
    channel.capabilities.some((c) => c.id === "propose_claims_batch")
  ).toBe(true);
  expect(channel.claimTypes.some((t) => t.type === "STORY")).toBe(true);
  expect(
    channel.recentDecisions.some(
      (d) => d.decision === "ACCEPTED" && d.claimId === acceptId
    )
  ).toBe(true);
  expect(
    channel.capabilities.some((c) => c.id === "link_evidence_batch")
  ).toBe(true);
  expect(
    channel.capabilities.some((c) => c.id === "create_persons_batch")
  ).toBe(true);
  expect(
    channel.capabilities.some((c) => c.id === "create_relationships_batch")
  ).toBe(true);
  expect(channel.capabilities.some((c) => c.id === "propose_package")).toBe(
    true
  );
  expect(
    (agent.body as { agent: { playbook: string[] } }).agent.playbook.length
  ).toBeGreaterThan(0);

  const ev = await apiJson(page, `/api/v1/families/${familyId}/evidence`, {
    method: "POST",
    body: {
      evidenceType: "GENEALOGY_PAGE",
      title: "西递明经胡氏谱页摘录（测试）",
      visibility: "FAMILY",
    },
  });
  expect(ev.status, JSON.stringify(ev.body)).toBe(201);
  const evidenceId = (ev.body as { evidence: { id: string } }).evidence.id;
  const linkBatch = await apiJson(
    page,
    `/api/v1/families/${familyId}/evidence/${evidenceId}/links`,
    {
      method: "POST",
      body: {
        claimIds,
        relation: "SUPPORTS",
        onDuplicate: "reuse",
      },
      headers: { "Idempotency-Key": `e2e-links-${Date.now()}` },
    }
  );
  expect(linkBatch.status, JSON.stringify(linkBatch.body)).toBe(201);
  const linkBody = linkBatch.body as {
    linked: number;
    reused: number;
    failed: number;
  };
  expect(linkBody.linked).toBe(2);
  expect(linkBody.failed).toBe(0);

  const farFuture = await apiJson(
    page,
    `/api/v1/families/${familyId}/agent?since=${encodeURIComponent(
      new Date(Date.now() + 60_000).toISOString()
    )}`
  );
  expect(farFuture.status).toBe(200);
  const futureDecisions = (
    farFuture.body as {
      agent: { recentDecisions: unknown[] };
    }
  ).agent.recentDecisions;
  expect(futureDecisions).toEqual([]);
});

test("明经胡氏：agent/propose 整包提议进入待确认", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const ownerId = await insertFakeUser();
  await loginAs(page, ownerId, baseURL!);
  await page.goto(`${baseURL}/alpha/families`);

  const fam = await apiJson(page, `/api/v1/families`, {
    method: "POST",
    body: {
      displayName: "西递明经胡氏·整包提议（测试）",
      surname: sample.surname,
    },
  });
  expect(fam.status, JSON.stringify(fam.body)).toBe(201);
  const familyId = (fam.body as { family: { id: string } }).family.id;

  const proposed = await apiJson(
    page,
    `/api/v1/families/${familyId}/agent/propose`,
    {
      method: "POST",
      body: {
        originType: "AI_EXTRACTION",
        persons: [
          {
            preferredName: sample.wenGuang.preferredName,
            gender: sample.wenGuang.gender,
            livingStatus: sample.wenGuang.livingStatus,
            clientItemId: "wg",
          },
          {
            preferredName: "胡氏侧证（整包）",
            gender: "UNKNOWN",
            livingStatus: "DECEASED",
            clientItemId: "side",
          },
        ],
        relationships: [
          {
            fromClientItemId: "wg",
            toClientItemId: "side",
            relationshipType: "BIOLOGICAL_PARENT",
            clientItemId: "edge-1",
          },
        ],
        claims: [
          {
            subjectClientItemId: "wg",
            claimType: "OCCUPATION",
            value: { text: "万载知县，后升胶州刺史" },
            confidence: 0.88,
            clientItemId: "occ",
          },
        ],
        evidence: {
          evidenceType: "GENEALOGY_PAGE",
          title: "整包谱页摘录（测试）",
          claimClientItemIds: ["occ"],
        },
      },
      headers: {
        "Idempotency-Key": `e2e-propose-${Date.now()}`,
        "X-Client-Agent": "cursor-e2e",
      },
    }
  );
  expect(proposed.status, JSON.stringify(proposed.body)).toBe(201);
  const body = proposed.body as {
    personMap: Record<string, string>;
    claimMap: Record<string, string>;
    persons: { created: number; failed: number };
    relationships: { created: number; failed: number };
    claims: {
      created: number;
      failed: number;
      results: Array<{ ok: boolean; claim?: { status: string; originType: string } }>;
    };
    evidence: { evidenceId: string | null; linked: number; failed: number };
  };
  expect(body.persons.created).toBe(2);
  expect(body.persons.failed).toBe(0);
  expect(body.relationships.created).toBe(1);
  expect(body.claims.created).toBe(1);
  expect(body.claimMap.occ).toBeTruthy();
  expect(body.claims.results[0]?.claim?.status).toBe("PROPOSED");
  expect(body.claims.results[0]?.claim?.originType).toBe("AI_EXTRACTION");
  expect(body.evidence.evidenceId).toBeTruthy();
  expect(body.evidence.linked).toBe(1);
  expect(body.evidence.failed).toBe(0);

  const claimId = body.claimMap.occ!;
  const reviewed = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/review-batch`,
    {
      method: "POST",
      body: { action: "accept", claimIds: [claimId] },
      headers: { "Idempotency-Key": `e2e-review-${Date.now()}` },
    }
  );
  expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
  const reviewBody = reviewed.body as {
    succeeded: number;
    failed: number;
    results: Array<{ ok: boolean; claim?: { status: string } }>;
  };
  expect(reviewBody.succeeded).toBe(1);
  expect(reviewBody.failed).toBe(0);
  expect(reviewBody.results[0]?.claim?.status).toBe("ACCEPTED");

  const agent = await apiJson(page, `/api/v1/families/${familyId}/agent`);
  expect(agent.status).toBe(200);
  expect(
    (
      agent.body as { agent: { capabilities: { id: string }[] } }
    ).agent.capabilities.some((c) => c.id === "review_claims_batch")
  ).toBe(true);
});

test("明经胡氏：概览可一键确认智能整理", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const ownerId = await insertFakeUser();
  await loginAs(page, ownerId, baseURL!);
  await page.goto(`${baseURL}/alpha/families`);

  const fam = await apiJson(page, `/api/v1/families`, {
    method: "POST",
    body: {
      displayName: "西递明经胡氏·概览确认（测试）",
      surname: sample.surname,
    },
  });
  expect(fam.status, JSON.stringify(fam.body)).toBe(201);
  const familyId = (fam.body as { family: { id: string } }).family.id;

  const proposed = await apiJson(
    page,
    `/api/v1/families/${familyId}/agent/propose`,
    {
      method: "POST",
      body: {
        originType: "AI_EXTRACTION",
        persons: [
          {
            preferredName: sample.wenGuang.preferredName,
            gender: sample.wenGuang.gender,
            livingStatus: sample.wenGuang.livingStatus,
            clientItemId: "wg",
          },
        ],
        claims: [
          {
            subjectClientItemId: "wg",
            claimType: "OCCUPATION",
            value: { text: "万载知县，后升胶州刺史" },
            confidence: 0.9,
            clientItemId: "occ",
          },
          {
            subjectClientItemId: "wg",
            claimType: "STORY",
            value: { text: "西递明经胡氏支系人物事迹摘录（概览确认）" },
            confidence: 0.7,
            clientItemId: "story",
          },
        ],
      },
      headers: { "X-Client-Agent": "cursor-e2e" },
    }
  );
  expect(proposed.status, JSON.stringify(proposed.body)).toBe(201);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const pending = page.getByRole("region", { name: /待确认资料/ });
  await expect(pending).toBeVisible({ timeout: 90_000 });
  const confirmBtn = pending.getByRole("button", {
    name: /确认 \d+ 条智能整理/,
  });
  await expect(confirmBtn).toBeVisible({ timeout: 30_000 });
  await expect(
    pending.getByRole("button", { name: "不采用这些" })
  ).toBeVisible();
  await confirmBtn.click();
  const confirmStatus = page.getByRole("status").filter({
    hasText: /已确认 2 条/,
  });
  await expect(confirmStatus).toBeVisible({ timeout: 60_000 });
  await expect(confirmStatus).toContainText("误操作可点恢复");
  await expect(
    page.getByRole("button", { name: /确认 \d+ 条智能整理/ })
  ).toHaveCount(0);
  await confirmStatus.getByRole("button", { name: "恢复" }).click();
  await expect(
    page.getByRole("status").filter({
      hasText: /已重新打开 2 条资料/,
    })
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    pending.getByRole("button", { name: /确认 \d+ 条智能整理/ })
  ).toBeVisible({ timeout: 60_000 });
});

test("明经胡氏：概览可一键不采用智能整理", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const ownerId = await insertFakeUser();
  await loginAs(page, ownerId, baseURL!);
  await page.goto(`${baseURL}/alpha/families`);

  const fam = await apiJson(page, `/api/v1/families`, {
    method: "POST",
    body: {
      displayName: "西递明经胡氏·概览不采用（测试）",
      surname: sample.surname,
    },
  });
  expect(fam.status, JSON.stringify(fam.body)).toBe(201);
  const familyId = (fam.body as { family: { id: string } }).family.id;

  const proposed = await apiJson(
    page,
    `/api/v1/families/${familyId}/agent/propose`,
    {
      method: "POST",
      body: {
        originType: "AI_EXTRACTION",
        persons: [
          {
            preferredName: sample.wenGuang.preferredName,
            gender: sample.wenGuang.gender,
            livingStatus: sample.wenGuang.livingStatus,
            clientItemId: "wg",
          },
        ],
        claims: [
          {
            subjectClientItemId: "wg",
            claimType: "OCCUPATION",
            value: { text: "万载知县（概览不采用）" },
            confidence: 0.9,
            clientItemId: "occ",
          },
          {
            subjectClientItemId: "wg",
            claimType: "STORY",
            value: { text: "西递明经胡氏支系人物事迹摘录（概览不采用）" },
            confidence: 0.7,
            clientItemId: "story",
          },
        ],
      },
      headers: { "X-Client-Agent": "cursor-e2e" },
    }
  );
  expect(proposed.status, JSON.stringify(proposed.body)).toBe(201);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const pending = page.getByRole("region", { name: /待确认资料/ });
  await expect(pending).toBeVisible({ timeout: 90_000 });
  const rejectBtn = pending.getByRole("button", { name: "不采用这些" });
  await expect(rejectBtn).toBeVisible({ timeout: 30_000 });
  await rejectBtn.click();
  const batchStatus = page.getByRole("status").filter({
    hasText: /已不采用 2 条/,
  });
  await expect(batchStatus).toBeVisible({ timeout: 60_000 });
  await expect(batchStatus).toContainText("误操作可点恢复");
  await expect(
    page.getByRole("button", { name: /确认 \d+ 条智能整理/ })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "不采用这些" })
  ).toHaveCount(0);
  await batchStatus.getByRole("button", { name: "恢复" }).click();
  await expect(
    page.getByRole("status").filter({
      hasText: /已重新打开 2 条资料/,
    })
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    pending.getByRole("button", { name: /确认 \d+ 条智能整理/ })
  ).toBeVisible({ timeout: 60_000 });
});

test("明经胡氏：不采用后可立即恢复待确认", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·不采用即时恢复（测试）",
    sample.surname
  );
  const personId = await seedPerson(page, familyId, sample.wenGuang, [
    { claimType: "OCCUPATION", text: "万载知县，后升胶州刺史" },
  ]);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  const card = page
    .locator("[data-claim-id]")
    .filter({ hasText: "万载知县，后升胶州刺史" });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.getByRole("button", { name: "不采用" }).click();
  const undoFlash = page.getByRole("status").filter({
    hasText: "已标记为不采用。误标可点恢复。",
  });
  await expect(undoFlash).toBeVisible({ timeout: 60_000 });
  await undoFlash.getByRole("button", { name: "恢复" }).click();
  await expect(
    page.getByRole("status").filter({
      hasText: "已重新打开这条资料，可再次确认或不采用",
    })
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page
      .locator("[data-claim-id]")
      .filter({ hasText: "万载知县，后升胶州刺史" })
      .getByRole("button", { name: "确认这条资料" })
  ).toBeVisible({ timeout: 60_000 });
});

test("明经胡氏：误标不采用后可从动态恢复待确认", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·不采用恢复（测试）",
    sample.surname
  );

  const personId = await seedPerson(page, familyId, sample.wenGuang, []);
  const created = await apiJson(page, `/api/v1/families/${familyId}/claims`, {
    method: "POST",
    body: {
      subjectType: "PERSON",
      subjectId: personId,
      claimType: "OCCUPATION",
      value: { text: "万载知县，后升胶州刺史" },
      originType: "MANUAL",
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const claimId = (created.body as { claim: { id: string } }).claim.id;
  const rejected = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/${claimId}/reject`,
    { method: "POST", body: {} }
  );
  expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const feed = page.getByRole("region", { name: "最近动态" });
  await expect(feed).toBeVisible({ timeout: 60_000 });
  const row = feed.locator("li").filter({
    hasText: `不采用「${sample.wenGuang.preferredName}」的一条职业`,
  });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole("button", { name: "恢复" }).click();
  await expect(
    page.getByText("已重新打开这条资料，可再次确认或不采用")
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(personId);
  await expect(page.locator(`[data-claim-id="${claimId}"]`)).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.locator(`[data-claim-id="${claimId}"]`).getByRole("button", {
      name: "确认这条资料",
    })
  ).toBeVisible();
});

test("明经胡氏：人物页待确认 chip 直达对应资料卡片", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·人物待确认（测试）",
    sample.surname
  );

  const personId = await seedPerson(page, familyId, sample.wenGuang, [
    { claimType: "BIRTH_DATE", text: "约明嘉靖年间" },
  ]);
  const created = await apiJson(page, `/api/v1/families/${familyId}/claims`, {
    method: "POST",
    body: {
      subjectType: "PERSON",
      subjectId: personId,
      claimType: "OCCUPATION",
      value: { text: "万载知县，后升胶州刺史" },
      originType: "MANUAL",
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const claimId = (created.body as { claim: { id: string } }).claim.id;

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: sample.wenGuang.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  await page
    .locator("li")
    .filter({ hasText: "万载知县，后升胶州刺史" })
    .getByRole("button", { name: "待确认", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(personId);
  await expect(page.getByRole("button", { name: /^待确认/ })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.locator(`[data-claim-id="${claimId}"]`)).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.locator(`[data-claim-id="${claimId}"]`).getByText("万载知县，后升胶州刺史")
  ).toBeVisible();
});

test("明经胡氏：保存字辈后自动打开谱页来源表单", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·字辈来源（测试）",
    sample.surname
  );

  const personId = await seedPerson(page, familyId, sample.guanSan, [
    { claimType: "BIRTH_DATE", text: "约清乾隆年间" },
  ]);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  await page.getByRole("button", { name: "+ 添加人物资料" }).click();
  await page.locator("#claim-type").selectOption("GENERATION_WORD");
  await page.locator("#claim-text").fill("贯");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(
    page.getByText("已添加人物资料。接着可以补上谱页或其他来源。")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "保存来源" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator("#ev-type")).toHaveValue("GENEALOGY_PAGE");
  await expect(
    page.locator(`[data-claim-id]`).filter({ hasText: "贯" })
  ).toBeVisible();
});

test("明经胡氏：保存故事后自动打开来源表单", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·故事来源（测试）",
    sample.surname
  );

  const personId = await seedPerson(page, familyId, sample.guanSan, [
    { claimType: "BIRTH_DATE", text: "约清乾隆年间" },
  ]);

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: sample.guanSan.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  await page
    .getByRole("region", { name: "故事与口述" })
    .getByRole("button", { name: "补充故事" })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#claim-type")).toHaveValue("STORY", {
    timeout: 15_000,
  });
  const story =
    sample.guanSan.claims.find((c) => c.claimType === "STORY")?.text ??
    "江南六大首富之一。";
  await page.locator("#claim-text").fill(story);
  await page.locator("#claim-narrator").fill("据公开报道整理");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(
    page.getByText("已添加故事。接着可以补上口述或谱页来源。")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "保存来源" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator("#ev-type")).toHaveValue("ORAL_HISTORY");
  await expect(page.locator(`[data-claim-id]`).filter({ hasText: story })).toBeVisible();
});

test("明经胡氏：人物页空故事区直达口述表单", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·空故事（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.guanSan,
    sample.guanSan.claims.filter(
      (c) => c.claimType === "BIRTH_DATE" || c.claimType === "OCCUPATION"
    )
  );

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: sample.guanSan.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  const stories = page.getByRole("region", { name: "故事与口述" });
  await expect(stories.getByRole("button", { name: "补充故事" })).toBeVisible();
  await stories.getByRole("button", { name: "补充故事" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(personId);
  await expect(page.locator("#claim-type")).toHaveValue("STORY", {
    timeout: 15_000,
  });
  await expect(page.locator("#claim-text")).toBeFocused();
});

test("明经胡氏：概览提示补故事，chip 直达口述表单", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·故事漏斗（测试）",
    sample.surname
  );

  const personId = await seedPerson(page, familyId, sample.guanSan, [
    { claimType: "BIRTH_DATE", text: "约清乾隆年间" },
  ]);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const storyStep = page
    .getByRole("listitem")
    .filter({ hasText: "故事或口述" });
  await expect(storyStep).toContainText("补充 1 位成员的故事或口述", {
    timeout: 60_000,
  });
  await storyStep
    .getByRole("button", { name: `为${sample.guanSan.preferredName}补充故事` })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(personId);
  await expect(page.locator("#claim-type")).toHaveValue("STORY", {
    timeout: 15_000,
  });
  await expect(page.locator("#claim-text")).toBeFocused();
});

test("明经胡氏：概览提示补职业，chip 直达资料表单", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·职业漏斗（测试）",
    sample.surname
  );

  const sl = sample.shiLiang;
  const personId = await seedPerson(page, familyId, sl, sl.claims);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const occStep = page.getByRole("listitem").filter({ hasText: "成员的职业" });
  await expect(occStep).toContainText("补充 1 位成员的职业", {
    timeout: 60_000,
  });
  await occStep
    .getByRole("button", { name: `为${sl.preferredName}补充职业` })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(personId);
  await expect(page.locator("#claim-type")).toHaveValue("OCCUPATION", {
    timeout: 15_000,
  });
  await expect(page.locator("#claim-text")).toBeFocused();
});

test("明经胡氏：保存祖籍后链式展开职业表单", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·祖籍链（测试）",
    sample.surname
  );

  const wg = sample.wenGuang;
  const personId = await seedPerson(
    page,
    familyId,
    wg,
    wg.claims.filter(
      (c) => c.claimType === "BIRTH_DATE" || c.claimType === "BIRTH_PLACE"
    )
  );

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  await page.getByRole("button", { name: "+ 添加人物资料" }).click();
  await page.locator("#claim-type").selectOption("ANCESTRAL_PLACE");
  await page.locator("#claim-text").fill("江西婺源考水");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(page.getByText("已添加祖籍。接着可以记下职业。")).toBeVisible();
  await expect(page.locator("#claim-type")).toHaveValue("OCCUPATION", {
    timeout: 15_000,
  });
  await expect(page.locator("#claim-text")).toBeFocused();
  await page.locator("#claim-text").fill("万载知县，后升胶州刺史");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(page.getByText("已添加职业。接着可以记下字号或别名。")).toBeVisible();
  await expect(page.locator("#claim-type")).toHaveValue("ALIAS", {
    timeout: 15_000,
  });
  await page.locator("#claim-text").fill("字子明");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(
    page.getByText("已添加字号。接着可以记下一段故事或口述。")
  ).toBeVisible();
  await expect(page.locator("#claim-type")).toHaveValue("STORY", {
    timeout: 15_000,
  });
  await expect(page.getByText("万载知县，后升胶州刺史")).toBeVisible();
});

test("明经胡氏：人物页显示字号，概览 chip 直达别名表单", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·字号（测试）",
    sample.surname
  );

  const sl = sample.shiLiang;
  const shiLiangId = await seedPerson(page, familyId, sl, sl.claims);

  await page.goto(`/alpha/families/${familyId}/people/${shiLiangId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: sl.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  const life = page.getByRole("region", { name: "生平" });
  await expect(life.getByRole("heading", { name: "字号" })).toBeVisible();
  await expect(life.getByText("字季臣")).toBeVisible();
  await expect(life.getByRole("heading", { name: "辈分" })).toBeVisible();
  await expect(life.getByText("士")).toBeVisible();

  const wg = sample.wenGuang;
  const wenGuangId = await seedPerson(
    page,
    familyId,
    wg,
    wg.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const aliasStep = page.getByRole("listitem").filter({ hasText: "成员的字号" });
  await expect(aliasStep).toContainText(/补充 \d+ 位成员的字号/, {
    timeout: 60_000,
  });
  await aliasStep
    .getByRole("button", { name: `为${wg.preferredName}补充字号` })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(wenGuangId);
  await expect(page.locator("#claim-type")).toHaveValue("ALIAS", {
    timeout: 15_000,
  });
  await expect(page.locator("#claim-text")).toBeFocused();
});

test("明经胡氏：胡贯三—胡元熙父子世系与排行", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·父子世系（测试）",
    sample.surname
  );

  const fatherId = await seedPerson(
    page,
    familyId,
    sample.guanSan,
    sample.guanSan.claims
  );
  const childId = await seedPerson(
    page,
    familyId,
    sample.yuanXi,
    sample.yuanXi.claims
  );
  const siblingId = await seedPerson(
    page,
    familyId,
    {
      preferredName: "胡元锟",
      gender: "MALE",
      livingStatus: "DECEASED",
    },
    [{ claimType: "BIRTH_DATE", text: "约清嘉庆年间" }]
  );
  for (const child of [childId, siblingId]) {
    const rel = await apiJson(
      page,
      `/api/v1/families/${familyId}/relationships`,
      {
        method: "POST",
        body: {
          fromPersonId: fatherId,
          toPersonId: child,
          relationshipType: "BIOLOGICAL_PARENT",
        },
      }
    );
    expect(rel.status, JSON.stringify(rel.body)).toBe(201);
  }

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "世系" }).click();
  await expect(page.getByRole("heading", { name: /第一代/ })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: /^胡贯三/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^胡元熙/ })).toBeVisible();
  await expect(page.getByText(/子女：.*胡元熙/)).toBeVisible();
  await expect(page.getByText("父母：胡贯三").first()).toBeVisible();

  await page.goto(`/alpha/families/${familyId}/people/${fatherId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "胡贯三" })
  ).toBeVisible({ timeout: 60_000 });
  const fatherKin = page.getByRole("region", { name: "家人" });
  await expect(
    fatherKin.getByRole("button", { name: "补充配偶" })
  ).toBeVisible();
  await expect(
    fatherKin.getByRole("button", { name: "补充父母" })
  ).toBeVisible();
  await fatherKin.getByRole("button", { name: "补充配偶" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("世系", {
    timeout: 60_000,
  });
  await expect(page.getByRole("dialog", { name: /添加配偶/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("dialog")).toContainText("胡贯三");
  await page.getByRole("dialog").getByRole("button", { name: "关闭" }).click();

  await page.goto(`/alpha/families/${familyId}/people/${fatherId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "胡贯三" })
  ).toBeVisible({ timeout: 60_000 });
  await page
    .getByRole("region", { name: "家人" })
    .getByRole("button", { name: "补充父母" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("世系", {
    timeout: 60_000,
  });
  await expect(page.getByRole("dialog", { name: /添加父母/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("dialog")).toContainText("胡贯三");
  await page.getByRole("dialog").getByRole("button", { name: "关闭" }).click();

  await page.goto(`/alpha/families/${familyId}/people/${childId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "胡元熙" })
  ).toBeVisible({ timeout: 60_000 });
  const childKin = page.getByRole("region", { name: "家人" });
  await expect(childKin.getByRole("button", { name: "补充配偶" })).toHaveCount(
    0
  );
  const life = page.getByRole("region", { name: "生平" });
  await expect(life.getByRole("heading", { name: "辈分" })).toBeVisible();
  await expect(life.getByText("三")).toBeVisible();
  await expect(life.getByRole("button", { name: "补充排行" })).toHaveCount(0);
  await expect(life.getByRole("button", { name: "补充字辈" })).toBeVisible();
  await expect(childKin.getByRole("link", { name: "胡贯三" })).toBeVisible();

  await life.getByRole("button", { name: "补充字辈" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(childId);
  await expect(page.locator("#claim-type")).toHaveValue("GENERATION_WORD", {
    timeout: 15_000,
  });
  await expect(page.locator("#claim-text")).toBeFocused();
  await page.getByRole("button", { name: "收起" }).click();

  await page.goto(`/alpha/families/${familyId}/people/${siblingId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "胡元锟" })
  ).toBeVisible({ timeout: 60_000 });
  const siblingLife = page.getByRole("region", { name: "生平" });
  await expect(
    siblingLife.getByRole("button", { name: "补充排行" })
  ).toBeVisible();
  await siblingLife.getByRole("button", { name: "补充排行" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(siblingId);
  await expect(page.locator("#claim-type")).toHaveValue("BIRTH_ORDER", {
    timeout: 15_000,
  });
  await expect(page.locator("#claim-text")).toBeFocused();
});

test("明经胡氏：人物页补来源直达资料表单", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·补来源（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.wenGuang,
    sample.wenGuang.claims.filter(
      (c) =>
        c.claimType === "BIRTH_DATE" ||
        c.claimType === "OCCUPATION" ||
        c.claimType === "STORY"
    )
  );

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: sample.wenGuang.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  const life = page.getByRole("region", { name: "生平" });
  await expect(life.getByRole("button", { name: "补来源" }).first()).toBeVisible();
  await life.getByRole("button", { name: "补来源" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(personId);
  await expect(page.getByRole("button", { name: "保存来源" })).toBeVisible({
    timeout: 20_000,
  });
});

test("明经胡氏：概览为已确认资料补出处直达表单", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·概览出处（测试）",
    sample.surname
  );

  const personId = await seedPerson(page, familyId, sample.wenGuang, [
    { claimType: "OCCUPATION", text: "万载知县，后升胶州刺史" },
  ]);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const progress = page.getByRole("region", { name: "档案进度" });
  await expect(progress.getByText("有出处资料")).toBeVisible({
    timeout: 60_000,
  });
  await expect(progress.getByText("0 / 1")).toBeVisible();

  const next = page.getByRole("region", { name: "下一步" });
  const sourceStep = next
    .locator("li")
    .filter({ hasText: "已确认资料补上来源" });
  await expect(sourceStep).toBeVisible({ timeout: 60_000 });
  await sourceStep
    .getByRole("button", {
      name: `为${sample.wenGuang.preferredName}补上来源`,
    })
    .click();

  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(personId);
  await expect(page.getByRole("button", { name: "保存来源" })).toBeVisible({
    timeout: 20_000,
  });
});

test("明经胡氏：有配偶无子女时提示补充子女", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·配偶子女（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.wenGuang,
    sample.wenGuang.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );
  const spouseId = await seedPerson(
    page,
    familyId,
    {
      preferredName: "汪孺人",
      gender: "FEMALE",
      livingStatus: "DECEASED",
    },
    [{ claimType: "BIRTH_DATE", text: "约明嘉靖年间" }]
  );
  const spouseRel = await apiJson(
    page,
    `/api/v1/families/${familyId}/relationships`,
    {
      method: "POST",
      body: {
        fromPersonId: personId,
        toPersonId: spouseId,
        relationshipType: "SPOUSE",
      },
    }
  );
  expect(spouseRel.status, JSON.stringify(spouseRel.body)).toBe(201);

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: sample.wenGuang.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  const kin = page.getByRole("region", { name: "家人" });
  await expect(kin.getByRole("button", { name: "补充配偶" })).toHaveCount(0);
  await expect(kin.getByRole("button", { name: "补充子女" })).toBeVisible();
  await kin.getByRole("button", { name: "补充子女" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("世系", {
    timeout: 60_000,
  });
  await expect(page.getByRole("dialog", { name: /添加子女/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole("dialog")).toContainText(
    sample.wenGuang.preferredName
  );
});

test("明经胡氏：人物页不确定在世/性别直达抽屉焦点", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·确认基本信息（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    {
      preferredName: sample.guanSan.preferredName,
      gender: "UNKNOWN",
      livingStatus: "UNKNOWN",
    },
    [{ claimType: "BIRTH_DATE", text: "约清嘉庆年间" }]
  );

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: sample.guanSan.preferredName,
    })
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole("button", { name: "确认在世状态" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "确认性别" })).toBeVisible();
  await expect(page.getByRole("button", { name: "修改姓名" })).toBeVisible();

  await page.getByRole("button", { name: "修改姓名" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  const nameDrawer = page.getByRole("dialog");
  await expect(
    nameDrawer.getByRole("heading", { name: sample.guanSan.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  await expect(nameDrawer.locator("#edit-name")).toHaveValue(
    sample.guanSan.preferredName
  );
  await expect(nameDrawer.locator("#edit-name")).toBeFocused();
  await nameDrawer.getByRole("button", { name: "关闭" }).click();

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: sample.guanSan.preferredName,
    })
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "确认在世状态" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  const livingDrawer = page.getByRole("dialog");
  await expect(
    livingDrawer.getByRole("heading", { name: sample.guanSan.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  await expect(livingDrawer.locator("#edit-living")).toHaveValue("UNKNOWN");
  await expect(livingDrawer.locator("#edit-living")).toBeFocused();
  await livingDrawer.getByRole("button", { name: "关闭" }).click();

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: sample.guanSan.preferredName,
    })
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "确认性别" }).click();
  const genderDrawer = page.getByRole("dialog");
  await expect(
    genderDrawer.getByRole("heading", { name: sample.guanSan.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  await expect(genderDrawer.locator("#edit-gender")).toHaveValue("UNKNOWN");
  await expect(genderDrawer.locator("#edit-gender")).toBeFocused();
});

test("明经胡氏：人物页可修改已填的在世状态与性别", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·修改基本信息（测试）",
    sample.surname
  );
  const personId = await seedPerson(page, familyId, sample.wenGuang, []);

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: sample.wenGuang.preferredName,
    })
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole("button", { name: "修改在世状态" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "修改性别" })).toBeVisible();

  await page.getByRole("button", { name: "修改在世状态" }).click();
  const livingDrawer = page.getByRole("dialog");
  await expect(livingDrawer.locator("#edit-living")).toHaveValue("DECEASED", {
    timeout: 60_000,
  });
  await expect(livingDrawer.locator("#edit-living")).toBeFocused();
  await livingDrawer.getByRole("button", { name: "关闭" }).click();

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await page.getByRole("button", { name: "修改性别" }).click();
  const genderDrawer = page.getByRole("dialog");
  await expect(genderDrawer.locator("#edit-gender")).toHaveValue("MALE", {
    timeout: 60_000,
  });
  await expect(genderDrawer.locator("#edit-gender")).toBeFocused();
});

test("明经胡氏：概览有配偶无子女时 chip 打开添加子女", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·概览子女（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.wenGuang,
    sample.wenGuang.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );
  const spouseId = await seedPerson(
    page,
    familyId,
    {
      preferredName: "汪孺人",
      gender: "FEMALE",
      livingStatus: "DECEASED",
    },
    [{ claimType: "BIRTH_DATE", text: "约明嘉靖年间" }]
  );
  const spouseRel = await apiJson(
    page,
    `/api/v1/families/${familyId}/relationships`,
    {
      method: "POST",
      body: {
        fromPersonId: personId,
        toPersonId: spouseId,
        relationshipType: "SPOUSE",
      },
    }
  );
  expect(spouseRel.status, JSON.stringify(spouseRel.body)).toBe(201);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const childrenStep = page
    .getByRole("listitem")
    .filter({ hasText: "已有配偶成员的子女" });
  await expect(childrenStep).toContainText("已有配偶成员的子女", {
    timeout: 60_000,
  });
  await childrenStep
    .getByRole("button", {
      name: `为${sample.wenGuang.preferredName}补充子女`,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: /添加子女/ });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(dialog).toContainText(sample.wenGuang.preferredName);
});

test("明经胡氏：人物页来源可查看照片", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const { familyId, ownerId } = await createFamilyOwned(
    page,
    baseURL!,
    "西递明经胡氏·人物页照片来源（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.wenGuang,
    sample.wenGuang.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  const birthCard = page
    .locator("[data-claim-id]")
    .filter({ hasText: "约明嘉靖年间" });
  await expect(birthCard).toBeVisible({ timeout: 60_000 });
  await birthCard.getByRole("button", { name: "添加资料来源" }).click();
  await birthCard.locator("#ev-type").selectOption("PHOTO");
  await birthCard.getByLabel("来源标题（可选）").fill("文光公画像（测试）");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  await birthCard.locator('input[type="file"]').setInputFiles({
    name: "wenguang.png",
    mimeType: "image/png",
    buffer: png,
  });
  await birthCard.getByRole("button", { name: "保存来源" }).click();
  await expect(birthCard.getByText("文光公画像（测试）")).toBeVisible({
    timeout: 90_000,
  });

  const claimId = await birthCard.getAttribute("data-claim-id");
  expect(claimId).toBeTruthy();
  const detail = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/${claimId}`
  );
  const mediaId = (
    detail.body as {
      evidenceLinks: { evidence: { mediaObjectId: string | null } }[];
    }
  ).evidenceLinks
    .map((l) => l.evidence.mediaObjectId)
    .find(Boolean);
  expect(mediaId, JSON.stringify(detail.body)).toBeTruthy();
  trackMedia(familyId, mediaId!, ownerId);

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: sample.wenGuang.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  const life = page.getByRole("region", { name: "生平" });
  await expect(life.getByText(/文光公画像/)).toBeVisible({ timeout: 60_000 });
  await life.getByRole("button", { name: "查看" }).first().click();
  const dialog = page.getByRole("dialog", { name: "文光公画像（测试）" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByRole("img", { name: "文光公画像（测试）" })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭" }).click();
});

test("明经胡氏：确认无来源资料后自动打开来源表单", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·确认后来源（测试）",
    sample.surname
  );

  const personId = await seedPerson(page, familyId, sample.wenGuang, []);
  const created = await apiJson(page, `/api/v1/families/${familyId}/claims`, {
    method: "POST",
    body: {
      subjectType: "PERSON",
      subjectId: personId,
      claimType: "OCCUPATION",
      value: { text: "万载知县，后升胶州刺史" },
      originType: "MANUAL",
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const claimId = (created.body as { claim: { id: string } }).claim.id;

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const pending = page.getByRole("region", { name: /待确认资料/ });
  await expect(pending).toBeVisible({ timeout: 60_000 });
  await pending
    .getByRole("button", { name: /胡文光.*职业|万载知县/ })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  const card = page.locator(`[data-claim-id="${claimId}"]`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole("button", { name: "确认这条资料" }).click();
  await expect(
    page.getByText("已确认这条资料。接着可以补上谱页或其他来源。")
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "保存来源" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(card.locator("#ev-type")).toHaveValue("GENEALOGY_PAGE");
});

test("明经胡氏：资料来源库可查看照片", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const { familyId, ownerId } = await createFamilyOwned(
    page,
    baseURL!,
    "西递明经胡氏·来源库照片（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.wenGuang,
    sample.wenGuang.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  await page.getByRole("button", { name: "添加资料来源" }).first().click();
  await page.locator("#ev-type").selectOption("PHOTO");
  await page.getByLabel("来源标题（可选）").fill("西递牌坊旧影（测试）");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "xidi-paifang.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.getByRole("button", { name: "保存来源" }).click();
  await expect(page.getByText("西递牌坊旧影（测试）")).toBeVisible({
    timeout: 90_000,
  });

  const claimBundle = await apiJson(
    page,
    `/api/v1/families/${familyId}/persons/${personId}/claims?includeRejected=true`
  );
  const claims = (
    claimBundle.body as { claims: { id: string; status: string }[] }
  ).claims;
  const accepted = claims.find((c) => c.status === "ACCEPTED");
  expect(accepted).toBeTruthy();
  const detail = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/${accepted!.id}`
  );
  const mediaId = (
    detail.body as {
      evidenceLinks: { evidence: { mediaObjectId: string | null } }[];
    }
  ).evidenceLinks
    .map((l) => l.evidence.mediaObjectId)
    .find(Boolean);
  if (mediaId) trackMedia(familyId, mediaId, ownerId);

  await page.getByRole("tab", { name: "概览" }).click();
  const sourcesLib = page.getByRole("region", { name: "资料来源库" });
  await expect(sourcesLib).toContainText("西递牌坊旧影（测试）", {
    timeout: 60_000,
  });
  await sourcesLib
    .locator("li")
    .filter({ hasText: "西递牌坊旧影（测试）" })
    .getByRole("button", { name: "查看" })
    .click();
  const dialog = page.getByRole("dialog", { name: "西递牌坊旧影（测试）" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByRole("img", { name: "西递牌坊旧影（测试）" })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭" }).click();
  await expect(dialog).toHaveCount(0);
});

test("明经胡氏：最近动态查看来源直达资料来源库", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const { familyId, ownerId } = await createFamilyOwned(
    page,
    baseURL!,
    "西递明经胡氏·动态查看来源（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.wenGuang,
    sample.wenGuang.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  const birthCard = page
    .locator("[data-claim-id]")
    .filter({ hasText: "约明嘉靖年间" });
  await expect(birthCard).toBeVisible({ timeout: 60_000 });
  await birthCard.getByRole("button", { name: "添加资料来源" }).click();
  await birthCard.locator("#ev-type").selectOption("PHOTO");
  await birthCard.getByLabel("来源标题（可选）").fill("西递牌坊动态（测试）");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  await birthCard.locator('input[type="file"]').setInputFiles({
    name: "paifang-activity.png",
    mimeType: "image/png",
    buffer: png,
  });
  await birthCard.getByRole("button", { name: "保存来源" }).click();
  await expect(birthCard.getByText("西递牌坊动态（测试）")).toBeVisible({
    timeout: 90_000,
  });

  const claimId = await birthCard.getAttribute("data-claim-id");
  expect(claimId).toBeTruthy();
  const detail = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/${claimId}`
  );
  const evidenceId = (
    detail.body as {
      evidenceLinks: {
        evidence: { id: string; mediaObjectId: string | null };
      }[];
    }
  ).evidenceLinks[0]?.evidence.id;
  const mediaId = (
    detail.body as {
      evidenceLinks: { evidence: { mediaObjectId: string | null } }[];
    }
  ).evidenceLinks
    .map((l) => l.evidence.mediaObjectId)
    .find(Boolean);
  expect(evidenceId, JSON.stringify(detail.body)).toBeTruthy();
  if (mediaId) trackMedia(familyId, mediaId, ownerId);

  await page.getByRole("tab", { name: "概览" }).click();
  const feed = page.getByRole("region", { name: "最近动态" });
  await expect(feed).toBeVisible({ timeout: 60_000 });
  await expect(feed).toContainText("资料来源");
  await feed
    .locator("li")
    .filter({ hasText: "资料来源" })
    .getByRole("button", { name: "查看" })
    .click();
  const sourcesLib = page.getByRole("region", { name: "资料来源库" });
  await expect(
    sourcesLib.locator(`[data-evidence-id="${evidenceId}"]`)
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("dialog", { name: "西递牌坊动态（测试）" })
  ).toBeVisible({ timeout: 20_000 });
});

test("明经胡氏：人物页有亲人时可在世系中查看", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·人物页世系（测试）",
    sample.surname
  );

  const fatherId = await seedPerson(page, familyId, sample.guanSan, []);
  const childId = await seedPerson(page, familyId, sample.yuanXi, []);
  const rel = await apiJson(page, `/api/v1/families/${familyId}/relationships`, {
    method: "POST",
    body: {
      fromPersonId: fatherId,
      toPersonId: childId,
      relationshipType: "BIOLOGICAL_PARENT",
    },
  });
  expect(rel.status, JSON.stringify(rel.body)).toBe(201);

  await page.goto(`/alpha/families/${familyId}/people/${childId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: sample.yuanXi.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "在世系中查看" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("世系", {
    timeout: 60_000,
  });
  await expect(page.locator(`[data-lineage-person="${childId}"]`)).toBeFocused(
    { timeout: 20_000 }
  );

  const soloId = await seedPerson(page, familyId, sample.wenGuang, []);
  await page.goto(`/alpha/families/${familyId}/people/${soloId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: sample.wenGuang.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole("button", { name: "在世系中查看" })
  ).toHaveCount(0);
});

test("明经胡氏：最近动态关系查看直达世系", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·动态关系查看（测试）",
    sample.surname
  );

  const fatherId = await seedPerson(page, familyId, sample.guanSan, []);
  const childId = await seedPerson(page, familyId, sample.yuanXi, []);
  const rel = await apiJson(page, `/api/v1/families/${familyId}/relationships`, {
    method: "POST",
    body: {
      fromPersonId: fatherId,
      toPersonId: childId,
      relationshipType: "BIOLOGICAL_PARENT",
    },
  });
  expect(rel.status, JSON.stringify(rel.body)).toBe(201);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const feed = page.getByRole("region", { name: "最近动态" });
  await expect(feed).toBeVisible({ timeout: 60_000 });
  const row = feed.locator("li").filter({ hasText: "的父母" });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole("button", { name: "查看" }).click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("世系", {
    timeout: 60_000,
  });
  await expect(page.locator(`[data-lineage-person="${fatherId}"]`)).toBeFocused(
    { timeout: 20_000 }
  );
});

test("明经胡氏：最近动态查看直达对应资料卡片", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·动态查看（测试）",
    sample.surname
  );

  const personId = await seedPerson(page, familyId, sample.wenGuang, []);
  const created = await apiJson(page, `/api/v1/families/${familyId}/claims`, {
    method: "POST",
    body: {
      subjectType: "PERSON",
      subjectId: personId,
      claimType: "OCCUPATION",
      value: { text: "万载知县，后升胶州刺史" },
      originType: "MANUAL",
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const claimId = (created.body as { claim: { id: string } }).claim.id;

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const feed = page.getByRole("region", { name: "最近动态" });
  await expect(feed).toBeVisible({ timeout: 60_000 });
  await expect(feed).toContainText("添加了职业");
  await feed
    .locator("li")
    .filter({ hasText: "添加了职业" })
    .getByRole("button", { name: "查看" })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(personId);
  await expect(page.getByRole("button", { name: /^待确认/ })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.locator(`[data-claim-id="${claimId}"]`)).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.locator(`[data-claim-id="${claimId}"]`).getByText("万载知县，后升胶州刺史")
  ).toBeVisible();
});

test("明经胡氏：概览有亲人无父母时 chip 打开添加父母", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·概览父母（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.wenGuang,
    sample.wenGuang.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );
  const spouseId = await seedPerson(
    page,
    familyId,
    {
      preferredName: "汪孺人",
      gender: "FEMALE",
      livingStatus: "DECEASED",
    },
    [{ claimType: "BIRTH_DATE", text: "约明嘉靖年间" }]
  );
  const spouseRel = await apiJson(
    page,
    `/api/v1/families/${familyId}/relationships`,
    {
      method: "POST",
      body: {
        fromPersonId: personId,
        toPersonId: spouseId,
        relationshipType: "SPOUSE",
      },
    }
  );
  expect(spouseRel.status, JSON.stringify(spouseRel.body)).toBe(201);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const parentsStep = page
    .getByRole("listitem")
    .filter({ hasText: "已有亲人成员的父母" });
  await expect(parentsStep).toContainText("已有亲人成员的父母", {
    timeout: 60_000,
  });
  await parentsStep
    .getByRole("button", {
      name: `为${sample.wenGuang.preferredName}补充父母`,
    })
    .click();
  const dialog = page.getByRole("dialog", { name: /添加父母/ });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(dialog).toContainText(sample.wenGuang.preferredName);
});

test("明经胡氏：资料卡来源详情显示说明", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·资料卡详情（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.wenGuang,
    sample.wenGuang.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  const birthCard = page
    .locator("[data-claim-id]")
    .filter({ hasText: "约明嘉靖年间" });
  await expect(birthCard).toBeVisible({ timeout: 60_000 });
  await birthCard.getByRole("button", { name: "添加资料来源" }).click();
  await birthCard.locator("#ev-type").selectOption("GENEALOGY_PAGE");
  await birthCard.getByLabel("来源标题（可选）").fill("资料卡说明来源（测试）");
  await birthCard
    .getByLabel("来源说明（可选）")
    .fill("西递口碑与谱牒互证，仅作测试。");
  await birthCard.getByRole("button", { name: "保存来源" }).click();
  await expect(birthCard.getByText("资料卡说明来源（测试）")).toBeVisible({
    timeout: 60_000,
  });
  await birthCard.getByRole("button", { name: "详情" }).click();
  await expect(birthCard.getByText("西递口碑与谱牒互证")).toBeVisible();
});

test("明经胡氏：来源库可打开非图片附件", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const { familyId, ownerId } = await createFamilyOwned(
    page,
    baseURL!,
    "西递明经胡氏·来源附件（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.wenGuang,
    sample.wenGuang.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  const birthCard = page
    .locator("[data-claim-id]")
    .filter({ hasText: "约明嘉靖年间" });
  await expect(birthCard).toBeVisible({ timeout: 60_000 });
  await birthCard.getByRole("button", { name: "添加资料来源" }).click();
  await birthCard.locator("#ev-type").selectOption("OTHER");
  await birthCard.getByLabel("来源标题（可选）").fill("谱牒目录 PDF（测试）");
  // Minimal PDF
  const pdf = Buffer.from(
    "%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
    "utf8"
  );
  await birthCard.locator('input[type="file"]').setInputFiles({
    name: "谱牒目录.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await birthCard.getByRole("button", { name: "保存来源" }).click();
  await expect(birthCard.getByText("谱牒目录 PDF（测试）")).toBeVisible({
    timeout: 90_000,
  });

  const claimId = await birthCard.getAttribute("data-claim-id");
  expect(claimId).toBeTruthy();
  const detail = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/${claimId}`
  );
  const mediaId = (
    detail.body as {
      evidenceLinks: { evidence: { mediaObjectId: string | null } }[];
    }
  ).evidenceLinks
    .map((l) => l.evidence.mediaObjectId)
    .find(Boolean);
  expect(mediaId, JSON.stringify(detail.body)).toBeTruthy();
  trackMedia(familyId, mediaId!, ownerId);

  await page.getByRole("tab", { name: "概览" }).click();
  const sourcesLib = page.getByRole("region", { name: "资料来源库" });
  const row = sourcesLib.locator("li").filter({ hasText: "谱牒目录 PDF（测试）" });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row.getByRole("button", { name: "打开" })).toBeVisible();
  const mediaRead = page.waitForResponse(
    (r) =>
      r.url().includes(`/media/${mediaId}`) &&
      r.request().method() === "GET" &&
      !r.url().includes("finalize")
  );
  // Popup may be about:blank / download depending on PDF handling — assert read API succeeds.
  page.once("popup", (p) => {
    void p.close().catch(() => undefined);
  });
  await row.getByRole("button", { name: "打开" }).click();
  expect((await mediaRead).ok()).toBeTruthy();
});

test("明经胡氏：来源库详情与动态查看展开说明", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·来源详情（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.wenGuang,
    sample.wenGuang.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  const birthCard = page
    .locator("[data-claim-id]")
    .filter({ hasText: "约明嘉靖年间" });
  await expect(birthCard).toBeVisible({ timeout: 60_000 });
  await birthCard.getByRole("button", { name: "添加资料来源" }).click();
  await birthCard.locator("#ev-type").selectOption("GENEALOGY_PAGE");
  await birthCard.getByLabel("来源标题（可选）").fill("西递明经胡氏族谱摘录（测试）");
  await birthCard.getByLabel("出处位置（可选）").fill("卷二·文光公");
  await birthCard
    .getByLabel("来源说明（可选）")
    .fill("据公开谱牒目录整理，仅作 Closed Alpha 测试。");
  await birthCard.getByRole("button", { name: "保存来源" }).click();
  await expect(birthCard.getByText("西递明经胡氏族谱摘录（测试）")).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("tab", { name: "概览" }).click();
  const sourcesLib = page.getByRole("region", { name: "资料来源库" });
  const row = sourcesLib
    .locator("li")
    .filter({ hasText: "西递明经胡氏族谱摘录（测试）" });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole("button", { name: "详情" }).click();
  await expect(row.getByText("据公开谱牒目录整理")).toBeVisible();
  await expect(row.getByText("出处：卷二·文光公")).toBeVisible();

  const feed = page.getByRole("region", { name: "最近动态" });
  await feed
    .locator("li")
    .filter({ hasText: "资料来源" })
    .getByRole("button", { name: "查看" })
    .click();
  await expect(
    sourcesLib
      .locator("li")
      .filter({ hasText: "西递明经胡氏族谱摘录（测试）" })
      .getByText("据公开谱牒目录整理")
  ).toBeVisible({ timeout: 20_000 });
});

test("明经胡氏：资料卡照片可内联查看", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const { familyId, ownerId } = await createFamilyOwned(
    page,
    baseURL!,
    "西递明经胡氏·资料卡照片（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.wenGuang,
    sample.wenGuang.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  const birthCard = page
    .locator("[data-claim-id]")
    .filter({ hasText: "约明嘉靖年间" });
  await expect(birthCard).toBeVisible({ timeout: 60_000 });
  await birthCard.getByRole("button", { name: "添加资料来源" }).click();
  await birthCard.locator("#ev-type").selectOption("PHOTO");
  await birthCard.getByLabel("来源标题（可选）").fill("资料卡内联照片（测试）");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  await birthCard.locator('input[type="file"]').setInputFiles({
    name: "records-inline.png",
    mimeType: "image/png",
    buffer: png,
  });
  await birthCard.getByRole("button", { name: "保存来源" }).click();
  await expect(birthCard.getByText("资料卡内联照片（测试）")).toBeVisible({
    timeout: 90_000,
  });

  const claimId = await birthCard.getAttribute("data-claim-id");
  expect(claimId).toBeTruthy();
  const detail = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/${claimId}`
  );
  const mediaId = (
    detail.body as {
      evidenceLinks: { evidence: { mediaObjectId: string | null } }[];
    }
  ).evidenceLinks
    .map((l) => l.evidence.mediaObjectId)
    .find(Boolean);
  expect(mediaId, JSON.stringify(detail.body)).toBeTruthy();
  trackMedia(familyId, mediaId!, ownerId);

  await birthCard.getByRole("button", { name: "查看", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "资料卡内联照片（测试）" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(
    dialog.getByRole("img", { name: "资料卡内联照片（测试）" })
  ).toBeVisible();
  await dialog.getByRole("button", { name: "关闭" }).click();
});

test("明经胡氏：来源库已用于可直达关联资料卡片", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·来源关联（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.wenGuang,
    sample.wenGuang.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  const birthCard = page
    .locator("[data-claim-id]")
    .filter({ hasText: "约明嘉靖年间" });
  await expect(birthCard).toBeVisible({ timeout: 60_000 });
  const claimId = await birthCard.getAttribute("data-claim-id");
  expect(claimId).toBeTruthy();
  await birthCard.getByRole("button", { name: "添加资料来源" }).click();
  await birthCard.locator("#ev-type").selectOption("GENEALOGY_PAGE");
  await birthCard.getByLabel("来源标题（可选）").fill("明经胡氏壬派宗谱（测试）");
  await birthCard.getByLabel("出处位置（可选）").fill("卷首");
  await birthCard.getByRole("button", { name: "保存来源" }).click();
  await expect(birthCard.getByText("明经胡氏壬派宗谱（测试）")).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("tab", { name: "概览" }).click();
  const sourcesLib = page.getByRole("region", { name: "资料来源库" });
  await expect(sourcesLib).toContainText("明经胡氏壬派宗谱（测试）", {
    timeout: 60_000,
  });
  await sourcesLib
    .locator("li")
    .filter({ hasText: "明经胡氏壬派宗谱（测试）" })
    .getByRole("button", { name: /已用于 \d+ 条资料/ })
    .click();
  await sourcesLib
    .getByRole("button", {
      name: `${sample.wenGuang.preferredName} · 出生`,
    })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(personId);
  await expect(page.locator(`[data-claim-id="${claimId}"]`)).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.locator(`[data-claim-id="${claimId}"]`).getByText("约明嘉靖年间")
  ).toBeVisible();
});

test("明经胡氏：人物抽屉来源库按钮直达概览来源库", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·抽屉来源库（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.wenGuang,
    sample.wenGuang.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "成员" }).click();
  await page
    .getByRole("button", { name: new RegExp(sample.wenGuang.preferredName) })
    .click();
  const drawer = page.getByRole("dialog");
  await expect(
    drawer.getByRole("heading", { name: sample.wenGuang.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    drawer.getByRole("button", { name: "在世系中查看" })
  ).toHaveCount(0);
  const birthCard = drawer
    .locator("[data-claim-id]")
    .filter({ hasText: "约明嘉靖年间" });
  await expect(birthCard).toBeVisible({ timeout: 60_000 });
  await birthCard.getByRole("button", { name: "添加资料来源" }).click();
  await birthCard.locator("#ev-type").selectOption("GENEALOGY_PAGE");
  await birthCard.getByLabel("来源标题（可选）").fill("抽屉来源库跳转（测试）");
  await birthCard.getByRole("button", { name: "保存来源" }).click();
  await expect(birthCard.getByText("抽屉来源库跳转（测试）")).toBeVisible({
    timeout: 60_000,
  });

  const claimId = await birthCard.getAttribute("data-claim-id");
  expect(claimId).toBeTruthy();
  const detail = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/${claimId}`
  );
  const evidenceId = (
    detail.body as { evidenceLinks: { evidence: { id: string } }[] }
  ).evidenceLinks[0]?.evidence.id;
  expect(evidenceId).toBeTruthy();

  await birthCard.getByRole("button", { name: "来源库" }).click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("概览", {
    timeout: 60_000,
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const sourcesLib = page.getByRole("region", { name: "资料来源库" });
  await expect(
    sourcesLib.locator(`[data-evidence-id="${evidenceId}"]`)
  ).toBeVisible({ timeout: 20_000 });
});

test("明经胡氏：资料卡来源库按钮直达概览来源库", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·资料卡来源库（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.wenGuang,
    sample.wenGuang.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  const birthCard = page
    .locator("[data-claim-id]")
    .filter({ hasText: "约明嘉靖年间" });
  await expect(birthCard).toBeVisible({ timeout: 60_000 });
  await birthCard.getByRole("button", { name: "添加资料来源" }).click();
  await birthCard.locator("#ev-type").selectOption("GENEALOGY_PAGE");
  await birthCard.getByLabel("来源标题（可选）").fill("来源库跳转谱（测试）");
  await birthCard.getByRole("button", { name: "保存来源" }).click();
  await expect(birthCard.getByText("来源库跳转谱（测试）")).toBeVisible({
    timeout: 60_000,
  });

  const claimId = await birthCard.getAttribute("data-claim-id");
  expect(claimId).toBeTruthy();
  const detail = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/${claimId}`
  );
  const evidenceId = (
    detail.body as { evidenceLinks: { evidence: { id: string } }[] }
  ).evidenceLinks[0]?.evidence.id;
  expect(evidenceId).toBeTruthy();

  await birthCard.getByRole("button", { name: "来源库" }).click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("概览", {
    timeout: 60_000,
  });
  const sourcesLib = page.getByRole("region", { name: "资料来源库" });
  await expect(
    sourcesLib.locator(`[data-evidence-id="${evidenceId}"]`)
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    sourcesLib.locator(`[data-evidence-id="${evidenceId}"]`)
  ).toContainText("来源库跳转谱（测试）");
});

test("明经胡氏：动态不采用查看展开对应记录", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·不采用查看（测试）",
    sample.surname
  );

  const personId = await seedPerson(page, familyId, sample.wenGuang, []);
  const created = await apiJson(page, `/api/v1/families/${familyId}/claims`, {
    method: "POST",
    body: {
      subjectType: "PERSON",
      subjectId: personId,
      claimType: "OCCUPATION",
      value: { text: "万载知县，后升胶州刺史" },
      originType: "MANUAL",
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const claimId = (created.body as { claim: { id: string } }).claim.id;
  const rejected = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/${claimId}/reject`,
    { method: "POST", body: {} }
  );
  expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const feed = page.getByRole("region", { name: "最近动态" });
  await expect(feed).toBeVisible({ timeout: 60_000 });
  await expect(feed).toContainText("不采用");
  await feed
    .locator("li")
    .filter({ hasText: "不采用" })
    .getByRole("button", { name: "查看" })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(personId);
  const rejectedPanel = page.locator("[data-rejected-claims]");
  await expect(rejectedPanel).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => rejectedPanel.evaluate((el) => (el as HTMLDetailsElement).open))
    .toBe(true);
  await expect(page.locator(`[data-claim-id="${claimId}"]`)).toBeVisible();
  await expect(
    page.locator(`[data-claim-id="${claimId}"]`).getByText("万载知县，后升胶州刺史")
  ).toBeVisible();
});

test("明经胡氏：采用不同说法后无来源则打开来源表单", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·采用后来源（测试）",
    sample.surname
  );

  const personId = await seedPerson(page, familyId, sample.wenGuang, []);
  const first = await apiJson(page, `/api/v1/families/${familyId}/claims`, {
    method: "POST",
    body: {
      subjectType: "PERSON",
      subjectId: personId,
      claimType: "BIRTH_DATE",
      value: { text: "约明嘉靖三十四年" },
      originType: "MANUAL",
    },
  });
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  const firstId = (first.body as { claim: { id: string } }).claim.id;
  const second = await apiJson(page, `/api/v1/families/${familyId}/claims`, {
    method: "POST",
    body: {
      subjectType: "PERSON",
      subjectId: personId,
      claimType: "BIRTH_DATE",
      value: { text: "约明嘉靖三十五年" },
      originType: "MANUAL",
    },
  });
  expect(second.status, JSON.stringify(second.body)).toBe(201);
  const secondId = (second.body as { claim: { id: string } }).claim.id;

  for (const id of [firstId, secondId]) {
    const accepted = await apiJson(
      page,
      `/api/v1/families/${familyId}/claims/${id}/accept`,
      { method: "POST", body: {} }
    );
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  }

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  const card = page.locator(`[data-claim-id="${firstId}"]`);
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByRole("button", { name: "采用这条" })).toBeVisible({
    timeout: 60_000,
  });
  await card.getByRole("button", { name: "采用这条" }).click();
  await expect(
    page.getByText("已采用这条说法。接着可以补上谱页或其他来源。")
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator(`[data-claim-id="${firstId}"]`).getByRole("button", {
      name: "保存来源",
    })
  ).toBeVisible({ timeout: 20_000 });
});

test("明经胡氏：无关系时世系为空态，不伪造第一代", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·世系空态（测试）",
    sample.surname
  );

  await seedPerson(page, familyId, sample.wenGuang, []);
  await seedPerson(page, familyId, sample.guanSan, []);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  await expect(page.getByText(/补充 \d+ 位成员的字辈/)).toHaveCount(0);
  await page.getByRole("tab", { name: "成员" }).click();
  await expect(page.getByText("第一代")).toHaveCount(0);
  await page.getByRole("tab", { name: "世系" }).click();
  await expect(
    page.getByText("添加家庭关系后，这里会按世代展示。")
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /第一代/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "添加家庭关系", exact: true })
  ).toBeVisible();
});

test("明经胡氏：无成员时打印版家谱为空态", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·打印空态（测试）",
    sample.surname
  );

  await page.goto(`/alpha/families/${familyId}/print`);
  await expect(
    page.getByRole("heading", { name: "西递明经胡氏·打印空态（测试）" })
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("还没有成员可排进家谱")).toBeVisible();
  await page.getByRole("link", { name: "去添加成员" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: /添加/ })
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole("button", { name: "打印或保存为 PDF" })
  ).toHaveCount(0);
});

test("明经胡氏：打印版同代按排行排序", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·打印排行（测试）",
    sample.surname
  );

  const fatherId = await seedPerson(page, familyId, sample.guanSan, []);
  const thirdId = await seedPerson(page, familyId, sample.yuanXi, [
    { claimType: "BIRTH_ORDER", text: "三" },
  ]);
  const eldestId = await seedPerson(
    page,
    familyId,
    {
      preferredName: "胡元锟",
      gender: "MALE",
      livingStatus: "DECEASED",
    },
    [{ claimType: "BIRTH_ORDER", text: "长" }]
  );
  for (const child of [thirdId, eldestId]) {
    const rel = await apiJson(
      page,
      `/api/v1/families/${familyId}/relationships`,
      {
        method: "POST",
        body: {
          fromPersonId: fatherId,
          toPersonId: child,
          relationshipType: "BIOLOGICAL_PARENT",
        },
      }
    );
    expect(rel.status, JSON.stringify(rel.body)).toBe(201);
  }

  await page.goto(`/alpha/families/${familyId}/print`);
  const gen2 = page.getByRole("region", { name: "第二代" });
  await expect(gen2).toBeVisible({ timeout: 60_000 });
  const headings = gen2.locator("h3");
  await expect(headings).toHaveCount(2);
  await expect(headings.nth(0)).toContainText("胡元锟");
  await expect(headings.nth(1)).toContainText("胡元熙");
});

test("明经胡氏：有成员无关系时打印版提示建立关系", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·打印无关系（测试）",
    sample.surname
  );

  await seedPerson(page, familyId, sample.wenGuang, []);
  await seedPerson(page, familyId, sample.guanSan, []);

  await page.goto(`/alpha/families/${familyId}/print`);
  await expect(
    page.getByRole("heading", { level: 1, name: "西递明经胡氏·打印无关系（测试）" })
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText(
      "尚未建立家庭关系。在世系里添加父母或配偶后，这里会按世代排版。"
    )
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /第一代/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "成员" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: sample.wenGuang.preferredName })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打印或保存为 PDF" })
  ).toBeVisible();
  await page.getByRole("link", { name: "去建立关系" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("世系", {
    timeout: 60_000,
  });
  await expect(
    page.getByRole("dialog", { name: "添加家庭关系" })
  ).toBeVisible({ timeout: 20_000 });
});

test("明经胡氏：唯一成员打印无关系时去添加成员", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·打印单人无关系（测试）",
    sample.surname
  );
  await seedPerson(page, familyId, sample.wenGuang, []);

  await page.goto(`/alpha/families/${familyId}/print`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "西递明经胡氏·打印单人无关系（测试）",
    })
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText("只有一位成员，还无法连成世代")
  ).toBeVisible();
  await page.getByRole("link", { name: "去添加成员" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("成员", {
    timeout: 60_000,
  });
  await expect(
    page.getByRole("dialog").or(page.getByLabel("姓名 / 常用称呼"))
  ).toBeVisible({ timeout: 60_000 });
});

test("明经胡氏：只读成员打印无关系时不催促建立", async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const { familyId, ownerId } = await createFamilyOwned(
    page,
    baseURL!,
    "西递明经胡氏·只读打印无关系（测试）",
    sample.surname
  );
  void ownerId;

  await seedPerson(page, familyId, sample.wenGuang, []);
  await seedPerson(page, familyId, sample.guanSan, []);

  const viewerId = await insertFakeUser();
  await insertMembership(familyId, viewerId, "VIEWER");
  const viewerCtx = await browser.newContext({ baseURL });
  const viewerPage = await viewerCtx.newPage();
  await loginAs(viewerPage, viewerId, baseURL!);
  await viewerPage.goto(`/alpha/families/${familyId}/print`);
  await expect(
    viewerPage.getByRole("heading", {
      level: 1,
      name: "西递明经胡氏·只读打印无关系（测试）",
    })
  ).toBeVisible({ timeout: 60_000 });
  await expect(viewerPage.getByText("尚未连成世代")).toBeVisible();
  await expect(
    viewerPage.getByRole("link", { name: "去建立关系" })
  ).toHaveCount(0);
  await viewerPage.getByRole("link", { name: "去世系查看" }).click();
  await expect(viewerPage).toHaveURL(
    new RegExp(`/alpha/families/${familyId}$`)
  );
  await expect(viewerPage.getByRole("tab", { selected: true })).toHaveText(
    "世系",
    { timeout: 60_000 }
  );
  await viewerCtx.close();
});

test("明经胡氏：打印版人名可打开人物页", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·打印人名（测试）",
    sample.surname
  );

  const personId = await seedPerson(page, familyId, sample.wenGuang, []);
  await page.goto(`/alpha/families/${familyId}/print`);
  await expect(
    page.getByRole("heading", { level: 1, name: "西递明经胡氏·打印人名（测试）" })
  ).toBeVisible({ timeout: 60_000 });
  await page
    .getByRole("link", { name: sample.wenGuang.preferredName })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/alpha/families/${familyId}/people/${personId}$`)
  );
  await expect(
    page.getByRole("heading", { level: 1, name: sample.wenGuang.preferredName })
  ).toBeVisible({ timeout: 60_000 });
});

test("明经胡氏：人物页可直达打印版对应条目", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·人物打印版（测试）",
    sample.surname
  );

  const personId = await seedPerson(page, familyId, sample.wenGuang, [
    { claimType: "BIRTH_DATE", text: "明嘉靖四年" },
  ]);
  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: sample.wenGuang.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: "在打印版家谱中查看" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/alpha/families/${familyId}/print\\?person=${personId}`)
  );
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "西递明经胡氏·人物打印版（测试）",
    })
  ).toBeVisible({ timeout: 60_000 });
  const entry = page.locator(`#print-person-${personId}`);
  await expect(entry).toBeVisible({ timeout: 20_000 });
  await expect(entry).toContainText(sample.wenGuang.preferredName);
});

test("明经胡氏：移除来源后可从动态恢复", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·来源恢复（测试）",
    sample.surname
  );

  await seedPerson(page, familyId, sample.wenGuang, [
    { claimType: "OCCUPATION", text: "万载知县，后升胶州刺史" },
  ]);

  const created = await apiJson(page, `/api/v1/families/${familyId}/evidence`, {
    method: "POST",
    body: {
      evidenceType: "DOCUMENT",
      title: "明经胡氏支谱摘录（测试）",
      visibility: "FAMILY",
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const evidenceId = (created.body as { evidence: { id: string } }).evidence.id;

  const del = await apiJson(
    page,
    `/api/v1/families/${familyId}/evidence/${evidenceId}`,
    { method: "DELETE", body: {} }
  );
  expect(del.status, JSON.stringify(del.body)).toBe(200);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const feed = page.getByRole("region", { name: "最近动态" });
  await expect(feed).toBeVisible({ timeout: 60_000 });
  const row = feed.locator("li").filter({ hasText: "移除了一条资料来源" });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole("button", { name: "恢复" }).click();
  await expect(page.getByText("已恢复「明经胡氏支谱摘录（测试）」")).toBeVisible({
    timeout: 60_000,
  });

  const sourcesLib = page.getByRole("region", { name: "资料来源库" });
  await expect(
    sourcesLib.locator(`[data-evidence-id="${evidenceId}"]`)
  ).toBeVisible({ timeout: 20_000 });
});

test("明经胡氏：取消关系后可从动态恢复", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·关系恢复（测试）",
    sample.surname
  );

  const fatherId = await seedPerson(page, familyId, sample.guanSan, []);
  const childId = await seedPerson(page, familyId, sample.yuanXi, []);
  const rel = await apiJson(page, `/api/v1/families/${familyId}/relationships`, {
    method: "POST",
    body: {
      fromPersonId: fatherId,
      toPersonId: childId,
      relationshipType: "BIOLOGICAL_PARENT",
    },
  });
  expect(rel.status, JSON.stringify(rel.body)).toBe(201);
  const relationshipId = (
    rel.body as { relationship: { id: string } }
  ).relationship.id;

  const del = await apiJson(
    page,
    `/api/v1/families/${familyId}/relationships/${relationshipId}`,
    { method: "DELETE", body: {} }
  );
  expect(del.status, JSON.stringify(del.body)).toBe(200);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const feed = page.getByRole("region", { name: "最近动态" });
  await expect(feed).toBeVisible({ timeout: 60_000 });
  const row = feed.locator("li").filter({
    hasText: `取消了「${sample.guanSan.preferredName}」与「${sample.yuanXi.preferredName}」的家庭关系`,
  });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole("button", { name: "恢复" }).click();
  await expect(
    page.getByText(
      `已恢复「${sample.guanSan.preferredName}」与「${sample.yuanXi.preferredName}」的家庭关系`
    )
  ).toBeVisible({ timeout: 60_000 });

  await page.getByRole("tab", { name: "世系" }).click();
  await expect(page.getByRole("heading", { name: /第二代/ })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByText(sample.yuanXi.preferredName, { exact: true }).first()
  ).toBeVisible({ timeout: 20_000 });
});

test("明经胡氏：移除成员后可从动态恢复", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·成员恢复（测试）",
    sample.surname
  );

  const fatherId = await seedPerson(page, familyId, sample.guanSan, []);
  const childId = await seedPerson(page, familyId, sample.yuanXi, []);
  const rel = await apiJson(page, `/api/v1/families/${familyId}/relationships`, {
    method: "POST",
    body: {
      fromPersonId: fatherId,
      toPersonId: childId,
      relationshipType: "BIOLOGICAL_PARENT",
    },
  });
  expect(rel.status, JSON.stringify(rel.body)).toBe(201);

  const del = await apiJson(
    page,
    `/api/v1/families/${familyId}/persons/${childId}`,
    { method: "DELETE", body: {} }
  );
  expect(del.status, JSON.stringify(del.body)).toBe(200);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const feed = page.getByRole("region", { name: "最近动态" });
  await expect(feed).toBeVisible({ timeout: 60_000 });
  const row = feed
    .locator("li")
    .filter({ hasText: `移除了成员「${sample.yuanXi.preferredName}」` });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole("button", { name: "恢复" }).click();
  await expect(page.getByText(/已恢复「胡元熙」/)).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole("tab", { name: "成员" }).click();
  await expect(
    page.getByRole("button", { name: new RegExp(sample.yuanXi.preferredName) })
  ).toBeVisible({ timeout: 60_000 });

  await page.getByRole("tab", { name: "世系" }).click();
  await expect(page.getByRole("heading", { name: /第二代/ })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.locator(`[data-lineage-person="${childId}"]`)
  ).toBeVisible();
});

test("明经胡氏：只读成员概览下一步用浏览文案", async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const { familyId, ownerId } = await createFamilyOwned(
    page,
    baseURL!,
    "西递明经胡氏·只读概览（测试）",
    sample.surname
  );
  void ownerId;

  await seedPerson(page, familyId, sample.wenGuang, []);
  await seedPerson(page, familyId, sample.guanSan, []);

  const viewerId = await insertFakeUser();
  await insertMembership(familyId, viewerId, "VIEWER");
  const viewerCtx = await browser.newContext({ baseURL });
  const viewerPage = await viewerCtx.newPage();
  await loginAs(viewerPage, viewerId, baseURL!);
  await viewerPage.goto(`/alpha/families/${familyId}`);
  await expect(viewerPage.getByRole("tab", { selected: true })).toHaveText(
    "概览",
    { timeout: 60_000 }
  );
  const connectStep = viewerPage
    .getByRole("listitem")
    .filter({ hasText: "未连入世系" });
  await expect(connectStep).toContainText("还有 2 位成员未连入世系", {
    timeout: 60_000,
  });
  await expect(connectStep).toContainText("可先打开人物页了解他们");
  await expect(connectStep).not.toContainText("点人名可为 TA 添加父母");
  await connectStep
    .getByRole("button", { name: `查看${sample.wenGuang.preferredName}` })
    .click();
  await expect(
    viewerPage.getByRole("dialog").getByRole("heading", {
      name: sample.wenGuang.preferredName,
    })
  ).toBeVisible({ timeout: 60_000 });
  await viewerCtx.close();
});

test("明经胡氏：只读成员概览缺出生信息可打开人物", async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const { familyId, ownerId } = await createFamilyOwned(
    page,
    baseURL!,
    "西递明经胡氏·只读出生（测试）",
    sample.surname
  );
  void ownerId;

  const fatherId = await seedPerson(page, familyId, sample.guanSan, [
    { claimType: "BIRTH_DATE", text: "约清乾隆年间" },
  ]);
  const childId = await seedPerson(page, familyId, sample.yuanXi, []);
  const rel = await apiJson(page, `/api/v1/families/${familyId}/relationships`, {
    method: "POST",
    body: {
      fromPersonId: fatherId,
      toPersonId: childId,
      relationshipType: "BIOLOGICAL_PARENT",
    },
  });
  expect(rel.status, JSON.stringify(rel.body)).toBe(201);

  const viewerId = await insertFakeUser();
  await insertMembership(familyId, viewerId, "VIEWER");
  const viewerCtx = await browser.newContext({ baseURL });
  const viewerPage = await viewerCtx.newPage();
  await loginAs(viewerPage, viewerId, baseURL!);
  await viewerPage.goto(`/alpha/families/${familyId}`);
  const birthStep = viewerPage
    .getByRole("listitem")
    .filter({ hasText: "还没有出生信息" });
  await expect(birthStep).toBeVisible({ timeout: 60_000 });
  await expect(birthStep).toContainText("可先打开人物页了解");
  await birthStep
    .getByRole("button", { name: `查看${sample.yuanXi.preferredName}` })
    .click();
  await expect(
    viewerPage.getByRole("dialog").getByRole("heading", {
      name: sample.yuanXi.preferredName,
    })
  ).toBeVisible({ timeout: 60_000 });
  await viewerCtx.close();
});

test("明经胡氏：只读成员人物页无资料时生平为空提示", async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const { familyId, ownerId } = await createFamilyOwned(
    page,
    baseURL!,
    "西递明经胡氏·只读生平（测试）",
    sample.surname
  );
  void ownerId;

  const personId = await seedPerson(page, familyId, sample.wenGuang, []);

  const viewerId = await insertFakeUser();
  await insertMembership(familyId, viewerId, "VIEWER");
  const viewerCtx = await browser.newContext({ baseURL });
  const viewerPage = await viewerCtx.newPage();
  await loginAs(viewerPage, viewerId, baseURL!);
  await viewerPage.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    viewerPage.getByRole("heading", {
      level: 1,
      name: sample.wenGuang.preferredName,
    })
  ).toBeVisible({ timeout: 60_000 });
  const life = viewerPage.getByRole("region", { name: "生平" });
  await expect(life).toContainText("暂无生平记录。有编辑权限的家人补充后");
  await expect(
    life.getByRole("link", { name: "返回家族档案" })
  ).toBeVisible();
  await expect(
    life.getByRole("link", { name: "在打印版家谱中查看" })
  ).toBeVisible();
  await expect(
    viewerPage.getByRole("button", { name: "补充出生" })
  ).toHaveCount(0);
  await viewerCtx.close();
});

test("明经胡氏：打印版脚注可直达来源库", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·打印脚注（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.wenGuang,
    sample.wenGuang.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  const birthCard = page
    .locator("[data-claim-id]")
    .filter({ hasText: "约明嘉靖年间" });
  await expect(birthCard).toBeVisible({ timeout: 60_000 });
  await birthCard.getByRole("button", { name: "添加资料来源" }).click();
  await birthCard.locator("#ev-type").selectOption("GENEALOGY_PAGE");
  await birthCard.getByLabel("来源标题（可选）").fill("打印脚注来源（测试）");
  await birthCard.getByRole("button", { name: "保存来源" }).click();
  await expect(birthCard.getByText("打印脚注来源（测试）")).toBeVisible({
    timeout: 60_000,
  });

  const claimId = await birthCard.getAttribute("data-claim-id");
  expect(claimId).toBeTruthy();
  const detail = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/${claimId}`
  );
  const evidenceId = (
    detail.body as { evidenceLinks: { evidence: { id: string } }[] }
  ).evidenceLinks[0]?.evidence.id;
  expect(evidenceId).toBeTruthy();

  await page.goto(`/alpha/families/${familyId}/print`);
  await expect(
    page.getByRole("region", { name: "资料来源" })
  ).toBeVisible({ timeout: 60_000 });
  await page
    .getByRole("link", { name: /打印脚注来源（测试）/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("概览", {
    timeout: 60_000,
  });
  const sourcesLib = page.getByRole("region", { name: "资料来源库" });
  await expect(
    sourcesLib.locator(`[data-evidence-id="${evidenceId}"]`)
  ).toBeVisible({ timeout: 20_000 });
});

test("明经胡氏：打印版正文角标可直达来源库", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·打印角标（测试）",
    sample.surname
  );

  const personId = await seedPerson(
    page,
    familyId,
    sample.wenGuang,
    sample.wenGuang.claims.filter((c) => c.claimType === "BIRTH_DATE")
  );

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  const birthCard = page
    .locator("[data-claim-id]")
    .filter({ hasText: "约明嘉靖年间" });
  await expect(birthCard).toBeVisible({ timeout: 60_000 });
  await birthCard.getByRole("button", { name: "添加资料来源" }).click();
  await birthCard.locator("#ev-type").selectOption("GENEALOGY_PAGE");
  await birthCard.getByLabel("来源标题（可选）").fill("打印角标来源（测试）");
  await birthCard.getByRole("button", { name: "保存来源" }).click();
  await expect(birthCard.getByText("打印角标来源（测试）")).toBeVisible({
    timeout: 60_000,
  });

  const claimId = await birthCard.getAttribute("data-claim-id");
  expect(claimId).toBeTruthy();
  const detail = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/${claimId}`
  );
  const evidenceId = (
    detail.body as { evidenceLinks: { evidence: { id: string } }[] }
  ).evidenceLinks[0]?.evidence.id;
  expect(evidenceId).toBeTruthy();

  await page.goto(`/alpha/families/${familyId}/print`);
  await expect(
    page.getByRole("link", { name: sample.wenGuang.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: "查看来源 1" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(page.getByRole("tab", { selected: true })).toHaveText("概览", {
    timeout: 60_000,
  });
  const sourcesLib = page.getByRole("region", { name: "资料来源库" });
  await expect(
    sourcesLib.locator(`[data-evidence-id="${evidenceId}"]`)
  ).toBeVisible({ timeout: 20_000 });
});

test("明经胡氏：打印版亲属名可打开人物页", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·打印亲属（测试）",
    sample.surname
  );

  const fatherId = await seedPerson(page, familyId, sample.guanSan, []);
  const childId = await seedPerson(page, familyId, sample.yuanXi, []);
  const rel = await apiJson(page, `/api/v1/families/${familyId}/relationships`, {
    method: "POST",
    body: {
      fromPersonId: fatherId,
      toPersonId: childId,
      relationshipType: "BIOLOGICAL_PARENT",
    },
  });
  expect(rel.status, JSON.stringify(rel.body)).toBe(201);

  await page.goto(`/alpha/families/${familyId}/print`);
  const childEntry = page
    .locator(".alpha-panel")
    .filter({ has: page.getByRole("heading", { name: sample.yuanXi.preferredName }) });
  await expect(childEntry).toBeVisible({ timeout: 60_000 });
  await childEntry
    .getByRole("link", { name: sample.guanSan.preferredName })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/alpha/families/${familyId}/people/${fatherId}$`)
  );
  await expect(
    page.getByRole("heading", { level: 1, name: sample.guanSan.preferredName })
  ).toBeVisible({ timeout: 60_000 });
});

test("明经胡氏：已移除人物页可恢复", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·人物页恢复（测试）",
    sample.surname
  );
  const personId = await seedPerson(page, familyId, sample.wenGuang, []);
  const del = await apiJson(
    page,
    `/api/v1/families/${familyId}/persons/${personId}`,
    { method: "DELETE", body: {} }
  );
  expect(del.status, JSON.stringify(del.body)).toBe(200);

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("button", { name: "恢复这位家人" })
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "恢复这位家人" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: sample.wenGuang.preferredName,
    })
  ).toBeVisible({ timeout: 60_000 });
});

test("明经胡氏：编辑者打开已移除人物页可去概览", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const { familyId } = await createFamilyOwned(
    page,
    baseURL!,
    "西递明经胡氏·编辑者见已移除（测试）",
    sample.surname
  );
  const personId = await seedPerson(page, familyId, sample.wenGuang, []);
  const del = await apiJson(
    page,
    `/api/v1/families/${familyId}/persons/${personId}`,
    { method: "DELETE", body: {} }
  );
  expect(del.status, JSON.stringify(del.body)).toBe(200);

  const editorId = await insertFakeUser();
  await insertMembership(familyId, editorId, "EDITOR");
  await loginAs(page, editorId, baseURL!);

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByText(/请联系创建者或管理员在概览「最近动态」中恢复/)
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole("button", { name: "恢复这位家人" })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "去概览最近动态" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  await expect(
    page.getByRole("heading", { name: "最近动态" })
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("需创建者或管理员恢复").first()).toBeVisible({
    timeout: 60_000,
  });
});

test("明经胡氏：无出生信息时人物页仍可补充照片录音故事", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·无出生补充（测试）",
    sample.surname
  );
  const personId = await seedPerson(page, familyId, sample.wenGuang, []);

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: sample.wenGuang.preferredName,
    })
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "补充照片" })).toBeVisible();
  await expect(page.getByRole("button", { name: "补充录音" })).toBeVisible();
  await expect(page.getByRole("button", { name: "补充故事" })).toBeVisible();
});

test("明经胡氏：世系未连接分支可点人名添加关系", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·世系分支（测试）",
    sample.surname
  );
  await seedPerson(page, familyId, sample.wenGuang, []);
  await seedPerson(page, familyId, sample.guanSan, []);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "世系" }).click();
  const branchBox = page.getByRole("region", { name: "尚未连接的家族分支" });
  await expect(branchBox).toBeVisible({ timeout: 60_000 });
  await expect(branchBox).toContainText("2 个尚未连接");
  await branchBox
    .getByRole("button", { name: sample.guanSan.preferredName })
    .or(branchBox.getByRole("button", { name: sample.wenGuang.preferredName }))
    .first()
    .click();
  await expect(
    page.getByRole("dialog").getByText(/为「.+」添加/)
  ).toBeVisible({ timeout: 60_000 });
});

test("明经胡氏：人物页可移除错误的父母关系", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·人物页移除关系（测试）",
    sample.surname
  );
  const fatherId = await seedPerson(page, familyId, sample.guanSan, []);
  const childId = await seedPerson(page, familyId, sample.yuanXi, []);
  const rel = await apiJson(page, `/api/v1/families/${familyId}/relationships`, {
    method: "POST",
    body: {
      fromPersonId: fatherId,
      toPersonId: childId,
      relationshipType: "BIOLOGICAL_PARENT",
    },
  });
  expect(rel.status, JSON.stringify(rel.body)).toBe(201);

  await page.goto(`/alpha/families/${familyId}/people/${childId}`);
  const kin = page.locator("section").filter({
    has: page.getByRole("heading", { name: "家人" }),
  });
  await expect(
    kin.getByRole("link", { name: sample.guanSan.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  page.once("dialog", (d) => d.accept());
  await kin.getByRole("button", { name: "移除" }).click();
  await expect(
    kin.getByRole("link", { name: sample.guanSan.preferredName })
  ).toHaveCount(0, { timeout: 60_000 });
  const undoFlash = page.getByRole("status").filter({
    hasText: `已移除与「${sample.guanSan.preferredName}」的家庭关系`,
  });
  await expect(undoFlash).toBeVisible({ timeout: 60_000 });
  await undoFlash.getByRole("button", { name: "恢复" }).click();
  await expect(
    kin.getByRole("link", { name: sample.guanSan.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole("status").filter({
      hasText: `已恢复与「${sample.guanSan.preferredName}」的家庭关系`,
    })
  ).toBeVisible({ timeout: 60_000 });
});

test("明经胡氏：打印版空条目可去补充资料", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·打印补充（测试）",
    sample.surname
  );
  const personId = await seedPerson(page, familyId, sample.wenGuang, []);

  await page.goto(`/alpha/families/${familyId}/print`);
  const entry = page.locator(`#print-person-${personId}`);
  await expect(entry).toBeVisible({ timeout: 60_000 });
  await expect(entry.getByText("暂无更多记录")).toBeVisible();
  await entry.getByRole("link", { name: "补充资料" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/alpha/families/${familyId}/people/${personId}$`)
  );
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: sample.wenGuang.preferredName,
    })
  ).toBeVisible({ timeout: 60_000 });
});

test("明经胡氏：资料来源库可直接收录来源", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·库收录（测试）",
    sample.surname
  );
  const personId = await seedPerson(page, familyId, sample.wenGuang, [
    { claimType: "BIRTH_DATE", text: "约明嘉靖年间" },
    { claimType: "BIRTH_PLACE", text: "西递" },
  ]);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const sourcesLib = page.getByRole("region", { name: "资料来源库" });
  await expect(sourcesLib).toBeVisible({ timeout: 60_000 });
  await sourcesLib.getByRole("button", { name: "收录来源" }).click();
  const form = sourcesLib.getByRole("form", { name: "收录资料来源" });
  await form.locator("#lib-ev-type").selectOption("GENEALOGY_PAGE");
  await form.getByLabel("来源标题（可选）").fill("库收录谱页（测试）");
  await form.getByLabel("年代 / 日期（可选）").fill("清嘉庆年间");
  await form.getByRole("button", { name: "保存到资料来源库" }).click();
  await expect(
    sourcesLib.getByRole("list", { name: "资料来源列表" })
  ).toContainText("库收录谱页（测试）", { timeout: 60_000 });
  await expect(sourcesLib.getByText("已用于 0 条资料")).toBeVisible();

  const row = sourcesLib
    .locator("[data-evidence-id]")
    .filter({ hasText: "库收录谱页（测试）" });
  await row.getByRole("button", { name: "详情" }).click();
  await expect(row.getByText("年代 / 日期：清嘉庆年间")).toBeVisible();
  await row.getByRole("button", { name: "挂到人物资料" }).click();
  const attach = sourcesLib.getByRole("form", { name: "挂到人物资料" });
  await attach.locator("select").first().selectOption(personId);
  await expect(attach.locator("select").nth(1)).not.toHaveValue("", {
    timeout: 60_000,
  });
  const firstClaimId = await attach.locator("select").nth(1).inputValue();
  await attach.getByRole("button", { name: "确认挂接" }).click();
  await expect(row.getByText("已用于 1 条资料")).toBeVisible({
    timeout: 60_000,
  });

  await row.getByRole("button", { name: "再挂到人物资料" }).click();
  const reattach = sourcesLib.getByRole("form", { name: "挂到人物资料" });
  await reattach.locator("select").first().selectOption(personId);
  await expect(reattach.locator("select").nth(1)).not.toHaveValue("", {
    timeout: 60_000,
  });
  const claimSelect = reattach.locator("select").nth(1);
  const claimOptions = claimSelect.locator("option");
  const optionCount = await claimOptions.count();
  let secondClaimId = "";
  for (let i = 0; i < optionCount; i++) {
    const value = await claimOptions.nth(i).getAttribute("value");
    if (value && value !== firstClaimId) {
      secondClaimId = value;
      break;
    }
  }
  expect(secondClaimId).toBeTruthy();
  await claimSelect.selectOption(secondClaimId);
  await reattach.getByRole("button", { name: "确认挂接" }).click();
  await expect(row.getByText("已用于 2 条资料")).toBeVisible({
    timeout: 60_000,
  });
});

test("明经胡氏：资料来源库空筛选可收录对应类型", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·空筛选收录（测试）",
    sample.surname
  );
  await seedPerson(page, familyId, sample.wenGuang, []);
  const parked = await apiJson(page, `/api/v1/families/${familyId}/evidence`, {
    method: "POST",
    body: {
      evidenceType: "GENEALOGY_PAGE",
      title: "已有谱页（测试）",
    },
  });
  expect(parked.status, JSON.stringify(parked.body)).toBe(201);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const sourcesLib = page.getByRole("region", { name: "资料来源库" });
  await expect(sourcesLib).toBeVisible({ timeout: 60_000 });
  await expect(
    sourcesLib.getByRole("list", { name: "资料来源列表" })
  ).toContainText("已有谱页（测试）", { timeout: 60_000 });

  await sourcesLib.getByRole("button", { name: "照片", exact: true }).click();
  await expect(sourcesLib.getByText("这一类还没有来源。")).toBeVisible();
  await sourcesLib.getByRole("button", { name: "收录照片" }).click();
  const form = sourcesLib.getByRole("form", { name: "收录资料来源" });
  await expect(form.locator("#lib-ev-type")).toHaveValue("PHOTO");
  await expect(
    sourcesLib.getByRole("button", { name: "查看全部" })
  ).toBeVisible();
});

test("明经胡氏：空库使用已有来源可去新建", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·空库新建来源（测试）",
    sample.surname
  );
  const personId = await seedPerson(page, familyId, sample.wenGuang, [
    { claimType: "BIRTH_DATE", text: "约明嘉靖年间" },
  ]);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption(personId);
  const birthCard = page
    .locator("[data-claim-id]")
    .filter({ hasText: "约明嘉靖年间" });
  await expect(birthCard).toBeVisible({ timeout: 60_000 });
  await birthCard.getByRole("button", { name: "添加资料来源" }).click();
  await birthCard.getByRole("button", { name: "使用已有来源" }).click();
  await expect(
    birthCard.getByText("还没有可复用的来源，请先新建一条。")
  ).toBeVisible();
  await birthCard.getByRole("button", { name: "去新建来源" }).click();
  await expect(birthCard.locator("#ev-type")).toBeVisible();
  await expect(
    birthCard.getByRole("button", { name: "新建来源", pressed: true })
  ).toBeVisible();
});

test("明经胡氏：唯一成员添加亲属提示新建", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·唯一成员加亲（测试）",
    sample.surname
  );
  const personId = await seedPerson(page, familyId, sample.wenGuang, []);

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: sample.wenGuang.preferredName,
    })
  ).toBeVisible({ timeout: 60_000 });
  await page
    .getByRole("group", { name: "为这位家人添加亲人" })
    .getByRole("button", { name: "添加父母" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}$`));
  const dialog = page.getByRole("dialog", { name: /添加父母/ });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(dialog.getByRole("button", { name: "选用已有" })).toBeDisabled();
  await expect(
    dialog.getByText("还没有其他成员可选用，请先用「新建成员」添加。")
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "新建成员" })).toBeEnabled();
  await expect(dialog.locator("#kin-name")).toBeVisible();
});

test("明经胡氏：无成员时资料来源库仍可见", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·无成员来源库（测试）",
    sample.surname
  );
  const parked = await apiJson(page, `/api/v1/families/${familyId}/evidence`, {
    method: "POST",
    body: {
      evidenceType: "GENEALOGY_PAGE",
      title: "无成员谱页（测试）",
    },
  });
  expect(parked.status, JSON.stringify(parked.body)).toBe(201);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const sourcesLib = page.getByRole("region", { name: "资料来源库" });
  await expect(sourcesLib).toBeVisible({ timeout: 60_000 });
  await expect(sourcesLib).toContainText("无成员谱页（测试）");
  await expect(
    sourcesLib.getByText(/还没有成员，来源仍可收录与查看/)
  ).toBeVisible();
  await sourcesLib.getByRole("button", { name: "去添加成员" }).click();
  await expect(
    page.getByRole("dialog").or(page.getByLabel("姓名 / 常用称呼"))
  ).toBeVisible({ timeout: 60_000 });
});

test("明经胡氏：人物页来源详情可看年代日期", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·人物页来源年代（测试）",
    sample.surname
  );
  const personId = await seedPerson(page, familyId, sample.wenGuang, [
    { claimType: "BIRTH_DATE", text: "约明嘉靖年间" },
  ]);
  const claims = await apiJson(
    page,
    `/api/v1/families/${familyId}/persons/${personId}/claims`
  );
  expect(claims.status, JSON.stringify(claims.body)).toBe(200);
  const claimId = (
    claims.body as { claims: { id: string; claimType: string }[] }
  ).claims.find((c) => c.claimType === "BIRTH_DATE")!.id;
  const ev = await apiJson(page, `/api/v1/families/${familyId}/evidence`, {
    method: "POST",
    body: {
      evidenceType: "GENEALOGY_PAGE",
      title: "年代来源（测试）",
      sourceDateText: "明嘉靖三十四年",
    },
  });
  expect(ev.status, JSON.stringify(ev.body)).toBe(201);
  const evidenceId = (ev.body as { evidence: { id: string } }).evidence.id;
  const linked = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/${claimId}/evidence-links`,
    {
      method: "POST",
      body: { evidenceId, relation: "SUPPORTS" },
    }
  );
  expect(linked.status, JSON.stringify(linked.body)).toBe(201);

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: sample.wenGuang.preferredName,
    })
  ).toBeVisible({ timeout: 60_000 });
  const life = page.getByRole("region", { name: "生平" });
  await expect(life.getByText(/来源：.*年代来源（测试）/)).toBeVisible({
    timeout: 60_000,
  });
  await life.getByRole("button", { name: "详情" }).click();
  await expect(life.getByText("年代 / 日期：明嘉靖三十四年")).toBeVisible();
});

test("明经胡氏：世系唯一成员去添加成员打开表单", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·世系单人加成员（测试）",
    sample.surname
  );
  await seedPerson(page, familyId, sample.wenGuang, []);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "世系" }).click();
  await page.getByRole("button", { name: "去添加成员" }).click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("成员", {
    timeout: 60_000,
  });
  await expect(
    page.getByRole("dialog").or(page.getByLabel("姓名 / 常用称呼"))
  ).toBeVisible({ timeout: 60_000 });
});

test("明经胡氏：唯一成员抽屉关系CTA去添加成员", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·抽屉单人加成员（测试）",
    sample.surname
  );
  await seedPerson(page, familyId, sample.wenGuang, []);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "成员" }).click();
  await page
    .getByRole("button", { name: new RegExp(sample.wenGuang.preferredName) })
    .click();
  const drawer = page.getByRole("dialog");
  await expect(
    drawer.getByRole("heading", { name: sample.wenGuang.preferredName })
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    drawer.getByRole("button", { name: "选用已有成员建立关系" })
  ).toHaveCount(0);
  await drawer.getByRole("button", { name: "去添加成员" }).click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("成员", {
    timeout: 60_000,
  });
  await expect(
    page.getByRole("dialog", { name: /添加成员|添加家人/ }).or(
      page.getByLabel("姓名 / 常用称呼")
    )
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByText("至少需要两位成员")
  ).toHaveCount(0);
});

test("明经胡氏：编辑者抽屉不可移除成员", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const { familyId } = await createFamilyOwned(
    page,
    baseURL!,
    "西递明经胡氏·编辑者不可删人（测试）",
    sample.surname
  );
  await seedPerson(page, familyId, sample.wenGuang, []);
  const editorId = await insertFakeUser();
  await insertMembership(familyId, editorId, "EDITOR");
  await loginAs(page, editorId, baseURL!);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "成员" }).click();
  await page
    .getByRole("button", { name: sample.wenGuang.preferredName })
    .click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible({ timeout: 60_000 });
  await expect(
    drawer.getByRole("button", { name: "移除这位成员" })
  ).toHaveCount(0);
  await expect(
    drawer.getByRole("button", { name: "查看人物页" })
  ).toBeVisible();
});

test("明经胡氏：编辑者概览不显示邀请家人", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const { familyId } = await createFamilyOwned(
    page,
    baseURL!,
    "西递明经胡氏·编辑者无邀请（测试）",
    sample.surname
  );
  await seedPerson(page, familyId, sample.wenGuang, []);
  const editorId = await insertFakeUser();
  await insertMembership(familyId, editorId, "EDITOR");
  await loginAs(page, editorId, baseURL!);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  await expect(
    page.getByRole("region", { name: "邀请家人" })
  ).toHaveCount(0, { timeout: 60_000 });
  const next = page.getByRole("region", { name: "下一步" }).or(
    page.locator("section").filter({ has: page.getByRole("heading", { name: "下一步" }) })
  );
  await expect(next.first()).toBeVisible({ timeout: 60_000 });
  await expect(
    next.first().getByRole("button", { name: "邀请家人" })
  ).toHaveCount(0);
});

test("明经胡氏：编辑者人物页待确认 chip 需管理员", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const { familyId } = await createFamilyOwned(
    page,
    baseURL!,
    "西递明经胡氏·编辑者人物待确认（测试）",
    sample.surname
  );
  const personId = await seedPerson(page, familyId, sample.wenGuang, []);
  const created = await apiJson(page, `/api/v1/families/${familyId}/claims`, {
    method: "POST",
    body: {
      subjectType: "PERSON",
      subjectId: personId,
      claimType: "OCCUPATION",
      value: { text: "万载知县（人物页编辑者）" },
      originType: "MANUAL",
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);

  const editorId = await insertFakeUser();
  await insertMembership(familyId, editorId, "EDITOR");
  await loginAs(page, editorId, baseURL!);

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: sample.wenGuang.preferredName,
    })
  ).toBeVisible({ timeout: 60_000 });
  const life = page.getByRole("region", { name: "档案" });
  await expect(
    life.getByRole("button", { name: "待创建者或管理员确认", exact: true })
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    life.getByRole("button", { name: "待确认", exact: true })
  ).toHaveCount(0);
});

test("明经胡氏：编辑者概览待确认显示需管理员", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const { familyId } = await createFamilyOwned(
    page,
    baseURL!,
    "西递明经胡氏·编辑者待确认文案（测试）",
    sample.surname
  );
  const personId = await seedPerson(page, familyId, sample.wenGuang, []);
  const created = await apiJson(page, `/api/v1/families/${familyId}/claims`, {
    method: "POST",
    body: {
      subjectType: "PERSON",
      subjectId: personId,
      claimType: "OCCUPATION",
      value: { text: "万载知县（编辑者待确认文案）" },
      originType: "MANUAL",
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const claimId = (created.body as { claim: { id: string } }).claim.id;

  const editorId = await insertFakeUser();
  await insertMembership(familyId, editorId, "EDITOR");
  await loginAs(page, editorId, baseURL!);

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const pending = page.getByRole("region", { name: /待确认资料/ });
  await expect(pending).toBeVisible({ timeout: 60_000 });
  await expect(pending.getByText("待创建者或管理员确认")).toBeVisible();
  await pending
    .getByRole("button", { name: /待创建者或管理员确认/ })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator(`[data-claim-id="${claimId}"]`)).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page
      .locator(`[data-claim-id="${claimId}"]`)
      .getByText("需创建者或管理员确认后才会成为正式记载")
  ).toBeVisible();
  await expect(
    page
      .locator(`[data-claim-id="${claimId}"]`)
      .getByRole("button", { name: "确认这条资料" })
  ).toHaveCount(0);
});

test("明经胡氏：邀请链接丢失会话可重新生成", async ({ page, baseURL }) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const familyId = await createFamily(
    page,
    baseURL!,
    "西递明经胡氏·邀请重生成（测试）",
    sample.surname
  );

  await page.goto(`/alpha/families/${familyId}`);
  await page.getByRole("tab", { name: "概览" }).click();
  const inviteBox = page.getByRole("region", { name: "邀请家人" });
  await expect(inviteBox).toBeVisible({ timeout: 60_000 });
  await inviteBox.locator("#invite-role").selectOption("EDITOR");
  await inviteBox.getByRole("button", { name: "生成邀请链接" }).click();
  const inviteUrl = await inviteBox.locator("#invite-link").inputValue();
  expect(inviteUrl).toMatch(/\/alpha\/invite\//);
  const pending = inviteBox.getByRole("list", { name: "尚未使用的邀请" });
  await expect(pending.getByRole("button", { name: "复制链接" })).toBeVisible({
    timeout: 60_000,
  });

  await page.evaluate((fid) => {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(`alpha-invite-link:${fid}:`)) keys.push(k);
    }
    for (const k of keys) sessionStorage.removeItem(k);
  }, familyId);
  await page.reload();
  await page.getByRole("tab", { name: "概览" }).click();
  const inviteBox2 = page.getByRole("region", { name: "邀请家人" });
  const pending2 = inviteBox2.getByRole("list", { name: "尚未使用的邀请" });
  await expect(
    pending2.getByText("链接不在本会话，无法再复制")
  ).toBeVisible({ timeout: 60_000 });
  await pending2.getByRole("button", { name: "重新生成链接" }).click();
  await expect(inviteBox2.locator("#invite-link")).toBeVisible({
    timeout: 60_000,
  });
  const newUrl = await inviteBox2.locator("#invite-link").inputValue();
  expect(newUrl).toMatch(/\/alpha\/invite\//);
  expect(newUrl).not.toBe(inviteUrl);
  await expect(
    pending2.getByRole("button", { name: "复制链接" })
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    inviteBox2.getByRole("status").filter({ hasText: "已重新生成邀请链接" })
  ).toBeVisible();
});
