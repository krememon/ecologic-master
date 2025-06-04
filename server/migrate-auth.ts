import { db } from "./db";
import { sql } from "drizzle-orm";

export async function migrateToEmailAuth() {
  try {
    console.log("Starting migration to email authentication...");
    
    // Add new columns to existing users table without changing existing structure
    await db.execute(sql`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS password VARCHAR(255),
      ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(255),
      ADD COLUMN IF NOT EXISTS reset_password_token VARCHAR(255),
      ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMP,
      ADD COLUMN IF NOT EXISTS provider VARCHAR(50) DEFAULT 'replit',
      ADD COLUMN IF NOT EXISTS provider_id VARCHAR(255)
    `);
    
    // Update existing users to mark them as verified (since they came from Replit auth)
    await db.execute(sql`
      UPDATE users 
      SET email_verified = TRUE, provider = 'replit', provider_id = id 
      WHERE email_verified IS NULL
    `);
    
    console.log("Migration completed successfully!");
    return true;
  } catch (error) {
    console.error("Migration failed:", error);
    return false;
  }
}