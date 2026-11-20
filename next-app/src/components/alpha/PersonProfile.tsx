"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CLAIM_STATUS_LABEL,
  CLAIM_TYPE_UI,
  ERROR_COPY,
  EVIDENCE_TYPE_UI,
  GENDER_LABEL,
  LIVING_STATUS_LABEL,
  PRODUCT,
  birthOrderRank,
  generationLabel,
} from "@/v1/ui/copy";
import { userMessageForApiError, v1api, V1ApiError } from "@/v1/client/api";
import { handleAuthRedirect } from "@/components/alpha/AlphaNav";

type Person = Awaited<
  ReturnType<typeof v1api.getGraph>
>["graph"]["persons"][number];
type Rel = Awaited<
  ReturnType<typeof v1api.getGraph>
>["graph"]["relationships"][number];
type Claim = Awaited<
  ReturnType<typeof v1api.listPersonClaims>
>["claims"][number];
type EvidenceLink = Awaited<
  ReturnType<typeof v1api.getClaim>
>["evidenceLinks"][number];
type SourcesByClaim = Record<string, EvidenceLink[]>;
type PhotoItem = {
  mediaId: string;
  title: string | null;
  evidenceType: string;
};
type AudioItem = {
  mediaId: string;
  title: string | null;
  evidenceType: string;
};

const PARENT_TYPES = new Set([
  "BIOLOGICAL_PARENT",
  "ADOPTIVE_PARENT",
  "STEP_PARENT",
]);

const FACT_TYPES = [
  "ANCESTRAL_PLACE",
  "GENERATION_WORD",
  "BIRTH_ORDER",
  "ALIAS",
  "OCCUPATION",
] as const;

const ALL_TYPES = [
  "BIRTH_DATE",
  "BIRTH_PLACE",
  "DEATH_DATE",
  "BURIAL_PLACE",
  ...FACT_TYPES,
  "STORY",
] as const;

type KinLink = { person: Person; relationshipId: string | null };

function sortByBirthOrder(
  list: Person[],
  orders: Record<string, string>
): Person[] {
  return list.slice().sort((a, b) => {
    const ra = orders[a.id] ? birthOrderRank(orders[a.id]) : null;
    const rb = orders[b.id] ? birthOrderRank(orders[b.id]) : null;
    if (ra != null && rb != null && ra !== rb) return ra - rb;
    if (ra != null && rb == null) return -1;
    if (ra == null && rb != null) return 1;
    return a.preferredName.localeCompare(b.preferredName, "zh-CN");
  });
}

function sortKinLinksByBirthOrder(
  list: KinLink[],
  orders: Record<string, string>
): KinLink[] {
  return list.slice().sort((a, b) => {
    const ra = orders[a.person.id] ? birthOrderRank(orders[a.person.id]) : null;
    const rb = orders[b.person.id] ? birthOrderRank(orders[b.person.id]) : null;
    if (ra != null && rb != null && ra !== rb) return ra - rb;
    if (ra != null && rb == null) return -1;
    if (ra == null && rb != null) return 1;
    return a.person.preferredName.localeCompare(b.person.preferredName, "zh-CN");
  });
}

function sortKinLinksByName(list: KinLink[]): KinLink[] {
  return list
    .slice()
    .sort((a, b) =>
      a.person.preferredName.localeCompare(b.person.preferredName, "zh-CN")
    );
}

/** Accepted claims win; otherwise show every open claim so differences stay visible. */
function pickShown(claims: Claim[], type: string): Claim[] {
  const rows = claims.filter(
    (c) => c.claimType === type && c.status !== "REJECTED"
  );
  const accepted = rows.filter((c) => c.status === "ACCEPTED");
  return accepted.length ? accepted : rows;
}

export function PersonProfile({
  familyId,
  personId,
}: {
  familyId: string;
  personId: string;
}) {
  const router = useRouter();
  const [familyName, setFamilyName] = useState("");
  const [role, setRole] = useState<string>("VIEWER");
  const [persons, setPersons] = useState<Person[]>([]);
  const [relationships, setRelationships] = useState<Rel[]>([]);
  const [generationByPerson, setGenerationByPerson] = useState<
    Record<string, number>
  >({});
  const [claims, setClaims] = useState<Claim[]>([]);
  const [sources, setSources] = useState<SourcesByClaim>({});
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [audios, setAudios] = useState<AudioItem[]>([]);
  const [birthOrders, setBirthOrders] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setSources({});
    setPhotos([]);
    setAudios([]);
    setError("");
    setLoading(true);
    try {
      const [fam, list, graph, claimRes, orders] = await Promise.all([
        v1api.getFamily(familyId),
        v1api.listFamilies(),
        v1api.getGraph(familyId),
        v1api.listPersonClaims(familyId, personId),
        v1api.getBirthOrders(familyId).catch(() => ({ birthOrders: {} })),
      ]);
      setFamilyName(fam.family.displayName);
      const mine = list.families.find((f) => f.id === familyId);
      if (mine?.role) setRole(mine.role);
      setPersons(graph.graph.persons);
      setRelationships(graph.graph.relationships);
      setGenerationByPerson(graph.graph.generationByPerson);
      setBirthOrders(orders.birthOrders);
      setClaims(claimRes.claims);
      const visible = claimRes.claims.filter((c) => c.status !== "REJECTED");
      void Promise.allSettled(
        visible.map((c) => v1api.getClaim(familyId, c.id))
      ).then((details) => {
        if (loadSeq.current !== seq) return;
        const next: SourcesByClaim = {};
        const photoMap = new Map<string, PhotoItem>();
        const audioMap = new Map<string, AudioItem>();
        details.forEach((d, i) => {
          if (d.status !== "fulfilled" || !d.value.evidenceLinks.length) return;
          next[visible[i].id] = d.value.evidenceLinks;
          for (const l of d.value.evidenceLinks) {
            const mid = l.evidence.mediaObjectId;
            if (!mid) continue;
            if (
              l.evidence.evidenceType === "PHOTO" &&
              !photoMap.has(mid)
            ) {
              photoMap.set(mid, {
                mediaId: mid,
                title: l.evidence.title,
                evidenceType: l.evidence.evidenceType,
              });
            }
            if (
              l.evidence.evidenceType === "ORAL_HISTORY" &&
              !audioMap.has(mid)
            ) {
              audioMap.set(mid, {
                mediaId: mid,
                title: l.evidence.title,
                evidenceType: l.evidence.evidenceType,
              });
            }
          }
        });
        setSources(next);
        setPhotos([...photoMap.values()]);
        setAudios([...audioMap.values()]);
      });
    } catch (e) {
      if (handleAuthRedirect(e, router)) return;
      if (e instanceof V1ApiError && e.status === 404) {
        setError(ERROR_COPY.notFound);
      } else {
        setError(userMessageForApiError(e));
      }
    } finally {
      setLoading(false);
    }
  }, [familyId, personId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const personMap = useMemo(() => {
    const m = new Map<string, Person>();
    for (const p of persons) m.set(p.id, p);
    return m;
  }, [persons]);

  const person = personMap.get(personId) ?? null;

  useEffect(() => {
    if (!person) return;
    const prev = document.title;
    document.title = `${person.preferredName} · ${familyName || PRODUCT.brand}`;
    return () => {
      document.title = prev;
    };
  }, [person, familyName]);

  const family = useMemo(() => {
    const parents: KinLink[] = [];
    const children: KinLink[] = [];
    const spouses: KinLink[] = [];
    for (const r of relationships) {
      if (PARENT_TYPES.has(r.type)) {
        if (r.toPersonId === personId) {
          const p = personMap.get(r.fromPersonId);
          if (p) parents.push({ person: p, relationshipId: r.id });
        } else if (r.fromPersonId === personId) {
          const c = personMap.get(r.toPersonId);
          if (c) children.push({ person: c, relationshipId: r.id });
        }
      } else if (r.type === "SPOUSE") {
        const other =
          r.fromPersonId === personId
            ? r.toPersonId
            : r.toPersonId === personId
              ? r.fromPersonId
              : null;
        const s = other ? personMap.get(other) : undefined;
        if (s) spouses.push({ person: s, relationshipId: r.id });
      }
    }
    const parentIds = new Set(parents.map((p) => p.person.id));
    const siblingIds = new Set<string>();
    for (const r of relationships) {
      if (
        PARENT_TYPES.has(r.type) &&
        parentIds.has(r.fromPersonId) &&
        r.toPersonId !== personId
      ) {
        siblingIds.add(r.toPersonId);
      }
    }
    const siblings: KinLink[] = [...siblingIds]
      .map((id) => personMap.get(id))
      .filter((p): p is Person => Boolean(p))
      .map((p) => ({ person: p, relationshipId: null }));
    return {
      parents: sortKinLinksByName(parents),
      spouses: sortKinLinksByName(spouses),
      siblings: sortKinLinksByBirthOrder(siblings, birthOrders),
      children: sortKinLinksByBirthOrder(children, birthOrders),
    };
  }, [relationships, personId, personMap, birthOrders]);

  const missingTypes = useMemo(
    () =>
      ALL_TYPES.filter((t) => pickShown(claims, t).length === 0).filter(
        (t) =>
          person?.livingStatus === "DECEASED" ||
          (t !== "DEATH_DATE" && t !== "BURIAL_PLACE")
      ),
    [claims, person?.livingStatus]
  );

  const canEdit = role === "OWNER" || role === "ADMIN" || role === "EDITOR";
  const workspaceHref = `/alpha/families/${familyId}`;

  function openRecords(claimType?: string) {
    try {
      sessionStorage.setItem(`alpha-records-person:${familyId}`, personId);
      sessionStorage.setItem(`alpha-tab:${familyId}`, "records");
      sessionStorage.removeItem(`alpha-records-evidence-seed:${familyId}`);
      sessionStorage.removeItem(`alpha-records-focus:${familyId}`);
      if (claimType) {
        sessionStorage.setItem(
          `alpha-records-claim-seed:${familyId}`,
          JSON.stringify({
            personId,
            claimType,
            nonce: Date.now(),
          })
        );
      } else {
        sessionStorage.removeItem(`alpha-records-claim-seed:${familyId}`);
      }
    } catch {
      /* private mode */
    }
    router.push(workspaceHref);
  }

  function openEvidence(claimId: string, evidenceType?: string) {
    try {
      sessionStorage.setItem(`alpha-records-person:${familyId}`, personId);
      sessionStorage.setItem(`alpha-tab:${familyId}`, "records");
      sessionStorage.removeItem(`alpha-records-claim-seed:${familyId}`);
      sessionStorage.removeItem(`alpha-records-focus:${familyId}`);
      sessionStorage.setItem(
        `alpha-records-evidence-seed:${familyId}`,
        JSON.stringify({
          personId,
          claimId,
          evidenceType: evidenceType || undefined,
          nonce: Date.now(),
        })
      );
    } catch {
      /* private mode */
    }
    router.push(workspaceHref);
  }

  function openRecordsFocus(claimId: string, status?: string) {
    const statusFilter =
      status === "CONFLICTED"
        ? "CONFLICTED"
        : status === "PROPOSED"
          ? "PROPOSED"
          : undefined;
    try {
      sessionStorage.setItem(`alpha-records-person:${familyId}`, personId);
      sessionStorage.setItem(`alpha-tab:${familyId}`, "records");
      sessionStorage.removeItem(`alpha-records-claim-seed:${familyId}`);
      sessionStorage.removeItem(`alpha-records-evidence-seed:${familyId}`);
      sessionStorage.setItem(
        `alpha-records-focus:${familyId}`,
        JSON.stringify({
          personId,
          claimId,
          statusFilter,
          nonce: Date.now(),
        })
      );
    } catch {
      /* private mode */
    }
    router.push(workspaceHref);
  }

  function openAddKin(role: "child" | "parent" | "spouse") {
    try {
      sessionStorage.setItem(
        `alpha-add-kin:${familyId}`,
        JSON.stringify({ personId, role })
      );
      sessionStorage.setItem(`alpha-tab:${familyId}`, "lineage");
    } catch {
      /* private mode */
    }
    router.push(workspaceHref);
  }

  function openPersonBasics(focus: "living" | "gender" | "name") {
    try {
      sessionStorage.setItem(
        `alpha-person-basics:${familyId}`,
        JSON.stringify({ personId, focus })
      );
      sessionStorage.setItem(`alpha-tab:${familyId}`, "lineage");
    } catch {
      /* private mode */
    }
    router.push(workspaceHref);
  }

  function openInLineage() {
    try {
      sessionStorage.setItem(`alpha-lineage-focus:${familyId}`, personId);
      sessionStorage.setItem(`alpha-tab:${familyId}`, "lineage");
    } catch {
      /* private mode */
    }
    router.push(workspaceHref);
  }

  function openSourcesLibrary(evidenceId: string) {
    try {
      sessionStorage.setItem(
        `alpha-evidence-focus:${familyId}`,
        evidenceId
      );
      sessionStorage.setItem(`alpha-tab:${familyId}`, "overview");
    } catch {
      /* private mode */
    }
    router.push(workspaceHref);
  }

  async function removeKin(relationshipId: string, name: string) {
    if (
      !window.confirm(
        `确认移除与「${name}」的家庭关系？可在世系或最近动态中恢复。`
      )
    ) {
      return;
    }
    try {
      await v1api.deleteRelationship(familyId, relationshipId, {
        idempotencyKey: crypto.randomUUID(),
      });
      await load();
    } catch (e) {
      if (handleAuthRedirect(e, router)) return;
      setError(userMessageForApiError(e));
    }
  }

  if (loading && !person) {
    return (
      <p className="py-16 text-center text-[color:var(--a-muted)]" role="status">
        正在打开人物档案…
      </p>
    );
  }

  if (error || !person) {
    return (
      <div className="py-12 text-center">
        <p className="text-[color:var(--a-danger)]" role="alert">
          {error || ERROR_COPY.notFound}
        </p>
        <Link
          href={workspaceHref}
          className="alpha-btn alpha-btn-secondary mt-6 inline-flex !min-h-[40px] !text-sm"
        >
          返回家族档案
        </Link>
      </div>
    );
  }

  const generation =
    relationships.length > 0 ? generationByPerson[person.id] : undefined;
  const birthDate = pickShown(claims, "BIRTH_DATE");
  const birthPlace = pickShown(claims, "BIRTH_PLACE");
  const alias = pickShown(claims, "ALIAS");
  const generationWord = pickShown(claims, "GENERATION_WORD");
  const birthOrder = pickShown(claims, "BIRTH_ORDER");
  const ancestral = pickShown(claims, "ANCESTRAL_PLACE");
  const occupation = pickShown(claims, "OCCUPATION");
  const deathDate = pickShown(claims, "DEATH_DATE");
  const burial = pickShown(claims, "BURIAL_PLACE");
  const stories = pickShown(claims, "STORY");
  const showDeath =
    person.livingStatus === "DECEASED" ||
    deathDate.length > 0 ||
    burial.length > 0;

  function evidenceAnchorClaim() {
    return (
      birthDate[0] ??
      claims.find((c) => c.status !== "REJECTED" && c.claimType !== "STORY") ??
      claims.find((c) => c.status !== "REJECTED")
    );
  }

  function openPhotoEvidence() {
    const anchor = evidenceAnchorClaim();
    if (!anchor) {
      openRecords("BIRTH_DATE");
      return;
    }
    openEvidence(anchor.id, "PHOTO");
  }

  function openAudioEvidence() {
    const anchor = evidenceAnchorClaim();
    if (!anchor) {
      openRecords("BIRTH_DATE");
      return;
    }
    openEvidence(anchor.id, "ORAL_HISTORY");
  }

  return (
    <article className="alpha-fade-in py-2">
      <Link
        href={workspaceHref}
        className="alpha-print-hide text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
      >
        ← {familyName || PRODUCT.family}
      </Link>

      <header className="mt-4 mb-8">
        <h1 className="alpha-font-display text-4xl font-bold leading-tight text-[color:var(--a-ink)]">
          {person.preferredName}
        </h1>
        <div className="mt-3 flex flex-wrap gap-2">
          {generation ? (
            <span className="alpha-chip">{generationLabel(generation)}</span>
          ) : null}
          <span className="alpha-chip">
            {LIVING_STATUS_LABEL[
              person.livingStatus as keyof typeof LIVING_STATUS_LABEL
            ] ?? person.livingStatus}
          </span>
          {person.gender !== "UNKNOWN" ? (
            <span className="alpha-chip">
              {GENDER_LABEL[person.gender as keyof typeof GENDER_LABEL] ??
                person.gender}
            </span>
          ) : null}
        </div>
        <div className="alpha-print-hide mt-5 flex flex-wrap gap-2">
          {canEdit ? (
            <button
              type="button"
              onClick={() => openRecords()}
              className="alpha-btn alpha-btn-secondary !min-h-[40px] !text-sm"
            >
              补充或修改资料
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              onClick={() => openPersonBasics("name")}
              className="alpha-btn alpha-btn-secondary !min-h-[40px] !text-sm"
            >
              修改姓名
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              onClick={() => openPersonBasics("living")}
              className="alpha-btn alpha-btn-secondary !min-h-[40px] !text-sm"
            >
              {!person.livingStatus || person.livingStatus === "UNKNOWN"
                ? "确认在世状态"
                : "修改在世状态"}
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              onClick={() => openPersonBasics("gender")}
              className="alpha-btn alpha-btn-secondary !min-h-[40px] !text-sm"
            >
              {!person.gender || person.gender === "UNKNOWN"
                ? "确认性别"
                : "修改性别"}
            </button>
          ) : null}
          {family.parents.length +
            family.spouses.length +
            family.siblings.length +
            family.children.length >
          0 ? (
            <button
              type="button"
              onClick={openInLineage}
              className="alpha-btn alpha-btn-secondary !min-h-[40px] !text-sm"
            >
              在世系中查看
            </button>
          ) : null}
          <Link
            href={`/alpha/families/${familyId}/print?person=${personId}`}
            className="alpha-btn alpha-btn-secondary !min-h-[40px] !text-sm"
          >
            在打印版家谱中查看
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="alpha-btn alpha-btn-secondary !min-h-[40px] !text-sm"
          >
            打印本页
          </button>
        </div>
      </header>

      <section aria-labelledby="profile-life" className="mb-8">
        <h2
          id="profile-life"
          className="mb-3 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
        >
          生平
        </h2>
        {!canEdit &&
        birthDate.length === 0 &&
        birthPlace.length === 0 &&
        generationWord.length === 0 &&
        birthOrder.length === 0 &&
        ancestral.length === 0 &&
        occupation.length === 0 &&
        alias.length === 0 &&
        deathDate.length === 0 &&
        burial.length === 0 ? (
          <p className="text-sm text-[color:var(--a-muted)]">暂无生平记录。</p>
        ) : (
        <ol className="alpha-lineage-rail space-y-4 pl-6">
          <TimelineEvent
            title="出生"
            rows={[
              {
                label: "时间",
                claims: birthDate,
                fill:
                  birthDate.length === 0
                    ? { label: "补充出生", claimType: "BIRTH_DATE" }
                    : undefined,
              },
              {
                label: "地点",
                claims: birthPlace,
                fill:
                  birthDate.length > 0 && birthPlace.length === 0
                    ? { label: "补充出生地", claimType: "BIRTH_PLACE" }
                    : undefined,
              },
            ]}
            sources={sources}
            familyId={familyId}
            canEdit={canEdit}
            onFill={openRecords}
            onAddSource={openEvidence}
            onFocusClaim={openRecordsFocus}
            onOpenSourcesLibrary={openSourcesLibrary}
          />
          {generationWord.length > 0 ||
          birthOrder.length > 0 ||
          (canEdit && generation != null && generationWord.length === 0) ||
          (canEdit &&
            family.siblings.length > 0 &&
            birthOrder.length === 0) ? (
            <TimelineEvent
              title="辈分"
              rows={[
                {
                  label: "字辈",
                  claims: generationWord,
                  fill:
                    generation != null && generationWord.length === 0
                      ? { label: "补充字辈", claimType: "GENERATION_WORD" }
                      : undefined,
                },
                {
                  label: "排行",
                  claims: birthOrder,
                  fill:
                    family.siblings.length > 0 && birthOrder.length === 0
                      ? { label: "补充排行", claimType: "BIRTH_ORDER" }
                      : undefined,
                },
              ]}
              sources={sources}
              familyId={familyId}
              canEdit={canEdit}
              onFill={openRecords}
              onAddSource={openEvidence}
              onFocusClaim={openRecordsFocus}
              onOpenSourcesLibrary={openSourcesLibrary}
            />
          ) : null}
          {ancestral.length > 0 ||
          (canEdit && birthPlace.length > 0 && ancestral.length === 0) ? (
            <TimelineEvent
              title="祖籍"
              rows={[
                {
                  label: "地方",
                  claims: ancestral,
                  fill:
                    ancestral.length === 0
                      ? { label: "补充祖籍", claimType: "ANCESTRAL_PLACE" }
                      : undefined,
                },
              ]}
              sources={sources}
              familyId={familyId}
              canEdit={canEdit}
              onFill={openRecords}
              onAddSource={openEvidence}
              onFocusClaim={openRecordsFocus}
              onOpenSourcesLibrary={openSourcesLibrary}
            />
          ) : null}
          {occupation.length > 0 ||
          (canEdit && ancestral.length > 0 && occupation.length === 0) ? (
            <TimelineEvent
              title="职业"
              rows={[
                {
                  label: "职事",
                  claims: occupation,
                  fill:
                    occupation.length === 0
                      ? { label: "补充职业", claimType: "OCCUPATION" }
                      : undefined,
                },
              ]}
              sources={sources}
              familyId={familyId}
              canEdit={canEdit}
              onFill={openRecords}
              onAddSource={openEvidence}
              onFocusClaim={openRecordsFocus}
              onOpenSourcesLibrary={openSourcesLibrary}
            />
          ) : null}
          {alias.length > 0 ||
          (canEdit && occupation.length > 0 && alias.length === 0) ? (
            <TimelineEvent
              title="字号"
              rows={[
                {
                  label: "称呼",
                  claims: alias,
                  fill:
                    alias.length === 0
                      ? { label: "补充字号", claimType: "ALIAS" }
                      : undefined,
                },
              ]}
              sources={sources}
              familyId={familyId}
              canEdit={canEdit}
              onFill={openRecords}
              onAddSource={openEvidence}
              onFocusClaim={openRecordsFocus}
              onOpenSourcesLibrary={openSourcesLibrary}
            />
          ) : null}
          {showDeath ? (
            <TimelineEvent
              title="去世"
              rows={[
                {
                  label: "时间",
                  claims: deathDate,
                  fill:
                    deathDate.length === 0
                      ? { label: "补充去世", claimType: "DEATH_DATE" }
                      : undefined,
                },
                {
                  label: "安葬",
                  claims: burial,
                  fill:
                    deathDate.length > 0 && burial.length === 0
                      ? { label: "补充安葬地", claimType: "BURIAL_PLACE" }
                      : undefined,
                },
              ]}
              sources={sources}
              familyId={familyId}
              canEdit={canEdit}
              onFill={openRecords}
              onAddSource={openEvidence}
              onFocusClaim={openRecordsFocus}
              onOpenSourcesLibrary={openSourcesLibrary}
            />
          ) : null}
        </ol>
        )}
      </section>

      {photos.length > 0 ? (
        <PhotoWall familyId={familyId} photos={photos} />
      ) : canEdit && birthDate.length > 0 ? (
        <section
          aria-labelledby="profile-photos"
          className="alpha-print-hide mb-8 rounded-2xl bg-[color:var(--a-brand-soft)]/40 px-4 py-4"
        >
          <h2
            id="profile-photos"
            className="font-semibold text-[color:var(--a-brand)]"
          >
            照片
          </h2>
          <p className="mt-1 text-sm text-[color:var(--a-muted)]">
            补一张人像、旧照或谱页照片，后人认亲会更容易。
          </p>
          <button
            type="button"
            className="alpha-btn alpha-btn-secondary mt-3 !min-h-[36px] !px-3 !text-xs"
            onClick={openPhotoEvidence}
          >
            补充照片
          </button>
        </section>
      ) : null}

      {audios.length > 0 ? (
        <AudioWall familyId={familyId} audios={audios} />
      ) : canEdit && birthDate.length > 0 ? (
        <section
          aria-labelledby="profile-audios"
          className="alpha-print-hide mb-8 rounded-2xl bg-[color:var(--a-brand-soft)]/40 px-4 py-4"
        >
          <h2
            id="profile-audios"
            className="font-semibold text-[color:var(--a-brand)]"
          >
            口述录音
          </h2>
          <p className="mt-1 text-sm text-[color:var(--a-muted)]">
            录一段口述或旧录音，后人听得到本人的声音。
          </p>
          <button
            type="button"
            className="alpha-btn alpha-btn-secondary mt-3 !min-h-[36px] !px-3 !text-xs"
            onClick={openAudioEvidence}
          >
            补充录音
          </button>
        </section>
      ) : null}

      {FACT_TYPES.some((t) => pickShown(claims, t).length > 0) ? (
        <section aria-labelledby="profile-facts" className="mb-8">
          <h2
            id="profile-facts"
            className="mb-3 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
          >
            档案
          </h2>
          <dl className="alpha-panel divide-y divide-[color:var(--a-brand-line)]">
            {FACT_TYPES.map((t) => {
              const rows = pickShown(claims, t);
              if (rows.length === 0) return null;
              return (
                <div key={t} className="flex gap-4 px-4 py-3">
                  <dt className="w-16 shrink-0 text-sm text-[color:var(--a-muted)]">
                    {CLAIM_TYPE_UI[t]?.label ?? t}
                  </dt>
                  <dd className="min-w-0 flex-1">
                    <ClaimValues
                      claims={rows}
                      sources={sources}
                      familyId={familyId}
                      canEdit={canEdit}
                      onAddSource={openEvidence}
                      onFocusClaim={openRecordsFocus}
                      onOpenSourcesLibrary={openSourcesLibrary}
                    />
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ) : null}

      {stories.length > 0 ? (
        <section aria-labelledby="profile-stories" className="mb-8">
          <h2
            id="profile-stories"
            className="mb-3 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
          >
            故事与口述
          </h2>
          <ul className="space-y-3">
            {stories.map((c) => (
              <li key={c.id} className="alpha-panel px-4 py-4">
                <p className="whitespace-pre-wrap leading-relaxed text-[color:var(--a-ink)]">
                  {c.value?.text ?? "—"}
                </p>
                {c.value?.narrator ? (
                  <p className="mt-2 text-sm text-[color:var(--a-muted)]">
                    讲述：{c.value.narrator}
                  </p>
                ) : null}
                {sources[c.id]?.length ? (
                  <div className="mt-2">
                    <ClaimSources
                      familyId={familyId}
                      links={sources[c.id]}
                      onOpenSourcesLibrary={openSourcesLibrary}
                    />
                  </div>
                ) : canEdit ? (
                  <button
                    type="button"
                    className="alpha-print-hide mt-2 text-xs font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                    onClick={() => openEvidence(c.id)}
                  >
                    补来源
                  </button>
                ) : null}
                {c.status !== "ACCEPTED" ? (
                  <button
                    type="button"
                    className={`alpha-print-hide alpha-chip mt-2 inline-flex ${
                      c.status === "CONFLICTED"
                        ? "alpha-chip-conflicted"
                        : "alpha-chip-proposed"
                    }`}
                    onClick={() => openRecordsFocus(c.id, c.status)}
                  >
                    {CLAIM_STATUS_LABEL[
                      c.status as keyof typeof CLAIM_STATUS_LABEL
                    ] ?? c.status}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {canEdit ? (
            <button
              type="button"
              className="alpha-print-hide mt-3 text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
              onClick={() => openRecords("STORY")}
            >
              再添一段故事
            </button>
          ) : null}
        </section>
      ) : canEdit && birthDate.length > 0 ? (
        <section
          aria-labelledby="profile-stories"
          className="alpha-print-hide mb-8 rounded-2xl bg-[color:var(--a-brand-soft)]/40 px-4 py-4"
        >
          <h2
            id="profile-stories"
            className="font-semibold text-[color:var(--a-brand)]"
          >
            故事与口述
          </h2>
          <p className="mt-1 text-sm text-[color:var(--a-muted)]">
            记下口碑、功绩或迁居缘起，一两段也可以。
          </p>
          <button
            type="button"
            className="alpha-btn alpha-btn-secondary mt-3 !min-h-[36px] !px-3 !text-xs"
            onClick={() => openRecords("STORY")}
          >
            补充故事
          </button>
        </section>
      ) : null}

      <section aria-labelledby="profile-family" className="mb-8">
        <h2
          id="profile-family"
          className="mb-3 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
        >
          家人
        </h2>
        {family.parents.length +
          family.spouses.length +
          family.siblings.length +
          family.children.length ===
        0 ? (
          <div className="alpha-panel border-dashed px-4 py-5">
            <p className="text-sm text-[color:var(--a-muted)]">
              还没有记录家庭关系。
            </p>
            {canEdit ? (
              <div
                className="mt-3 flex flex-wrap gap-2"
                role="group"
                aria-label="为这位家人添加亲人"
              >
                {(
                  [
                    ["child", "添加子女"],
                    ["parent", "添加父母"],
                    ["spouse", "添加配偶"],
                  ] as const
                ).map(([role, label]) => (
                  <button
                    key={role}
                    type="button"
                    className="alpha-btn alpha-btn-secondary !min-h-[36px] !px-3 !text-xs"
                    onClick={() => openAddKin(role)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-[color:var(--a-muted)]">
                有编辑权限的家人可以补充父母、配偶或子女。
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {canEdit &&
            showDeath &&
            family.children.length > 0 &&
            family.spouses.length === 0 ? (
              <div className="alpha-print-hide rounded-2xl bg-[color:var(--a-brand-soft)]/40 px-4 py-3">
                <p className="text-sm text-[color:var(--a-muted)]">
                  已有子女，补上配偶后世系和打印版更完整。
                </p>
                <button
                  type="button"
                  className="alpha-btn alpha-btn-secondary mt-2 !min-h-[36px] !px-3 !text-xs"
                  onClick={() => openAddKin("spouse")}
                >
                  补充配偶
                </button>
              </div>
            ) : null}
            {canEdit &&
            family.parents.length === 0 &&
            family.spouses.length +
              family.siblings.length +
              family.children.length >
              0 ? (
              <div className="alpha-print-hide rounded-2xl bg-[color:var(--a-brand-soft)]/40 px-4 py-3">
                <p className="text-sm text-[color:var(--a-muted)]">
                  还没有父母记录，有线索的话可以补上。
                </p>
                <button
                  type="button"
                  className="alpha-btn alpha-btn-secondary mt-2 !min-h-[36px] !px-3 !text-xs"
                  onClick={() => openAddKin("parent")}
                >
                  补充父母
                </button>
              </div>
            ) : null}
            {canEdit &&
            family.spouses.length > 0 &&
            family.children.length === 0 ? (
              <div className="alpha-print-hide rounded-2xl bg-[color:var(--a-brand-soft)]/40 px-4 py-3">
                <p className="text-sm text-[color:var(--a-muted)]">
                  已有配偶，补上子女后世系和打印版更完整。
                </p>
                <button
                  type="button"
                  className="alpha-btn alpha-btn-secondary mt-2 !min-h-[36px] !px-3 !text-xs"
                  onClick={() => openAddKin("child")}
                >
                  补充子女
                </button>
              </div>
            ) : null}
            <KinRow
              label="父母"
              links={family.parents}
              familyId={familyId}
              canEdit={canEdit}
              onRemove={removeKin}
            />
            <KinRow
              label="配偶"
              links={family.spouses}
              familyId={familyId}
              canEdit={canEdit}
              onRemove={removeKin}
            />
            <KinRow
              label="兄弟姐妹"
              links={family.siblings}
              familyId={familyId}
              orders={birthOrders}
            />
            <KinRow
              label="子女"
              links={family.children}
              familyId={familyId}
              orders={birthOrders}
              canEdit={canEdit}
              onRemove={removeKin}
            />
            {canEdit ? (
              <div
                className="flex flex-wrap gap-2 pt-1"
                role="group"
                aria-label="继续添加亲人"
              >
                {(
                  [
                    ["child", "添加子女"],
                    ["parent", "添加父母"],
                    ["spouse", "添加配偶"],
                  ] as const
                ).map(([role, label]) => (
                  <button
                    key={role}
                    type="button"
                    className="text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                    onClick={() => openAddKin(role)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </section>

      {canEdit && missingTypes.length > 0 ? (
        <section
          aria-labelledby="profile-missing"
          className="alpha-print-hide rounded-2xl bg-[color:var(--a-brand-soft)]/50 px-4 py-4"
        >
          <h2
            id="profile-missing"
            className="font-semibold text-[color:var(--a-brand)]"
          >
            还可以补充
          </h2>
          <p className="mt-1 text-sm text-[color:var(--a-muted)]">
            点一项即可打开资料表单开始填写。
          </p>
          <div
            className="mt-3 flex flex-wrap gap-2"
            role="group"
            aria-label="还可以补充的资料"
          >
            {missingTypes.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => openRecords(t)}
                className="alpha-btn alpha-btn-secondary !min-h-[36px] !px-3 !text-xs"
              >
                {CLAIM_TYPE_UI[t]?.label ?? t}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}

type TimelineRow = {
  label: string;
  claims: Claim[];
  fill?: { label: string; claimType: string };
};

function TimelineEvent({
  title,
  rows,
  sources,
  familyId,
  canEdit = false,
  onFill,
  onAddSource,
  onFocusClaim,
  onOpenSourcesLibrary,
}: {
  title: string;
  rows: TimelineRow[];
  sources: SourcesByClaim;
  familyId: string;
  canEdit?: boolean;
  onFill?: (claimType: string) => void;
  onAddSource?: (claimId: string) => void;
  onFocusClaim?: (claimId: string, status?: string) => void;
  onOpenSourcesLibrary: (evidenceId: string) => void;
}) {
  const visible = rows.filter(
    (r) => r.claims.length > 0 || (canEdit && r.fill && onFill)
  );
  if (visible.length === 0) return null;

  return (
    <li className="relative">
      <span
        className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-[color:var(--a-brand)]"
        aria-hidden
      />
      <h3 className="alpha-font-display text-lg font-bold text-[color:var(--a-ink)]">
        {title}
      </h3>
      <dl className="mt-1 space-y-1">
        {visible.map((r) => (
          <div key={r.label} className="flex gap-3">
            <dt className="w-10 shrink-0 text-sm text-[color:var(--a-muted)]">
              {r.label}
            </dt>
            <dd className="min-w-0 flex-1">
              {r.claims.length > 0 ? (
                <ClaimValues
                  claims={r.claims}
                  sources={sources}
                  familyId={familyId}
                  canEdit={canEdit}
                  onAddSource={onAddSource}
                  onFocusClaim={onFocusClaim}
                  onOpenSourcesLibrary={onOpenSourcesLibrary}
                />
              ) : r.fill && onFill ? (
                <button
                  type="button"
                  className="alpha-print-hide text-sm font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                  onClick={() => onFill(r.fill!.claimType)}
                >
                  {r.fill.label}
                </button>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

function sourceText(l: EvidenceLink): string {
  return [
    EVIDENCE_TYPE_UI[l.evidence.evidenceType] ?? "来源",
    l.evidence.title,
    l.evidence.sourceLocator,
    l.evidence.sourceDateText,
  ]
    .filter(Boolean)
    .join(" · ");
}

function isAudioEvidence(type: string) {
  return type === "ORAL_HISTORY";
}

function isPhotoEvidence(type: string) {
  return type === "PHOTO";
}

function ClaimSources({
  familyId,
  links,
  onOpenSourcesLibrary,
}: {
  familyId: string;
  links: EvidenceLink[];
  onOpenSourcesLibrary: (evidenceId: string) => void;
}) {
  const [viewer, setViewer] = useState<{
    url: string;
    title: string;
  } | null>(null);
  const [playing, setPlaying] = useState<{
    url: string;
    title: string;
  } | null>(null);
  const [mediaError, setMediaError] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  async function openMedia(
    l: EvidenceLink,
    kind: "photo" | "audio" | "file"
  ) {
    const mediaId = l.evidence.mediaObjectId;
    if (!mediaId) return;
    setMediaError("");
    try {
      const r = await v1api.mediaRead(familyId, mediaId);
      const mime = r.media.mimeType ?? "";
      const title =
        l.evidence.title ||
        EVIDENCE_TYPE_UI[l.evidence.evidenceType] ||
        (kind === "audio" ? "口述录音" : kind === "photo" ? "照片" : "附件");
      if (kind === "file") {
        if (mime.startsWith("image/")) {
          setPlaying(null);
          setViewer({ url: r.read.url, title });
          return;
        }
        if (mime.startsWith("audio/")) {
          setViewer(null);
          setPlaying({ url: r.read.url, title });
          return;
        }
        window.open(r.read.url, "_blank", "noopener,noreferrer");
        return;
      }
      if (kind === "audio") {
        setViewer(null);
        setPlaying({ url: r.read.url, title });
      } else {
        setPlaying(null);
        setViewer({ url: r.read.url, title });
      }
    } catch (e) {
      setMediaError(userMessageForApiError(e));
    }
  }

  return (
    <div className="w-full text-xs text-[color:var(--a-muted)]">
      <ul className="space-y-1">
        {links.map((l) => {
          const mid = l.evidence.mediaObjectId;
          const type = l.evidence.evidenceType;
          const hasDetail = Boolean(l.evidence.description);
          return (
            <li key={l.evidence.id} className="space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span>来源：{sourceText(l)}</span>
                {hasDetail ? (
                  <button
                    type="button"
                    className="alpha-print-hide font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                    aria-expanded={detailId === l.evidence.id}
                    onClick={() =>
                      setDetailId((id) =>
                        id === l.evidence.id ? null : l.evidence.id
                      )
                    }
                  >
                    详情
                  </button>
                ) : null}
                <button
                  type="button"
                  className="alpha-print-hide font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                  onClick={() => onOpenSourcesLibrary(l.evidence.id)}
                >
                  来源库
                </button>
                {mid && isAudioEvidence(type) ? (
                  <button
                    type="button"
                    className="alpha-print-hide font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                    onClick={() => void openMedia(l, "audio")}
                  >
                    收听
                  </button>
                ) : null}
                {mid && isPhotoEvidence(type) ? (
                  <button
                    type="button"
                    className="alpha-print-hide font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                    onClick={() => void openMedia(l, "photo")}
                  >
                    查看
                  </button>
                ) : null}
                {mid && !isPhotoEvidence(type) && !isAudioEvidence(type) ? (
                  <button
                    type="button"
                    className="alpha-print-hide font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                    onClick={() => void openMedia(l, "file")}
                  >
                    打开
                  </button>
                ) : null}
              </div>
              {detailId === l.evidence.id && l.evidence.description ? (
                <p className="whitespace-pre-wrap text-[color:var(--a-ink)]">
                  {l.evidence.description}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {playing ? (
        <div className="alpha-print-hide mt-2 rounded-xl bg-[color:var(--a-brand-soft)]/50 px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="font-semibold text-[color:var(--a-brand)]">
              {playing.title}
            </p>
            <button
              type="button"
              className="font-semibold text-[color:var(--a-muted)]"
              onClick={() => setPlaying(null)}
            >
              关闭
            </button>
          </div>
          <audio controls autoPlay src={playing.url} className="w-full">
            你的浏览器不支持音频播放。
          </audio>
        </div>
      ) : null}
      {viewer ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={viewer.title}
          className="alpha-print-hide fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setViewer(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-lg bg-white/90 px-3 py-1.5 text-sm font-semibold text-[color:var(--a-ink)]"
            onClick={() => setViewer(null)}
          >
            关闭
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={viewer.url}
            alt={viewer.title}
            className="max-h-[90vh] max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
      {mediaError ? (
        <p role="alert" className="mt-1 text-[color:var(--a-danger)]">
          {mediaError}
        </p>
      ) : null}
    </div>
  );
}

function AudioWall({
  familyId,
  audios,
}: {
  familyId: string;
  audios: AudioItem[];
}) {
  const [clips, setClips] = useState<
    Array<{ mediaId: string; title: string; url: string }> | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    setClips(null);
    void Promise.all(
      audios.map(async (a) => {
        try {
          const r = await v1api.mediaRead(familyId, a.mediaId);
          if (
            cancelled ||
            (r.media.mimeType && !r.media.mimeType.startsWith("audio/"))
          ) {
            return null;
          }
          return {
            mediaId: a.mediaId,
            title: a.title || "口述录音",
            url: r.read.url,
          };
        } catch {
          return null;
        }
      })
    ).then((rows) => {
      if (!cancelled) {
        setClips(rows.filter(Boolean) as Array<{
          mediaId: string;
          title: string;
          url: string;
        }>);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [familyId, audios]);

  if (clips === null) {
    return (
      <section aria-labelledby="profile-audio" className="mb-8">
        <h2
          id="profile-audio"
          className="mb-3 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
        >
          口述录音
        </h2>
        <p className="text-sm text-[color:var(--a-muted)]" role="status">
          正在载入录音…
        </p>
      </section>
    );
  }
  if (clips.length === 0) return null;

  return (
    <section aria-labelledby="profile-audio" className="mb-8">
      <h2
        id="profile-audio"
        className="mb-3 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
      >
        口述录音
      </h2>
      <ul className="space-y-3">
        {clips.map((c) => (
          <li key={c.mediaId} className="alpha-panel px-4 py-3">
            <p className="mb-2 text-sm font-semibold text-[color:var(--a-ink)]">
              {c.title}
            </p>
            <audio controls src={c.url} className="w-full">
              你的浏览器不支持音频播放。
            </audio>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PhotoWall({
  familyId,
  photos,
}: {
  familyId: string;
  photos: PhotoItem[];
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [viewer, setViewer] = useState<{ url: string; title: string } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      photos.map(async (p) => {
        try {
          const r = await v1api.mediaRead(familyId, p.mediaId);
          if (!cancelled && r.media.mimeType?.startsWith("image/")) {
            setUrls((prev) =>
              prev[p.mediaId] ? prev : { ...prev, [p.mediaId]: r.read.url }
            );
          } else if (!cancelled) {
            setFailed((prev) => new Set(prev).add(p.mediaId));
          }
        } catch {
          if (!cancelled) setFailed((prev) => new Set(prev).add(p.mediaId));
        }
      })
    );
    return () => {
      cancelled = true;
    };
  }, [familyId, photos]);

  const ready = photos.filter((p) => urls[p.mediaId]);
  if (ready.length === 0 && failed.size === photos.length) return null;
  if (ready.length === 0 && Object.keys(urls).length === 0) {
    return (
      <section aria-labelledby="profile-photos" className="mb-8">
        <h2
          id="profile-photos"
          className="mb-3 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
        >
          照片
        </h2>
        <p className="text-sm text-[color:var(--a-muted)]" role="status">
          正在载入照片…
        </p>
      </section>
    );
  }
  if (ready.length === 0) return null;

  return (
    <section aria-labelledby="profile-photos" className="mb-8">
      <h2
        id="profile-photos"
        className="mb-3 text-sm font-semibold tracking-wide text-[color:var(--a-brand)]"
      >
        照片
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ready.map((p) => (
          <li key={p.mediaId}>
            <button
              type="button"
              onClick={() =>
                setViewer({
                  url: urls[p.mediaId],
                  title: p.title || "照片",
                })
              }
              className="group block w-full overflow-hidden rounded-xl border border-[color:var(--a-brand-line)] bg-[color:var(--a-surface)] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-brand)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={urls[p.mediaId]}
                alt={p.title || "家族照片"}
                className="aspect-square w-full object-cover transition group-hover:opacity-95"
              />
              {p.title ? (
                <span className="block truncate px-2 py-1.5 text-xs text-[color:var(--a-muted)]">
                  {p.title}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>

      {viewer ? (
        <div
          className="alpha-print-hide fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={viewer.title}
          tabIndex={-1}
          ref={(el) => el?.focus()}
          onClick={() => setViewer(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setViewer(null);
          }}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-sm font-semibold text-[color:var(--a-ink)]"
            onClick={() => setViewer(null)}
          >
            关闭
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={viewer.url}
            alt={viewer.title}
            className="max-h-[90vh] max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </section>
  );
}

function ClaimValues({
  claims,
  sources,
  familyId,
  canEdit = false,
  onAddSource,
  onFocusClaim,
  onOpenSourcesLibrary,
}: {
  claims: Claim[];
  sources: SourcesByClaim;
  familyId: string;
  canEdit?: boolean;
  onAddSource?: (claimId: string) => void;
  onFocusClaim?: (claimId: string, status?: string) => void;
  onOpenSourcesLibrary: (evidenceId: string) => void;
}) {
  if (claims.length === 0) {
    return <span className="text-sm text-[color:var(--a-muted)]">未记录</span>;
  }
  const differs = claims.length > 1;
  const differTarget =
    claims.find((c) => c.status === "CONFLICTED") ??
    claims.find((c) => c.status === "PROPOSED") ??
    claims[0];
  return (
    <div>
      {differs ? (
        onFocusClaim && differTarget ? (
          <button
            type="button"
            className="alpha-print-hide text-xs font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
            onClick={() => onFocusClaim(differTarget.id, differTarget.status)}
          >
            存在不同说法
          </button>
        ) : (
          <p className="text-xs font-semibold text-[color:var(--a-brand)]">
            存在不同说法
          </p>
        )
      ) : null}
      <ul className="space-y-0.5">
        {claims.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2">
            <span className="text-[color:var(--a-ink)]">
              {c.value?.text ?? "—"}
            </span>
            {c.status !== "ACCEPTED" ? (
              onFocusClaim ? (
                <button
                  type="button"
                  className={`alpha-print-hide alpha-chip ${
                    c.status === "CONFLICTED"
                      ? "alpha-chip-conflicted"
                      : "alpha-chip-proposed"
                  }`}
                  onClick={() => onFocusClaim(c.id, c.status)}
                >
                  {CLAIM_STATUS_LABEL[
                    c.status as keyof typeof CLAIM_STATUS_LABEL
                  ] ?? c.status}
                </button>
              ) : (
                <span
                  className={`alpha-chip ${
                    c.status === "CONFLICTED"
                      ? "alpha-chip-conflicted"
                      : "alpha-chip-proposed"
                  }`}
                >
                  {CLAIM_STATUS_LABEL[
                    c.status as keyof typeof CLAIM_STATUS_LABEL
                  ] ?? c.status}
                </span>
              )
            ) : null}
            {sources[c.id]?.length ? (
              <ClaimSources
                familyId={familyId}
                links={sources[c.id]}
                onOpenSourcesLibrary={onOpenSourcesLibrary}
              />
            ) : canEdit && onAddSource ? (
              <button
                type="button"
                className="alpha-print-hide text-xs font-semibold text-[color:var(--a-brand)] underline-offset-2 hover:underline"
                onClick={() => onAddSource(c.id)}
              >
                补来源
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function KinRow({
  label,
  links,
  familyId,
  orders,
  canEdit = false,
  onRemove,
}: {
  label: string;
  links: KinLink[];
  familyId: string;
  orders?: Record<string, string>;
  canEdit?: boolean;
  onRemove?: (relationshipId: string, name: string) => void | Promise<void>;
}) {
  if (links.length === 0) return null;
  return (
    <div className="flex gap-4">
      <p className="w-16 shrink-0 pt-2 text-sm text-[color:var(--a-muted)]">
        {label}
      </p>
      <ul className="flex min-w-0 flex-1 flex-wrap gap-2">
        {links.map(({ person: p, relationshipId }) => (
          <li
            key={relationshipId ?? p.id}
            className="inline-flex min-h-[40px] items-center gap-1"
          >
            <Link
              href={`/alpha/families/${familyId}/people/${p.id}`}
              className="alpha-panel alpha-panel-interactive inline-flex min-h-[40px] items-center gap-2 px-3 text-sm font-semibold text-[color:var(--a-ink)]"
            >
              {orders?.[p.id] ? (
                <span className="text-xs font-semibold text-[color:var(--a-brand)]">
                  {orders[p.id]}
                </span>
              ) : null}
              {p.preferredName}
            </Link>
            {canEdit && relationshipId && onRemove ? (
              <button
                type="button"
                className="alpha-print-hide px-1 text-xs font-semibold text-[color:var(--a-danger)] underline-offset-2 hover:underline"
                onClick={() => void onRemove(relationshipId, p.preferredName)}
              >
                移除
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
