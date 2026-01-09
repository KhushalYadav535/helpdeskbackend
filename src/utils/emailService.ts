import nodemailer, { Transporter, SendMailOptions } from "nodemailer";

interface EmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: Buffer | string;
  }>;
}

class EmailService {
  private transporter: Transporter;

  constructor() {
    // Create transporter
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.hostinger.com",
      port: parseInt(process.env.SMTP_PORT || "465"),
      secure: true, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER || "sdsiteadmin@sentientdigital.in",
        pass: process.env.SMTP_PASS || "Admin@sdsite2025",
      },
      tls: {
        rejectUnauthorized: false, // For self-signed certificates
      },
    });

    // Verify connection
    this.verifyConnection();
  }

  private async verifyConnection(): Promise<void> {
    try {
      await this.transporter.verify();
      console.log("✅ SMTP Server is ready to send emails");
    } catch (error: any) {
      console.error("❌ SMTP connection error:", error.message);
    }
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      const mailOptions: SendMailOptions = {
        from: `"${process.env.SMTP_FROM_NAME || "Sentient Digital"}" <${process.env.SMTP_FROM || "sdsiteadmin@sentientdigital.in"}>`,
        to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        cc: options.cc ? (Array.isArray(options.cc) ? options.cc.join(", ") : options.cc) : undefined,
        bcc: options.bcc ? (Array.isArray(options.bcc) ? options.bcc.join(", ") : options.bcc) : undefined,
        attachments: options.attachments,
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email sent: ${info.messageId}`);
      return true;
    } catch (error: any) {
      console.error(`❌ Email send error: ${error.message}`);
      return false;
    }
  }

  // Welcome email for new tenant
  async sendWelcomeEmail(to: string, name: string, companyName: string): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .button { display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to Helpdesk!</h1>
          </div>
          <div class="content">
            <h2>Hello ${name},</h2>
            <p>Welcome to our Helpdesk Management System! Your account has been successfully created for <strong>${companyName}</strong>.</p>
            <p>You can now:</p>
            <ul>
              <li>Access your tenant dashboard</li>
              <li>Manage your agents and customers</li>
              <li>Track and manage support tickets</li>
              <li>Configure webhook integrations</li>
            </ul>
            <p>Get started by logging in to your dashboard.</p>
            <p>If you have any questions, feel free to reach out to our support team.</p>
            <p>Best regards,<br>Sentient Digital Team</p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to,
      subject: `Welcome to Helpdesk - ${companyName}`,
      html,
    });
  }

  // Ticket created notification
  async sendTicketCreatedEmail(
    to: string | string[],
    ticketId: string,
    title: string,
    customerName: string,
    priority: string
  ): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .ticket-info { background: white; padding: 15px; border-radius: 5px; margin: 15px 0; }
          .priority { display: inline-block; padding: 5px 10px; border-radius: 3px; font-weight: bold; }
          .priority-critical { background: #dc2626; color: white; }
          .priority-high { background: #ea580c; color: white; }
          .priority-medium { background: #eab308; color: black; }
          .priority-low { background: #16a34a; color: white; }
          .button { display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>New Ticket Created</h1>
          </div>
          <div class="content">
            <h2>A new ticket has been created</h2>
            <div class="ticket-info">
              <p><strong>Ticket ID:</strong> ${ticketId}</p>
              <p><strong>Title:</strong> ${title}</p>
              <p><strong>Customer:</strong> ${customerName}</p>
              <p><strong>Priority:</strong> <span class="priority priority-${priority.toLowerCase()}">${priority}</span></p>
            </div>
            <p>Please review and respond to this ticket in your dashboard.</p>
            <p>Best regards,<br>Helpdesk System</p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to,
      subject: `New Ticket: ${ticketId} - ${title}`,
      html,
    });
  }

  // Ticket assigned notification
  async sendTicketAssignedEmail(
    to: string,
    agentName: string,
    ticketId: string,
    title: string,
    customerName: string
  ): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #16a34a; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .ticket-info { background: white; padding: 15px; border-radius: 5px; margin: 15px 0; }
          .button { display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Ticket Assigned to You</h1>
          </div>
          <div class="content">
            <h2>Hello ${agentName},</h2>
            <p>A new ticket has been assigned to you:</p>
            <div class="ticket-info">
              <p><strong>Ticket ID:</strong> ${ticketId}</p>
              <p><strong>Title:</strong> ${title}</p>
              <p><strong>Customer:</strong> ${customerName}</p>
            </div>
            <p>Please review and respond to this ticket in your dashboard.</p>
            <p>Best regards,<br>Helpdesk System</p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to,
      subject: `Ticket Assigned: ${ticketId}`,
      html,
    });
  }

  // Password reset email
  async sendPasswordResetEmail(to: string, name: string, resetToken: string, resetUrl: string): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #dc2626; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .button { display: inline-block; padding: 12px 24px; background: #dc2626; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .warning { background: #fef2f2; border-left: 4px solid #dc2626; padding: 10px; margin: 15px 0; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Reset Request</h1>
          </div>
          <div class="content">
            <h2>Hello ${name},</h2>
            <p>We received a request to reset your password. Click the button below to reset it:</p>
            <div style="text-align: center;">
              <a href="${resetUrl}" class="button">Reset Password</a>
            </div>
            <p>Or copy and paste this link in your browser:</p>
            <p style="word-break: break-all; color: #2563eb;">${resetUrl}</p>
            <div class="warning">
              <p><strong>⚠️ Security Notice:</strong></p>
              <p>This link will expire in 1 hour. If you didn't request this password reset, please ignore this email.</p>
            </div>
            <p>Best regards,<br>Sentient Digital Team</p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to,
      subject: "Password Reset Request - RezolvX",
      html,
    });
  }

  // Generic email sender
  async sendGenericEmail(to: string | string[], subject: string, message: string): Promise<boolean> {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${subject}</h1>
          </div>
          <div class="content">
            ${message.replace(/\n/g, "<br>")}
          </div>
          <div class="footer">
            <p>This is an automated email from Helpdesk System.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to,
      subject,
      html,
    });
  }
}

// Export singleton instance
export const emailService = new EmailService();

