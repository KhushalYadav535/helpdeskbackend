import express, { Response } from "express";
import mongoose from "mongoose";
import { CallHistory } from "../models/CallHistory";
import { protect, AuthRequest } from "../middleware/auth";

const router = express.Router();

/** @route GET /api/call-logs | GET /api/call-history — voice call log rows (same data as POST /call-logs creates; not sales leads). */
router.get("/", protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { tenantId, callType, limit, page } = req.query;

    const query: Record<string, unknown> = {};

    if (user.role === "super-admin") {
      if (tenantId && mongoose.Types.ObjectId.isValid(tenantId as string)) {
        query.tenantId = new mongoose.Types.ObjectId(tenantId as string);
      }
    } else if (user.tenantId) {
      query.tenantId = user.tenantId;
    }

    if (callType && typeof callType === "string") {
      query.callType = callType;
    }

    const pageNumber = page ? parseInt(page as string, 10) : 1;
    const limitNumber = limit ? parseInt(limit as string, 10) : undefined;
    const skip = limitNumber ? (pageNumber - 1) * limitNumber : 0;

    const totalCount = await CallHistory.countDocuments(query);

    let qb = CallHistory.find(query)
      .populate("tenantId", "name")
      .sort({ callTimestamp: -1, createdAt: -1 })
      .skip(skip);

    if (limitNumber) {
      qb = qb.limit(limitNumber);
    }

    const data = await qb.exec();

    res.json({
      success: true,
      data,
      count: data.length,
      total: totalCount,
      page: pageNumber,
      limit: limitNumber ?? totalCount,
      totalPages: limitNumber ? Math.ceil(totalCount / limitNumber) : 1,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

export default router;
