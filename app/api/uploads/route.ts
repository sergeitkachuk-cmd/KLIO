// Accepts one image file from the browser and stores it in Timeweb S3
// (see api/_lib/storage.ts), returning a public URL — used by the
// "Публикации" calendar editor so a person can attach a picture from
// their own disk instead of only pasting an external link.
//
// Deliberately its own top-level route rather than an action on
// api/publications (workspace-account.ts's ensureAccount/session helpers
// still gate it) — multipart/form-data doesn't fit the JSON action-
// dispatch shape every other workspace write uses, and this has nothing
// to do with a specific publication until the resulting URL is attached
// to one afterward.

import { uploadPublicationImage, StorageError } from "../_lib/storage";
import { workspaceIdentity, WorkspaceAccessError, workspaceErrorResponse } from "../_lib/workspace-account";

export async function POST(request: Request) {
  try {
    const user = await workspaceIdentity();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Файл не передан." }, { status: 400 });
    }
    const url = await uploadPublicationImage(file, user.email);
    return Response.json({ url }, { status: 201 });
  } catch (error) {
    if (error instanceof StorageError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof WorkspaceAccessError) return workspaceErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
