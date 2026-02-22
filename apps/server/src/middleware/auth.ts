import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { verifyToken } from "../lib/jwt.js";
import { unauthorized } from "../utils/http.js";

function tokenFromAuthHeader(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [prefix, token] = header.split(" ");
  if (prefix !== "Bearer" || !token) {
    return null;
  }

  return token;
}

export async function authRequired(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = tokenFromAuthHeader(req.headers.authorization);
    if (!token) {
      unauthorized();
    }

    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true } });
    if (!user) {
      unauthorized();
    }

    req.user = { id: user.id };
    next();
  } catch {
    unauthorized();
  }
}
