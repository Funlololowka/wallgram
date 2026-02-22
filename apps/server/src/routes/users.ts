import { Router } from "express";
import { authRequired } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.use(authRequired);

router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const query = String(req.query.q ?? "").trim();
    if (!query) {
      res.json({ users: [] });
      return;
    }

    const users = await prisma.user.findMany({
      where: {
        id: { not: req.user!.id },
        OR: [
          { username: { contains: query } },
          { displayName: { contains: query } },
          { phone: { contains: query } },
        ],
      },
      select: {
        id: true,
        phone: true,
        username: true,
        displayName: true,
        avatarUrl: true,
      },
      take: 20,
    });

    res.json({ users });
  }),
);

export const usersRouter = router;
