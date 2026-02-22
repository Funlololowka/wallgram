import { ChatMemberRole, MediaType, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { authRequired } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { emitToChat } from "../realtime/gateway.js";
import { ensureChatMember, requireRole, touchChat } from "../services/chat.js";
import { serializeMessage } from "../services/serializers.js";
import { badRequest, forbidden, notFound } from "../utils/http.js";

const router = Router();
router.use(authRequired);

const editSchema = z.object({
  text: z.string().min(1).max(4096),
});

const reactionSchema = z.object({
  emoji: z.string().min(1).max(16),
});

const forwardSchema = z.object({
  chatId: z.string().min(1),
  comment: z.string().max(1024).optional().nullable(),
});

function parse<T>(schema: z.ZodSchema<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    badRequest(result.error.issues.map((issue) => issue.message).join(", "));
  }
  return result.data;
}

router.patch(
  "/:messageId",
  asyncHandler(async (req, res) => {
    const body = parse(editSchema, req.body);
    const message = await prisma.message.findUnique({
      where: { id: req.params.messageId },
      include: {
        sender: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
        reactions: {
          include: { user: { select: { id: true, displayName: true, username: true } } },
        },
        replyTo: true,
      },
    });
    if (!message) {
      notFound("Message not found");
    }
    if (message.isDeleted) {
      badRequest("Cannot edit deleted message");
    }

    const membership = await ensureChatMember(message.chatId, req.user!.id);
    if (message.senderId !== req.user!.id) {
      if (membership.chat.kind === "CHANNEL") {
        requireRole(membership.role, [ChatMemberRole.OWNER, ChatMemberRole.ADMIN]);
      } else {
        forbidden("Cannot edit this message");
      }
    }

    const updated = await prisma.message.update({
      where: { id: message.id },
      data: { text: body.text, editedAt: new Date() },
      include: {
        sender: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
        reactions: {
          include: { user: { select: { id: true, displayName: true, username: true } } },
        },
        replyTo: true,
      },
    });
    await touchChat(updated.chatId);

    const payload = serializeMessage(updated as any);
    emitToChat(updated.chatId, "message:updated", payload);
    res.json({ message: payload });
  }),
);

router.delete(
  "/:messageId",
  asyncHandler(async (req, res) => {
    const message = await prisma.message.findUnique({
      where: { id: req.params.messageId },
    });
    if (!message) {
      notFound("Message not found");
    }

    const membership = await ensureChatMember(message.chatId, req.user!.id);
    const isOwner = message.senderId === req.user!.id;
    const isAdmin = membership.role === ChatMemberRole.OWNER || membership.role === ChatMemberRole.ADMIN;
    if (!isOwner && !isAdmin) {
      forbidden("Cannot delete this message");
    }

    await prisma.message.update({
      where: { id: message.id },
      data: {
        isDeleted: true,
        text: null,
        mediaType: MediaType.NONE,
        mediaUrl: null,
        mediaMeta: Prisma.DbNull,
        editedAt: new Date(),
      },
    });
    await touchChat(message.chatId);

    emitToChat(message.chatId, "message:deleted", { messageId: message.id, chatId: message.chatId });
    res.json({ ok: true });
  }),
);

router.post(
  "/:messageId/reactions",
  asyncHandler(async (req, res) => {
    const body = parse(reactionSchema, req.body);
    const message = await prisma.message.findUnique({
      where: { id: req.params.messageId },
      select: { id: true, chatId: true },
    });
    if (!message) {
      notFound("Message not found");
    }

    await ensureChatMember(message.chatId, req.user!.id);
    await prisma.reaction.upsert({
      where: {
        messageId_userId_emoji: {
          messageId: message.id,
          userId: req.user!.id,
          emoji: body.emoji,
        },
      },
      update: {},
      create: {
        messageId: message.id,
        userId: req.user!.id,
        emoji: body.emoji,
      },
    });

    const reactions = await prisma.reaction.findMany({
      where: { messageId: message.id },
      include: { user: { select: { id: true, displayName: true, username: true } } },
    });

    emitToChat(message.chatId, "message:reactions", {
      messageId: message.id,
      chatId: message.chatId,
      reactions: reactions.map((reaction) => ({
        id: reaction.id,
        emoji: reaction.emoji,
        userId: reaction.userId,
        user: reaction.user,
      })),
    });

    res.status(201).json({ ok: true });
  }),
);

router.delete(
  "/:messageId/reactions/:emoji",
  asyncHandler(async (req, res) => {
    const message = await prisma.message.findUnique({
      where: { id: req.params.messageId },
      select: { id: true, chatId: true },
    });
    if (!message) {
      notFound("Message not found");
    }
    await ensureChatMember(message.chatId, req.user!.id);

    await prisma.reaction.deleteMany({
      where: {
        messageId: message.id,
        userId: req.user!.id,
        emoji: req.params.emoji,
      },
    });

    const reactions = await prisma.reaction.findMany({
      where: { messageId: message.id },
      include: { user: { select: { id: true, displayName: true, username: true } } },
    });

    emitToChat(message.chatId, "message:reactions", {
      messageId: message.id,
      chatId: message.chatId,
      reactions: reactions.map((reaction) => ({
        id: reaction.id,
        emoji: reaction.emoji,
        userId: reaction.userId,
        user: reaction.user,
      })),
    });

    res.json({ ok: true });
  }),
);

router.post(
  "/:messageId/forward",
  asyncHandler(async (req, res) => {
    const body = parse(forwardSchema, req.body);
    const message = await prisma.message.findUnique({
      where: { id: req.params.messageId },
      include: { sender: true },
    });
    if (!message) {
      notFound("Message not found");
    }

    await ensureChatMember(message.chatId, req.user!.id);
    const targetMembership = await ensureChatMember(body.chatId, req.user!.id);
    if (targetMembership.chat.kind === "CHANNEL") {
      requireRole(targetMembership.role, [ChatMemberRole.OWNER, ChatMemberRole.ADMIN]);
    }

    const forwarded = await prisma.message.create({
      data: {
        chatId: body.chatId,
        senderId: req.user!.id,
        text: body.comment ? `${body.comment}\n\n${message.text ?? ""}`.trim() : message.text,
        mediaType: message.mediaType,
        mediaUrl: message.mediaUrl,
        mediaMeta: message.mediaMeta ?? undefined,
        forwardedFromId: message.senderId,
        forwardedFromName: message.sender.displayName,
      },
      include: {
        sender: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
        reactions: {
          include: { user: { select: { id: true, displayName: true, username: true } } },
        },
        replyTo: true,
      },
    });
    await touchChat(body.chatId);

    const payload = serializeMessage(forwarded as any);
    emitToChat(body.chatId, "message:new", payload);
    res.status(201).json({ message: payload });
  }),
);

export const messagesRouter = router;
