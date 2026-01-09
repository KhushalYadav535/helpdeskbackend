import mongoose, { Document, Schema } from "mongoose";

export interface ITicket extends Document {
  ticketId: string;
  title: string;
  description: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  status: "Open" | "In Progress" | "Resolved" | "Closed";
  category: "general" | "technical" | "billing" | "feature" | "bug" | "account";
  tenantId: mongoose.Types.ObjectId;
  agentId?: mongoose.Types.ObjectId;
  customerId?: mongoose.Types.ObjectId;
  customer: string;
  customerEmail?: string;
  customerPhone?: string;
  source: "web" | "whatsapp" | "telegram" | "phone" | "contact-form" | "chatbot" | "email" | "walk-in";
  channel: string;
  responses: number;
  metadata?: Record<string, any>;
  resolvedBy?: mongoose.Types.ObjectId;
  resolvedAt?: Date;
  assignedAt?: Date;
  created: Date;
  updated: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ticketSchema = new Schema<ITicket>(
  {
    ticketId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
    },
    description: {
      type: String,
      required: [true, "Description is required"],
    },
    priority: {
      type: String,
      enum: ["Critical", "High", "Medium", "Low"],
      default: "Medium",
    },
    status: {
      type: String,
      enum: ["Open", "In Progress", "Resolved", "Closed"],
      default: "Open",
    },
    category: {
      type: String,
      enum: ["general", "technical", "billing", "feature", "bug", "account"],
      default: "general",
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    agentId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
    },
    customer: {
      type: String,
      required: true,
      trim: true,
    },
    customerEmail: {
      type: String,
      trim: true,
    },
    customerPhone: {
      type: String,
      trim: true,
    },
    source: {
      type: String,
      enum: ["web", "whatsapp", "telegram", "phone", "contact-form", "chatbot", "email", "walk-in"],
      default: "web",
    },
    channel: {
      type: String,
      default: "web",
    },
    responses: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    resolvedAt: {
      type: Date,
    },
    assignedAt: {
      type: Date,
    },
    created: {
      type: Date,
      default: Date.now,
    },
    updated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Generate ticket ID before validation so required passes
ticketSchema.pre("validate", async function (next) {
  if (!this.ticketId) {
    const count = await mongoose.model("Ticket").countDocuments();
    this.ticketId = `TKT-${String(count + 1000).padStart(4, "0")}`;
  }
  this.updated = new Date();
  next();
});

// Indexes for better query performance
ticketSchema.index({ tenantId: 1, status: 1 });
ticketSchema.index({ tenantId: 1, priority: 1 });
ticketSchema.index({ agentId: 1, status: 1 });

export const Ticket = mongoose.model<ITicket>("Ticket", ticketSchema);

