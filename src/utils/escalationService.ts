import { Ticket } from "../models/Ticket";
import { Agent } from "../models/Agent";
import { Activity } from "../models/Activity";
import mongoose from "mongoose";

const HOURS_TO_SENIOR = parseInt(process.env.ESCALATION_TO_SENIOR_HOURS || "24", 10);
const HOURS_TO_SUPERVISOR = parseInt(process.env.ESCALATION_TO_SUPERVISOR_HOURS || "48", 10);

/**
 * Find least-loaded agent of given level within tenant
 */
async function getLeastLoadedAgent(
  tenantId: mongoose.Types.ObjectId,
  level: "senior-agent" | "supervisor"
): Promise<mongoose.Types.ObjectId | null> {
  const agents = await Agent.find({
    tenantId,
    agentLevel: level,
  })
    .populate("userId", "name email")
    .sort({ ticketsAssigned: 1 });

  return agents.length > 0 ? (agents[0].userId as any)._id : null;
}

/**
 * Run escalation for unresolved tickets
 * Call via cron every 15-30 minutes
 */
export async function runEscalation(): Promise<{ escalatedToSenior: number; escalatedToSupervisor: number }> {
  let escalatedToSenior = 0;
  let escalatedToSupervisor = 0;

  const unresolved = await Ticket.find({
    status: { $in: ["Open", "In Progress"] },
    agentId: { $exists: true },
  }).populate("agentId", "name");

  const now = new Date();

  for (const ticket of unresolved) {
    const tenantId = ticket.tenantId as mongoose.Types.ObjectId;
    const currentLevel = ticket.escalationLevel || "agent";
    const escalatedAt = ticket.escalatedAt || ticket.created;
    const hoursSinceEscalation = (now.getTime() - new Date(escalatedAt).getTime()) / (1000 * 60 * 60);

    if (currentLevel === "agent") {
      if (hoursSinceEscalation >= HOURS_TO_SENIOR) {
        const newAgentId = await getLeastLoadedAgent(tenantId, "senior-agent");
        if (newAgentId) {
          const oldAgentId = ticket.agentId as mongoose.Types.ObjectId;
          ticket.agentId = newAgentId;
          ticket.escalationLevel = "senior-agent";
          ticket.escalatedAt = now;
          ticket.assignedAt = now;
          ticket.updated = now;
          await ticket.save();

          if (oldAgentId) {
            const oldAgent = await Agent.findOne({ userId: oldAgentId });
            if (oldAgent && oldAgent.ticketsAssigned > 0) {
              oldAgent.ticketsAssigned = Math.max(0, oldAgent.ticketsAssigned - 1);
              await oldAgent.save();
            }
          }
          const newAgent = await Agent.findOne({ userId: newAgentId });
          if (newAgent) {
            newAgent.ticketsAssigned = (newAgent.ticketsAssigned || 0) + 1;
            await newAgent.save();
          }

          await Activity.create({
            ticketId: ticket._id,
            action: "escalated",
            description: `Escalated to Senior Agent (unresolved after ${HOURS_TO_SENIOR}h)`,
            user: "System",
            userId: undefined as any,
          });
          escalatedToSenior++;
        }
      }
    } else if (currentLevel === "senior-agent") {
      if (hoursSinceEscalation >= HOURS_TO_SUPERVISOR) {
        const newAgentId = await getLeastLoadedAgent(tenantId, "supervisor");
        if (newAgentId) {
          const oldAgentId = ticket.agentId as mongoose.Types.ObjectId;
          ticket.agentId = newAgentId;
          ticket.escalationLevel = "supervisor";
          ticket.escalatedAt = now;
          ticket.assignedAt = now;
          ticket.updated = now;
          await ticket.save();

          if (oldAgentId) {
            const oldAgent = await Agent.findOne({ userId: oldAgentId });
            if (oldAgent && oldAgent.ticketsAssigned > 0) {
              oldAgent.ticketsAssigned = Math.max(0, oldAgent.ticketsAssigned - 1);
              await oldAgent.save();
            }
          }
          const newAgent = await Agent.findOne({ userId: newAgentId });
          if (newAgent) {
            newAgent.ticketsAssigned = (newAgent.ticketsAssigned || 0) + 1;
            await newAgent.save();
          }

          await Activity.create({
            ticketId: ticket._id,
            action: "escalated",
            description: `Escalated to Supervisor (unresolved after ${HOURS_TO_SUPERVISOR}h)`,
            user: "System",
            userId: undefined as any,
          });
          escalatedToSupervisor++;
        }
      }
    }
  }

  return { escalatedToSenior, escalatedToSupervisor };
}
