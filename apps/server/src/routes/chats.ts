import { ChatKind, ChatMemberRole, MediaType } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { emitToChat, emitToUser } from "../realtime/gateway.js";
import { ensureChatMember, getOrCreateDirectChat, requireRole, touchChat } from "../services/chat.js";
import { serializeChat, serializeMessage } from "../services/serializers.js";
import { badRequest, notFound } from "../utils/http.js";

const router = Router();
router.use(authRequired);

const createDirectSchema = z.object({
  userId: z.string().min(1),
});

const createChatSchema = z.object({
  kind: z.enum(["GROUP", "CHANNEL"]),
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  memberIds: z.array(z.string()).optional(),
  photoUrl: z.string().url().optional().nullable(),
});

const createMessageSchema = z.object({
  text: z.string().max(4096).optional().nullable(),
  mediaType: z.nativeEnum(MediaType).optional(),
  mediaUrl: z.string().max(8_000_000).optional().nullable(),
  mediaMeta: z.record(z.any()).optional().nullable(),
  replyToId: z.string().optional().nullable(),
  forwardedFromId: z.string().optional().nullable(),
  forwardedFromName: z.string().optional().nullable(),
});

const setReadSchema = z.object({
  at: z.coerce.date().optional(),
});

const pinSchema = z.object({
  messageId: z.string().min(1),
});

const addMembersSchema = z.object({
  userIds: z.array(z.string()).min(1),
});

const updateMemberSchema = z.object({
  role: z.nativeEnum(ChatMemberRole),
});

function parse<T>(schema: z.ZodSchema<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    badRequest(result.error.issues.map((issue) => issue.message).join(", "));
  }
  return result.data;
}

const chatInclude = {
  members: {
    include: {
      user: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
    },
  },
  messages: {
    take: 1,
    orderBy: { createdAt: "desc" as const },
    include: {
      sender: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
    },
  },
};

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const memberships = await prisma.chatMember.findMany({
      where: { userId: req.user!.id },
      include: {
        chat: { include: chatInclude },
      },
      orderBy: { chat: { updatedAt: "desc" } },
    });

    const chats = memberships.map((membership) => serializeChat(membership.chat, req.user!.id));
    res.json({ chats });
  }),
);

router.post(
  "/direct",
  asyncHandler(async (req, res) => {
    const body = parse(createDirectSchema, req.body);
    if (body.userId === req.user!.id) {
      badRequest("Cannot create direct chat with yourself");
    }

    const peer = await prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true },
    });
    if (!peer) {
      notFound("User not found");
    }

    const chat = await getOrCreateDirectChat(req.user!.id, body.userId);
    const full = await prisma.chat.findUnique({
      where: { id: chat.id },
      include: chatInclude,
    });

    if (!full) {
      notFound("Chat not found");
    }

    emitToUser(body.userId, "chat:new", serializeChat(full, body.userId));
    res.status(201).json({ chat: serializeChat(full, req.user!.id) });
  }),
);

router.post(
  "/favorites",
  asyncHandler(async (req, res) => {
    const directChats = await prisma.chat.findMany({
      where: {
        kind: ChatKind.DIRECT,
        members: { some: { userId: req.user!.id } },
      },
      include: chatInclude,
      orderBy: { createdAt: "asc" },
    });

    const favorites = directChats.find((chat) => {
      if (chat.members.length !== 1) {
        return false;
      }
      const onlyMember = chat.members[0];
      return onlyMember.userId === req.user!.id;
    });

    const chat =
      favorites ??
      (await prisma.chat.create({
        data: {
          kind: ChatKind.DIRECT,
          ownerId: req.user!.id,
          title: "Избранное",
          members: {
            create: [{ userId: req.user!.id, role: ChatMemberRole.OWNER }],
          },
        },
        include: chatInclude,
      }));

    res.status(201).json({ chat: serializeChat(chat, req.user!.id) });
  }),
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = parse(createChatSchema, req.body);
    const memberIds = Array.from(new Set([...(body.memberIds ?? []), req.user!.id]));

    const users = await prisma.user.findMany({
      where: { id: { in: memberIds } },
      select: { id: true },
    });
    if (users.length !== memberIds.length) {
      badRequest("Some users do not exist");
    }

    const chat = await prisma.chat.create({
      data: {
        kind: body.kind as ChatKind,
        title: body.title,
        description: body.description,
        photoUrl: body.photoUrl,
        ownerId: req.user!.id,
        members: {
          create: memberIds.map((userId) => ({
            userId,
            role: userId === req.user!.id ? ChatMemberRole.OWNER : ChatMemberRole.MEMBER,
          })),
        },
      },
      include: chatInclude,
    });

    for (const memberId of memberIds) {
      emitToUser(memberId, "chat:new", serializeChat(chat, memberId));
    }

    res.status(201).json({ chat: serializeChat(chat, req.user!.id) });
  }),
);

router.post(
  "/:chatId/members",
  asyncHandler(async (req, res) => {
    const body = parse(addMembersSchema, req.body);
    const membership = await ensureChatMember(req.params.chatId, req.user!.id);
    if (membership.chat.kind === "DIRECT") {
      badRequest("Cannot add members to direct chat");
    }

    requireRole(membership.role, [ChatMemberRole.OWNER, ChatMemberRole.ADMIN]);
    const userIds = Array.from(new Set(body.userIds)).filter((id) => id !== req.user!.id);
    if (!userIds.length) {
      badRequest("No users to add");
    }

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true },
    });
    if (users.length !== userIds.length) {
      badRequest("Some users do not exist");
    }

    const existing = await prisma.chatMember.findMany({
      where: { chatId: membership.chatId, userId: { in: userIds } },
      select: { userId: true },
    });
    const existingSet = new Set(existing.map((item) => item.userId));
    const toCreate = userIds.filter((id) => !existingSet.has(id));
    if (toCreate.length) {
      await prisma.chatMember.createMany({
        data: toCreate.map((userId) => ({ chatId: membership.chatId, userId })),
      });
    }
    await touchChat(membership.chatId);

    const chat = await prisma.chat.findUnique({
      where: { id: membership.chatId },
      include: chatInclude,
    });

    if (!chat) {
      notFound("Chat not found");
    }

    for (const member of chat.members) {
      emitToUser(member.userId, "chat:updated", serializeChat(chat, member.userId));
    }

    res.json({ chat: serializeChat(chat, req.user!.id) });
  }),
);

router.patch(
  "/:chatId/members/:userId",
  asyncHandler(async (req, res) => {
    const body = parse(updateMemberSchema, req.body);
    const membership = await ensureChatMember(req.params.chatId, req.user!.id);
    if (membership.chat.kind === "DIRECT") {
      badRequest("No roles in direct chat");
    }

    requireRole(membership.role, [ChatMemberRole.OWNER]);
    const target = await prisma.chatMember.findUnique({
      where: {
        chatId_userId: {
          chatId: req.params.chatId,
          userId: req.params.userId,
        },
      },
    });
    if (!target) {
      notFound("Member not found");
    }

    await prisma.chatMember.update({
      where: { id: target.id },
      data: { role: body.role },
    });

    const members = await prisma.chatMember.findMany({ where: { chatId: req.params.chatId } });
    for (const member of members) {
      emitToUser(member.userId, "chat:member-role", {
        chatId: req.params.chatId,
        userId: req.params.userId,
        role: body.role,
      });
    }

    res.json({ ok: true });
  }),
);

router.get(
  "/:chatId/messages",
  asyncHandler(async (req, res) => {
    await ensureChatMember(req.params.chatId, req.user!.id);

    const limit = Math.min(Number(req.query.limit ?? 50), 100);
    const cursor = req.query.cursor ? String(req.query.cursor) : null;

    const messages = await prisma.message.findMany({
      where: { chatId: req.params.chatId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      include: {
        sender: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
        reactions: {
          include: { user: { select: { id: true, displayName: true, username: true } } },
        },
        replyTo: true,
      },
    });

    const hasNext = messages.length > limit;
    const page = hasNext ? messages.slice(0, limit) : messages;
    const items = page.reverse().map((message) => serializeMessage(message as any));

    res.json({
      messages: items,
      nextCursor: hasNext ? page[page.length - 1]?.id ?? null : null,
    });
  }),
);

router.post(
  "/:chatId/messages",
  asyncHandler(async (req, res) => {
    const body = parse(createMessageSchema, req.body);
    const membership = await ensureChatMember(req.params.chatId, req.user!.id);

    if (membership.chat.kind === "CHANNEL") {
      requireRole(membership.role, [ChatMemberRole.OWNER, ChatMemberRole.ADMIN]);
    }

    const hasContent = Boolean(body.text?.trim()) || (body.mediaType && body.mediaType !== MediaType.NONE);
    if (!hasContent) {
      badRequest("Message cannot be empty");
    }

    if (body.replyToId) {
      const reply = await prisma.message.findUnique({
        where: { id: body.replyToId },
        select: { id: true, chatId: true },
      });
      if (!reply || reply.chatId !== req.params.chatId) {
        badRequest("Reply target not found");
      }
    }

    const message = await prisma.message.create({
      data: {
        chatId: req.params.chatId,
        senderId: req.user!.id,
        text: body.text?.trim() || null,
        mediaType: body.mediaType ?? MediaType.NONE,
        mediaUrl: body.mediaUrl ?? null,
        mediaMeta: body.mediaMeta ?? undefined,
        replyToId: body.replyToId ?? null,
        forwardedFromId: body.forwardedFromId ?? null,
        forwardedFromName: body.forwardedFromName ?? null,
      },
      include: {
        sender: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
        reactions: {
          include: { user: { select: { id: true, displayName: true, username: true } } },
        },
        replyTo: true,
      },
    });

    await touchChat(req.params.chatId);
    const payload = serializeMessage(message as any);
    emitToChat(req.params.chatId, "message:new", payload);

    res.status(201).json({ message: payload });
  }),
);

router.post(
  "/:chatId/read",
  asyncHandler(async (req, res) => {
    const body = parse(setReadSchema, req.body ?? {});
    const at = body.at ?? new Date();

    await ensureChatMember(req.params.chatId, req.user!.id);
    await prisma.chatMember.update({
      where: { chatId_userId: { chatId: req.params.chatId, userId: req.user!.id } },
      data: { lastReadAt: at },
    });

    emitToChat(req.params.chatId, "chat:read", {
      chatId: req.params.chatId,
      userId: req.user!.id,
      at,
    });

    res.json({ ok: true });
  }),
);

router.post(
  "/:chatId/pin",
  asyncHandler(async (req, res) => {
    const body = parse(pinSchema, req.body);
    const membership = await ensureChatMember(req.params.chatId, req.user!.id);
    requireRole(membership.role, [ChatMemberRole.OWNER, ChatMemberRole.ADMIN]);

    const message = await prisma.message.findUnique({
      where: { id: body.messageId },
      select: { id: true, chatId: true },
    });
    if (!message || message.chatId !== req.params.chatId) {
      badRequest("Message not found");
    }

    await prisma.chat.update({
      where: { id: req.params.chatId },
      data: { pinnedMessageId: body.messageId },
    });

    emitToChat(req.params.chatId, "chat:pinned", {
      chatId: req.params.chatId,
      messageId: body.messageId,
    });

    res.json({ ok: true });
  }),
);

export const chatsRouter = router;

