import { getCurrentUser } from "../../../identity";

export async function GET() {
  const user = await getCurrentUser();
  return Response.json({ user });
}
