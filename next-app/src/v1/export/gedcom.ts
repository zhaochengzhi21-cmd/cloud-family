/**
 * Convert a privacy-scoped FamilyExport into GEDCOM 5.5.1 text.
 * Pure function — no IO. Dates stay as free text (DATE even without calendar).
 */

import type { FamilyExport } from "@/v1/services/exportService";

type Person = FamilyExport["persons"][number];
type Fact = Person["facts"][number];
type Rel = FamilyExport["relationships"][number];

const PARENT = new Set([
  "BIOLOGICAL_PARENT",
  "ADOPTIVE_PARENT",
  "STEP_PARENT",
]);

function factText(facts: Fact[], type: string): string | null {
  const accepted = facts.filter(
    (f) => f.claimType === type && f.status === "ACCEPTED"
  );
  const rows = accepted.length
    ? accepted
    : facts.filter((f) => f.claimType === type && f.status !== "REJECTED");
  const v = rows[0]?.value as { text?: unknown } | null;
  return typeof v?.text === "string" && v.text.trim() ? v.text.trim() : null;
}

function escapeGedcom(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/@/g, "@@");
}

/** Split long values across CONT/CONC lines (≤200 chars per payload chunk). */
function emitText(level: number, tag: string, text: string): string[] {
  const safe = escapeGedcom(text);
  const lines: string[] = [];
  const firstBudget = Math.max(1, 200 - tag.length - 1);
  let rest = safe;
  const head = rest.slice(0, firstBudget);
  rest = rest.slice(firstBudget);
  lines.push(`${level} ${tag} ${head}`);
  while (rest.length) {
    const chunk = rest.slice(0, 200);
    rest = rest.slice(200);
    // Prefer CONT on paragraph boundaries when the cut landed mid-line.
    lines.push(`${level + 1} CONT ${chunk}`);
  }
  return lines;
}

function sexOf(gender: string): string {
  if (gender === "MALE") return "M";
  if (gender === "FEMALE") return "F";
  return "U";
}

function nameLine(person: Person, surname: string | null): string {
  const n = person.preferredName.trim();
  if (surname && n.startsWith(surname) && n.length > surname.length) {
    return `1 NAME ${escapeGedcom(n.slice(surname.length))} /${escapeGedcom(surname)}/`;
  }
  if (surname) {
    return `1 NAME ${escapeGedcom(n)} /${escapeGedcom(surname)}/`;
  }
  return `1 NAME ${escapeGedcom(n)}`;
}

type FamUnit = {
  id: string;
  husbandId: string | null;
  wifeId: string | null;
  childIds: string[];
};

/**
 * Build nuclear families: each spouse pair is a FAM; lone-parent→child edges
 * get a FAM with one parent. Children attach to a matching parent FAM when possible.
 */
function buildFamilies(
  persons: Person[],
  relationships: Rel[]
): { fams: FamUnit[]; famc: Map<string, string>; famsOf: Map<string, string[]> } {
  const byId = new Map(persons.map((p) => [p.id, p]));
  const fams: FamUnit[] = [];
  const famKey = new Map<string, string>(); // sorted spouse ids → fam id
  const famc = new Map<string, string>();
  const famsOf = new Map<string, string[]>();

  const addFams = (personId: string, famId: string) => {
    const list = famsOf.get(personId) ?? [];
    if (!list.includes(famId)) list.push(famId);
    famsOf.set(personId, list);
  };

  let seq = 1;
  const nextId = () => {
    const id = `@F${seq}@`;
    seq += 1;
    return id;
  };

  for (const r of relationships) {
    if (r.type !== "SPOUSE") continue;
    if (!byId.has(r.fromPersonId) || !byId.has(r.toPersonId)) continue;
    const a = r.fromPersonId;
    const b = r.toPersonId;
    const key = [a, b].sort().join("|");
    if (famKey.has(key)) continue;
    const id = nextId();
    famKey.set(key, id);
    const pa = byId.get(a)!;
    const pb = byId.get(b)!;
    let husbandId: string | null = null;
    let wifeId: string | null = null;
    if (pa.gender === "MALE" || pb.gender === "FEMALE") {
      husbandId = pa.gender === "FEMALE" ? b : a;
      wifeId = husbandId === a ? b : a;
    } else if (pb.gender === "MALE" || pa.gender === "FEMALE") {
      husbandId = pb.gender === "FEMALE" ? a : b;
      wifeId = husbandId === a ? b : a;
    } else {
      husbandId = a;
      wifeId = b;
    }
    fams.push({ id, husbandId, wifeId, childIds: [] });
    addFams(a, id);
    addFams(b, id);
  }

  for (const r of relationships) {
    if (!PARENT.has(r.type)) continue;
    if (!byId.has(r.fromPersonId) || !byId.has(r.toPersonId)) continue;
    const parentId = r.fromPersonId;
    const childId = r.toPersonId;
    // Prefer a spouse FAM that already includes this parent.
    let famId = (famsOf.get(parentId) ?? []).find((fid) => {
      const f = fams.find((x) => x.id === fid);
      return f && (f.husbandId === parentId || f.wifeId === parentId);
    });
    if (!famId) {
      famId = nextId();
      const parent = byId.get(parentId)!;
      fams.push({
        id: famId,
        husbandId: parent.gender === "FEMALE" ? null : parentId,
        wifeId: parent.gender === "FEMALE" ? parentId : null,
        childIds: [],
      });
      addFams(parentId, famId);
    }
    const fam = fams.find((f) => f.id === famId)!;
    if (!fam.childIds.includes(childId)) fam.childIds.push(childId);
    if (!famc.has(childId)) famc.set(childId, famId);
  }

  return { fams, famc, famsOf };
}

export function gedcomFromExport(data: FamilyExport): string {
  const surname = data.family.surname;
  const indiId = new Map<string, string>();
  data.persons.forEach((p, i) => indiId.set(p.id, `@I${i + 1}@`));

  const { fams, famc, famsOf } = buildFamilies(
    data.persons,
    data.relationships
  );

  const out: string[] = [
    "0 HEAD",
    "1 SOUR YUNZUPU",
    "2 NAME 云族谱",
    "2 VERS 1",
    "1 DEST OTHER",
    "1 DATE " +
      new Date(data.exportedAt).toUTCString().replace(/^[A-Za-z]+, /, ""),
    "1 FILE " + escapeGedcom(`${data.family.displayName}.ged`),
    "1 GEDC",
    "2 VERS 5.5.1",
    "2 FORM LINEAGE-LINKED",
    "1 CHAR UTF-8",
    `1 NOTE Privacy-scoped export of ${escapeGedcom(data.family.displayName)}`,
  ];

  for (const p of data.persons) {
    const id = indiId.get(p.id)!;
    out.push(`0 ${id} INDI`);
    out.push(nameLine(p, surname));
    out.push(`1 SEX ${sexOf(p.gender)}`);
    if (p.livingStatus === "DECEASED") {
      // DEAT record may still be filled below from claims.
    } else if (p.livingStatus === "LIVING") {
      /* no DEAT */
    }

    const birthDate = factText(p.facts, "BIRTH_DATE");
    const birthPlace = factText(p.facts, "BIRTH_PLACE");
    if (birthDate || birthPlace) {
      out.push("1 BIRT");
      if (birthDate) out.push(...emitText(2, "DATE", birthDate));
      if (birthPlace) out.push(...emitText(2, "PLAC", birthPlace));
    }

    const deathDate = factText(p.facts, "DEATH_DATE");
    const burial = factText(p.facts, "BURIAL_PLACE");
    if (deathDate || burial || p.livingStatus === "DECEASED") {
      out.push("1 DEAT");
      if (deathDate) out.push(...emitText(2, "DATE", deathDate));
      if (burial) {
        out.push("1 BURI");
        out.push(...emitText(2, "PLAC", burial));
      }
    }

    const occ = factText(p.facts, "OCCUPATION");
    if (occ) out.push(...emitText(1, "OCCU", occ));

    const alias = factText(p.facts, "ALIAS");
    if (alias) out.push(...emitText(1, "NAME", alias));

    const ancestral = factText(p.facts, "ANCESTRAL_PLACE");
    if (ancestral) out.push(...emitText(1, "NOTE", `祖籍：${ancestral}`));

    const genWord = factText(p.facts, "GENERATION_WORD");
    if (genWord) out.push(...emitText(1, "NOTE", `字辈：${genWord}`));

    for (const f of p.facts.filter(
      (x) => x.claimType === "STORY" && x.status !== "REJECTED"
    )) {
      const v = f.value as { text?: string; narrator?: string | null };
      if (typeof v?.text !== "string") continue;
      const body = v.narrator ? `（讲述：${v.narrator}）\n${v.text}` : v.text;
      out.push(...emitText(1, "NOTE", body));
    }

    const childOf = famc.get(p.id);
    if (childOf) out.push(`1 FAMC ${childOf}`);
    for (const fid of famsOf.get(p.id) ?? []) {
      const fam = fams.find((f) => f.id === fid);
      if (
        fam &&
        (fam.husbandId === p.id || fam.wifeId === p.id) &&
        !fam.childIds.includes(p.id)
      ) {
        out.push(`1 FAMS ${fid}`);
      }
    }
  }

  for (const fam of fams) {
    out.push(`0 ${fam.id} FAM`);
    if (fam.husbandId && indiId.has(fam.husbandId)) {
      out.push(`1 HUSB ${indiId.get(fam.husbandId)}`);
    }
    if (fam.wifeId && indiId.has(fam.wifeId)) {
      out.push(`1 WIFE ${indiId.get(fam.wifeId)}`);
    }
    for (const cid of fam.childIds) {
      if (indiId.has(cid)) out.push(`1 CHIL ${indiId.get(cid)}`);
    }
  }

  out.push("0 TRLR");
  return out.join("\n") + "\n";
}
