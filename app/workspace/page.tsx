import TextoraExperience from "../textora-experience";
import { requireChatGPTUser } from "../chatgpt-auth";

export default async function WorkspacePage() {
  await requireChatGPTUser("/workspace");
  return <TextoraExperience workspace />;
}
