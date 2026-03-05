import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { verifyToken } from "../lib/jwt.js";
import { unauthorized } from "../utils/http.js";

function tokenFromAuthHeader(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return null;
  }

  return parts[1];
}

export async function authRequired(req: Request, _res: Response, next: NextFunction) {
  const token = tokenFromAuthHeader(req.headers.authorization);
  if (!token) {
    return unauthorized("No token provided");
  }

  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true } });
    if (!user) {
      return unauthorized("User not found");
    }

    req.user = { id: user.id };
    next();
  } catch (error) {
    console.error("[Auth] Token verification failed:", error instanceof Error ? error.message : error);
    unauthorized("Invalid or expired token");
  }
}
