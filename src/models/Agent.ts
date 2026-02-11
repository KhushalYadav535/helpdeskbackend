import mongoose, { Document, Schema } from "mongoose";

export interface IAgent extends Document {
  userId: mongoose.Types.ObjectId;
  tenantId: mongoose.Types.ObjectId;
  status: "online" | "away" | "offline";
  agentLevel: "agent" | "senior-agent" | "supervisor" | "management";
  ticketsAssigned: number;
  resolved: number;
  satisfaction: number;
  joinDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

const agentSchema = new Schema<IAgent>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["online", "away", "offline"],
      default: "offline",
    },
    agentLevel: {
      type: String,
      enum: ["agent", "senior-agent", "supervisor", "management"],
      default: "agent",
    },
    ticketsAssigned: {
      type: Number,
      default: 0,
    },
    resolved: {
      type: Number,
      default: 0,
    },
    satisfaction: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    joinDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

agentSchema.index({ tenantId: 1, status: 1 });

export const Agent = mongoose.model<IAgent>("Agent", agentSchema);

