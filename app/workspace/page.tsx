import TextoraExperience from "../textora-experience";
import { requireCurrentUser } from "../identity";

export default async function WorkspacePage() {
  await requireCurrentUser("/workspace");
  return <TextoraExperience key="workspace" workspace />;
}
