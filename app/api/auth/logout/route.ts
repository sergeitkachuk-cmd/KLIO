import { destroySiteSession } from "../../../site-auth";

export async function POST() {
  await destroySiteSession();
  return Response.json({ ok: true });
}
