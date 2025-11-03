import express, { Response } from "express";
import { Customer } from "../models/Customer";
import { protect, AuthRequest } from "../middleware/auth";

const router = express.Router();

// @route   GET /api/customers
// @desc    Get all customers
// @access  Private
router.get("/", protect, async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.query;
    const user = req.user!;

    const query: any = {};

    // Filter by tenant
    if (user.role !== "super-admin") {
      query.tenantId = user.tenantId;
    } else if (tenantId) {
      query.tenantId = tenantId;
    }

    const customers = await Customer.find(query)
      .populate("tenantId", "name")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: customers,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   GET /api/customers/:id
// @desc    Get single customer
// @access  Private
router.get("/:id", protect, async (req: AuthRequest, res: Response) => {
  try {
    const customer = await Customer.findById(req.params.id)
      .populate("tenantId", "name");

    if (!customer) {
      return res.status(404).json({
        success: false,
        error: "Customer not found",
      });
    }

    // Check access
    const user = req.user!;
    if (
      user.role !== "super-admin" &&
      customer.tenantId.toString() !== user.tenantId?.toString()
    ) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to access this customer",
      });
    }

    res.json({
      success: true,
      data: customer,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

export default router;

