import express, { Request, Response } from "express";
import { Comment } from "../models/Comment";
import { Ticket } from "../models/Ticket";
import { protect, AuthRequest } from "../middleware/auth";
import mongoose from "mongoose";

const router = express.Router();

// @route   GET /api/comments/:ticketId
// @desc    Get all comments for a ticket
// @access  Private
router.get("/:ticketId", protect, async (req: AuthRequest, res: Response) => {
  try {
    const { ticketId } = req.params;
    const user = req.user!;

    // Verify ticket exists and user has access
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found",
      });
    }

    // Check tenant access
    if (
      user.role !== "super-admin" &&
      ticket.tenantId.toString() !== user.tenantId?.toString()
    ) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to access this ticket",
      });
    }

    // Get comments for this ticket
    const comments = await Comment.find({ ticketId: new mongoose.Types.ObjectId(ticketId) })
      .populate("authorId", "name email")
      .sort({ timestamp: 1 }); // Oldest first

    res.json({
      success: true,
      data: comments.map((comment) => ({
        id: comment._id,
        author: (comment.authorId as any)?.name || comment.author,
        authorId: comment.authorId,
        role: comment.role,
        text: comment.text,
        timestamp: comment.timestamp,
        createdAt: comment.createdAt,
        attachments: comment.attachments,
      })),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   POST /api/comments/:ticketId
// @desc    Add a comment to a ticket
// @access  Private
router.post("/:ticketId", protect, async (req: AuthRequest, res: Response) => {
  try {
    const { ticketId } = req.params;
    const { text } = req.body;
    const user = req.user!;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        error: "Comment text is required",
      });
    }

    // Verify ticket exists and user has access
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found",
      });
    }

    // Check tenant access
    if (
      user.role !== "super-admin" &&
      ticket.tenantId.toString() !== user.tenantId?.toString()
    ) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to comment on this ticket",
      });
    }

    // Determine role based on user role
    let role: "Agent" | "Customer" | "System" = "Agent";
    if (user.role === "customer") {
      role = "Customer";
    } else if (user.role === "agent" || user.role === "tenant-admin" || user.role === "super-admin") {
      role = "Agent";
    }

    // Create comment
    const comment = await Comment.create({
      ticketId: new mongoose.Types.ObjectId(ticketId),
      author: user.name || user.email,
      authorId: user._id,
      role,
      text: text.trim(),
      timestamp: new Date(),
    });

    // Populate and return
    const populatedComment = await Comment.findById(comment._id).populate("authorId", "name email");

    res.status(201).json({
      success: true,
      data: {
        id: populatedComment!._id,
        author: (populatedComment!.authorId as any)?.name || populatedComment!.author,
        authorId: populatedComment!.authorId,
        role: populatedComment!.role,
        text: populatedComment!.text,
        timestamp: populatedComment!.timestamp,
        createdAt: populatedComment!.createdAt,
        attachments: populatedComment!.attachments,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

export default router;

