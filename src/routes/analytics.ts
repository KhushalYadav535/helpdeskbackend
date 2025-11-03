import express, { Response } from "express";
import { Ticket } from "../models/Ticket";
import { Tenant } from "../models/Tenant";
import { Agent } from "../models/Agent";
import { protect, AuthRequest } from "../middleware/auth";

const router = express.Router();

// @route   GET /api/analytics/tenant-stats
// @desc    Get tenant statistics
// @access  Private (Super Admin)
router.get("/tenant-stats", protect, async (req: AuthRequest, res: Response) => {
  try {
    const tenants = await Tenant.countDocuments({ status: "active" });
    const agents = await Agent.countDocuments();
    const tickets = await Ticket.countDocuments();

    // Calculate average response time (mock for now)
    const avgResponseTime = "3.2h";

    res.json({
      success: true,
      data: {
        activeTenants: tenants,
        totalAgents: agents,
        totalTickets: tickets,
        avgResponseTime,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   GET /api/analytics/ticket-stats
// @desc    Get ticket statistics
// @access  Private
router.get("/ticket-stats", protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const query: any = {};

    // Filter by tenant
    if (user.role !== "super-admin") {
      query.tenantId = user.tenantId;
    }

    const total = await Ticket.countDocuments(query);
    const open = await Ticket.countDocuments({ ...query, status: "Open" });
    const inProgress = await Ticket.countDocuments({
      ...query,
      status: "In Progress",
    });
    const resolved = await Ticket.countDocuments({
      ...query,
      status: "Resolved",
    });

    res.json({
      success: true,
      data: {
        total,
        open,
        inProgress,
        resolved,
        avgResolutionTime: "3.2h",
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   GET /api/analytics/agent-performance/:agentId
// @desc    Get agent performance
// @access  Private
router.get("/agent-performance/:agentId", protect, async (req: AuthRequest, res: Response) => {
  try {
    const agent = await Agent.findById(req.params.agentId);

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: "Agent not found",
      });
    }

    res.json({
      success: true,
      data: {
        agentId: agent._id,
        resolved: agent.resolved,
        satisfaction: agent.satisfaction,
        responseTime: "2.3h",
        slcCompliance: "98%",
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

