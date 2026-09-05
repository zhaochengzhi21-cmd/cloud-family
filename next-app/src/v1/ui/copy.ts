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

export const CLAIM_STATUS_LABEL = {
  PROPOSED: "待确认",
  ACCEPTED: "已确认",
  CONFLICTED: "存在不同说法",
  REJECTED: "不采用",
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
};

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
  forbidden: "你的当前权限不能执行这个操作。",
  notFound: "找不到这份资料，或者你没有查看权限。",
  familyConflict: "这份家族档案刚刚被其他人更新，请刷新后再试。",
  personConflict: "这位成员的资料刚刚被更新，请重新载入后再修改。",
  ancestryCycle: "这条关系会形成循环世系，请检查所选成员。",
  duplicateRelationship: "这条家庭关系已经存在。",
  duplicateClaim: "已有相同的资料记录。",
  generic: "操作未能完成，请稍后再试。",
  verifyFailed: "验证码无效或已过期，请重新获取。",
  requestCodeGeneric:
    "如果该邮箱可以使用云族谱，我们已经发送了验证码。",
} as const;

export const LOGIN_COPY = {
  title: "把家里的故事，安全地留给下一代",
  subtitle:
    "云族谱 Alpha 目前采用邀请制。已有邀请的用户可以通过邮箱验证码登录。",
  otpHint: "验证码 10 分钟内有效。",
} as const;

export const EMPTY_FAMILIES = {
  title: "还没有家族档案",
  body: "从两三个你熟悉的家人开始就可以，资料以后可以慢慢补充。",
  cta: "创建第一个家族档案",
} as const;

export function generationLabel(gen: number): string {
  const cn = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  if (gen >= 1 && gen <= 10) return `第${cn[gen]}代`;
  return `第${gen}代`;
}
