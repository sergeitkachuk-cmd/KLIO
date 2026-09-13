import { and, eq, isNull } from "drizzle-orm";
import { invoices } from "../../../db/schema";
import { getWorkspaceDb } from "./workspace-account";

// Persist intent BEFORE contacting the bank. Never expire this claim blindly:
// a timed-out request may already have created a legal document externally.
export async function claimInvoiceClosing(id: string, ownerEmail: string): Promise<boolean> {
  const db = await getWorkspaceDb();
  const [claimed] = await db.update(invoices).set({ closingStatus: "creating", updatedAt: new Date().toISOString() }).where(and(
    eq(invoices.id, id), eq(invoices.ownerEmail, ownerEmail),
    isNull(invoices.closingDocumentId), isNull(invoices.closingStatus),
  )).returning({ id: invoices.id });
  return Boolean(claimed);
}
