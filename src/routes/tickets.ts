import express, { Request, Response } from "express";
import { Ticket } from "../models/Ticket";
import { Activity } from "../models/Activity";
import { protect, AuthRequest, authorize, checkTenantAccess } from "../middleware/auth";
import { validateTicket } from "../middleware/validator";
import { validationResult } from "express-validator";
import { hasPermission } from "../utils/agentPermissions";

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

    // Filter by agent: if myTickets=true OR if agent role without myTickets param
    if (user.role === "agent" && myTickets === "true") {
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

    // Check permission for ticket assignment
    if (req.body.agentId && req.body.agentId !== oldAgent) {
      const canAssign = await hasPermission(user, "canAssignTickets");
      if (!canAssign) {
        return res.status(403).json({
          success: false,
          error: "You don't have permission to assign tickets. Only Senior Agents and above can assign tickets.",
        });
      }
    }

    // Update ticket
    Object.assign(ticket, req.body);
    ticket.updated = new Date();
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

