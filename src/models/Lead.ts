import mongoose, { Document, Schema } from "mongoose";

export interface ILead extends Document {
  leadId: string;
  source: "zoronal" | "web" | "phone" | "whatsapp" | "email" | "other";
  type: "sales-lead" | "service-request" | "support" | "other";
  status: "new" | "contacted" | "qualified" | "converted" | "lost" | "closed";
  
  // Call/Contact Information
  callerName?: string;
  callerPhone?: string;
  callerEmail?: string;
  calledNumber?: string; // Business number that was called
  callDuration?: number; // in seconds
  callRecordingUrl?: string;
  callTranscript?: string;
  callTimestamp?: Date;
  
  // Zoronal Specific Data
  zoronalCallId?: string;
  zoronalData?: Record<string, any>; // Store complete Zoronal webhook payload
  
  // Analysis Results
  analysisResult?: {
    category: string;
    confidence: number;
    keywords: string[];
    sentiment?: "positive" | "neutral" | "negative";
    intent?: string;
    suggestedAction?: string;
  };
  
  // CRM Integration
  crmLeadId?: string;
  crmStatus?: string;
  
  // HelpDesk Integration
  ticketId?: mongoose.Types.ObjectId;
  ticketCreated?: boolean;
  
  // Tenant & Assignment
  tenantId: mongoose.Types.ObjectId;
  assignedTo?: mongoose.Types.ObjectId; // User ID
  assignedAt?: Date;
  
  // Additional Metadata
  metadata?: Record<string, any>;
  notes?: string;
  
  // Timestamps
  created: Date;
  updated: Date;
  createdAt: Date;
  updatedAt: Date;
}

const leadSchema = new Schema<ILead>(
  {
    leadId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    source: {
      type: String,
      enum: ["zoronal", "web", "phone", "whatsapp", "email", "other"],
      required: true,
      default: "zoronal",
    },
    type: {
      type: String,
      enum: ["sales-lead", "service-request", "support", "other"],
      default: "other",
    },
    status: {
      type: String,
      enum: ["new", "contacted", "qualified", "converted", "lost", "closed"],
      default: "new",
    },
    callerName: {
      type: String,
      trim: true,
    },
    callerPhone: {
      type: String,
      trim: true,
      index: true,
    },
    callerEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    calledNumber: {
      type: String,
      trim: true,
    },
    callDuration: {
      type: Number,
      default: 0,
    },
    callRecordingUrl: {
      type: String,
    },
    callTranscript: {
      type: String,
    },
    callTimestamp: {
      type: Date,
      default: Date.now,
    },
    zoronalCallId: {
      type: String,
      index: true,
    },
    zoronalData: {
      type: Schema.Types.Mixed,
      default: {},
    },
    analysisResult: {
      category: String,
      confidence: Number,
      keywords: [String],
      sentiment: {
        type: String,
        enum: ["positive", "neutral", "negative"],
      },
      intent: String,
      suggestedAction: String,
    },
    crmLeadId: {
      type: String,
    },
    crmStatus: {
      type: String,
    },
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "Ticket",
    },
    ticketCreated: {
      type: Boolean,
      default: false,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    assignedAt: {
      type: Date,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    notes: {
      type: String,
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

// Generate lead ID before validation
leadSchema.pre("validate", async function (next) {
  if (!this.leadId) {
    const count = await mongoose.model("Lead").countDocuments();
    this.leadId = `LEAD-${String(count + 1000).padStart(4, "0")}`;
  }
  this.updated = new Date();
  next();
});

// Indexes for better query performance (zoronalCallId & callerPhone already have index: true above)
leadSchema.index({ tenantId: 1, status: 1 });
leadSchema.index({ tenantId: 1, type: 1 });
leadSchema.index({ tenantId: 1, source: 1 });
leadSchema.index({ assignedTo: 1 });

export const Lead = mongoose.model<ILead>("Lead", leadSchema);

