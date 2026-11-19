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
