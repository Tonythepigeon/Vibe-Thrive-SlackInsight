import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

// Make database connection lazy - only connect when actually needed
let pool: Pool;
let db: ReturnType<typeof drizzle>;

function getDbConnection() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle({ client: pool, schema });
  }
  
  return db;
}

// Export lazy-initialized database connection
export { getDbConnection as db };

// Initialize database tables if they don't exist
export async function initializeDatabase() {
  try {
    console.log("Initializing database tables...");
    
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    
    // Get fresh connection for initialization
    const tempPool = new Pool({ connectionString: process.env.DATABASE_URL });
    
    // Create tables using raw SQL since we don't have migration files
    await tempPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slack_user_id TEXT,
        slack_team_id TEXT,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        timezone TEXT DEFAULT 'America/New_York',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS slack_teams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slack_team_id TEXT UNIQUE NOT NULL,
        team_name TEXT NOT NULL,
        bot_token TEXT NOT NULL,
        bot_user_id TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS integrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        expires_at TIMESTAMP,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS meetings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        duration INTEGER NOT NULL,
        attendee_count INTEGER DEFAULT 1,
        meeting_type TEXT DEFAULT 'scheduled',
        source TEXT NOT NULL,
        external_id TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS productivity_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        total_meeting_time INTEGER DEFAULT 0,
        meeting_count INTEGER DEFAULT 0,
        focus_time INTEGER DEFAULT 0,
        breaks_suggested INTEGER DEFAULT 0,
        breaks_accepted INTEGER DEFAULT 0,
        focus_sessions_started INTEGER DEFAULT 0,
        focus_sessions_completed INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, date)
      );

      CREATE TABLE IF NOT EXISTS break_suggestions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        reason TEXT NOT NULL,
        accepted BOOLEAN DEFAULT FALSE,
        suggested_at TIMESTAMP DEFAULT NOW(),
        accepted_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS focus_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        duration INTEGER NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP,
        status TEXT DEFAULT 'active',
        slack_status_set BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS activity_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        details JSONB DEFAULT '{}',
        timestamp TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_users_slack_user_id ON users(slack_user_id);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_meetings_user_date ON meetings(user_id, start_time);
      CREATE INDEX IF NOT EXISTS idx_productivity_metrics_user_date ON productivity_metrics(user_id, date);
      CREATE INDEX IF NOT EXISTS idx_break_suggestions_user ON break_suggestions(user_id, suggested_at);
      CREATE INDEX IF NOT EXISTS idx_focus_sessions_user ON focus_sessions(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id, timestamp);
    `);
    
    await tempPool.end(); // Close the temporary connection
    
    console.log("Database tables initialized successfully!");
  } catch (error) {
    console.error("Failed to initialize database:", error);
    throw error;
  }
}