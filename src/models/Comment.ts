import mongoose, { Document, Schema } from "mongoose";

export interface IComment extends Document {
  ticketId: mongoose.Types.ObjectId;
  author: string;
  authorId: mongoose.Types.ObjectId;
  role: "Agent" | "Customer" | "System";
  text: string;
  attachments: string[];
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const commentSchema = new Schema<IComment>(
  {
    ticketId: {
      type: Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      index: true,
    },
    author: {
      type: String,
      required: true,
    },
    authorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["Agent", "Customer", "System"],
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    attachments: {
      type: [String],
      default: [],
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

export const Comment = mongoose.model<IComment>("Comment", commentSchema);

