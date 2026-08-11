import { and, desc, eq, sql } from "drizzle-orm";
import { brands, generations, materials } from "../../../db/schema";
import { planRule } from "../../plans";
import {
  accountSummary,
  ensureAccount,
  getWorkspaceDb,
  workspaceDatabaseAvailable,
  WorkspaceAccessError,
  workspaceErrorResponse,
  workspaceIdentity,
} from "../_lib/workspace-account";

type WorkspacePayload = {
  action?: unknown;
  brandId?: unknown;
  profile?: unknown;
  workspace?: unknown;
  generation?: unknown;
  material?: unknown;
  id?: unknown;
};

const MATERIAL_TYPES = new Set(["semantics", "competitors", "content_plan"]);

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseJson(value: string, fallback: unknown) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function cleanProfile(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    name: clean(source.name, 160) || "Новый бренд",
    website: clean(source.website, 220),
    description: clean(source.description, 3000),
    positioning: clean(source.positioning, 2000),
    audience: clean(source.audience, 2000),
    advantages: clean(source.advantages, 4000),
    products: clean(source.products, 3000),
    services: clean(source.services, 3000),
    proof: clean(source.proof, 3000),
    geography: clean(source.geography, 1200),
    vocabulary: clean(source.vocabulary, 2000),
    cta: clean(source.cta, 800),
    voice: clean(source.voice, 2000),
    restrictions: clean(source.restrictions, 2000),
    signature: clean(source.signature, 1200),
    prohibited: clean(source.prohibited, 2000),
  };
}

function cleanWorkspace(value: unknown) {
  if (!value || typeof value !== "object") return {};
  const serialized = JSON.stringify(value);
  if (serialized.length > 240_000) throw new WorkspaceAccessError("Рабочее состояние бренда превышает допустимый объём.", 400);
  return JSON.parse(serialized);
}

function cleanGenerationUpdate(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    id: clean(source.id, 100),
    title: clean(source.title, 500),
    body: clean(source.body, 60_000),
    subtitle: clean(source.subtitle, 600),
    metaTitle: clean(source.metaTitle, 500),
    metaDescription: clean(source.metaDescription, 1200),
    editorialComment: clean(source.editorialComment, 2400),
    tone: clean(source.tone, 120),
  };
}

function cleanSavedMaterial(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const type = clean(source.type, 40);
  const payload = source.payload && typeof source.payload === "object" ? source.payload : {};
  const payloadJson = JSON.stringify(payload);
  if (!MATERIAL_TYPES.has(type)) throw new WorkspaceAccessError("Неизвестный тип материала.", 400);
  if (payloadJson.length > 240_000) throw new WorkspaceAccessError("Материал превышает допустимый объём.", 400);
  return {
    brandId: clean(source.brandId, 100),
    sourceId: clean(source.sourceId, 100),
    saveMode: clean(source.saveMode, 20) === "copy" ? "copy" as const : "version" as const,
    type,
    title: clean(source.title, 500) || "Материал без названия",
    status: clean(source.status, 80) || "Сохранено",
    payload,
    payloadJson,
  };
}

function materialResponse(item: typeof materials.$inferSelect) {
  return {
    id: item.id,
    brandId: item.brandId,
    type: item.type,
    title: item.title,
    status: item.status,
    payload: parseJson(item.payloadJson, {}),
    groupId: item.groupId,
    versionNumber: item.versionNumber,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function accountAndBrandCount(email: string, displayName: string) {
  const account = await ensureAccount({ email, displayName, fullName: displayName });
  const db = await getWorkspaceDb();
  const [{ count = 0 } = { count: 0 }] = await db.select({ count: sql<number>`count(*)` }).from(brands).where(eq(brands.ownerEmail, email));
  return { account, brandCount: Number(count) };
}

export async function GET() {
  try {
    if (!await workspaceDatabaseAvailable()) return Response.json({ error: "Хранилище кабинета недоступно." }, { status: 503 });
    const user = await workspaceIdentity();
    const db = await getWorkspaceDb();
    const { account, brandCount } = await accountAndBrandCount(user.email, user.displayName);
    const brandRows = await db.select().from(brands).where(eq(brands.ownerEmail, user.email)).orderBy(desc(brands.updatedAt), desc(brands.createdAt));
    const archiveRows = await db.select().from(generations).where(eq(generations.ownerEmail, user.email)).orderBy(desc(generations.createdAt)).limit(60);
    const materialRows = await db.select().from(materials).where(eq(materials.ownerEmail, user.email)).orderBy(desc(materials.createdAt)).limit(120);
    return Response.json({
      user,
      account: accountSummary(account, brandCount),
      brands: brandRows.map((item) => ({
        id: item.id,
        name: item.name,
        website: item.website,
        profile: parseJson(item.profileJson, {}),
        workspace: parseJson(item.workspaceJson, {}),
        updatedAt: item.updatedAt,
      })),
      history: archiveRows,
      materials: materialRows.map(materialResponse),
    });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    if (!await workspaceDatabaseAvailable()) return Response.json({ error: "Хранилище кабинета недоступно." }, { status: 503 });
    const user = await workspaceIdentity();
    const db = await getWorkspaceDb();
    const payload = await request.json() as WorkspacePayload;
    const action = clean(payload.action, 40);
    const { account, brandCount } = await accountAndBrandCount(user.email, user.displayName);

    if (action === "create_brand") {
      const rule = planRule(account.planId);
      if (brandCount >= rule.brandLimit) {
        return Response.json({ error: `Тариф «${rule.name}» поддерживает до ${rule.brandLimit} ${rule.brandLimit === 1 ? "бренда" : "брендов"}.` }, { status: 409 });
      }
      const profile = cleanProfile(payload.profile);
      const workspace = cleanWorkspace(payload.workspace);
      const [created] = await db.insert(brands).values({
        id: crypto.randomUUID(),
        ownerEmail: user.email,
        name: profile.name,
        website: profile.website,
        profileJson: JSON.stringify(profile),
        workspaceJson: JSON.stringify(workspace),
      }).returning();
      return Response.json({
        brand: { ...created, profile, workspace },
        account: accountSummary(account, brandCount + 1),
      }, { status: 201 });
    }

    if (action === "save_brand") {
      const brandId = clean(payload.brandId, 100);
      const profile = cleanProfile(payload.profile);
      const workspace = cleanWorkspace(payload.workspace);
      const [saved] = await db.update(brands).set({
        name: profile.name,
        website: profile.website,
        profileJson: JSON.stringify(profile),
        workspaceJson: JSON.stringify(workspace),
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(and(eq(brands.id, brandId), eq(brands.ownerEmail, user.email))).returning();
      if (!saved) return Response.json({ error: "Бренд не найден или недоступен." }, { status: 404 });
      return Response.json({ brand: { ...saved, profile, workspace }, account: accountSummary(account, brandCount) });
    }

    if (action === "update_generation") {
      const generation = cleanGenerationUpdate(payload.generation);
      if (!generation.id || !generation.title || !generation.body) {
        return Response.json({ error: "Для сохранения нужны заголовок и текст материала." }, { status: 400 });
      }
      const [saved] = await db.update(generations).set({
        title: generation.title,
        body: generation.body,
        subtitle: generation.subtitle,
        metaTitle: generation.metaTitle,
        metaDescription: generation.metaDescription,
        editorialComment: generation.editorialComment,
        tone: generation.tone || undefined,
      }).where(and(eq(generations.id, generation.id), eq(generations.ownerEmail, user.email))).returning();
      if (!saved) return Response.json({ error: "Материал не найден или недоступен." }, { status: 404 });
      return Response.json({ generation: saved });
    }

    if (action === "copy_generation") {
      const generation = cleanGenerationUpdate(payload.generation);
      if (!generation.id || !generation.title || !generation.body) {
        return Response.json({ error: "Для сохранения копии нужны заголовок и текст материала." }, { status: 400 });
      }
      const [source] = await db.select().from(generations).where(and(
        eq(generations.id, generation.id),
        eq(generations.ownerEmail, user.email),
      )).limit(1);
      if (!source) return Response.json({ error: "Исходный материал не найден или недоступен." }, { status: 404 });
      const [saved] = await db.insert(generations).values({
        id: crypto.randomUUID(),
        ownerEmail: user.email,
        brandId: source.brandId,
        format: source.format,
        topic: source.topic,
        title: generation.title,
        body: generation.body,
        subtitle: generation.subtitle,
        metaTitle: generation.metaTitle,
        metaDescription: generation.metaDescription,
        editorialComment: generation.editorialComment,
        keywords: source.keywords,
        tone: generation.tone || source.tone,
        targetLength: source.targetLength,
      }).returning();
      return Response.json({ generation: saved, quotaUsed: false }, { status: 201 });
    }

    if (action === "save_material") {
      const material = cleanSavedMaterial(payload.material);
      if (!material.brandId) return Response.json({ error: "Выберите кабинет бренда." }, { status: 400 });
      const [ownedBrand] = await db.select({ id: brands.id }).from(brands).where(and(
        eq(brands.id, material.brandId),
        eq(brands.ownerEmail, user.email),
      )).limit(1);
      if (!ownedBrand) return Response.json({ error: "Бренд не найден или недоступен." }, { status: 404 });

      const id = crypto.randomUUID();
      let groupId = id;
      let versionNumber = 1;
      if (material.sourceId) {
        const [source] = await db.select().from(materials).where(and(
          eq(materials.id, material.sourceId),
          eq(materials.ownerEmail, user.email),
          eq(materials.brandId, material.brandId),
          eq(materials.type, material.type),
        )).limit(1);
        if (!source) return Response.json({ error: "Исходная версия не найдена или недоступна." }, { status: 404 });
        if (material.saveMode === "version") {
          groupId = source.groupId;
          const [{ maxVersion = 0 } = { maxVersion: 0 }] = await db.select({
            maxVersion: sql<number>`max(${materials.versionNumber})`,
          }).from(materials).where(and(
            eq(materials.ownerEmail, user.email),
            eq(materials.groupId, groupId),
          ));
          versionNumber = Number(maxVersion || 0) + 1;
        }
      }

      const [saved] = await db.insert(materials).values({
        id,
        ownerEmail: user.email,
        brandId: material.brandId,
        type: material.type,
        title: material.title,
        status: material.status,
        payloadJson: material.payloadJson,
        groupId,
        versionNumber,
      }).returning();
      return Response.json({ material: materialResponse(saved), quotaUsed: false }, { status: 201 });
    }

    if (action === "delete_generation") {
      const id = clean(payload.id, 100);
      if (!id) return Response.json({ error: "Не указан материал для удаления." }, { status: 400 });
      const [deleted] = await db.delete(generations).where(and(
        eq(generations.id, id),
        eq(generations.ownerEmail, user.email),
      )).returning({ id: generations.id });
      if (!deleted) return Response.json({ error: "Материал не найден или недоступен." }, { status: 404 });
      return Response.json({ ok: true, id: deleted.id });
    }

    if (action === "delete_material") {
      const id = clean(payload.id, 100);
      if (!id) return Response.json({ error: "Не указан материал для удаления." }, { status: 400 });
      const [deleted] = await db.delete(materials).where(and(
        eq(materials.id, id),
        eq(materials.ownerEmail, user.email),
      )).returning({ id: materials.id });
      if (!deleted) return Response.json({ error: "Материал не найден или недоступен." }, { status: 404 });
      return Response.json({ ok: true, id: deleted.id });
    }

    return Response.json({ error: "Неизвестное действие кабинета." }, { status: 400 });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
