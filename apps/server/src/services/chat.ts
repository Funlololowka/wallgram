import { ChatKind, ChatMemberRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { badRequest, forbidden, notFound } from "../utils/http.js";

export async function ensureChatMember(chatId: string, userId: string) {
  const membership = await prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
    include: { chat: true },
  });

  if (!membership) {
    notFound("Chat not found");
  }

  return membership;
}

export function requireRole(role: ChatMemberRole, allowed: ChatMemberRole[]) {
  if (!allowed.includes(role)) {
    forbidden("Insufficient permissions");
  }
}

export async function touchChat(chatId: string) {
  await prisma.chat.update({
    where: { id: chatId },
    data: { updatedAt: new Date() },
  });
}

export async function getOrCreateDirectChat(meId: string, peerId: string) {
  if (meId === peerId) {
    badRequest("Cannot create direct chat with yourself");
  }

  const existing = await prisma.chat.findFirst({
    where: {
      kind: ChatKind.DIRECT,
      members: {
        every: { userId: { in: [meId, peerId] } },
      },
    },
    include: { members: true },
  });

  if (existing && existing.members.length === 2) {
    return existing;
  }

  return prisma.chat.create({
    data: {
      kind: ChatKind.DIRECT,
      title: "Direct chat",
      members: {
        createMany: {
          data: [
            { userId: meId, role: ChatMemberRole.MEMBER },
            { userId: peerId, role: ChatMemberRole.MEMBER },
          ],
        },
      },
    },
  });
}
