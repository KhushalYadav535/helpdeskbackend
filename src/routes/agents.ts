import express, { Response } from "express";
import { Agent } from "../models/Agent";
import { User } from "../models/User";
import { Ticket } from "../models/Ticket";
import { protect, AuthRequest, authorize } from "../middleware/auth";
import { hasPermission, getAgentLevel } from "../utils/agentPermissions";

const router = express.Router();

const MAX_TICKETS_ERR = "Max tickets must be at least 1.";

function parseMaxTickets(value: unknown): { ok: true; n: number } | { ok: false; error: string } {
  const n = typeof value === "string" ? parseInt(value, 10) : Number(value);
  if (isNaN(n) || n < 1 || n > 999) {
    return { ok: false, error: MAX_TICKETS_ERR };
  }
  return { ok: true, n };
}

// @route   GET /api/agents/me
// @desc    Current user's agent record + settings (agents only)
// @access  Private
router.get("/me", protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== "agent") {
      return res.status(403).json({
        success: false,
        error: "This endpoint is only for agent accounts",
      });
    }

    const agent = await Agent.findOne({ userId: user._id })
      .populate("tenantId", "name")
      .populate("userId", "name email");

    if (!agent) {
      return res.status(404).json({ success: false, error: "Agent profile not found" });
    }

    const u = agent.userId as any;
    res.json({
      success: true,
      data: {
        id: agent._id,
        name: u?.name,
        email: u?.email,
        agentLevel: agent.agentLevel || "agent",
        tenantName: (agent.tenantId as any)?.name,
        maxTicketsPerDay: agent.maxTicketsPerDay ?? 15,
        notificationsEnabled: agent.notificationsEnabled ?? true,
        emailNotifications: agent.emailNotifications ?? true,
        autoAcceptTickets: agent.autoAcceptTickets ?? false,
        phoneNumber: agent.phoneNumber || "",
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Server error" });
  }
});

// @route   PATCH /api/agents/me/settings
// @desc    Update own preferences (not maxTicketsPerDay — Tenant Admin only via PUT /agents/:id)
// @access  Private (agent)
router.patch("/me/settings", protect, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== "agent") {
      return res.status(403).json({ success: false, error: "Only agents can update these settings" });
    }

    if (req.body.maxTicketsPerDay !== undefined) {
      return res.status(403).json({
        success: false,
        error: "Only Tenant Admin can modify Max Tickets Per Day",
      });
    }

    const agent = await Agent.findOne({ userId: user._id });
    if (!agent) {
      return res.status(404).json({ success: false, error: "Agent profile not found" });
    }

    const { notificationsEnabled, emailNotifications, autoAcceptTickets, phoneNumber, fullName } = req.body;

    if (typeof notificationsEnabled === "boolean") agent.notificationsEnabled = notificationsEnabled;
    if (typeof emailNotifications === "boolean") agent.emailNotifications = emailNotifications;
    if (typeof autoAcceptTickets === "boolean") agent.autoAcceptTickets = autoAcceptTickets;
    if (typeof phoneNumber === "string") agent.phoneNumber = phoneNumber.trim();

    if (typeof fullName === "string" && fullName.trim()) {
      await User.findByIdAndUpdate(user._id, { name: fullName.trim() });
    }

    await agent.save();

    const fresh = await Agent.findById(agent._id).populate("userId", "name email").populate("tenantId", "name");
    const u = fresh!.userId as any;

    res.json({
      success: true,
      data: {
        id: fresh!._id,
        name: u?.name,
        email: u?.email,
        agentLevel: fresh!.agentLevel || "agent",
        tenantName: (fresh!.tenantId as any)?.name,
        maxTicketsPerDay: fresh!.maxTicketsPerDay ?? 15,
        notificationsEnabled: fresh!.notificationsEnabled ?? true,
        emailNotifications: fresh!.emailNotifications ?? true,
        autoAcceptTickets: fresh!.autoAcceptTickets ?? false,
        phoneNumber: fresh!.phoneNumber || "",
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Server error" });
  }
});

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
      .populate("userId", "name email avatar role accessRoles")
      .populate("tenantId", "name");

    res.json({
      success: true,
      data: agents.map((agent) => ({
        id: agent._id,
        userId: (agent.userId as any)?._id || agent.userId,
        name: (agent.userId as any).name,
        email: (agent.userId as any).email,
        avatar: (agent.userId as any).avatar,
        role: (agent.userId as any).role,
        accessRoles: (agent.userId as any).accessRoles || ["agent"],
        // Force display as online in responses
        status: "online",
        agentLevel: agent.agentLevel || "agent",
        ticketsAssigned: agent.ticketsAssigned,
        resolved: agent.resolved,
        satisfaction: agent.satisfaction,
        tenantId: agent.tenantId,
        joinDate: agent.joinDate,
        maxTicketsPerDay: agent.maxTicketsPerDay ?? 15,
        notificationsEnabled: agent.notificationsEnabled ?? true,
        emailNotifications: agent.emailNotifications ?? true,
        autoAcceptTickets: agent.autoAcceptTickets ?? false,
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
      .populate("userId", "name email avatar role accessRoles")
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
        role: (agent.userId as any).role,
        accessRoles: (agent.userId as any).accessRoles || ["agent"],
        status: agent.status,
        agentLevel: agent.agentLevel || "agent",
        ticketsAssigned: agent.ticketsAssigned,
        resolved: agent.resolved,
        satisfaction: agent.satisfaction,
        tenantId: agent.tenantId,
        joinDate: agent.joinDate,
        maxTicketsPerDay: agent.maxTicketsPerDay ?? 15,
        notificationsEnabled: agent.notificationsEnabled ?? true,
        emailNotifications: agent.emailNotifications ?? true,
        autoAcceptTickets: agent.autoAcceptTickets ?? false,
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

    const wantsMaxTickets =
      req.body.maxTicketsPerDay !== undefined && req.body.maxTicketsPerDay !== null;

    if (wantsMaxTickets) {
      if (user.role !== "tenant-admin" && user.role !== "super-admin") {
        return res.status(403).json({
          success: false,
          error: "Only Tenant Admin can modify Max Tickets Per Day",
        });
      }
      const parsed = parseMaxTickets(req.body.maxTicketsPerDay);
      if (!parsed.ok) {
        return res.status(400).json({
          success: false,
          error: parsed.error,
        });
      }
      req.body.maxTicketsPerDay = parsed.n;
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

    const allowedKeys = [
      "status",
      "agentLevel",
      "maxTicketsPerDay",
      "notificationsEnabled",
      "emailNotifications",
      "autoAcceptTickets",
      "phoneNumber",
    ];
    const updatePayload: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      if (key in req.body) {
        updatePayload[key] = req.body[key];
      }
    }

    // Update agent
    const updatedAgent = await Agent.findByIdAndUpdate(
      agentId,
      { $set: updatePayload },
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
        maxTicketsPerDay: updatedAgent!.maxTicketsPerDay ?? 15,
        notificationsEnabled: updatedAgent!.notificationsEnabled ?? true,
        emailNotifications: updatedAgent!.emailNotifications ?? true,
        autoAcceptTickets: updatedAgent!.autoAcceptTickets ?? false,
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
router.post("/:id/convert-to-sales-team", protect, authorize("super-admin", "tenant-admin"), async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const user = req.user!;
    const agentId = req.params.id;

    const agent = await Agent.findById(agentId).populate("userId");
    if (!agent) {
      return res.status(404).json({
        success: false,
        error: "Agent not found",
      });
    }

    if (user.role === "tenant-admin" && agent.tenantId.toString() !== user.tenantId?.toString()) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to modify agents from other tenants",
      });
    }

    const userId = (agent.userId as any)?._id || agent.userId;
    const agentUser = await User.findById(userId);
    if (!agentUser) {
      return res.status(404).json({
        success: false,
        error: "Associated user not found",
      });
    }

    agentUser.role = "sales-team";
    (agentUser as any).accessRoles = ["sales-team"];
    await agentUser.save();

    // Unassign tickets from this user because they are no longer an agent.
    const ticketUpdateResult = await Ticket.updateMany(
      { agentId: userId, status: { $nin: ["Closed", "Resolved"] } },
      { $set: { updated: new Date() }, $unset: { agentId: 1, assignedAt: 1 } }
    );

    await Agent.findByIdAndDelete(agentId);

    res.json({
      success: true,
      message: "Agent converted to sales-team user successfully",
      data: {
        id: String(agentUser._id),
        name: agentUser.name,
        email: agentUser.email,
        role: agentUser.role,
        tenantId: agentUser.tenantId?.toString(),
      },
      unassignedTickets: ticketUpdateResult.modifiedCount || 0,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

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

