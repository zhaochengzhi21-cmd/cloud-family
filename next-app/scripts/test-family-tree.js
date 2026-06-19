/**
 * 家族树构建逻辑测试脚本（带修复验证）
 * 
 * 测试数据：
 * 第一代（祖辈）：赵德厚（男，1945）配 陈秀英（女，1947）
 * 第二代（父辈）：赵振林（男，1973）配 张艳霞（女，1975）
 *                  赵振山（男，1976，无配偶）
 * 第三代（子辈）：赵诚志（男，1995）
 *                  赵苗（女，1997）
 */

function getChildIds(member, members) {
  const ids = new Set();
  if (member.childrenIds) {
    for (const cid of member.childrenIds) ids.add(cid);
  }
  for (const m of members) {
    if (m.parentId === member.id || m.fatherId === member.id || m.motherId === member.id) {
      ids.add(m.id);
    }
  }
  return Array.from(ids);
}

function sortByBirth(a, b) {
  const ay = a.birth ? parseInt(a.birth) : 9999;
  const by = b.birth ? parseInt(b.birth) : 9999;
  return ay - by;
}

const MAX_GENERATION = 30;

function buildCoupleGroups(nodes) {
  const groups = [];
  const used = new Set();
  for (const node of nodes) {
    if (used.has(node.member.id)) continue;
    if (node.spouse && !used.has(node.spouse.member.id)) {
      const sn = node.spouse;
      const isHusband = node.member.gender === "男" || (sn.member.gender === "女" && node.member.gender !== "女") || node.member.id < sn.member.id;
      groups.push({ husband: isHusband ? node : sn, wife: isHusband ? sn : node, children: node.children });
      used.add(node.member.id); used.add(sn.member.id);
    } else {
      groups.push({ husband: node, wife: null, children: node.children });
      used.add(node.member.id);
    }
  }
  return groups;
}

// ===================== 原始版本（有Bug） =====================

function buildPagodaTree_ORIGINAL(members) {
  if (members.length === 0) return [];

  const nodeMap = new Map();
  for (const m of members) {
    nodeMap.set(m.id, { member: m, generation: -1, children: [], spouse: null });
  }

  for (const m of members) {
    if (m.spouseOf && nodeMap.has(m.spouseOf)) {
      const node = nodeMap.get(m.id);
      const sn = nodeMap.get(m.spouseOf);
      node.spouse = sn; sn.spouse = node;
    }
    if (m.spouseId && nodeMap.has(m.spouseId)) {
      const node = nodeMap.get(m.id);
      const sn = nodeMap.get(m.spouseId);
      node.spouse = sn; sn.spouse = node;
    }
  }

  const assigned = new Set();

  // ── Bug就在这里：配偶（如张艳霞）没有fatherId/motherId，
  //    也被当作根节点。当BFS处理张艳霞时，她把赵振林拉到gen=0，
  //    导致整个树结构错位。 ──
  const gen0Ids = [];
  for (const m of members) {
    if ((!m.fatherId || m.fatherId === "") && (!m.motherId || m.motherId === "")) {
      gen0Ids.push(m.id);
    }
  }
  if (gen0Ids.length === 0) {
    const isChild = new Set();
    for (const m of members) for (const cid of getChildIds(m, members)) isChild.add(cid);
    for (const m of members) if (!isChild.has(m.id)) gen0Ids.push(m.id);
  }

  const queue = [];
  for (const id of gen0Ids) {
    if (!assigned.has(id)) queue.push({ nodeId: id, gen: 0 });
  }

  while (queue.length > 0) {
    const { nodeId, gen } = queue.shift();
    if (assigned.has(nodeId) || gen > MAX_GENERATION) continue;
    assigned.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    node.generation = gen;

    if (node.spouse && !assigned.has(node.spouse.member.id)) {
      node.spouse.generation = gen;
      assigned.add(node.spouse.member.id);
    }

    const allChildIds = new Set();
    for (const cid of getChildIds(node.member, members)) allChildIds.add(cid);
    if (node.spouse) {
      for (const cid of getChildIds(node.spouse.member, members)) allChildIds.add(cid);
    }

    for (const cid of allChildIds) {
      const cn = nodeMap.get(cid);
      if (cn && !assigned.has(cid)) {
        if (!node.children.some(c => c.member.id === cid)) {
          node.children.push(cn);
        }
        queue.push({ nodeId: cid, gen: gen + 1 });
      }
    }
  }

  for (const m of members) {
    if (!assigned.has(m.id)) {
      const node = nodeMap.get(m.id);
      if (node) {
        node.generation = 0; assigned.add(m.id);
        if (node.spouse && !assigned.has(node.spouse.member.id)) {
          node.spouse.generation = 0; assigned.add(node.spouse.member.id);
        }
      }
    }
  }

  for (const [, node] of nodeMap) {
    node.children.sort((a, b) => sortByBirth(a.member, b.member));
  }

  const genMap = new Map();
  for (const [, node] of nodeMap) {
    if (!assigned.has(node.member.id)) continue;
    if (!genMap.has(node.generation)) genMap.set(node.generation, []);
    genMap.get(node.generation).push(node);
  }

  const generations = [];
  for (const gen of Array.from(genMap.keys()).sort((a, b) => a - b)) {
    generations.push({ generation: gen, couples: buildCoupleGroups(genMap.get(gen)) });
  }
  return generations;
}

// ===================== 修复版本 =====================

function buildPagodaTree_FIXED(members) {
  if (members.length === 0) return [];

  const nodeMap = new Map();
  for (const m of members) {
    nodeMap.set(m.id, { member: m, generation: -1, children: [], spouse: null });
  }

  for (const m of members) {
    if (m.spouseOf && nodeMap.has(m.spouseOf)) {
      const node = nodeMap.get(m.id);
      const sn = nodeMap.get(m.spouseOf);
      node.spouse = sn; sn.spouse = node;
    }
    if (m.spouseId && nodeMap.has(m.spouseId)) {
      const node = nodeMap.get(m.id);
      const sn = nodeMap.get(m.spouseId);
      node.spouse = sn; sn.spouse = node;
    }
  }

  const assigned = new Set();

  // ── 修复：找根节点时，只选那些既没有父辈、又没有配偶指向家族中其他人（避免配偶被误当根节点）
  //    更精确：无fatherId/motherId的人中，排除那些配偶已经在家族中的 ──
  const gen0Ids = [];
  for (const m of members) {
    if ((!m.fatherId || m.fatherId === "") && (!m.motherId || m.motherId === "")) {
      // 如果这个人有配偶，且配偶也有父辈信息，那这个人不是根节点
      const spouseId = m.spouseOf || m.spouseId;
      if (spouseId && nodeMap.has(spouseId)) {
        const spouse = nodeMap.get(spouseId).member;
        // 如果配偶有父辈信息（说明配偶是家族中的一代），或者配偶也在候选名单中但ID更大（避免重复），
        // 则跳过这个候选
        if ((spouse.fatherId && spouse.fatherId !== "") || (spouse.motherId && spouse.motherId !== "")) {
          continue; // 配偶有父辈，所以这个人应该通过配偶关系被纳入树
        }
        // 如果配偶也没有父辈，两者都是根节点候选，只选ID较小的那个
        if (spouseId < m.id) {
          continue; // 让配偶作为根节点
        }
      }
      gen0Ids.push(m.id);
    }
  }
  
  // 如果找不到根节点（所有节点都有父辈），fallback
  if (gen0Ids.length === 0) {
    const isChild = new Set();
    for (const m of members) for (const cid of getChildIds(m, members)) isChild.add(cid);
    for (const m of members) if (!isChild.has(m.id)) gen0Ids.push(m.id);
  }

  const queue = [];
  for (const id of gen0Ids) {
    if (!assigned.has(id)) queue.push({ nodeId: id, gen: 0 });
  }

  while (queue.length > 0) {
    const { nodeId, gen } = queue.shift();
    if (assigned.has(nodeId) || gen > MAX_GENERATION) continue;
    assigned.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    node.generation = gen;

    if (node.spouse && !assigned.has(node.spouse.member.id)) {
      node.spouse.generation = gen;
      assigned.add(node.spouse.member.id);
    }

    const allChildIds = new Set();
    for (const cid of getChildIds(node.member, members)) allChildIds.add(cid);
    if (node.spouse) {
      for (const cid of getChildIds(node.spouse.member, members)) allChildIds.add(cid);
    }

    for (const cid of allChildIds) {
      const cn = nodeMap.get(cid);
      if (cn && !assigned.has(cid)) {
        if (!node.children.some(c => c.member.id === cid)) {
          node.children.push(cn);
        }
        queue.push({ nodeId: cid, gen: gen + 1 });
      }
    }
  }

  for (const m of members) {
    if (!assigned.has(m.id)) {
      const node = nodeMap.get(m.id);
      if (node) {
        node.generation = 0; assigned.add(m.id);
        if (node.spouse && !assigned.has(node.spouse.member.id)) {
          node.spouse.generation = 0; assigned.add(node.spouse.member.id);
        }
      }
    }
  }

  for (const [, node] of nodeMap) {
    node.children.sort((a, b) => sortByBirth(a.member, b.member));
  }

  const genMap = new Map();
  for (const [, node] of nodeMap) {
    if (!assigned.has(node.member.id)) continue;
    if (!genMap.has(node.generation)) genMap.set(node.generation, []);
    genMap.get(node.generation).push(node);
  }

  const generations = [];
  for (const gen of Array.from(genMap.keys()).sort((a, b) => a - b)) {
    generations.push({ generation: gen, couples: buildCoupleGroups(genMap.get(gen)) });
  }
  return generations;
}

// ==================== 更简洁的修复 ====================

function buildPagodaTree_FIXED2(members) {
  if (members.length === 0) return [];

  const nodeMap = new Map();
  for (const m of members) {
    nodeMap.set(m.id, { member: m, generation: -1, children: [], spouse: null });
  }

  for (const m of members) {
    if (m.spouseOf && nodeMap.has(m.spouseOf)) {
      const node = nodeMap.get(m.id);
      const sn = nodeMap.get(m.spouseOf);
      node.spouse = sn; sn.spouse = node;
    }
    if (m.spouseId && nodeMap.has(m.spouseId)) {
      const node = nodeMap.get(m.id);
      const sn = nodeMap.get(m.spouseId);
      node.spouse = sn; sn.spouse = node;
    }
  }

  const assigned = new Set();

  // ── 修复方案：找根节点时，排除那些配偶有父辈的人 ──
  const gen0Ids = [];
  for (const m of members) {
    if ((!m.fatherId || m.fatherId === "") && (!m.motherId || m.motherId === "")) {
      // 检查这个人的配偶是否已有父辈信息（即属于家族中某人的后代）
      const spouseId = m.spouseOf || m.spouseId;
      let spouseHasParent = false;
      if (spouseId) {
        const spouse = members.find(x => x.id === spouseId);
        if (spouse) {
          spouseHasParent = !!(spouse.fatherId && spouse.fatherId !== "") || !!(spouse.motherId && spouse.motherId !== "");
        }
      }
      if (!spouseHasParent) {
        gen0Ids.push(m.id);
      }
    }
  }
  
  if (gen0Ids.length === 0) {
    const isChild = new Set();
    for (const m of members) for (const cid of getChildIds(m, members)) isChild.add(cid);
    for (const m of members) if (!isChild.has(m.id)) gen0Ids.push(m.id);
  }

  const queue = [];
  for (const id of gen0Ids) {
    if (!assigned.has(id)) queue.push({ nodeId: id, gen: 0 });
  }

  while (queue.length > 0) {
    const { nodeId, gen } = queue.shift();
    if (assigned.has(nodeId) || gen > MAX_GENERATION) continue;
    assigned.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    node.generation = gen;

    if (node.spouse && !assigned.has(node.spouse.member.id)) {
      node.spouse.generation = gen;
      assigned.add(node.spouse.member.id);
    }

    const allChildIds = new Set();
    for (const cid of getChildIds(node.member, members)) allChildIds.add(cid);
    if (node.spouse) {
      for (const cid of getChildIds(node.spouse.member, members)) allChildIds.add(cid);
    }

    for (const cid of allChildIds) {
      const cn = nodeMap.get(cid);
      if (cn && !assigned.has(cid)) {
        if (!node.children.some(c => c.member.id === cid)) {
          node.children.push(cn);
        }
        queue.push({ nodeId: cid, gen: gen + 1 });
      }
    }
  }

  for (const m of members) {
    if (!assigned.has(m.id)) {
      const node = nodeMap.get(m.id);
      if (node) {
        node.generation = 0; assigned.add(m.id);
        if (node.spouse && !assigned.has(node.spouse.member.id)) {
          node.spouse.generation = 0; assigned.add(node.spouse.member.id);
        }
      }
    }
  }

  for (const [, node] of nodeMap) {
    node.children.sort((a, b) => sortByBirth(a.member, b.member));
  }

  const genMap = new Map();
  for (const [, node] of nodeMap) {
    if (!assigned.has(node.member.id)) continue;
    if (!genMap.has(node.generation)) genMap.set(node.generation, []);
    genMap.get(node.generation).push(node);
  }

  const generations = [];
  for (const gen of Array.from(genMap.keys()).sort((a, b) => a - b)) {
    generations.push({ generation: gen, couples: buildCoupleGroups(genMap.get(gen)) });
  }
  return generations;
}

// ==================== 辅助分析函数 ====================

function analyzeResult(name, generations, members) {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`${name}`);
  console.log(`${"=".repeat(50)}`);

  const genMap = new Map();
  for (const genRow of generations) {
    for (const cpl of genRow.couples) {
      if (cpl.husband) {
        if (!genMap.has(cpl.husband.member.id)) genMap.set(cpl.husband.member.id, genRow.generation);
      }
      if (cpl.wife) {
        if (!genMap.has(cpl.wife.member.id)) genMap.set(cpl.wife.member.id, genRow.generation);
      }
    }
  }

  const genLabels = ["第一代", "第二代", "第三代"];
  
  // 输出结构
  for (const genRow of generations) {
    const label = genRow.generation < genLabels.length ? genLabels[genRow.generation] : `第${genRow.generation + 1}代`;
    console.log(`\n  ${label} (generation=${genRow.generation}):`);
    for (const cpl of genRow.couples) {
      const h = cpl.husband?.member.name || "?";
      const w = cpl.wife?.member.name || null;
      console.log(`    ${h}${w ? ` + ${w}` : "（单身）"}`);
      if (cpl.children.length > 0) {
        const kidNames = cpl.children.map(c => c.member.name).join(", ");
        console.log(`      ↓ 子女: ${kidNames}`);
      }
    }
  }

  // 逐个检查
  console.log("\n  检查结果：");
  let allPass = true;
  for (const m of members) {
    const gen = genMap.get(m.id);
    let status = "⚠️";
    if (m.name === "赵德厚" || m.name === "陈秀英") {
      status = gen === 0 ? "✅" : "❌";
      if (gen !== 0) allPass = false;
      console.log(`    ${status} ${m.name}: gen=${gen} (期望=0)`);
    } else if (m.name === "赵振林" || m.name === "张艳霞") {
      status = gen === 1 ? "✅" : "❌";
      if (gen !== 1) allPass = false;
      console.log(`    ${status} ${m.name}: gen=${gen} (期望=1)`);
    } else if (m.name === "赵振山") {
      status = gen === 1 ? "✅" : "❌";
      if (gen !== 1) allPass = false;
      console.log(`    ${status} ${m.name}: gen=${gen} (期望=1)`);
    } else if (m.name === "赵诚志" || m.name === "赵苗") {
      status = gen === 2 ? "✅" : "❌";
      if (gen !== 2) allPass = false;
      console.log(`    ${status} ${m.name}: gen=${gen} (期望=2)`);
    }
  }
  
  // 检查子女归属
  for (const genRow of generations) {
    for (const cpl of genRow.couples) {
      if (cpl.children.length > 0) {
        const parentName = cpl.husband?.member.name || cpl.wife?.member.name || "?";
        for (const child of cpl.children) {
          if (child.member.name === "赵诚志" || child.member.name === "赵苗") {
            console.log(`    ℹ️ ${child.member.name} 在 ${parentName} 组的 children 中`);
          }
        }
      }
    }
  }

  console.log(`\n  ${allPass ? "✅ 全部通过！" : "❌ 有错误！"}`);
}

// ==================== 测试数据 ====================

const members = [
  { id: "zhao-dehou", name: "赵德厚", gender: "男", birth: "1945", spouseOf: "chen-xiuying" },
  { id: "chen-xiuying", name: "陈秀英", gender: "女", birth: "1947", spouseOf: "zhao-dehou" },
  { id: "zhao-zhenlin", name: "赵振林", gender: "男", birth: "1973", fatherId: "zhao-dehou", motherId: "chen-xiuying", spouseOf: "zhang-yanxia" },
  { id: "zhang-yanxia", name: "张艳霞", gender: "女", birth: "1975", spouseOf: "zhao-zhenlin" },
  { id: "zhao-zhenshan", name: "赵振山", gender: "男", birth: "1976", fatherId: "zhao-dehou", motherId: "chen-xiuying" },
  { id: "zhao-chengzhi", name: "赵诚志", gender: "男", birth: "1995", fatherId: "zhao-zhenlin", motherId: "zhang-yanxia" },
  { id: "zhao-miao", name: "赵苗", gender: "女", birth: "1997", fatherId: "zhao-zhenlin", motherId: "zhang-yanxia" },
];

console.log("=".repeat(50));
console.log("家族树构建逻辑测试（原始 vs 修复）");
console.log("=".repeat(50));

const gens1 = buildPagodaTree_ORIGINAL(members);
analyzeResult("原始版本（当前生产代码）", gens1, members);

const gens2 = buildPagodaTree_FIXED2(members);
analyzeResult("修复版本（排除配偶误当根节点）", gens2, members);

// 输出总体结论
console.log("\n");
console.log("=".repeat(50));
console.log("问题根因分析");
console.log("=".repeat(50));
console.log(`
在 buildPagodaTree 中找根节点（gen0Ids）时，代码只检查了 fatherId 和 motherId：
  if ((!m.fatherId || m.fatherId === "") && (!m.motherId || m.motherId === "")) {
    gen0Ids.push(m.id);
  }

这意味着，像"张艳霞"这样的配偶角色，因为没有设置 fatherId/motherId（她不是从本家族
出生的，而是嫁进来的），也被当成了根节点。

当 BFS 从张艳霞开始遍历时：
1. 张艳霞(gen=0) → 配偶赵振林被拉到 gen=0（"配偶同代"逻辑）
2. 张艳霞的子女赵诚志、赵苗入队 gen=1
3. 赵振林已 assigned 跳过了（被张艳霞拉到了 gen=0）
4. 赵诚志(gen=1)、赵苗(gen=1) 被分配为第二代

但正确的应该是：
- 赵德厚(gen=0) → 配偶陈秀英(gen=0)
- 子女赵振林(gen=1)、赵振山(gen=1)
- 赵振林(gen=1) → 配偶张艳霞(gen=1)
- 子女赵诚志(gen=2)、赵苗(gen=2)

修复方案：在根节点识别时，排除那些配偶已有父辈信息的人。
`);

console.log("=".repeat(50));
console.log("修复建议");
console.log("=".repeat(50));
console.log(`
在 buildPagodaTree 的 gen0Ids 查找循环中添加一个条件：
对每个无 fatherId/motherId 的候选，检查其配偶是否具有 fatherId/motherId。
如果有，说明这个候选是嫁进来的配偶，不是真正的根节点。

具体代码修改在 FamilyTreePagoda.tsx 的 buildPagodaTree 函数中，
第 84-88 行的 for 循环内增加配偶检查。
`);