/**
 * Closed Alpha person-profile E2E seeded with public 西递明经胡氏 sample facts.
 * Disposable family only — not private living-person data.
 */

import { test, expect } from "@playwright/test";
import {
  requireV1Env,
  insertFakeUser,
  loginAs,
  cleanupAllV1TestData,
  tableCounts,
  closeDb,
  apiJson,
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

test("明经胡氏公开史料：人物页生平显示祖籍与职业", async ({
  page,
  baseURL,
}) => {
  test.skip(!baseURL, "baseURL required");
  const sample = MINGJING_HU_SAMPLE;
  const ownerId = await insertFakeUser();
  await loginAs(page, ownerId, baseURL!);

  await page.goto("/alpha/families");
  await page.getByRole("button", { name: /创建第一个家族档案|创建家族档案/ }).click();
  await page.getByLabel("家族名称 *").fill(sample.familyDisplayName);
  await page.getByLabel("姓氏（可选）").fill(sample.surname);
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page).toHaveURL(/\/alpha\/families\/[0-9a-f-]{36}/i);
  const familyId = page.url().split("/").pop()!;

  const wg = sample.wenGuang;
  const personRes = await apiJson(page, `/api/v1/families/${familyId}/persons`, {
    method: "POST",
    body: {
      preferredName: wg.preferredName,
      gender: wg.gender,
      livingStatus: wg.livingStatus,
      privacyLevel: "INHERIT",
    },
  });
  expect(personRes.status, JSON.stringify(personRes.body)).toBe(201);
  const personId = (personRes.body as { person: { id: string } }).person.id;

  for (const c of wg.claims) {
    const value =
      c.claimType === "STORY" && "narrator" in c && c.narrator
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

  await page.goto(`/alpha/families/${familyId}/people/${personId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: wg.preferredName })
  ).toBeVisible({ timeout: 60_000 });

  const life = page.getByRole("region", { name: "生平" });
  await expect(life.getByRole("heading", { name: "出生" })).toBeVisible();
  await expect(life.getByText("约明嘉靖年间")).toBeVisible();
  await expect(life.getByText("安徽黟县西递")).toBeVisible();

  await expect(life.getByRole("heading", { name: "祖籍" })).toBeVisible();
  await expect(life.getByText("江西婺源考水")).toBeVisible();

  await expect(life.getByRole("heading", { name: "职业" })).toBeVisible();
  await expect(life.getByText("万载知县，后升胶州刺史")).toBeVisible();

  await expect(life.getByRole("heading", { name: "去世" })).toBeVisible();
  await expect(life.getByText("约明万历年间")).toBeVisible();

  await expect(page.getByText(/文光刺史美名扬/)).toBeVisible();
});
