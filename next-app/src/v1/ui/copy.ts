/**
 * Product-facing copy for Closed Alpha UI.
 * Never surface Claim / Evidence / ACL to end users.
 */

export const PRODUCT = {
  brand: "云族谱",
  family: "家族档案",
  person: "家族成员",
  relationship: "家庭关系",
  claim: "人物资料",
  evidence: "资料来源",
  media: "原始资料",
  privacyFamilyOnly: "仅家族成员可见",
} as const;

/** User-facing role labels — never show OWNER/EDITOR raw enums. */
export const ROLE_LABEL = {
  OWNER: "创建者",
  ADMIN: "管理员",
  EDITOR: "可编辑",
  VIEWER: "只读",
} as const;

/** Who can confirm / reject / restore admin-gated actions (OWNER + ADMIN). */
export const REVIEWER_CONTACT = "创建者或管理员";

export const CLAIM_STATUS_LABEL = {
  PROPOSED: "待确认",
  ACCEPTED: "已确认",
  CONFLICTED: "存在不同说法",
  REJECTED: "不采用",
} as const;

/** How a fact entered — product language, never "model". */
export const CLAIM_ORIGIN_LABEL = {
  MANUAL: "手录",
  AI_EXTRACTION: "智能整理",
  IMPORT: "导入",
  MIGRATION: "迁移",
} as const;

export const LIVING_STATUS_LABEL = {
  LIVING: "在世",
  DECEASED: "已故",
  UNKNOWN: "不确定",
} as const;

export const GENDER_LABEL = {
  MALE: "男",
  FEMALE: "女",
  UNKNOWN: "未填写",
  OTHER: "其他",
} as const;

export const RELATIONSHIP_UI = {
  BIOLOGICAL_PARENT: "亲生父母 → 子女",
  ADOPTIVE_PARENT: "养父母 → 子女",
  STEP_PARENT: "继父母 → 子女",
  SPOUSE: "配偶",
} as const;

/** Claim types exposed in Alpha UI (subset of registry). */
export const CLAIM_TYPE_UI: Record<
  string,
  { label: string; placeholder: string }
> = {
  BIRTH_DATE: { label: "出生信息", placeholder: "例如：民国十三年" },
  DEATH_DATE: { label: "去世信息", placeholder: "例如：一九九八年" },
  BIRTH_PLACE: { label: "出生地", placeholder: "例如：安徽西递" },
  ANCESTRAL_PLACE: { label: "祖籍", placeholder: "例如：徽州" },
  BURIAL_PLACE: { label: "安葬地", placeholder: "例如：村后山" },
  GENERATION_WORD: { label: "字辈", placeholder: "例如：德" },
  ALIAS: { label: "别名", placeholder: "例如：字子明" },
  OCCUPATION: { label: "职业", placeholder: "例如：耕读" },
  STORY: {
    label: "故事 / 口述",
    placeholder: "记下长辈讲过的事，可以多写几段",
  },
  BIRTH_ORDER: {
    label: "排行",
    placeholder: "例如：长、次、三",
  },
};

/** Rank for 排行 labels — lower sorts first. Unknown → null. */
export function birthOrderRank(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const named: Record<string, number> = {
    长: 1,
    伯: 1,
    孟: 1,
    次: 2,
    仲: 2,
    三: 3,
    叔: 3,
    四: 4,
    季: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (t in named) return named[t];
  if (/^[幺幼]$/.test(t)) return 99;
  const m = t.match(/^第?\s*(\d+)\s*([子女孩]|)$/);
  if (m) return Number(m[1]);
  if (/^\d+$/.test(t)) return Number(t);
  return null;
}

export const EVIDENCE_TYPE_UI: Record<string, string> = {
  GENEALOGY_PAGE: "族谱",
  PHOTO: "照片",
  TOMBSTONE: "墓碑",
  ORAL_HISTORY: "口述",
  DOCUMENT: "文档",
  ARCHIVE: "档案",
  USER_TESTIMONY: "本人/家人说明",
  OTHER: "其他",
};

export const ERROR_COPY = {
  unauthenticated: "登录状态已失效，请重新登录。",
  forbidden:
    "你的当前权限不能执行这个操作。可在概览「参与家人」中联系有相应权限的家人。",
  notFound:
    "找不到这份资料，或者你没有查看权限。可返回「我的家族」另选一份档案。",
  familyConflict: "这份家族档案刚刚被其他人更新，请点「刷新」后再试。",
  personConflict:
    "这位成员的资料刚刚被更新，已载入最新内容，请再试一次保存。",
  ancestryCycle:
    "这条关系会形成循环世系，请检查所选成员，或去世系页核对现有关系。",
  duplicateRelationship: "这条家庭关系已经存在。可在世系或人物卡片中查看。",
  duplicateClaim: "已有相同的资料记录。可打开资料页查看或记下另一种说法。",
  generic: "操作未能完成，请稍后再试。可刷新页面后重试。",
  verifyFailed: "验证码无效或已过期，请重新获取。",
  requestCodeGeneric:
    "如果该邮箱可以使用云族谱，我们已经发送了验证码。",
} as const;

export const LOGIN_COPY = {
  title: "把家里的故事，安全地留给下一代",
  subtitle:
    "目前为邀请制内测。老用户直接用邮箱验证码登录；首次使用请展开并填写邀请码。",
  otpHint: "验证码 10 分钟内有效。",
} as const;

export const EMPTY_FAMILIES = {
  title: "还没有家族档案",
  body: "从两三个你熟悉的家人开始就可以，资料以后可以慢慢补充。若家人已发来邀请链接，打开链接即可加入。",
  cta: "创建第一个家族档案",
} as const;

/** "刚刚 / 5 分钟前 / 3 小时前 / 昨天 / 11月3日" — feed timestamps. */
export function relativeTimeLabel(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  const diffMs = now.getTime() - t.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} 小时前`;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 86400000;
  if (t.getTime() >= startOfToday.getTime() - dayMs) return "昨天";
  if (t.getFullYear() === now.getFullYear()) {
    return `${t.getMonth() + 1}月${t.getDate()}日`;
  }
  return `${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日`;
}

/** 字辈 in use per generation, most common first. */
export function generationWordsByGeneration(
  wordsByPerson: Record<string, string>,
  generationByPerson: Record<string, number>,
  excludePersonId?: string
): Map<number, { word: string; count: number }[]> {
  const counts = new Map<number, Map<string, number>>();
  for (const [personId, word] of Object.entries(wordsByPerson)) {
    const g = generationByPerson[personId];
    if (!g || personId === excludePersonId) continue;
    const m = counts.get(g) ?? new Map<string, number>();
    m.set(word, (m.get(word) ?? 0) + 1);
    counts.set(g, m);
  }
  const out = new Map<number, { word: string; count: number }[]>();
  for (const [g, m] of counts) {
    out.set(
      g,
      [...m.entries()]
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, "zh-CN"))
    );
  }
  return out;
}

export function generationLabel(gen: number): string {
  const cn = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  if (gen >= 1 && gen <= 10) return `第${cn[gen]}代`;
  return `第${gen}代`;
}

/** Unique CJK characters from a pasted 行辈歌 (drops punctuation / spaces). */
export function generationSongChars(snippet: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ch of snippet) {
    if (!/[\u4e00-\u9fff]/.test(ch)) continue;
    if (seen.has(ch)) continue;
    seen.add(ch);
    out.push(ch);
  }
  return out;
}
