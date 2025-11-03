import mongoose from "mongoose";

// URL encode password to handle special characters
const encodePassword = (password: string): string => {
  return encodeURIComponent(password);
};

export const connectDB = async (): Promise<void> => {
  try {
    // Get MongoDB URI from environment
    let mongoURI = process.env.MONGODB_URI;

    // If URI contains placeholder, replace it with encoded password
    if (mongoURI?.includes("<db_password>")) {
      const password = process.env.DB_PASSWORD || "Khus1234@";
      const encodedPassword = encodePassword(password);
      mongoURI = mongoURI.replace("<db_password>", encodedPassword);
    }

    // Fallback: Build connection string with encoded password
    if (!mongoURI) {
      const password = "Khus1234@";
      const encodedPassword = encodePassword(password);
      mongoURI = `mongodb+srv://helpdesk:${encodedPassword}@helpdesk.7fpanbz.mongodb.net/?appName=helpdesk`;
    } else {
      // If URI exists, check if password needs encoding
      // Extract password from connection string
      const uriMatch = mongoURI.match(/mongodb\+srv:\/\/([^:]+):([^@]+)@/);
      if (uriMatch) {
        const username = uriMatch[1];
        let passwordPart = uriMatch[2];
        
        // Try to decode to see if it's already encoded
        let decodedPassword: string;
        try {
          decodedPassword = decodeURIComponent(passwordPart);
        } catch {
          // If decode fails, assume it's already encoded or plain text
          decodedPassword = passwordPart;
        }
        
        // If decoded password contains special chars (meaning it's not encoded), encode it
        if (decodedPassword.includes("@") || decodedPassword.includes(":") || decodedPassword.includes("%")) {
          // If it contains @ or : and is not already encoded (%40), encode it
          if (!passwordPart.includes("%40") && !passwordPart.includes("%3A")) {
            const encodedPassword = encodePassword(decodedPassword);
            mongoURI = mongoURI.replace(
              /mongodb\+srv:\/\/[^:]+:[^@]+@/,
              `mongodb+srv://${username}:${encodedPassword}@`
            );
          }
        }
      }
    }

    if (!mongoURI) {
      throw new Error("MONGODB_URI is not defined in environment variables");
    }

    console.log(`🔌 Connecting to MongoDB...`);
    // Don't log full URI with password for security
    console.log(`📡 Connection string: mongodb+srv://helpdesk:***@helpdesk.7fpanbz.mongodb.net/`);
    
    const conn = await mongoose.connect(mongoURI);

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database: ${conn.connection.name}`);
  } catch (error: any) {
    console.error(`❌ Error connecting to MongoDB: ${error.message}`);
    
    // Provide helpful error messages
    if (error.message.includes("authentication failed") || error.message.includes("bad auth")) {
      console.error(`💡 Tip: Check if username and password are correct`);
      console.error(`💡 Tip: Password special characters should be URL encoded (@ = %40)`);
    }
    
    process.exit(1);
  }
};

// Handle connection events
mongoose.connection.on("disconnected", () => {
  console.log("⚠️ MongoDB disconnected");
});

mongoose.connection.on("error", (error) => {
  console.error(`❌ MongoDB connection error: ${error.message}`);
});

