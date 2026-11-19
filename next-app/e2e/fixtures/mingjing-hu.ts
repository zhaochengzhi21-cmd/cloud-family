/**
 * Public historical sample for Closed Alpha UI tests.
 *
 * Sources (public web articles / genealogy catalogs — not private living persons):
 * - 黟县西递胡氏代表人物（安徽纪检监察网等公开报道）
 * - 西递明经胡氏壬派宗谱著录（国学大师等谱牒目录）
 * - 婺源考水 / 明经胡氏迁西递叙述（公开地方志与宗亲资料）
 *
 * Use only as synthetic test content inside disposable E2E families.
 */

export const MINGJING_HU_SAMPLE = {
  familyDisplayName: "西递明经胡氏（测试）",
  surname: "胡",
  /** 十八世祖胡文光 — public historical figure */
  wenGuang: {
    preferredName: "胡文光",
    gender: "MALE" as const,
    livingStatus: "DECEASED" as const,
    claims: [
      {
        claimType: "BIRTH_DATE",
        text: "约明嘉靖年间",
      },
      {
        claimType: "BIRTH_PLACE",
        text: "安徽黟县西递",
      },
      {
        claimType: "ANCESTRAL_PLACE",
        text: "江西婺源考水",
      },
      {
        claimType: "GENERATION_WORD",
        text: "文",
      },
      {
        claimType: "OCCUPATION",
        text: "万载知县，后升胶州刺史",
      },
      {
        claimType: "DEATH_DATE",
        text: "约明万历年间",
      },
      {
        claimType: "STORY",
        text: "在任清廉，族人捐建功德牌坊表彰。西递口传：文光刺史美名扬，重视教育办学堂。",
        narrator: "据西递口碑整理",
      },
    ],
    evidence: {
      title: "黟县西递胡氏代表人物",
      evidenceType: "OTHER",
      sourceLocator: "公开报道摘录（测试）",
      sourceDateText: "公开网页",
    },
  },
  /** 西递始迁祖胡士良（谱牒目录常见著录） */
  shiLiang: {
    preferredName: "胡士良",
    gender: "MALE" as const,
    livingStatus: "DECEASED" as const,
    claims: [
      {
        claimType: "BIRTH_DATE",
        text: "约北宋年间",
      },
      {
        claimType: "BIRTH_PLACE",
        text: "江西婺源",
      },
      {
        claimType: "ANCESTRAL_PLACE",
        text: "江西婺源考水",
      },
      {
        claimType: "ALIAS",
        text: "字季臣",
      },
      {
        claimType: "GENERATION_WORD",
        text: "士",
      },
      {
        claimType: "STORY",
        text: "北宋皇祐年间由婺源迁居西递，为西递明经胡氏始迁祖。",
        narrator: "据谱牒目录与地方公开叙述",
      },
    ],
  },
  /** 道光《西递明经壬派排行》公开「行辈歌」节选，供字辈测试 */
  generationSongSnippet: "圣世长清，兆锡嘉名",
} as const;
