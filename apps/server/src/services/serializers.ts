import type { Chat, ChatMember, Message, Reaction, User } from "@prisma/client";

type ChatWithMembers = Chat & {
  members: (ChatMember & { user: Pick<User, "id" | "displayName" | "username" | "avatarUrl"> })[];
  messages?: (Message & { sender: Pick<User, "id" | "displayName" | "username" | "avatarUrl"> })[];
};

type MessageWithRelations = Message & {
  sender: Pick<User, "id" | "displayName" | "username" | "avatarUrl">;
  reactions?: (Reaction & { user: Pick<User, "id" | "displayName" | "username"> })[];
  replyTo?: Message | null;
};

export function serializeChat(chat: ChatWithMembers, meId: string) {
  const peer = chat.kind === "DIRECT" ? chat.members.find((m) => m.userId !== meId)?.user : null;
  const isFavorites = chat.kind === "DIRECT" && !peer;
  const selfUser = chat.members.find((m) => m.userId === meId)?.user;
  const title = isFavorites
    ? "Избранное"
    : chat.kind === "DIRECT"
      ? (peer?.displayName ?? "Unknown user")
      : chat.title;
  const photoUrl = isFavorites
    ? (selfUser?.avatarUrl ?? null)
    : chat.kind === "DIRECT"
      ? (peer?.avatarUrl ?? null)
      : chat.photoUrl;
  const lastMessage = chat.messages?.[0];

  return {
    id: chat.id,
    kind: chat.kind,
    isFavorites,
    title,
    photoUrl,
    description: chat.description,
    updatedAt: chat.updatedAt,
    pinnedMessageId: chat.pinnedMessageId,
    members: chat.members.map((m) => ({
      id: m.user.id,
      displayName: m.user.displayName,
      username: m.user.username,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      joinedAt: m.joinedAt,
      lastReadAt: m.lastReadAt,
    })),
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          text: lastMessage.text,
          senderId: lastMessage.senderId,
          createdAt: lastMessage.createdAt,
          isDeleted: lastMessage.isDeleted,
        }
      : null,
  };
}

export function serializeMessage(message: MessageWithRelations) {
  return {
    id: message.id,
    chatId: message.chatId,
    sender: message.sender,
    text: message.isDeleted ? null : message.text,
    mediaType: message.mediaType,
    mediaUrl: message.mediaUrl,
    mediaMeta: message.mediaMeta,
    replyToId: message.replyToId,
    replyTo: message.replyTo,
    forwardedFromId: message.forwardedFromId,
    forwardedFromName: message.forwardedFromName,
    editedAt: message.editedAt,
    isDeleted: message.isDeleted,
    createdAt: message.createdAt,
    reactions:
      message.reactions?.map((reaction) => ({
        id: reaction.id,
        emoji: reaction.emoji,
        userId: reaction.userId,
        user: reaction.user,
      })) ?? [],
  };
}

