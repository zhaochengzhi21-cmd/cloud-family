/**
 * 家族关联匹配 API
 *
 * 根据以下维度匹配其他已开启关联的家族：
 * 1. 姓氏相同
 * 2. 祖籍地（市县级别）相同或相邻
 * 3. 字辈部分重合
 * 4. 堂号相同
 * 5. 高代节点（最早祖先）姓名相似
 *
 * 匹配结果按综合分数排序，只返回分数最高的 3 个。
 * 只返回脱敏信息。
 */

import { NextRequest, NextResponse } from "next/server";
import { defaultAbiCoder } from "@ethersproject/abi";
import { getFamilyMeta, getAllFamilyMeta } from "@/lib/familyStore";
import { fetchJsonFromIpfs } from "@/lib/ipfsGateway";

// ==================== 合约配置 ====================

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";
const ALCHEMY_POLYGON_RPC_URL = process.env.ALCHEMY_POLYGON_RPC_URL || "";
const FAMILY_DATA_HASH_SELECTOR = "65023a23";

// ==================== 类型定义 ====================

interface MatchResult {
  familyId: string;
  familyName: string;
  origin: string;
  generationCount: number;
  founderName: string;
  score: number;
  matchReasons: string[];
}

interface MatchingConfig {
  surname: string;
  origin?: string;
  generationWords?: string[];
  hallName?: string;
  founderName?: string;
}

// ==================== 合约调用 ====================

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(ALCHEMY_POLYGON_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC call ${method} failed: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function callContract(data: string): Promise<string> {
  return (await rpcCall("eth_call", [{ to: CONTRACT_ADDRESS, data }, "latest"])) as string;
}

/**
 * 从合约获取家族数据的 IPFS CID（dataHash）
 */
async function getDataHashFromContract(familyId: string): Promise<string | null> {
  try {
    const familyIdHex = familyId.startsWith("0x") ? familyId.slice(2) : familyId;
    const callData = "0x" + FAMILY_DATA_HASH_SELECTOR + familyIdHex.padStart(64, "0");
    const rawResult = await callContract(callData);
    const decoded = defaultAbiCoder.decode(["string"], rawResult);
    const dataHash: string = decoded[0];
    return dataHash || null;
  } catch {
    return null;
  }
}

// ==================== 脱敏工具 ====================

function maskName(name: string): string {
  if (!name) return "未知";
  return name[0] + "**";
}

function maskOrigin(origin: string): string {
  if (!origin) return "未知";
  const match = origin.match(/(?:省|自治区|直辖市)?(.+?(?:市|县|区|旗))/);
  if (match) return match[1];
  if (origin.length <= 4) return origin;
  return origin.slice(0, 4) + "…";
}

function maskFamilyName(familyName: string): string {
  if (!familyName) return "某氏";
  return familyName[0] + "氏";
}

// ==================== IPFS 数据提取 ====================

async function extractMatchingConfig(ipfsData: any): Promise<MatchingConfig> {
  const config: MatchingConfig = { surname: "" };

  try {
    const tree = ipfsData?.data || ipfsData;
    if (!tree) return config;

    const familyName = tree.familyName || "";
    config.surname = familyName ? familyName[0] : "";

    const members: any[] = tree.members || [];
    if (members.length > 0) {
      const rootMember = members.find((m: any) => !m.parentId && !m.fatherId) || members[0];
      if (rootMember) {
        if (rootMember.info) {
          const originMatch = rootMember.info.match(/祖籍[：:]\s*([^\s，,，、\n]+)/);
          if (originMatch) {
            config.origin = originMatch[1].trim();
          }
        }
        if (!config.origin && rootMember.burialPlace) {
          config.origin = rootMember.burialPlace;
        }
      }
    }

    const genWords: string[] = members
      .map((m: any) => m.generationWord)
      .filter((w: any) => typeof w === "string" && w.length > 0);
    if (genWords.length > 0) {
      config.generationWords = [...new Set(genWords)];
    }

    for (const member of members) {
      if (member.info) {
        const hallMatch = member.info.match(/堂号[：:]\s*([^\s，,，、\n]+)/);
        if (hallMatch) {
          config.hallName = hallMatch[1].trim();
          break;
        }
      }
    }

    const founder = members.find((m: any) => !m.parentId && !m.fatherId) || members[0];
    if (founder) {
      config.founderName = founder.name || "";
    }
  } catch (err) {
    console.error("[family-matching] extractMatchingConfig error:", err);
  }

  return config;
}

// ==================== 匹配算法 ====================

function calculateOriginScore(origin1: string, origin2: string): number {
  if (!origin1 || !origin2) return 0;
  if (origin1 === origin2) return 1;
  const province1 = origin1.match(/(?:省|自治区|直辖市)?(.+?)(?:市|县|区|旗)/);
  const province2 = origin2.match(/(?:省|自治区|直辖市)?(.+?)(?:市|县|区|旗)/);
  if (province1 && province2 && province1[0] === province2[0]) {
    return 0.5;
  }
  return 0;
}

function calculateGenerationWordScore(words1: string[], words2: string[]): number {
  if (!words1?.length || !words2?.length) return 0;
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  let intersection = 0;
  for (const w of set1) {
    if (set2.has(w)) intersection++;
  }
  const union = new Set([...set1, ...set2]).size;
  return union > 0 ? intersection / union : 0;
}

function calculateNameSimilarity(name1: string, name2: string): number {
  if (!name1 || !name2) return 0;
  if (name1 === name2) return 1;

  const surname1 = name1[0];
  const surname2 = name2[0];

  if (surname1 !== surname2) {
    const chars1 = new Set(name1);
    const chars2 = new Set(name2);
    let overlap = 0;
    for (const c of chars1) {
      if (chars2.has(c)) overlap++;
    }
    const maxSize = Math.max(chars1.size, chars2.size);
    return maxSize > 0 ? (overlap / maxSize) * 0.3 : 0;
  }

  const given1 = name1.slice(1);
  const given2 = name2.slice(1);

  if (!given1 && !given2) return 0.8;
  if (!given1 || !given2) return 0.5;

  const m = given1.length;
  const n = given2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (given1[i - 1] === given2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(dp[i - 1][j - 1] + 1, dp[i - 1][j] + 1, dp[i][j - 1] + 1);
      }
    }
  }

  const dist = dp[m][n];
  const maxLen = Math.max(given1.length, given2.length);
  const similarity = 1 - dist / maxLen;
  return 0.5 + similarity * 0.5;
}

// ==================== 主 API ====================

export async function POST(
  _request: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
    const { familyId } = params;

    if (!CONTRACT_ADDRESS || !ALCHEMY_POLYGON_RPC_URL) {
      return NextResponse.json(
        { success: false, error: "Blockchain config not fully set" },
        { status: 500 }
      );
    }

    // 1. 获取当前家族的元数据，检查是否开启关联匹配
    const currentMeta = await getFamilyMeta(familyId);
    if (!currentMeta) {
      return NextResponse.json(
        { success: false, error: "未找到该家族的数据" },
        { status: 404 }
      );
    }
    if (!currentMeta.enableMatching) {
      return NextResponse.json(
        { success: false, error: "该家族未开启关联匹配" },
        { status: 400 }
      );
    }

    // 2. 从合约获取当前家族的 dataHash（IPFS CID）
    const dataHash = await getDataHashFromContract(familyId);
    if (!dataHash) {
      return NextResponse.json(
        { success: false, error: "未找到该家族的链上数据" },
        { status: 400 }
      );
    }

    const ipfsData = await fetchJsonFromIpfs(dataHash);
    if (!ipfsData) {
      return NextResponse.json(
        { success: false, error: "无法加载家族树数据" },
        { status: 400 }
      );
    }

    const currentConfig = await extractMatchingConfig(ipfsData);

    // 3. 获取所有开启了匹配的其他家族
    const allMetas = await getAllFamilyMeta();
    const candidates = allMetas.filter(
      (m) => m.familyId !== familyId && m.enableMatching
    );

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        matches: [],
        message: "暂未找到开启关联匹配的其他家族",
      });
    }

    // 4. 对每个候选家族计算匹配分数
    const results: MatchResult[] = [];

    for (const candidateMeta of candidates) {
      try {
        // 从合约获取候选家族的 dataHash
        const candidateDataHash = await getDataHashFromContract(candidateMeta.familyId);
        if (!candidateDataHash) continue;

        const candidateIpfsData = await fetchJsonFromIpfs(candidateDataHash);
        if (!candidateIpfsData) continue;

        const candidateConfig = await extractMatchingConfig(candidateIpfsData);

        const matchReasons: string[] = [];
        let totalScore = 0;

        // 4a. 姓氏相同（权重 0.25）
        if (
          currentConfig.surname &&
          candidateConfig.surname &&
          currentConfig.surname === candidateConfig.surname
        ) {
          totalScore += 25;
          matchReasons.push(`同姓「${currentConfig.surname}」`);
        }

        // 4b. 祖籍地相同或相邻（权重 0.2）
        if (currentConfig.origin && candidateConfig.origin) {
          const originScore = calculateOriginScore(currentConfig.origin, candidateConfig.origin);
          if (originScore > 0) {
            totalScore += originScore * 20;
            if (originScore === 1) {
              matchReasons.push(`祖籍地同为「${maskOrigin(currentConfig.origin)}」`);
            } else {
              matchReasons.push(`祖籍地相邻（${maskOrigin(currentConfig.origin)}）`);
            }
          }
        }

        // 4c. 字辈重合（权重 0.25）
        if (currentConfig.generationWords?.length && candidateConfig.generationWords?.length) {
          const genScore = calculateGenerationWordScore(
            currentConfig.generationWords,
            candidateConfig.generationWords
          );
          if (genScore > 0) {
            totalScore += genScore * 25;
            matchReasons.push(`字辈部分重合（相似度 ${Math.round(genScore * 100)}%）`);
          }
        }

        // 4d. 堂号相同（权重 0.15）
        if (
          currentConfig.hallName &&
          candidateConfig.hallName &&
          currentConfig.hallName === candidateConfig.hallName
        ) {
          totalScore += 15;
          matchReasons.push(`堂号同为「${currentConfig.hallName}」`);
        }

        // 4e. 最早祖先姓名相似（权重 0.15）
        if (currentConfig.founderName && candidateConfig.founderName) {
          const nameScore = calculateNameSimilarity(
            currentConfig.founderName,
            candidateConfig.founderName
          );
          if (nameScore > 0.3) {
            totalScore += nameScore * 15;
            matchReasons.push(`最早先辈姓名相似（相似度 ${Math.round(nameScore * 100)}%）`);
          }
        }

        if (totalScore > 0) {
          const candidateTree: any = candidateIpfsData?.data || candidateIpfsData;
          const candidateMembers: any[] = candidateTree?.members || [];
          const candidateFounder =
            candidateMembers.find((m: any) => !m.parentId && !m.fatherId) || candidateMembers[0];

          results.push({
            familyId: candidateMeta.familyId,
            familyName: maskFamilyName(candidateMeta.familyName),
            origin: candidateConfig.origin ? maskOrigin(candidateConfig.origin) : "未知",
            generationCount: candidateMeta.memberCount || candidateMembers.length || 0,
            founderName: candidateFounder?.name ? maskName(candidateFounder.name) : "未知",
            score: Math.round(totalScore),
            matchReasons,
          });
        }
      } catch (err) {
        console.error(`[family-matching] Error processing candidate ${candidateMeta.familyId}:`, err);
        continue;
      }
    }

    // 5. 按分数排序，只返回前 3 个
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, 3);

    return NextResponse.json({
      success: true,
      matches: topResults,
      message:
        topResults.length > 0
          ? `找到 ${topResults.length} 个可能同源的家族`
          : "暂未找到匹配的同源家族",
    });
  } catch (err) {
    console.error("[family-matching] API error:", err);
    return NextResponse.json(
      { success: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}