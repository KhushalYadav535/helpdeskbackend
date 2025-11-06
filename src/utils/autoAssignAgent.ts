import { Agent } from "../models/Agent";
import { Ticket } from "../models/Ticket";
import mongoose from "mongoose";

export const autoAssignAgent = async (
  tenantId: string,
  priority?: "Critical" | "High" | "Medium" | "Low"
): Promise<string | null> => {
  // Get all agents for this tenant
  const tenantAgents = await Agent.find({
    tenantId: new mongoose.Types.ObjectId(tenantId),
  }).populate("userId", "name email");

  if (tenantAgents.length === 0) {
    return null;
  }

  // Treat all agents as available (always-online behavior)
  const availableAgents = tenantAgents;

  if (availableAgents.length === 0) {
    // If no online agents, assign to any agent
    return tenantAgents[0].userId._id.toString();
  }

  // Get current ticket counts for load balancing (only count active/open tickets)
  const ticketCounts: Record<string, number> = {};

  // Count only unresolved tickets (Open, In Progress, etc.) - exclude Resolved and Closed
  const unresolvedTickets = await Ticket.find({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    status: { $nin: ["Resolved", "Closed"] }, // Only count active tickets
    agentId: { $exists: true },
  });

  // Initialize all candidate agents with 0 tickets
  for (const agent of availableAgents) {
    const agentIdStr = agent.userId._id.toString();
    ticketCounts[agentIdStr] = 0;
  }

  // Count tickets per agent
  for (const ticket of unresolvedTickets) {
    if (ticket.agentId) {
      const agentIdStr = ticket.agentId.toString();
      ticketCounts[agentIdStr] = (ticketCounts[agentIdStr] || 0) + 1;
    }
  }

  // Priority-based assignment with agent levels
  let candidateAgents: typeof availableAgents = [];

  if (priority === "Critical") {
    // Critical tickets → Supervisors first, then Senior Agents only (no fallback to regular agents)
    candidateAgents = availableAgents.filter((a) => a.agentLevel === "supervisor");
    if (candidateAgents.length === 0) {
      candidateAgents = availableAgents.filter((a) => a.agentLevel === "senior-agent");
    }
    // If no supervisor or senior-agent, return null (unassigned) - do NOT fallback to regular agents
  } else if (priority === "High") {
    // High priority → ONLY Senior Agents or Supervisors (no fallback to regular agents)
    candidateAgents = availableAgents.filter(
      (a) => a.agentLevel === "senior-agent" || a.agentLevel === "supervisor"
    );
    // If no senior-agent or supervisor, return null (unassigned) - do NOT fallback to regular agents
  } else {
    // Medium/Low priority → Any available agent (including regular agents)
    candidateAgents = availableAgents;
  }

  // If no candidate agents found (for High/Critical), return null (unassigned)
  if (candidateAgents.length === 0) {
    return null;
  }

  // Load balancing: Assign to agent with least open tickets
  // Find agent with minimum ticket count
  let selectedAgent = candidateAgents[0];
  let minTickets = ticketCounts[selectedAgent.userId._id.toString()] || 0;

  for (const agent of candidateAgents) {
    const agentIdStr = agent.userId._id.toString();
    const count = ticketCounts[agentIdStr] || 0;
    
    // Select agent with fewer tickets
    if (count < minTickets) {
      minTickets = count;
      selectedAgent = agent;
    }
  }

  // Return the agent with least tickets (if multiple have same count, returns first one)
  return selectedAgent.userId._id.toString();
};

