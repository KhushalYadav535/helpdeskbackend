import express, { Response } from "express";
import { Tenant } from "../models/Tenant";
import { User } from "../models/User";
import { Agent } from "../models/Agent";
import { protect, AuthRequest, authorize } from "../middleware/auth";
import { validateTenant } from "../middleware/validator";
import { validationResult } from "express-validator";
import { emailService } from "../utils/emailService";

const router = express.Router();

// @route   GET /api/tenants
// @desc    Get all tenants
// @access  Private (Super Admin only)
router.get("/", protect, authorize("super-admin"), async (req: AuthRequest, res: Response) => {
  try {
    const tenants = await Tenant.find().sort({ createdAt: -1 });

    res.json({
      success: true,
      data: tenants,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   GET /api/tenants/:id
// @desc    Get single tenant
// @access  Private
router.get("/:id", protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;

    // Non-super-admins can only access their own tenant
    if (user.role !== "super-admin") {
      const tenantId = req.params.id;
      if (tenantId !== user.tenantId?.toString()) {
        return res.status(403).json({
          success: false,
          error: "Not authorized to access this tenant",
        });
      }
    }

    const tenant = await Tenant.findById(req.params.id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: "Tenant not found",
      });
    }

    res.json({
      success: true,
      data: tenant,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   POST /api/tenants
// @desc    Create new tenant
// @access  Private (Super Admin only)
router.post("/", protect, authorize("super-admin"), validateTenant, async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg,
      });
    }

    const { name, email, channels, plan, adminName, adminPassword } = req.body;

    // Check if tenant already exists
    const existingTenant = await Tenant.findOne({ email });
    if (existingTenant) {
      return res.status(400).json({
        success: false,
        error: "Tenant already exists with this email",
      });
    }

    // Check if user already exists with this email
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "User already exists with this email",
      });
    }

    const webhookToken = `wh_tenant_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    // Create tenant
    const tenant = await Tenant.create({
      name,
      email,
      channels: channels || {},
      plan: plan || "professional",
      webhookToken,
    });

    // Create tenant-admin user if adminName and adminPassword provided
    let tenantAdmin = null;
    if (adminName && adminPassword) {
      tenantAdmin = await User.create({
        name: adminName,
        email,
        password: adminPassword,
        role: "tenant-admin",
        tenantId: tenant._id,
        companyName: name,
        avatar: adminName.substring(0, 2).toUpperCase(),
      });

      // Send welcome email (non-blocking)
      emailService
        .sendWelcomeEmail(email, adminName, name)
        .catch((err) => console.error("Failed to send welcome email:", err));
    }

    res.status(201).json({
      success: true,
      data: {
        tenant,
        admin: tenantAdmin ? {
          id: (tenantAdmin._id as any).toString(),
          name: tenantAdmin.name,
          email: tenantAdmin.email,
          role: tenantAdmin.role,
        } : null,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   PUT /api/tenants/:id
// @desc    Update tenant
// @access  Private
router.put("/:id", protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;

    // Non-super-admins can only update their own tenant
    if (user.role !== "super-admin") {
      if (req.params.id !== user.tenantId?.toString()) {
        return res.status(403).json({
          success: false,
          error: "Not authorized to update this tenant",
        });
      }
    }

    const tenant = await Tenant.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: "Tenant not found",
      });
    }

    res.json({
      success: true,
      data: tenant,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   PUT /api/tenants/:id/regenerate-token
// @desc    Regenerate webhook token
// @access  Private
router.put("/:id/regenerate-token", protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;

    // Non-super-admins can only regenerate token for their own tenant
    if (user.role !== "super-admin") {
      if (req.params.id !== user.tenantId?.toString()) {
        return res.status(403).json({
          success: false,
          error: "Not authorized",
        });
      }
    }

    const tenant = await Tenant.findById(req.params.id);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: "Tenant not found",
      });
    }

    // Generate new token
    tenant.webhookToken = `wh_tenant_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    await tenant.save();

    res.json({
      success: true,
      data: tenant,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   DELETE /api/tenants/:id
// @desc    Delete tenant
// @access  Private (Super Admin only)
router.delete("/:id", protect, authorize("super-admin"), async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const tenantId = req.params.id;
    const tenant = await Tenant.findById(tenantId);

    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: "Tenant not found",
      });
    }

    // Delete all agents associated with this tenant
    const agents = await Agent.find({ tenantId });
    for (const agent of agents) {
      // Delete the user associated with each agent
      if (agent.userId) {
        await User.findByIdAndDelete(agent.userId);
      }
      // Delete the agent record
      await Agent.findByIdAndDelete(agent._id);
    }

    // Delete all users associated with this tenant (tenant-admin, agents, customers)
    await User.deleteMany({ tenantId });

    // Delete the tenant
    await Tenant.findByIdAndDelete(tenantId);

    res.json({
      success: true,
      message: "Tenant and all associated data deleted successfully",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

export default router;

