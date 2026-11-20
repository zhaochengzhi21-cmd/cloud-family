/**
 * Closed Alpha E2E seeded with public 西递明经胡氏 sample facts.
 * Disposable family only — not private living-person data.
 */

import { test, expect, type Page } from "@playwright/test";
import {
  requireV1Env,
  insertFakeUser,
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
  await page.getByRole("tab", { name: "世系" }).click();
  await page.getByRole("button", { name: new RegExp(sample.wenGuang.preferredName) }).click();
  const drawer = page.getByRole("dialog");
  await expect(
    drawer.getByRole("heading", { name: sample.wenGuang.preferredName })
  ).toBeVisible({ timeout: 60_000 });
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
