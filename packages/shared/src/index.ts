export type ChatKind = "DIRECT" | "GROUP" | "CHANNEL";

export interface SessionUser {
  id: string;
  phone: string;
  username: string;
  displayName: string;
}

export interface ChatPreview {
  id: string;
  title: string;
  kind: ChatKind;
  photoUrl: string | null;
  lastMessage: string | null;
  updatedAt: string;
}
