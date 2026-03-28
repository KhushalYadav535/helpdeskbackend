import express, { Response } from "express";
import { Notification } from "../models/Notification";
import { protect, AuthRequest } from "../middleware/auth";

const router = express.Router();

// @route   POST /api/notifications/mark-all-read (before /:id)
router.post("/mark-all-read", protect, async (req: AuthRequest, res: Response) => {
  try {
    await Notification.updateMany({ userId: req.user!._id, read: false }, { $set: { read: true } });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Server error" });
  }
});

// @route   GET /api/notifications
// @desc    List notifications for current user (latest 50)
// @access  Private
router.get("/", protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const limit = Math.min(parseInt((req.query.limit as string) || "10", 10), 50);

    let items = await Notification.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Seed demo notifications once if empty (so QA sees the panel)
    if (items.length === 0) {
      const seeds = [
        {
          userId: user._id,
          type: "info" as const,
          title: "Welcome to RezolvX",
          message: "Your notification center is ready. New alerts will appear here.",
          read: false,
          actionUrl: "/dashboard/agent",
        },
        {
          userId: user._id,
          type: "info" as const,
          title: "Tip: Global search",
          message: "Use the search bar to jump to tickets and settings.",
          read: true,
          actionUrl: "/dashboard/agent/settings",
        },
      ];
      await Notification.insertMany(seeds);
      items = await Notification.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
    }

    const unreadCount = await Notification.countDocuments({ userId: user._id, read: false });

    res.json({
      success: true,
      data: items.map((n) => ({
        id: n._id.toString(),
        type: n.type,
        title: n.title,
        message: n.message,
        read: n.read,
        actionUrl: n.actionUrl,
        timestamp: n.createdAt,
      })),
      unreadCount,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Server error" });
  }
});

// @route   PATCH /api/notifications/:id/read
router.patch("/:id/read", protect, async (req: AuthRequest, res: Response) => {
  try {
    const n = await Notification.findOne({ _id: req.params.id, userId: req.user!._id });
    if (!n) {
      return res.status(404).json({ success: false, error: "Notification not found" });
    }
    n.read = true;
    await n.save();
    res.json({ success: true, data: { id: String(n._id), read: true } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Server error" });
  }
});

export default router;
