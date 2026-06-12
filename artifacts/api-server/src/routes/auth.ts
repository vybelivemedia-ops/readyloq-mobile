import { Router } from "express";
import { requireAuth } from "../middleware/require-auth";

const router = Router();

router.get("/me", requireAuth, (req, res) => {
  const user = req.user!;
  res.json({
    id: user.id,
    clerkUserId: user.clerkUserId,
    role: user.role,
  });
});

export default router;
