export type SharedGeneration = {
  id: string;
  title: string;
  body: string;
  imageUrl: string;
  brandId: string | null;
};
export type DialogueWorkspaceProps = {
  theme: "dark" | "light";
  brandId: string;
  brandName: string;
  userKey: string;
  visible: boolean;
  brands: Array<{ id: string; name: string }>;
  hasLogo: boolean;
  dialogueRemaining: number;
  researchRemaining: number;
  generationsRemaining: number;
  onNavigate: (section: "history" | "publications" | "brand") => void;
  onBrandChange: (id: string) => void;
  onSaved: (generation: SharedGeneration) => void;
  onProfessional: (generation: SharedGeneration) => void;
  onGenerateTopic?: (source: { title: string; body: string; useBrandContext: boolean }) => void | Promise<void>;
  onProfile: (brand: unknown) => void;
  beforeProfile: () => Promise<boolean>;
  onUsage: () => void;
  onSchedule: (source: {
    title: string;
    body: string;
    generationId: string;
    imageUrl: string;
  }) => void;
  importMaterial: { id: string; nonce: number } | null;
};
