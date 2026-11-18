/**
 * CF-V1-UI-001 Closed Alpha workspace E2E (fake session cookie).
 */

import { readFileSync } from "node:fs";
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
  await expect(page.getByLabel("姓氏（可选）")).toHaveValue("测");
  await expect(page.getByText("已根据家族名称预填姓氏")).toBeVisible();
  await page.getByLabel("姓氏（可选）").fill("赵");
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page).toHaveURL(/\/alpha\/families\/[0-9a-f-]{36}/i);
  await expect(page.getByText("仅家族成员可见")).toBeVisible();
  await expect(page.getByRole("heading", { name: "测试赵氏家庭" })).toBeVisible();
  const familyUrl = page.url();
  const familyId = familyUrl.split("/").pop()!;

  // Flow 03 — overview is the family home; persons (keep modal open to add consecutively)
  await expect(page.getByRole("tab", { selected: true })).toHaveText("概览");
  await expect(page.getByText("添加第一位家人")).toBeVisible();
  await page.getByRole("button", { name: "添加成员", exact: true }).click();
  await page.getByLabel("姓名 / 常用称呼 *").fill("赵甲");
  await expect(page.locator("#p-living")).toHaveValue("UNKNOWN");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("已添加「赵甲」。可继续添加下一位，或点完成。")
  ).toBeVisible();
  await page.getByLabel("姓名 / 常用称呼 *").fill("赵乙");
  await page.getByRole("button", { name: "继续添加" }).click();
  await expect(
    page.getByRole("dialog").getByText("已添加「赵乙」。可继续添加下一位，或点完成。")
  ).toBeVisible();
  await page.getByRole("button", { name: "完成" }).click();
  await expect(page.getByText("已添加 2 位家族成员")).toBeVisible();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("成员");
  await expect(page.getByText("赵甲")).toBeVisible();
  await expect(page.getByText("赵乙")).toBeVisible();

  // Overview now asks for relationships
  await page.getByRole("tab", { name: "概览" }).click();
  await expect(page.getByText("为 2 位成员建立关系")).toBeVisible();

  // Flow 04 — relationship + generation from server
  await page.getByRole("tab", { name: "世系" }).click();
  await page.getByRole("button", { name: "+ 添加家庭关系" }).click();
  await page.locator("#rel-parent").selectOption({ label: "赵甲" });
  await page.locator("#rel-child").selectOption({ label: "赵乙" });
  await page.locator("#rel-type").selectOption("BIOLOGICAL_PARENT");
  await expect(
    page.getByText("将记录：赵甲 是 赵乙 的父母")
  ).toBeVisible();
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
  await expect(
    page.getByRole("heading", { name: /第二代/ })
  ).toBeVisible({ timeout: 20_000 });

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

  await expect(page.getByRole("heading", { name: /第一代/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^赵甲/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^赵乙/ })).toBeVisible();
  await expect(page.getByText("子女：赵乙")).toBeVisible();
  await expect(page.getByText("父母：赵甲")).toBeVisible();

  // Lineage tools — search/jump, fold a generation, branch view
  const tools = page.getByRole("search", { name: "世系工具" });
  await expect(tools).toContainText("共 2 代 2 人");
  await tools.getByPlaceholder("在世系中查找姓名").fill("乙");
  await expect(tools).toContainText("找到 1 位");
  await tools.getByRole("button", { name: "赵乙 · 第二代" }).click();
  await expect(page.locator(`[data-lineage-person="${yi.id}"]`)).toBeFocused();
  await tools.getByPlaceholder("在世系中查找姓名").fill("");
  const gen2Toggle = page.getByRole("button", { name: /^第二代/ });
  await gen2Toggle.click();
  await expect(gen2Toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: /^赵乙/ })).toBeHidden();
  await gen2Toggle.click();
  await expect(page.getByRole("button", { name: /^赵乙/ })).toBeVisible();
  await tools.locator("select").selectOption({ label: "赵甲（第一代）一支" });
  await expect(tools).toContainText("正在查看赵甲一支，共 2 人");
  await tools.locator("select").selectOption("");
  await expect(tools).toContainText("共 2 代 2 人");

  // Flow 04b — remove relationship from drawer, then restore for later flows
  // Prefer /^赵乙/ — accessible name now includes 「父母：赵甲」, so plain "赵乙" also hits 赵甲
  await page.getByRole("button", { name: /^赵乙/ }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("第二代")).toBeVisible();
  await expect(drawer.getByText("父母：赵甲")).toBeVisible();

  // Dirty-close guard + sibling navigation (姓名序：赵甲 → 赵乙)
  await drawer.locator("#edit-living").selectOption("DECEASED");
  await drawer.getByRole("button", { name: "关闭" }).click();
  await expect(drawer.getByText("有未保存的修改，确定放弃？")).toBeVisible();
  await drawer.getByRole("button", { name: "继续编辑" }).click();
  await drawer.getByRole("button", { name: /上一位/ }).click();
  await expect(
    drawer.getByText("有未保存的修改，切换成员前要放弃吗？")
  ).toBeVisible();
  await drawer.getByRole("button", { name: "放弃修改" }).click();
  await expect(drawer.getByRole("heading", { name: "赵甲" })).toBeVisible();
  await drawer.getByRole("button", { name: /下一位/ }).click();
  await expect(drawer.getByRole("heading", { name: "赵乙" })).toBeVisible();
  await drawer.getByRole("button", { name: "关闭" }).click();

  // Soft duplicate-name hint when adding another 赵乙
  await page.getByRole("tab", { name: "成员" }).click();
  await page.getByRole("button", { name: "+ 添加成员" }).click();
  await page.getByLabel("姓名 / 常用称呼 *").fill("赵乙");
  await expect(
    page.getByText("已有同名成员。若是不同的人，可继续添加并用称呼区分。")
  ).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await page.getByRole("tab", { name: "世系" }).click();
  await page.getByRole("button", { name: /^赵乙/ }).click();
  await expect(drawer.getByText("父母：赵甲")).toBeVisible();
  await drawer.getByRole("button", { name: "移除", exact: true }).click();
  await drawer.getByRole("button", { name: "确认移除" }).click();
  await expect(drawer.getByText("已移除这条家庭关系")).toBeVisible();
  await expect(drawer.getByText("暂无关系")).toBeVisible();
  await drawer.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "+ 添加家庭关系" }).click();
  await page.locator("#rel-parent").selectOption({ label: "赵甲" });
  await page.locator("#rel-child").selectOption({ label: "赵乙" });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已添加家庭关系")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /第二代/ })
  ).toBeVisible({ timeout: 20_000 });

  // Flow 05–09 claims / evidence / conflict
  await page.getByRole("tab", { name: "资料" }).click();
  await expect(page.getByRole("tabpanel")).toBeVisible();
  await page.locator("#records-person").selectOption({ label: "赵乙" });
  await page.getByRole("button", { name: "+ 添加人物资料" }).click();
  await page.locator("#claim-text").fill("民国十三年");
  await page.getByRole("button", { name: "保存资料" }).click();
  await expect(page.getByText("待确认").first()).toBeVisible();
  await expect(page.getByText("民国十三年")).toBeVisible();

  // Overview: progress + next steps + pending queue jumps to the person's records
  await page.getByRole("tab", { name: "概览" }).click();
  await expect(page.getByText("处理 1 条待确认资料")).toBeVisible();
  await expect(page.getByText("补充 1 位成员的出生信息")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "为赵甲补充出生信息" })
  ).toBeVisible();
  const feed = page.getByRole("region", { name: "最近动态" });
  await expect(feed).toContainText("你 为「赵乙」添加了出生信息");
  await expect(feed).toContainText("你 创建了家族档案");
  await expect(feed.getByRole("link", { name: "赵乙" }).first()).toHaveAttribute(
    "href",
    `/alpha/families/${familyId}/people/${yi.id}`
  );
  await page
    .getByRole("region", { name: /待确认资料/ })
    .getByRole("button", { name: /赵乙/ })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料");
  await expect(page.locator("#records-person")).toHaveValue(yi.id);
  await expect(page.getByText("民国十三年")).toBeVisible();

  // Status filter
  await page.getByRole("button", { name: /^待确认/ }).click();
  await expect(page.getByText(/显示 1 \/ 1 条资料/)).toBeVisible();
  await expect(page.getByText("民国十三年")).toBeVisible();
  await page.getByRole("button", { name: /^已确认/ }).click();
  await expect(page.getByText("没有符合当前筛选的资料")).toBeVisible();
  await page.getByRole("button", { name: "查看全部" }).click();
  await expect(page.getByText("民国十三年")).toBeVisible();
  await page.getByRole("button", { name: "刷新" }).click();
  await expect(page.getByText("已刷新")).toBeVisible();
  await expect(page.getByRole("heading", { name: "测试赵氏家庭" })).toBeVisible();
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

  await page.getByRole("button", { name: "+ 添加人物资料" }).click();
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
  await page.getByRole("button", { name: "保存来源" }).click();
  // Server has V1_BLOB_LOCAL_FINALIZE=true in Playwright webServer — UI polls + finalize-local.
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

  // Remove media evidence source (OWNER/ADMIN) — innermost li, not the claim card
  const photoRow = page.locator("li").filter({ hasText: "测试合成照片" }).last();
  await photoRow.getByRole("button", { name: "移除来源" }).click();
  await photoRow.getByRole("button", { name: "确认移除" }).click();
  await expect(page.getByText("已移除资料来源")).toBeVisible();
  await expect(page.getByText("测试合成照片")).toHaveCount(0);
  await expect(page.getByText(/测试族谱/)).toBeVisible();

  // Persist records person + tab across reload
  await expect(page.locator("#records-person")).toHaveValue(yi.id);
  await page.reload();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(yi.id);
  await expect(page.getByText(/测试族谱/)).toBeVisible();

  // Person page — life timeline, kin links, back to records
  await page.getByRole("button", { name: "打开此人" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "查看人物页" }).click();
  await expect(page).toHaveURL(new RegExp(`/people/${yi.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: "赵乙" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("第二代")).toBeVisible();
  const life = page.getByRole("region", { name: "生平" });
  await expect(life.getByText("民国十三年")).toBeVisible();
  await expect(life.getByText("民国十四年")).toHaveCount(0);
  await expect(life.getByText(/^来源：.*族谱 · 测试族谱 · 第17页/)).toBeVisible();
  await expect(life.getByText(/测试合成照片/)).toHaveCount(0);
  const kin = page.getByRole("region", { name: "家人" });
  await kin.getByRole("link", { name: "赵甲" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "赵甲" })).toBeVisible();
  await page.getByRole("region", { name: "家人" }).getByRole("link", { name: "赵乙" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "赵乙" })).toBeVisible();
  await page.getByRole("button", { name: "补充或修改资料" }).click();
  await expect(page.getByRole("tab", { selected: true })).toHaveText("资料", {
    timeout: 60_000,
  });
  await expect(page.locator("#records-person")).toHaveValue(yi.id);

  // Backup download from overview
  await page.getByRole("tab", { name: "概览" }).click();
  const backup = page.getByRole("region", { name: "备份" });
  const downloadEvt = page.waitForEvent("download");
  await backup.getByRole("button", { name: "下载家族备份" }).click();
  const download = await downloadEvt;
  expect(download.suggestedFilename()).toMatch(/^测试赵氏家庭-备份-\d{8}\.json$/);
  const backupJson = JSON.parse(
    readFileSync(await download.path(), "utf8")
  ) as {
    format: string;
    persons: { preferredName: string; facts: { value: { text?: string } }[] }[];
    sources: { title: string | null }[];
  };
  expect(backupJson.format).toBe("yunzupu.family-export");
  const yiExport = backupJson.persons.find((p) => p.preferredName === "赵乙");
  expect(yiExport?.facts.some((f) => f.value.text === "民国十三年")).toBe(true);
  expect(backupJson.sources.some((s) => s.title === "测试族谱")).toBe(true);
  await expect(backup.getByRole("status")).toContainText("已生成备份");

  // Printable family book
  await backup.getByRole("link", { name: "打印版家谱" }).click();
  await expect(page).toHaveURL(new RegExp(`/alpha/families/${familyId}/print$`));
  await expect(
    page.getByRole("heading", { level: 1, name: "测试赵氏家庭" })
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "第一代" })).toContainText("赵甲");
  const gen2 = page.getByRole("region", { name: "第二代" });
  await expect(gen2).toContainText("赵乙");
  await expect(gen2).toContainText("民国十三年");
  await expect(gen2).not.toContainText("民国十四年");
  await expect(gen2).toContainText("父母赵甲");
  await expect(page.getByRole("region", { name: "资料来源" })).toContainText(
    "族谱 · 测试族谱 · 第17页"
  );
  await expect(page.getByRole("region", { name: "资料来源" })).not.toContainText(
    "测试合成照片"
  );
  const printBtn = page.getByRole("button", { name: "打印或保存为 PDF" });
  await expect(printBtn).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(printBtn).toBeHidden();
  await expect(page.locator(".alpha-nav")).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  // list still shows family + recent marker
  await page.goto("/alpha/families");
  await expect(page.getByText("测试赵氏家庭")).toBeVisible();
  await expect(page.getByText("最近打开")).toBeVisible();

  // offline banner
  await page.context().setOffline(true);
  await expect(page.getByRole("status").getByText(/网络已断开/)).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByText(/网络已断开/)).toHaveCount(0);

  // skip link targets main landmark
  await expect(page.locator("#alpha-main")).toBeAttached();
  await expect(page.getByRole("link", { name: "跳到主要内容" })).toHaveAttribute(
    "href",
    "#alpha-main"
  );

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
    await expect(
      page.getByRole("dialog").getByText("已添加「赵甲」。可继续添加下一位，或点完成。")
    ).toBeVisible();
    await page.getByLabel("姓名 / 常用称呼 *").fill("赵乙");
    await page.getByRole("button", { name: "继续添加" }).click();
    await expect(
      page.getByRole("dialog").getByText("已添加「赵乙」。可继续添加下一位，或点完成。")
    ).toBeVisible();
    await page.getByRole("button", { name: "完成" }).click();
    await expect(page.getByText("已添加 2 位家族成员")).toBeVisible();

    await page.getByRole("tab", { name: "世系" }).click();
    await page.getByRole("button", { name: "+ 添加家庭关系" }).click();
    await page.locator("#rel-parent").selectOption({ label: "赵甲" });
    await page.locator("#rel-child").selectOption({ label: "赵乙" });
    await expect(
      page.getByText("将记录：赵甲 是 赵乙 的父母")
    ).toBeVisible();
    const relRespPromise = page.waitForResponse(
      (r) =>
        r.url().includes("/relationships") && r.request().method() === "POST"
    );
    await page.getByRole("button", { name: "保存", exact: true }).click();
    expect((await relRespPromise).status()).toBe(201);
    await expect(
      page.getByRole("heading", { name: /第二代/ })
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /第一代/ })).toBeVisible();
    await expect(page.getByText("子女：赵乙")).toBeVisible();
    await expect(page.getByText("父母：赵甲")).toBeVisible();

    // Drawer: living status edit
    await page.getByRole("tab", { name: "成员" }).click();
    await page.getByRole("button", { name: /^赵甲/ }).click();
    await page.locator("#edit-living").selectOption("LIVING");
    await page.getByRole("button", { name: "保存基本信息" }).click();
    await expect(page.getByText("已保存基本信息")).toBeVisible();
    await page.getByRole("button", { name: "关闭" }).click();
    await expect(page.getByText("在世").first()).toBeVisible();

    // 字辈 helper — generation header shows the confirmed word; peers get a suggestion
    const mFamilyId = page.url().match(/families\/([0-9a-f-]{36})/i)![1];
    const mGraph = await apiJson(page, `/api/v1/families/${mFamilyId}/graph`);
    const mPersons = (
      mGraph.body as { graph: { persons: { id: string; preferredName: string }[] } }
    ).graph.persons;
    const mJia = mPersons.find((p) => p.preferredName === "赵甲")!;
    const mYi = mPersons.find((p) => p.preferredName === "赵乙")!;
    const gw = await apiJson(page, `/api/v1/families/${mFamilyId}/claims`, {
      method: "POST",
      body: {
        subjectType: "PERSON",
        subjectId: mYi.id,
        claimType: "GENERATION_WORD",
        value: { text: "德" },
        originType: "MANUAL",
      },
    });
    expect(gw.status).toBe(201);
    const gwId = (gw.body as { claim: { id: string } }).claim.id;
    const gwAccept = await apiJson(
      page,
      `/api/v1/families/${mFamilyId}/claims/${gwId}/accept`,
      { method: "POST", body: {} }
    );
    expect(gwAccept.status).toBe(200);
    const bing = await apiJson(page, `/api/v1/families/${mFamilyId}/persons`, {
      method: "POST",
      body: {
        preferredName: "赵丙",
        gender: "UNKNOWN",
        livingStatus: "UNKNOWN",
        privacyLevel: "INHERIT",
      },
    });
    expect([200, 201]).toContain(bing.status);
    const bingId = (bing.body as { person: { id: string } }).person.id;
    const bingRel = await apiJson(
      page,
      `/api/v1/families/${mFamilyId}/relationships`,
      {
        method: "POST",
        body: {
          fromPersonId: mJia.id,
          toPersonId: bingId,
          relationshipType: "BIOLOGICAL_PARENT",
        },
      }
    );
    expect(bingRel.status).toBe(201);
    await page.reload();
    await page.getByRole("tab", { name: "世系" }).click();
    await expect(page.getByRole("heading", { name: /第二代/ })).toContainText(
      "字辈：「德」",
      { timeout: 20_000 }
    );
    await page.locator(`[data-lineage-person="${bingId}"]`).click();
    const mDrawer = page.getByRole("dialog");
    await mDrawer.getByRole("button", { name: "+ 添加人物资料" }).click();
    await mDrawer.locator("#claim-type").selectOption("GENERATION_WORD");
    await mDrawer
      .getByRole("group", { name: "同辈字辈" })
      .getByRole("button", { name: /^德/ })
      .click();
    await expect(mDrawer.locator("#claim-text")).toHaveValue("德");
  });
});

test.describe("CF-V1-UI-001 desktop 1280", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("core journey + roles + concurrency + session + login mock + gate unit", async ({
    page,
    baseURL,
    browser,
  }) => {
    // Covers a dozen flows end to end; dev-server first compiles add up.
    test.setTimeout(420_000);
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
    await expect(
      viewerPage.getByRole("heading", { name: "测试赵氏家庭" })
    ).toBeVisible({ timeout: 60_000 });
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
    await expect(
      editorPage.getByRole("heading", { name: "测试赵氏家庭" })
    ).toBeVisible({ timeout: 60_000 });
    await editorPage.getByRole("tab", { name: "成员" }).click();
    await expect(
      editorPage.getByRole("button", { name: "+ 添加成员" })
    ).toBeVisible();
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
    type FeedItem = { personId?: string; otherPersonId?: string; personName?: string };
    const ownerFeed = await apiJson(
      ownerPage2,
      `/api/v1/families/${familyId}/activity`,
      undefined,
      baseURL
    );
    expect(ownerFeed.status).toBe(200);
    expect(
      (ownerFeed.body as { activity: FeedItem[] }).activity.some(
        (i) => i.personId === privId
      )
    ).toBe(true);
    type ExportBody = { export: { persons: { id: string }[] } };
    const ownerExport = await apiJson(
      ownerPage2,
      `/api/v1/families/${familyId}/export`,
      undefined,
      baseURL
    );
    expect(ownerExport.status).toBe(200);
    expect(
      (ownerExport.body as ExportBody).export.persons.some((p) => p.id === privId)
    ).toBe(true);
    await ownerCtx2.close();

    const editorCtx2 = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      baseURL,
    });
    const editorPage2 = await editorCtx2.newPage();
    await loginAs(editorPage2, editorId, baseURL!);
    await editorPage2.goto(`/alpha/families/${familyId}`);
    await expect(
      editorPage2.getByRole("heading", { name: "测试赵氏家庭" })
    ).toBeVisible({ timeout: 60_000 });
    const privGet = await apiJson(
      editorPage2,
      `/api/v1/families/${familyId}/persons/${privId}`,
      undefined,
      baseURL
    );
    expect([403, 404]).toContain(privGet.status);
    // Activity feed must not reveal the private person to the editor
    const editorFeed = await apiJson(
      editorPage2,
      `/api/v1/families/${familyId}/activity`,
      undefined,
      baseURL
    );
    expect(editorFeed.status).toBe(200);
    const editorItems = (editorFeed.body as { activity: FeedItem[] }).activity;
    expect(editorItems.length).toBeGreaterThan(0);
    expect(JSON.stringify(editorItems)).not.toContain(privId);
    expect(JSON.stringify(editorItems)).not.toContain("私密测试员");
    const editorExport = await apiJson(
      editorPage2,
      `/api/v1/families/${familyId}/export`,
      undefined,
      baseURL
    );
    expect(editorExport.status).toBe(200);
    const editorExportText = JSON.stringify(editorExport.body);
    expect((editorExport.body as ExportBody).export.persons.length).toBeGreaterThan(0);
    expect(editorExportText).not.toContain(privId);
    expect(editorExportText).not.toContain("私密测试员");
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
    await p2.getByRole("tab", { name: "成员" }).click();
    await p2.getByRole("button", { name: /^赵乙/ }).click();
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
    await p2.getByRole("button", { name: "保存基本信息" }).click();
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
    await expect(loginPage).toHaveTitle(/登录 · 云族谱/);
    await expect(
      loginPage.getByRole("heading", { name: "云族谱" })
    ).toBeVisible();
    await expect(
      loginPage.getByText("把家里的故事，安全地留给下一代")
    ).toBeVisible();
    await loginPage.getByLabel("邮箱").fill("test-zhao@example.com");
    await loginPage.getByRole("button", { name: /获取验证码|发送验证码|继续/ }).click();
    await expect(
      loginPage.getByText("如果该邮箱可以使用云族谱，我们已经发送了验证码。").first()
    ).toBeVisible();
    await expect(
      loginPage.getByText(/验证码已发往 te··@example\.com/)
    ).toBeVisible();
    await loginPage.getByLabel(/验证码/).fill("123456");
    // OTP auto-submits at 6 digits
    await expect(
      loginPage.getByText("验证码无效或已过期，请重新获取。").first()
    ).toBeVisible();
    await expect(loginPage.getByLabel(/验证码/)).toHaveValue("");
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
