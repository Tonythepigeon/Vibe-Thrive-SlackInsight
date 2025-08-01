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
    try {
      // Add connection timeout and other optimizations
      pool = new Pool({ 
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 5000, // 5 second connection timeout
        idleTimeoutMillis: 30000, // 30 second idle timeout
        max: 10, // max 10 connections
      });
      db = drizzle({ client: pool, schema });
    } catch (error) {
      console.error("Failed to create database pool:", error);
      throw error;
    }
  }
  
  return db;
}

// Export lazy-initialized database connection
export { getDbConnection as db };

// Initialize database tables with comprehensive error handling
export async function initializeDatabase() {
  try {
    console.log("Initializing database tables...");
    
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set");
    }
    
    // Use a very short timeout to avoid the Neon client bug
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Database initialization timeout')), 5000);
    });

    // Race between database initialization and timeout
    await Promise.race([
      initializeDatabaseTables(),
      timeoutPromise
    ]);
    
    console.log("Database tables initialized successfully!");
  } catch (error) {
    console.error("Failed to initialize database:", error);
    // Don't re-throw the error - let the app continue in offline mode
  }
}

async function initializeDatabaseTables() {
  let tempPool: Pool | null = null;
  
  try {
    // Get fresh connection for initialization with very conservative timeouts
    tempPool = new Pool({ 
      connectionString: process.env.DATABASE_URL!,
      connectionTimeoutMillis: 3000, // Even shorter timeout
      max: 1, // Only one connection for initialization
    });
    
    // Add error handlers to prevent crashes
    tempPool.on('error', (err) => {
      console.error('Database pool error during initialization:', err);
    });
    
    // Create tables using raw SQL since we don't have migration files
    await tempPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        slack_user_id TEXT UNIQUE,
        slack_team_id TEXT,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        timezone TEXT DEFAULT 'UTC',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS slack_teams (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        slack_team_id TEXT UNIQUE NOT NULL,
        team_name TEXT NOT NULL,
        bot_token TEXT,
        bot_user_id TEXT,
        installed_at TIMESTAMP DEFAULT NOW(),
        is_active BOOLEAN DEFAULT TRUE
      );

      CREATE TABLE IF NOT EXISTS integrations (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        expires_at TIMESTAMP,
        metadata JSONB,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS meetings (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
        external_id TEXT,
        title TEXT,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        duration INTEGER,
        attendees JSONB,
        source TEXT NOT NULL,
        meeting_type TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS productivity_metrics (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
        date TIMESTAMP NOT NULL,
        total_meeting_time INTEGER DEFAULT 0,
        meeting_count INTEGER DEFAULT 0,
        focus_time INTEGER DEFAULT 0,
        breaks_suggested INTEGER DEFAULT 0,
        breaks_accepted INTEGER DEFAULT 0,
        focus_sessions_started INTEGER DEFAULT 0,
        focus_sessions_completed INTEGER DEFAULT 0,
        back_to_back_meetings INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS break_suggestions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        reason TEXT,
        accepted BOOLEAN DEFAULT FALSE,
        suggested_at TIMESTAMP DEFAULT NOW(),
        accepted_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS focus_sessions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
        duration INTEGER NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP,
        status TEXT DEFAULT 'active',
        slack_status_set BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS activity_logs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR REFERENCES users(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        details JSONB,
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
    
    // Fix existing tables that might be missing new columns
    try {
      await tempPool.query(`
        DO $$ 
        BEGIN 
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='slack_teams' AND column_name='installed_at') THEN
            ALTER TABLE slack_teams ADD COLUMN installed_at TIMESTAMP DEFAULT NOW();
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='slack_teams' AND column_name='is_active') THEN
            ALTER TABLE slack_teams ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='integrations' AND column_name='metadata') THEN
            ALTER TABLE integrations ADD COLUMN metadata JSONB;
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='integrations' AND column_name='is_active') THEN
            ALTER TABLE integrations ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
          END IF;
        END $$;
      `);
      console.log("Applied schema fixes for existing tables");
    } catch (schemaError) {
      console.error("Schema fix error (non-critical):", schemaError);
    }
  } catch (error) {
    console.error("Error during table creation:", error);
    throw error;
  } finally {
    // Always try to close the connection, but don't let errors here crash the app
    if (tempPool) {
      try {
        await tempPool.end();
      } catch (endError) {
        console.error("Error closing temporary database connection:", endError);
      }
    }
  }
}