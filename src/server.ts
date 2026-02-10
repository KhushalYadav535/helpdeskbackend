// Load environment variables FIRST before any other imports
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import express, { Application, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { connectDB } from "./config/database";
import { errorHandler } from "./middleware/errorHandler";

// Import routes
import authRoutes from "./routes/auth";
import ticketRoutes from "./routes/tickets";
import tenantRoutes from "./routes/tenants";
import agentRoutes from "./routes/agents";
import customerRoutes from "./routes/customers";
import analyticsRoutes from "./routes/analytics";
import webhookRoutes from "./routes/webhooks";
import emailRoutes from "./routes/email";
import commentRoutes from "./routes/comments";
import leadRoutes from "./routes/leads";

// Create Express app
const app: Application = express();
const PORT = process.env.PORT || 4000;

// Connect to MongoDB
connectDB();

// Security middleware
app.use(helmet());

// CORS configuration - Allow all origins (use with care in production)
app.use(
  cors({
    origin: true, // Reflects the request origin, effectively allowing all
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000"), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100"), // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});

// Apply rate limiting to API routes
app.use("/api/", limiter);

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Health check route
app.get("/health", (req: Request, res: Response) => {
  res.json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/tenants", tenantRoutes);
app.use("/api/agents", agentRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/leads", leadRoutes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
});

// Error handler middleware (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV || "development"} mode`);
});

export default app;

