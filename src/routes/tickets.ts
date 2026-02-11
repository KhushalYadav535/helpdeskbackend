import express, { Request, Response } from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import { Ticket } from "../models/Ticket";
import { Activity } from "../models/Activity";
import { Agent } from "../models/Agent";
import { User } from "../models/User";
import { protect, AuthRequest, authorize, checkTenantAccess } from "../middleware/auth";
import { validateTicket } from "../middleware/validator";
import { validationResult } from "express-validator";
import { hasPermission } from "../utils/agentPermissions";
import { emailService } from "../utils/emailService";
import { runEscalation } from "../utils/escalationService";

const router = express.Router();

// @route   GET /api/tickets
// @desc    Get all tickets (filtered by tenant)
// @access  Private
router.get("/", protect, async (req: AuthRequest, res: Response) => {
  try {
    const { status, priority, tenantId, myTickets } = req.query;
    const user = req.user!;

    // Build query
    const query: any = {};

    // Filter by tenant (unless super-admin)
    if (user.role !== "super-admin") {
      query.tenantId = user.tenantId;
    } else if (tenantId) {
      query.tenantId = tenantId;
    }

    // Filter by status
    if (status) {
      query.status = status;
    }

    // Filter by priority
    if (priority) {
      query.priority = priority;
    }

    // Agent: always see only their assigned tickets (no option to see all)
    if (user.role === "agent") {
      query.agentId = user._id;
    }

    const tickets = await Ticket.find(query)
      .populate("tenantId", "name")
      .populate("agentId", "name email")
      .sort({ created: -1 });

    res.json({
      success: true,
      data: tickets,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   GET /api/tickets/:id
// @desc    Get single ticket
// @access  Private
router.get("/:id", protect, async (req: AuthRequest, res: Response) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate("tenantId", "name")
      .populate("agentId", "name email")
      .populate("customerId");

    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found",
      });
    }

    // Check access
    const user = req.user!;
    if (
      user.role !== "super-admin" &&
      ticket.tenantId.toString() !== user.tenantId?.toString()
    ) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to access this ticket",
      });
    }

    res.json({
      success: true,
      data: ticket,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   POST /api/tickets
// @desc    Create new ticket
// @access  Private
router.post("/", protect, validateTicket, async (req: AuthRequest, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: errors.array()[0].msg,
      });
    }

    const user = req.user!;
    const ticketData = {
      ...req.body,
      tenantId: req.body.tenantId || user.tenantId,
    };

    const ticket = await Ticket.create(ticketData);

    // Create activity
    await Activity.create({
      ticketId: ticket._id,
      action: "created",
      description: "Ticket created",
      user: user.name,
      userId: user._id,
    });

    const populatedTicket = await Ticket.findById(ticket._id)
      .populate("tenantId", "name")
      .populate("agentId", "name email");

    // Send email notifications (non-blocking)
    if (populatedTicket) {
      // Send to tenant admin
      const tenantAdmins = await User.find({
        tenantId: populatedTicket.tenantId,
        role: "tenant-admin",
      });
      if (tenantAdmins.length > 0) {
        const adminEmails = tenantAdmins.map((admin) => admin.email);
        emailService
          .sendTicketCreatedEmail(
            adminEmails,
            populatedTicket.ticketId,
            populatedTicket.title,
            populatedTicket.customer,
            populatedTicket.priority
          )
          .catch((err) => console.error("Failed to send ticket email:", err));
      }

      // Send to assigned agent
      if (populatedTicket.agentId) {
        const agent = await User.findById(populatedTicket.agentId);
        if (agent) {
          emailService
            .sendTicketAssignedEmail(
              agent.email,
              agent.name,
              populatedTicket.ticketId,
              populatedTicket.title,
              populatedTicket.customer
            )
            .catch((err) => console.error("Failed to send agent email:", err));
        }
      }
    }

    res.status(201).json({
      success: true,
      data: populatedTicket,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   PUT /api/tickets/:id
// @desc    Update ticket
// @access  Private
router.put("/:id", protect, async (req: AuthRequest, res: Response) => {
  try {
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found",
      });
    }

    // Check access
    const user = req.user!;
    if (
      user.role !== "super-admin" &&
      ticket.tenantId.toString() !== user.tenantId?.toString()
    ) {
      return res.status(403).json({
        success: false,
        error: "Not authorized to update this ticket",
      });
    }

    const oldStatus = ticket.status;
    const oldAgent = ticket.agentId?.toString();
    const newAgent = req.body.agentId?.toString();

    // Check permission for ticket assignment
    if (newAgent && newAgent !== oldAgent) {
      const canAssign = await hasPermission(user, "canAssignTickets");
      if (!canAssign) {
        return res.status(403).json({
          success: false,
          error: "You don't have permission to assign tickets. Only Supervisors can manually assign or transfer tickets.",
        });
      }
    }

    // Close requires client feedback (unless super-admin/tenant-admin force-close)
    if (req.body.status === "Closed" && oldStatus !== "Closed") {
      const canForceClose = user.role === "super-admin" || user.role === "tenant-admin";
      const hasFeedback = ticket.clientFeedback || req.body.clientFeedback;
      if (!canForceClose && !hasFeedback) {
        return res.status(400).json({
          success: false,
          error: "Ticket cannot be closed without client feedback. Agent/Senior Agent can only Resolve. Client must confirm (satisfied/dissatisfied) before closing.",
        });
      }
      if (req.body.clientFeedback) {
        ticket.clientFeedback = req.body.clientFeedback;
        ticket.clientFeedbackAt = new Date();
        ticket.clientFeedbackNote = req.body.clientFeedbackNote;
      }
    }

    // Update ticket
    Object.assign(ticket, req.body);
    ticket.updated = new Date();

    // If status moved to Resolved/Closed, stamp resolver
    if (req.body.status && req.body.status !== oldStatus) {
      const newStatus = req.body.status as string;
      if (newStatus === "Resolved" || newStatus === "Closed") {
        ticket.resolvedBy = user._id as mongoose.Types.ObjectId;
        ticket.resolvedAt = new Date();
        if (newStatus === "Resolved") {
          ticket.metadata = ticket.metadata || {};
          ticket.metadata.feedbackToken = crypto.randomBytes(24).toString("hex");
        }
        // Update agent statistics if ticket has an agent
        if (ticket.agentId) {
          const agent = await Agent.findOne({ userId: ticket.agentId });
          if (agent) {
            // Increment resolved count
            agent.resolved = (agent.resolved || 0) + 1;
            // Decrement ticketsAssigned (since it's now resolved)
            if (agent.ticketsAssigned > 0) {
              agent.ticketsAssigned = Math.max(0, agent.ticketsAssigned - 1);
            }
            await agent.save();
          }
        }
      } else {
        // If reopening, clear resolved fields and adjust counts
        if (oldStatus === "Resolved" || oldStatus === "Closed") {
          if (ticket.agentId) {
            const agent = await Agent.findOne({ userId: ticket.agentId });
            if (agent) {
              // Decrement resolved count
              if (agent.resolved > 0) {
                agent.resolved = Math.max(0, agent.resolved - 1);
              }
              // Increment ticketsAssigned (since it's now open again)
              agent.ticketsAssigned = (agent.ticketsAssigned || 0) + 1;
              await agent.save();
            }
          }
        }
        ticket.resolvedBy = undefined as any;
        ticket.resolvedAt = undefined as any;
      }
    }

    // Handle agent assignment changes
    if (newAgent && newAgent !== oldAgent) {
      // Set assignedAt when agent is assigned
      ticket.assignedAt = new Date();
      
      // Decrement old agent's ticketsAssigned if ticket was assigned
      if (oldAgent) {
        const oldAgentDoc = await Agent.findOne({ userId: new mongoose.Types.ObjectId(oldAgent) });
        if (oldAgentDoc && oldAgentDoc.ticketsAssigned > 0) {
          oldAgentDoc.ticketsAssigned = Math.max(0, oldAgentDoc.ticketsAssigned - 1);
          await oldAgentDoc.save();
        }
      }

      // Increment new agent's ticketsAssigned
      if (newAgent) {
        const newAgentDoc = await Agent.findOne({ userId: new mongoose.Types.ObjectId(newAgent) });
        if (newAgentDoc) {
          newAgentDoc.ticketsAssigned = (newAgentDoc.ticketsAssigned || 0) + 1;
          await newAgentDoc.save();
        }
      }
    }

    await ticket.save();

    // Create activities for changes
    if (req.body.status && req.body.status !== oldStatus) {
      await Activity.create({
        ticketId: ticket._id,
        action: "status_changed",
        description: `Status changed to ${req.body.status}`,
        user: user.name,
        userId: user._id,
      });
    }

    if (req.body.agentId && req.body.agentId !== oldAgent) {
      await Activity.create({
        ticketId: ticket._id,
        action: "assigned",
        description: `Assigned to agent`,
        user: user.name,
        userId: user._id,
      });
    }

    const updatedTicket = await Ticket.findById(ticket._id)
      .populate("tenantId", "name")
      .populate("agentId", "name email");

    res.json({
      success: true,
      data: updatedTicket,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

// @route   POST /api/tickets/:id/transfer
// @desc    Transfer ticket to another agent (Supervisor only)
// @access  Private
router.post("/:id/transfer", protect, async (req: AuthRequest, res: Response) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: "Ticket not found" });
    }

    const user = req.user!;
    if (user.role !== "super-admin" && ticket.tenantId.toString() !== user.tenantId?.toString()) {
      return res.status(403).json({ success: false, error: "Not authorized" });
    }

    const canAssign = await hasPermission(user, "canAssignTickets");
    if (!canAssign) {
      return res.status(403).json({
        success: false,
        error: "Only Supervisors can transfer tickets.",
      });
    }

    const { toAgentId } = req.body;
    if (!toAgentId) {
      return res.status(400).json({ success: false, error: "toAgentId is required" });
    }

    const oldAgentId = ticket.agentId?.toString();
    const newAgentId = toAgentId.toString();
    if (oldAgentId === newAgentId) {
      return res.status(400).json({ success: false, error: "Ticket is already assigned to this agent" });
    }

    ticket.agentId = new mongoose.Types.ObjectId(newAgentId);
    ticket.assignedAt = new Date();
    ticket.updated = new Date();
    await ticket.save();

    if (oldAgentId) {
      const oldAgentDoc = await Agent.findOne({ userId: new mongoose.Types.ObjectId(oldAgentId) });
      if (oldAgentDoc && oldAgentDoc.ticketsAssigned > 0) {
        oldAgentDoc.ticketsAssigned = Math.max(0, oldAgentDoc.ticketsAssigned - 1);
        await oldAgentDoc.save();
      }
    }
    const newAgentDoc = await Agent.findOne({ userId: new mongoose.Types.ObjectId(newAgentId) });
    if (newAgentDoc) {
      newAgentDoc.ticketsAssigned = (newAgentDoc.ticketsAssigned || 0) + 1;
      await newAgentDoc.save();
    }

    await Activity.create({
      ticketId: ticket._id,
      action: "transferred",
      description: `Ticket transferred to new agent`,
      user: user.name,
      userId: user._id,
    });

    const updated = await Ticket.findById(ticket._id)
      .populate("tenantId", "name")
      .populate("agentId", "name email");

    res.json({ success: true, data: updated, message: "Ticket transferred successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Server error" });
  }
});

// @route   POST /api/tickets/:id/client-feedback
// @desc    Submit client feedback (required before Close). Public with token.
// @access  Public (token in body)
router.post("/:id/client-feedback", async (req: Request, res: Response) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ success: false, error: "Ticket not found" });
    }

    const { feedbackToken, feedback, note } = req.body;
    const storedToken = ticket.metadata?.feedbackToken;

    if (!storedToken || feedbackToken !== storedToken) {
      return res.status(401).json({ success: false, error: "Invalid or expired feedback link" });
    }

    const validFeedback = ["satisfied", "dissatisfied", "no_response"];
    if (!feedback || !validFeedback.includes(feedback)) {
      return res.status(400).json({ success: false, error: "Invalid feedback. Use: satisfied, dissatisfied, or no_response" });
    }

    ticket.clientFeedback = feedback;
    ticket.clientFeedbackAt = new Date();
    ticket.clientFeedbackNote = note;
    if (feedback === "satisfied" || feedback === "no_response") {
      ticket.status = "Closed";
      ticket.resolvedAt = new Date();
    } else if (feedback === "dissatisfied") {
      ticket.status = "In Progress";
      ticket.clientFeedback = undefined;
      ticket.clientFeedbackAt = undefined;
    }
    ticket.updated = new Date();
    await ticket.save();

    res.json({
      success: true,
      message: feedback === "satisfied" ? "Thank you! Ticket closed." : feedback === "dissatisfied" ? "We'll look into it. Ticket reopened." : "Feedback recorded.",
      data: { ticketId: ticket.ticketId, status: ticket.status },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Server error" });
  }
});

// @route   POST /api/tickets/run-escalation
// @desc    Run escalation job (call via cron every 15-30 min). Protected by cron secret or admin.
// @access  Private
router.post("/run-escalation", protect, authorize("super-admin", "tenant-admin"), async (req: AuthRequest, res: Response) => {
  try {
    const result = await runEscalation();
    res.json({
      success: true,
      message: `Escalation complete: ${result.escalatedToSenior} to Senior Agent, ${result.escalatedToSupervisor} to Supervisor`,
      ...result,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || "Server error" });
  }
});

// @route   DELETE /api/tickets/:id
// @desc    Delete ticket
// @access  Private (Admin only)
router.delete("/:id", protect, authorize("super-admin", "tenant-admin"), async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const ticket = await Ticket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: "Ticket not found",
      });
    }

    await Ticket.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Ticket deleted",
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Server error",
    });
  }
});

export default router;

