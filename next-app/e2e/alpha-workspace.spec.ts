/**
 * CF-V1-UI-001 Closed Alpha workspace E2E (fake session cookie).
 */

import { test, expect } from "@playwright/test";
import {
  requireV1Env,
  insertFakeUser,
  loginAs,
  revokeToken,
  insertMembership,
  cleanupAllV1TestData,
  tableCounts,
  closeDb,
  apiJson,
  trackMedia,
  finalizePendingUploadsForFamily,
} from "./helpers/v1";
import { isV1AlphaUiEnabled } from "../src/v1/http/featureGate";

test.beforeAll(() => {
  requireV1Env();
});

test.afterAll(async () => {
  try {
    await cleanupAllV1TestData();
    const counts = await tableCounts();
    const nonzero = Object.entries(counts).filter(([, n]) => n !== 0);
    if (nonzero.length) {
      console.error("cleanup leftover", Object.fromEntries(nonzero));
      throw new Error(
        `cleanup leftover: ${JSON.stringify(Object.fromEntries(nonzero))}`
      );
    }
  } catch (e) {
    console.error("afterAll cleanup error", e);
    throw e;
  } finally {
    try {
      await closeDb();
    } catch {
      /* ignore */
    }
  }
});

async function runCoreJourney(
  page: import("@playwright/test").Page,
  baseURL: string
) {
  const ownerId = await insertFakeUser();
  await loginAs(page, ownerId, baseURL);

  // Flow 01 — empty
  await page.goto("/alpha/families");
  await expect(page.getByRole("heading", { name: "还没有家族档案" })).toBeVisible();
  await expect(
    page.getByText("从两三个你熟悉的家人开始就可以")
  ).toBeVisible();

  // Flow 02 — create family
  await page.getByRole("button", { name: "创建第一个家族档案" }).click();
  await page.getByLabel("家族名称 *").fill("测试赵氏家庭");
  await page.getByLabel("姓氏（可选）").fill("赵");
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page).toHaveURL(/\/alpha\/families\/[0-9a-f-]{36}/i);
  await expect(page.getByText("仅家族成员可见")).toBeVisible();
  await expect(page.getByRole("heading", { name: "测试赵氏家庭" })).toBeVisible();
  const familyUrl = page.url();
  const familyId = familyUrl.split("/").pop()!;

  // Flow 03 — persons
  await page.getByRole("button", { name: "添加成员" }).click();
  await page.getByLabel("姓名 / 常用称呼 *").fill("赵甲");
  await expect(page.locator("#p-living")).toHaveValue("UNKNOWN");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByText("赵甲")).toBeVisible();

  await page.getByRole("button", { name: "+ 添加成员" }).click();
  await page.getByLabel("姓名 / 常用称呼 *").fill("赵乙");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByText("赵乙")).toBeVisible();

  // Flow 04 — relationship + generation from server
  await page.getByRole("tab", { name: "世系" }).click();
  await page.getByRole("button", { name: "+ 添加家庭关系" }).click();
  await page.locator("#rel-parent").selectOption({ label: "赵甲" });
  await page.locator("#rel-child").selectOption({ label: "赵乙" });
  await page.locator("#rel-type").selectOption("BIOLOGICAL_PARENT");
  const relRespPromise = page.waitForResponse(
    (r) =>
      r.url().includes("/relationships") &&
      r.request().method() === "POST" &&
      !r.url().includes("undefined")
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const relResp = await relRespPromise;
  expect(
    relResp.status(),
    `relationship create status body=${await relResp.text()}`
  ).toBe(201);
  await expect(page.getByText("已添加家庭关系")).toBeVisible();
  await expect(page.getByText("第二代")).toBeVisible({ timeout: 20_000 });

  const graph = await apiJson(page, `/api/v1/families/${familyId}/graph`);
  expect(graph.status).toBe(200);
  const g = (graph.body as {
    graph: {
      generationByPerson: Record<string, number>;
      persons: { id: string; preferredName: string }[];
      relationships: { type: string; fromPersonId: string; toPersonId: string }[];
    };
  }).graph;
  expect(g.relationships.length).toBeGreaterThanOrEqual(1);
  const jia = g.persons.find((p) => p.preferredName === "赵甲")!;
  const yi = g.persons.find((p) => p.preferredName === "赵乙")!;
  expect(g.generationByPerson[jia.id]).toBe(1);
  expect(g.generationByPerson[yi.id]).toBe(2);

  await expect(page.getByText("第一代")).toBeVisible();
  await expect(page.getByText("赵甲").first()).toBeVisible();
  await expect(page.getByText("赵乙").first()).toBeVisible();

  // Flow 05–09 claims / evidence / conflict
  await page.getByRole("tab", { name: "资料" }).click();
  await page.locator("#records-person").selectOption({ label: "赵乙" });
  await page.locator("#claim-text").fill("民国十三年");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(page.getByText("待确认").first()).toBeVisible();
  await expect(page.getByText("民国十三年")).toBeVisible();

  await page.getByRole("button", { name: "添加资料来源" }).click();
  await page.locator("#ev-type").selectOption("GENEALOGY_PAGE");
  await page.getByLabel("来源标题（可选）").fill("测试族谱");
  await page.getByLabel("出处位置（可选）").fill("第17页");
  await page.getByRole("button", { name: "保存来源" }).click();
  await expect(page.getByText("已添加资料来源")).toBeVisible();
  await expect(page.getByText(/测试族谱/)).toBeVisible();
  await expect(page.getByText(/第17页/)).toBeVisible();

  await page.getByRole("button", { name: "确认这条资料" }).click();
  await expect(page.getByText("已确认").first()).toBeVisible();

  await page.locator("#claim-text").fill("民国十四年");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(page.getByText("民国十四年")).toBeVisible();
  await page.getByRole("button", { name: "添加资料来源" }).last().click();
  await page.getByLabel("来源标题（可选）").fill("测试墓碑记录");
  await page.getByRole("button", { name: "保存来源" }).click();
  await expect(page.getByText("已添加资料来源")).toBeVisible();
  const accept2 = page.waitForResponse(
    (r) => r.url().includes("/accept") && r.request().method() === "POST"
  );
  await page.getByRole("button", { name: "确认这条资料" }).click();
  expect((await accept2).status()).toBe(200);
  await expect(page.getByText("存在不同说法").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("民国十三年").first()).toBeVisible();
  await expect(page.getByText("民国十四年").first()).toBeVisible();
  // Conflict banner must appear (not auto-pick one truth)
  await expect(
    page.getByText("目前资料中记录不一致，先保留两种说法")
  ).toBeVisible();

  // reject second (十四年) — find card with 十四年 and reject
  const conflictCards = page.locator("li").filter({ hasText: "民国十四年" });
  await conflictCards.getByRole("button", { name: "不采用" }).click();
  await expect(page.getByText("已确认").first()).toBeVisible();
  await expect(page.getByText("查看不采用的记录")).toBeVisible();
  await page.getByText("查看不采用的记录").click();
  await expect(page.getByText("民国十四年")).toBeVisible();

  // Flow 10 — media evidence
  await page.getByRole("button", { name: "添加资料来源" }).first().click();
  await page.locator("#ev-type").selectOption("PHOTO");
  await page.getByLabel("来源标题（可选）").fill("测试合成照片");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "test-zhao.png",
    mimeType: "image/png",
    buffer: png,
  });
  const saveClick = page.getByRole("button", { name: "保存来源" }).click();
  const finalizeLoop = finalizePendingUploadsForFamily(familyId, ownerId, {
    timeoutMs: 90_000,
  });
  const [, finalized] = await Promise.all([saveClick, finalizeLoop]);
  if (!finalized) {
    throw new Error("media finalize: no PENDING_UPLOAD became ACTIVE (blob put/callback)");
  }
  const uploadErr = page.getByText(/上传失败|上传超时|不支持的文件/);
  if (await uploadErr.count()) {
    throw new Error(`media upload UI error: ${await uploadErr.first().textContent()}`);
  }
  await expect(page.getByText("测试合成照片")).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByRole("button", { name: "查看原始资料" })).toBeVisible();

  const claimBundle = await apiJson(
    page,
    `/api/v1/families/${familyId}/persons/${yi.id}/claims?includeRejected=true`
  );
  const claims = (
    claimBundle.body as {
      claims: { id: string; status: string }[];
    }
  ).claims;
  const accepted = claims.find((c) => c.status === "ACCEPTED");
  expect(accepted).toBeTruthy();
  const detail = await apiJson(
    page,
    `/api/v1/families/${familyId}/claims/${accepted!.id}`
  );
  const links = (
    detail.body as {
      evidenceLinks: { evidence: { mediaObjectId: string | null } }[];
    }
  ).evidenceLinks;
  const mediaId = links.map((l) => l.evidence.mediaObjectId).find(Boolean);
  if (mediaId) trackMedia(familyId, mediaId, ownerId);

  // list still shows family
  await page.goto("/alpha/families");
  await expect(page.getByText("测试赵氏家庭")).toBeVisible();

  return { ownerId, familyId, jiaId: jia.id, yiId: yi.id };
}

test.describe("CF-V1-UI-001 mobile 390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("empty → create → persons → lineage (mobile smoke)", async ({
    page,
    baseURL,
  }) => {
    const ownerId = await insertFakeUser();
    await loginAs(page, ownerId, baseURL!);
    await page.goto("/alpha/families");
    await expect(page.getByRole("heading", { name: "还没有家族档案" })).toBeVisible();
    await page.getByRole("button", { name: "创建第一个家族档案" }).click();
    await page.getByLabel("家族名称 *").fill("测试赵氏家庭");
    await page.getByLabel("姓氏（可选）").fill("赵");
    await page.getByRole("button", { name: "创建" }).click();
    await expect(page).toHaveURL(/\/alpha\/families\/[0-9a-f-]{36}/i);
    await expect(page.getByText("仅家族成员可见")).toBeVisible();

    await page.getByRole("button", { name: "添加成员" }).click();
    await page.getByLabel("姓名 / 常用称呼 *").fill("赵甲");
    await page.getByRole("button", { name: "添加", exact: true }).click();
    await page.getByRole("button", { name: "+ 添加成员" }).click();
    await page.getByLabel("姓名 / 常用称呼 *").fill("赵乙");
    await page.getByRole("button", { name: "添加", exact: true }).click();

    await page.getByRole("tab", { name: "世系" }).click();
    await page.getByRole("button", { name: "+ 添加家庭关系" }).click();
    await page.locator("#rel-parent").selectOption({ label: "赵甲" });
    await page.locator("#rel-child").selectOption({ label: "赵乙" });
    const relRespPromise = page.waitForResponse(
      (r) =>
        r.url().includes("/relationships") && r.request().method() === "POST"
    );
    await page.getByRole("button", { name: "保存", exact: true }).click();
    expect((await relRespPromise).status()).toBe(201);
    await expect(page.getByText("第二代")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("第一代")).toBeVisible();
  });
});

test.describe("CF-V1-UI-001 desktop 1280", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("core journey + roles + concurrency + session + login mock + gate unit", async ({
    page,
    baseURL,
    browser,
  }) => {
    const { ownerId, familyId, yiId } = await runCoreJourney(page, baseURL!);

    // Flow 11 — Viewer
    const viewerId = await insertFakeUser();
    await insertMembership(familyId, viewerId, "VIEWER");
    const viewerCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      baseURL,
    });
    const viewerPage = await viewerCtx.newPage();
    await loginAs(viewerPage, viewerId, baseURL!);
    await viewerPage.goto(`/alpha/families/${familyId}`);
    await expect(viewerPage.getByRole("heading", { name: "测试赵氏家庭" })).toBeVisible();
    await expect(viewerPage.getByRole("button", { name: "+ 添加成员" })).toHaveCount(0);
    await expect(
      viewerPage.getByRole("button", { name: "+ 添加家庭关系" })
    ).toHaveCount(0);
    await viewerPage.getByRole("tab", { name: "资料" }).click();
    await expect(
      viewerPage.getByRole("button", { name: "确认这条资料" })
    ).toHaveCount(0);
    const mut = await apiJson(viewerPage, `/api/v1/families/${familyId}/persons`, {
      method: "POST",
      body: {
        preferredName: "不应成功",
        livingStatus: "UNKNOWN",
        gender: "UNKNOWN",
        privacyLevel: "INHERIT",
      },
    }, baseURL);
    expect(mut.status).toBe(403);
    await viewerCtx.close();

    // Flow 12 — Editor
    const editorId = await insertFakeUser();
    await insertMembership(familyId, editorId, "EDITOR");
    const editorCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      baseURL,
    });
    const editorPage = await editorCtx.newPage();
    await loginAs(editorPage, editorId, baseURL!);
    await editorPage.goto(`/alpha/families/${familyId}`);
    await expect(editorPage.getByRole("button", { name: "+ 添加成员" })).toBeVisible();
    await editorPage.getByRole("tab", { name: "资料" }).click();
    await expect(
      editorPage.getByRole("button", { name: "确认这条资料" })
    ).toHaveCount(0);
    await editorCtx.close();

    const ownerCtx2 = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      baseURL,
    });
    const ownerPage2 = await ownerCtx2.newPage();
    await loginAs(ownerPage2, ownerId, baseURL!);
    await ownerPage2.goto(`/alpha/families/${familyId}`);
    const privCreate = await apiJson(
      ownerPage2,
      `/api/v1/families/${familyId}/persons`,
      {
        method: "POST",
        body: {
          preferredName: "私密测试员",
          livingStatus: "UNKNOWN",
          gender: "UNKNOWN",
          privacyLevel: "PRIVATE",
        },
      },
      baseURL
    );
    expect([200, 201]).toContain(privCreate.status);
    const privId = (
      privCreate.body as { person: { id: string } }
    ).person.id;
    await ownerCtx2.close();

    const editorCtx2 = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      baseURL,
    });
    const editorPage2 = await editorCtx2.newPage();
    await loginAs(editorPage2, editorId, baseURL!);
    await editorPage2.goto(`/alpha/families/${familyId}`);
    const privGet = await apiJson(
      editorPage2,
      `/api/v1/families/${familyId}/persons/${privId}`,
      undefined,
      baseURL
    );
    expect([403, 404]).toContain(privGet.status);
    await editorCtx2.close();

    // Flow 13 — concurrency (stale revision in UI drawer)
    const c2 = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      baseURL,
    });
    const p2 = await c2.newPage();
    await loginAs(p2, ownerId, baseURL!);
    await p2.goto(`/alpha/families/${familyId}`);
    await expect(p2.getByRole("heading", { name: "测试赵氏家庭" })).toBeVisible();
    await p2.getByRole("button", { name: /赵乙/ }).first().click();
    await expect(p2.locator("#edit-name")).toBeVisible();
    const uiRev = Number(
      await p2.locator("form[data-revision]").getAttribute("data-revision")
    );
    expect(uiRev).toBeGreaterThan(0);

    // Other session wins with the same revision the drawer holds
    const winRes = await p2.request.patch(
      `${baseURL}/api/v1/families/${familyId}/persons/${yiId}`,
      {
        data: {
          expectedRevision: uiRev,
          preferredName: "赵乙并发胜出",
        },
        headers: { Origin: baseURL! },
      }
    );
    expect(winRes.status(), await winRes.text()).toBe(200);

    await p2.locator("#edit-name").fill("赵乙应失败");
    await p2.getByRole("button", { name: "保存姓名" }).click();
    await expect(
      p2.getByText(/刚刚被更新|请重新载入/).first()
    ).toBeVisible({ timeout: 15_000 });
    await c2.close();

    // Flow 14 — session expiry
    const expCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      baseURL,
    });
    const expPage = await expCtx.newPage();
    const token = await loginAs(expPage, ownerId, baseURL!);
    await expPage.goto("/alpha/families");
    await revokeToken(token);
    await expPage.goto("/alpha/families");
    await expect(expPage).toHaveURL(/\/alpha\/login/);
    await expect(expPage.getByText("登录状态已失效")).toBeVisible();
    await expCtx.close();

    // Login UI mocked
    const loginCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      baseURL,
    });
    const loginPage = await loginCtx.newPage();
    await loginPage.route("**/api/v1/auth/request-code", async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ success: true, challengeId: "fake-challenge" }),
      });
    });
    await loginPage.route("**/api/v1/auth/verify", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ success: false, code: "INVALID_CODE" }),
      });
    });
    await loginPage.goto("/alpha/login");
    await expect(
      loginPage.getByRole("heading", {
        name: "把家里的故事，安全地留给下一代",
      })
    ).toBeVisible();
    await loginPage.getByLabel("邮箱").fill("test-zhao@example.com");
    await loginPage.getByRole("button", { name: /获取验证码|发送验证码|继续/ }).click();
    await expect(
      loginPage.getByText("如果该邮箱可以使用云族谱，我们已经发送了验证码。").first()
    ).toBeVisible();
    await loginPage.getByLabel(/验证码/).fill("123456");
    await loginPage.getByRole("button", { name: /登录|验证/ }).click();
    await expect(
      loginPage.getByText("验证码无效或已过期，请重新获取。").first()
    ).toBeVisible();
    await loginCtx.close();

    // Gate unit — fail closed when unset
    const prev = process.env.V1_ALPHA_UI_ENABLED;
    delete process.env.V1_ALPHA_UI_ENABLED;
    expect(isV1AlphaUiEnabled()).toBe(false);
    process.env.V1_ALPHA_UI_ENABLED = "false";
    expect(isV1AlphaUiEnabled()).toBe(false);
    if (prev === undefined) delete process.env.V1_ALPHA_UI_ENABLED;
    else process.env.V1_ALPHA_UI_ENABLED = prev;

    void yiId;
  });
});
