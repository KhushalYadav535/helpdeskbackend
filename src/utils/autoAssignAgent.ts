import { Agent } from "../models/Agent";
import { Ticket } from "../models/Ticket";
import mongoose from "mongoose";

export const autoAssignAgent = async (
  tenantId: string
): Promise<string | null> => {
  // Get all agents for this tenant
  const tenantAgents = await Agent.find({
    tenantId: new mongoose.Types.ObjectId(tenantId),
  }).populate("userId", "name email");

  if (tenantAgents.length === 0) {
    return null;
  }

  // Filter online/available agents (exclude offline)
  const availableAgents = tenantAgents.filter(
    (a) => a.status === "online" || a.status === "away"
  );

  if (availableAgents.length === 0) {
    // If no online agents, assign to any agent
    return tenantAgents[0].userId._id.toString();
  }

  // Get current ticket counts for load balancing
  const ticketCounts: Record<string, number> = {};

  const unresolvedTickets = await Ticket.find({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    status: { $ne: "Resolved" },
    agentId: { $exists: true },
  });

  for (const ticket of unresolvedTickets) {
    if (ticket.agentId) {
      const agentIdStr = ticket.agentId.toString();
      ticketCounts[agentIdStr] = (ticketCounts[agentIdStr] || 0) + 1;
    }
  }

  // Assign to agent with least tickets (round-robin with load balancing)
  let selectedAgent = availableAgents[0];
  let minTickets = ticketCounts[selectedAgent.userId._id.toString()] || 0;

  for (const agent of availableAgents) {
    const agentIdStr = agent.userId._id.toString();
    const count = ticketCounts[agentIdStr] || 0;
    if (count < minTickets) {
      minTickets = count;
      selectedAgent = agent;
    }
  }

  return selectedAgent.userId._id.toString();
};

