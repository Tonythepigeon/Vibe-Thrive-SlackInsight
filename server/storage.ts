import { 
  users, integrations, meetings, productivityMetrics, breakSuggestions, 
  focusSessions, activityLogs, slackTeams,
  type User, type InsertUser, type Integration, type InsertIntegration,
  type Meeting, type InsertMeeting, type ProductivityMetrics, type InsertProductivityMetrics,
  type BreakSuggestion, type InsertBreakSuggestion, type FocusSession, type InsertFocusSession,
  type ActivityLog, type InsertActivityLog, type SlackTeam, type InsertSlackTeam
} from "@shared/schema";
import { db } from "./db";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserBySlackId(slackUserId: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<InsertUser>): Promise<User>;
  
  // Integrations
  getUserIntegrations(userId: string): Promise<Integration[]>;
  getIntegrationByType(userId: string, type: string): Promise<Integration | undefined>;
  createIntegration(integration: InsertIntegration): Promise<Integration>;
  updateIntegration(id: string, updates: Partial<InsertIntegration>): Promise<Integration>;
  deleteIntegration(id: string): Promise<void>;
  
  // Meetings
  getUserMeetings(userId: string, startDate?: Date, endDate?: Date): Promise<Meeting[]>;
  createMeeting(meeting: InsertMeeting): Promise<Meeting>;
  getMeetingsByDate(userId: string, date: Date): Promise<Meeting[]>;
  
  // Productivity Metrics
  getProductivityMetrics(userId: string, startDate: Date, endDate: Date): Promise<ProductivityMetrics[]>;
  createOrUpdateProductivityMetrics(metrics: InsertProductivityMetrics): Promise<ProductivityMetrics>;
  getAggregatedMetrics(startDate: Date, endDate: Date): Promise<any>;
  
  // Break Suggestions
  createBreakSuggestion(suggestion: InsertBreakSuggestion): Promise<BreakSuggestion>;
  getRecentBreakSuggestions(userId: string, hours: number): Promise<BreakSuggestion[]>;
  updateBreakSuggestion(id: string, updates: Partial<InsertBreakSuggestion>): Promise<BreakSuggestion>;
  
  // Focus Sessions
  createFocusSession(session: InsertFocusSession): Promise<FocusSession>;
  getActiveFocusSession(userId: string): Promise<FocusSession | undefined>;
  updateFocusSession(id: string, updates: Partial<InsertFocusSession>): Promise<FocusSession>;
  
  // Activity Logs
  logActivity(log: InsertActivityLog): Promise<ActivityLog>;
  getRecentActivity(limit: number): Promise<ActivityLog[]>;
  
  // Slack Teams
  getSlackTeam(slackTeamId: string): Promise<SlackTeam | undefined>;
  createSlackTeam(team: InsertSlackTeam): Promise<SlackTeam>;
  updateSlackTeam(slackTeamId: string, updates: Partial<InsertSlackTeam>): Promise<SlackTeam>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserBySlackId(slackUserId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.slackUserId, slackUserId));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: string, updates: Partial<InsertUser>): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ ...updates, updatedAt: sql`now()` })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getUserIntegrations(userId: string): Promise<Integration[]> {
    return await db.select().from(integrations).where(eq(integrations.userId, userId));
  }

  async getIntegrationByType(userId: string, type: string): Promise<Integration | undefined> {
    const [integration] = await db
      .select()
      .from(integrations)
      .where(and(eq(integrations.userId, userId), eq(integrations.type, type)));
    return integration || undefined;
  }

  async createIntegration(integration: InsertIntegration): Promise<Integration> {
    const [newIntegration] = await db.insert(integrations).values(integration).returning();
    return newIntegration;
  }

  async updateIntegration(id: string, updates: Partial<InsertIntegration>): Promise<Integration> {
    const [integration] = await db
      .update(integrations)
      .set({ ...updates, updatedAt: sql`now()` })
      .where(eq(integrations.id, id))
      .returning();
    return integration;
  }

  async deleteIntegration(id: string): Promise<void> {
    await db.delete(integrations).where(eq(integrations.id, id));
  }

  async getUserMeetings(userId: string, startDate?: Date, endDate?: Date): Promise<Meeting[]> {
    let conditions = [eq(meetings.userId, userId)];
    
    if (startDate && endDate) {
      conditions.push(gte(meetings.startTime, startDate));
      conditions.push(lte(meetings.startTime, endDate));
    }
    
    return await db
      .select()
      .from(meetings)
      .where(and(...conditions))
      .orderBy(desc(meetings.startTime));
  }

  async createMeeting(meeting: InsertMeeting): Promise<Meeting> {
    const [newMeeting] = await db.insert(meetings).values(meeting).returning();
    return newMeeting;
  }

  async getMeetingsByDate(userId: string, date: Date): Promise<Meeting[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return await db
      .select()
      .from(meetings)
      .where(
        and(
          eq(meetings.userId, userId),
          gte(meetings.startTime, startOfDay),
          lte(meetings.startTime, endOfDay)
        )
      )
      .orderBy(meetings.startTime);
  }

  async getProductivityMetrics(userId: string, startDate: Date, endDate: Date): Promise<ProductivityMetrics[]> {
    return await db
      .select()
      .from(productivityMetrics)
      .where(
        and(
          eq(productivityMetrics.userId, userId),
          gte(productivityMetrics.date, startDate),
          lte(productivityMetrics.date, endDate)
        )
      )
      .orderBy(productivityMetrics.date);
  }

  async createOrUpdateProductivityMetrics(metrics: InsertProductivityMetrics): Promise<ProductivityMetrics> {
    const existing = await db
      .select()
      .from(productivityMetrics)
      .where(
        and(
          eq(productivityMetrics.userId, metrics.userId),
          eq(productivityMetrics.date, metrics.date)
        )
      );

    if (existing.length > 0) {
      const [updated] = await db
        .update(productivityMetrics)
        .set(metrics)
        .where(eq(productivityMetrics.id, existing[0].id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(productivityMetrics).values(metrics).returning();
      return created;
    }
  }

  async getAggregatedMetrics(startDate: Date, endDate: Date): Promise<any> {
    const result = await db
      .select({
        totalUsers: sql<number>`count(distinct ${productivityMetrics.userId})`,
        totalMeetingTime: sql<number>`sum(${productivityMetrics.totalMeetingTime})`,
        totalMeetings: sql<number>`sum(${productivityMetrics.meetingCount})`,
        totalBreaksSuggested: sql<number>`sum(${productivityMetrics.breaksSuggested})`,
        totalFocusSessions: sql<number>`sum(${productivityMetrics.focusSessionsStarted})`,
      })
      .from(productivityMetrics)
      .where(
        and(
          gte(productivityMetrics.date, startDate),
          lte(productivityMetrics.date, endDate)
        )
      );

    return result[0];
  }

  async createBreakSuggestion(suggestion: InsertBreakSuggestion): Promise<BreakSuggestion> {
    const [newSuggestion] = await db.insert(breakSuggestions).values(suggestion).returning();
    return newSuggestion;
  }

  async getRecentBreakSuggestions(userId: string, hours: number): Promise<BreakSuggestion[]> {
    const hoursAgo = new Date(Date.now() - hours * 60 * 60 * 1000);
    return await db
      .select()
      .from(breakSuggestions)
      .where(
        and(
          eq(breakSuggestions.userId, userId),
          gte(breakSuggestions.suggestedAt, hoursAgo)
        )
      )
      .orderBy(desc(breakSuggestions.suggestedAt));
  }

  async updateBreakSuggestion(id: string, updates: Partial<InsertBreakSuggestion>): Promise<BreakSuggestion> {
    const [updated] = await db
      .update(breakSuggestions)
      .set(updates)
      .where(eq(breakSuggestions.id, id))
      .returning();
    return updated;
  }

  async createFocusSession(session: InsertFocusSession): Promise<FocusSession> {
    const [newSession] = await db.insert(focusSessions).values(session).returning();
    return newSession;
  }

  async getActiveFocusSession(userId: string): Promise<FocusSession | undefined> {
    const [session] = await db
      .select()
      .from(focusSessions)
      .where(
        and(
          eq(focusSessions.userId, userId),
          eq(focusSessions.status, "active")
        )
      );
    return session || undefined;
  }

  async updateFocusSession(id: string, updates: Partial<InsertFocusSession>): Promise<FocusSession> {
    const [updated] = await db
      .update(focusSessions)
      .set(updates)
      .where(eq(focusSessions.id, id))
      .returning();
    return updated;
  }

  async logActivity(log: InsertActivityLog): Promise<ActivityLog> {
    const [newLog] = await db.insert(activityLogs).values(log).returning();
    return newLog;
  }

  async getRecentActivity(limit: number): Promise<ActivityLog[]> {
    return await db
      .select()
      .from(activityLogs)
      .orderBy(desc(activityLogs.timestamp))
      .limit(limit);
  }

  async getSlackTeam(slackTeamId: string): Promise<SlackTeam | undefined> {
    const [team] = await db
      .select()
      .from(slackTeams)
      .where(eq(slackTeams.slackTeamId, slackTeamId));
    return team || undefined;
  }

  async createSlackTeam(team: InsertSlackTeam): Promise<SlackTeam> {
    const [newTeam] = await db.insert(slackTeams).values(team).returning();
    return newTeam;
  }

  async updateSlackTeam(slackTeamId: string, updates: Partial<InsertSlackTeam>): Promise<SlackTeam> {
    const [updated] = await db
      .update(slackTeams)
      .set(updates)
      .where(eq(slackTeams.slackTeamId, slackTeamId))
      .returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
