import express, { Response } from "express";
import { Agent } from "../models/Agent";
import { User } from "../models/User";
import { protect, AuthRequest, authorize } from "../middleware/auth";
import { hasPermission, getAgentLevel } from "../utils/agentPermissions";

const router = express.Router();

// @route   GET /api/agents
// @desc    Get all agents
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

    const agents = await Agent.find(query)
      .populate("userId", "name email avatar")
      .populate("tenantId", "name");

    res.json({
      success: true,
      data: agents.map((agent) => ({
        id: agent._id,
        name: (agent.userId as any).name,
        email: (agent.userId as any).email,
        avatar: (agent.userId as any).avatar,
        // Force display as online in responses
        status: "online",
        agentLevel: agent.agentLevel || "agent",
        ticketsAssigned: agent.ticketsAssigned,
        resolved: agent.resolved,
        satisfaction: agent.satisfaction,
        tenantId: agent.tenantId,
        joinDate: agent.joinDate,
      })),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   GET /api/agents/:id
// @desc    Get single agent
// @access  Private
router.get("/:id", protect, async (req: AuthRequest, res: Response) => {
  try {
    const agent = await Agent.findById(req.params.id)
      .populate("userId", "name email avatar")
      .populate("tenantId", "name");

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: "Agent not found",
      });
    }

    res.json({
      success: true,
      data: {
        id: agent._id,
        name: (agent.userId as any).name,
        email: (agent.userId as any).email,
        avatar: (agent.userId as any).avatar,
        status: agent.status,
        agentLevel: agent.agentLevel || "agent",
        ticketsAssigned: agent.ticketsAssigned,
        resolved: agent.resolved,
        satisfaction: agent.satisfaction,
        tenantId: agent.tenantId,
        joinDate: agent.joinDate,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   POST /api/agents
// @desc    Create new agent (creates user + agent)
// @access  Private (Tenant Admin, Super Admin)
router.post("/", protect, authorize("super-admin", "tenant-admin"), async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const { name, email, password, status, agentLevel } = req.body;
    const user = req.user!;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: "Name, email, and password are required",
      });
    }

    // Validate agent level
    const validLevels = ["agent", "senior-agent", "supervisor"];
    const finalLevel = agentLevel && validLevels.includes(agentLevel) ? agentLevel : "agent";

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "User already exists with this email",
      });
    }

    const tenantId = user.role === "super-admin" ? req.body.tenantId : user.tenantId;

    // Create user with agent role
    const agentUser = await User.create({
      name,
      email,
      password,
      role: "agent",
      tenantId,
      avatar: name.substring(0, 2).toUpperCase(),
    });

    // Check if agent already exists
    const existingAgent = await Agent.findOne({ userId: agentUser._id });
    if (existingAgent) {
      return res.status(400).json({
        success: false,
        error: "Agent already exists",
      });
    }

    // Create agent record
    const agent = await Agent.create({
      userId: agentUser._id,
      tenantId,
      status: status || "offline",
      agentLevel: finalLevel,
    });

    const populatedAgent = await Agent.findById(agent._id)
      .populate("userId", "name email avatar")
      .populate("tenantId", "name");

    res.status(201).json({
      success: true,
      data: {
        id: agent._id,
        name: agentUser.name,
        email: agentUser.email,
        avatar: agentUser.avatar,
        status: (populatedAgent as any).status,
        agentLevel: (populatedAgent as any).agentLevel || "agent",
        ticketsAssigned: (populatedAgent as any).ticketsAssigned,
        resolved: (populatedAgent as any).resolved,
        satisfaction: (populatedAgent as any).satisfaction,
        tenantId: agent.tenantId,
        joinDate: (populatedAgent as any).joinDate,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   PUT /api/agents/:id
// @desc    Update agent (Tenant Admin, Super Admin, or Supervisor)
// @access  Private
router.put("/:id", protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const agentId = req.params.id;

    // Find the agent to update
    const agentToUpdate = await Agent.findById(agentId);
    if (!agentToUpdate) {
      return res.status(404).json({
        success: false,
        error: "Agent not found",
      });
    }

    // Check permissions
    // Super-admin and tenant-admin can always update
    if (user.role === "super-admin" || user.role === "tenant-admin") {
      // Allow update
    } else if (user.role === "agent") {
      // Check if user is a supervisor with manage agents permission
      const canManage = await hasPermission(user, "canManageAgents");
      if (!canManage) {
        return res.status(403).json({
          success: false,
          error: "You don't have permission to manage agents. Only supervisors can manage agents.",
        });
      }

      // Supervisors can only manage agents in their tenant
      if (agentToUpdate.tenantId.toString() !== user.tenantId?.toString()) {
        return res.status(403).json({
          success: false,
          error: "You can only manage agents in your own tenant",
        });
      }

      // Supervisors cannot change agent level to supervisor (only tenant-admin can)
      if (req.body.agentLevel === "supervisor") {
        return res.status(403).json({
          success: false,
          error: "Only tenant admin can assign supervisor level",
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        error: "You don't have permission to update agents",
      });
    }

    // Update agent
    const updatedAgent = await Agent.findByIdAndUpdate(
      agentId,
      req.body,
      { new: true, runValidators: true }
    )
      .populate("userId", "name email avatar")
      .populate("tenantId", "name");

    res.json({
      success: true,
      data: {
        id: updatedAgent!._id,
        name: (updatedAgent!.userId as any).name,
        email: (updatedAgent!.userId as any).email,
        avatar: (updatedAgent!.userId as any).avatar,
        status: updatedAgent!.status,
        agentLevel: updatedAgent!.agentLevel || "agent",
        ticketsAssigned: updatedAgent!.ticketsAssigned,
        resolved: updatedAgent!.resolved,
        satisfaction: updatedAgent!.satisfaction,
        tenantId: updatedAgent!.tenantId,
        joinDate: updatedAgent!.joinDate,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   DELETE /api/agents/:id
// @desc    Delete agent
// @access  Private (Tenant Admin, Super Admin)
router.delete("/:id", protect, authorize("super-admin", "tenant-admin"), async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const user = req.user!;
    const agentId = req.params.id;

    // Find the agent first
    const agent = await Agent.findById(agentId).populate("userId");

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: "Agent not found",
      });
    }

    // Check permissions - tenant admin can only delete agents in their tenant
    if (user.role === "tenant-admin") {
      if (agent.tenantId.toString() !== user.tenantId?.toString()) {
        return res.status(403).json({
          success: false,
          error: "Not authorized to delete agents from other tenants",
        });
      }
    }

    // Delete the User record
    if (agent.userId) {
      await User.findByIdAndDelete((agent.userId as any)._id || agent.userId);
    }

    // Delete the Agent record
    await Agent.findByIdAndDelete(agentId);

    res.json({
      success: true,
      message: "Agent deleted successfully",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

export default router;

