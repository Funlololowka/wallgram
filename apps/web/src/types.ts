export type ChatKind = "DIRECT" | "GROUP" | "CHANNEL";
export type ChatRole = "OWNER" | "ADMIN" | "MEMBER";

export interface User {
  id: string;
  phone: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio?: string | null;
}

export interface ChatMember {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  role: ChatRole;
  joinedAt: string;
  lastReadAt: string | null;
}

export interface MessageReaction {
  id: string;
  emoji: string;
  userId: string;
  user: {
    id: string;
    displayName: string;
    username: string;
  };
}

export interface Message {
  id: string;
  chatId: string;
  sender: {
    id: string;
    displayName: string;
    username: string;
    avatarUrl: string | null;
  };
  text: string | null;
  mediaType: "NONE" | "IMAGE" | "VIDEO" | "FILE" | "AUDIO" | "VOICE" | "STICKER";
  mediaUrl: string | null;
  mediaMeta: Record<string, unknown> | null;
  replyToId: string | null;
  forwardedFromId: string | null;
  forwardedFromName: string | null;
  editedAt: string | null;
  isDeleted: boolean;
  createdAt: string;
  reactions: MessageReaction[];
}

export interface ChatPreview {
  id: string;
  kind: ChatKind;
  isFavorites?: boolean;
  title: string;
  photoUrl: string | null;
  description: string | null;
  updatedAt: string;
  pinnedMessageId: string | null;
  members: ChatMember[];
  lastMessage: {
    id: string;
    text: string | null;
    senderId: string;
    createdAt: string;
    isDeleted: boolean;
  } | null;
}
