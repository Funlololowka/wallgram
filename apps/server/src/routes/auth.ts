import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";
import { authRequired } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { badRequest, unauthorized } from "../utils/http.js";

const router = Router();

const registerSchema = z.object({
  phone: z.string().min(5),
  username: z.string().min(3).max(32),
  displayName: z.string().min(1).max(64),
  password: z.string().min(6),
});

const loginSchema = z.object({
  phone: z.string().min(5),
  password: z.string().min(6),
});

const updateSchema = z.object({
  username: z.string().trim().min(3).max(32).optional(),
  displayName: z.string().min(1).max(64).optional(),
  bio: z.string().max(160).optional().nullable(),
  avatarUrl: z.string().max(2_000_000).optional().nullable(),
});

function parse<T>(schema: z.ZodSchema<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    badRequest(result.error.issues.map((issue) => issue.message).join(", "));
  }
  return result.data;
}

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const body = parse(registerSchema, req.body);

    const exists = await prisma.user.findFirst({
      where: { OR: [{ phone: body.phone }, { username: body.username }] },
      select: { id: true },
    });
    if (exists) {
      badRequest("Phone or username already used");
    }

    try {
      const passwordHash = await bcrypt.hash(body.password, 10);
      const user = await prisma.user.create({
        data: {
          phone: body.phone,
          username: body.username,
          displayName: body.displayName,
          passwordHash,
        },
        select: {
          id: true,
          phone: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          bio: true,
        },
      });

      const token = signToken(user.id);
      res.status(201).json({ token, user });
    } catch (error) {
      console.error("[Auth] Registration failed:", error);
      throw error;
    }
  }),
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = parse(loginSchema, req.body);

    const user = await prisma.user.findUnique({ where: { phone: body.phone } });
    if (!user) {
      unauthorized("Invalid credentials");
    }

    try {
      const ok = await bcrypt.compare(body.password, user.passwordHash);
      if (!ok) {
        unauthorized("Invalid credentials");
      }

      const token = signToken(user.id);
      res.json({
        token,
        user: {
          id: user.id,
          phone: user.phone,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          bio: user.bio,
        },
      });
    } catch (error) {
      console.error("[Auth] Login failed:", error);
      throw error;
    }
  }),
);

router.get(
  "/me",
  authRequired,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        phone: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        createdAt: true,
      },
    });

    res.json({ user });
  }),
);

router.patch(
  "/me",
  authRequired,
  asyncHandler(async (req, res) => {
    const body = parse(updateSchema, req.body);
    const username = body.username?.trim();
    if (username) {
      const taken = await prisma.user.findFirst({
        where: { username, id: { not: req.user!.id } },
        select: { id: true },
      });
      if (taken) {
        badRequest("Username already used");
      }
    }

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...body,
        username: username ?? body.username,
      },
      select: {
        id: true,
        phone: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
      },
    });

    res.json({ user });
  }),
);

export const authRouter = router;
