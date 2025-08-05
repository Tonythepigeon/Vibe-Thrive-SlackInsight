import { 
  users, integrations, meetings, productivityMetrics, breakSuggestions, 
  focusSessions, activityLogs, slackTeams, waterIntake, waterGoals, waterReminders,
  type User, type InsertUser, type Integration, type InsertIntegration,
  type Meeting, type InsertMeeting, type ProductivityMetrics, type InsertProductivityMetrics,
  type BreakSuggestion, type InsertBreakSuggestion, type FocusSession, type InsertFocusSession,
  type ActivityLog, type InsertActivityLog, type SlackTeam, type InsertSlackTeam,
  type WaterIntake, type InsertWaterIntake, type WaterGoal, type InsertWaterGoal,
  type WaterReminder, type InsertWaterReminder
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
  
  // Water Tracking
  logWaterIntake(userId: string, glasses: number, date: Date): Promise<WaterIntake>;
  getTodayWaterProgress(userId: string): Promise<{ totalGlasses: number; goal: number; percentage: number }>;
  setWaterGoal(userId: string, goal: number): Promise<WaterGoal>;
  getWeeklyWaterStats(userId: string): Promise<{ 
    totalGlasses: number; 
    averagePerDay: number; 
    goalsMet: number; 
    daysTracked: number; 
    maxGlasses: number 
  }>;
  getWaterStreak(userId: string): Promise<number>;
  setWaterReminders(userId: string, intervalMinutes: number): Promise<WaterReminder>;
}

export class DatabaseStorage implements IStorage {
  private getDb() {
    try {
      return db();
    } catch (error) {
      console.error("Database connection error:", error);
      throw new Error("Database unavailable");
    }
  }

  async getUser(id: string): Promise<User | undefined> {
    try {
      const [user] = await this.getDb().select().from(users).where(eq(users.id, id));
      return user || undefined;
    } catch (error) {
      console.error("Failed to get user:", error);
      return undefined;
    }
  }

  async getUserBySlackId(slackUserId: string): Promise<User | undefined> {
    try {
      const [user] = await this.getDb().select().from(users).where(eq(users.slackUserId, slackUserId));
      return user || undefined;
    } catch (error) {
      console.error("Failed to get user by Slack ID:", error);
      return undefined;
    }
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    try {
      const [user] = await this.getDb().select().from(users).where(eq(users.email, email));
      return user || undefined;
    } catch (error) {
      console.error("Failed to get user by email:", error);
      return undefined;
    }
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    try {
      const [user] = await this.getDb().insert(users).values(insertUser).returning();
      return user;
    } catch (error) {
      console.error("Failed to create user:", error);
      throw error;
    }
  }

  async updateUser(id: string, updates: Partial<InsertUser>): Promise<User> {
    try {
      const [user] = await this.getDb()
        .update(users)
        .set({ ...updates, updatedAt: sql`now()` })
        .where(eq(users.id, id))
        .returning();
      return user;
    } catch (error) {
      console.error("Failed to update user:", error);
      throw error;
    }
  }

  async getUserIntegrations(userId: string): Promise<Integration[]> {
    try {
      return await this.getDb().select().from(integrations).where(eq(integrations.userId, userId));
    } catch (error) {
      console.error("Failed to get user integrations:", error);
      return [];
    }
  }

  async getIntegrationByType(userId: string, type: string): Promise<Integration | undefined> {
    try {
      const [integration] = await this.getDb()
        .select()
        .from(integrations)
        .where(and(eq(integrations.userId, userId), eq(integrations.type, type)));
      return integration || undefined;
    } catch (error) {
      console.error("Failed to get integration by type:", error);
      return undefined;
    }
  }

  async createIntegration(integration: InsertIntegration): Promise<Integration> {
    try {
      const [newIntegration] = await this.getDb().insert(integrations).values(integration).returning();
      return newIntegration;
    } catch (error) {
      console.error("Failed to create integration:", error);
      throw error;
    }
  }

  async updateIntegration(id: string, updates: Partial<InsertIntegration>): Promise<Integration> {
    try {
      const [integration] = await this.getDb()
        .update(integrations)
        .set({ ...updates, updatedAt: sql`now()` })
        .where(eq(integrations.id, id))
        .returning();
      return integration;
    } catch (error) {
      console.error("Failed to update integration:", error);
      throw error;
    }
  }

  async deleteIntegration(id: string): Promise<void> {
    try {
      await this.getDb().delete(integrations).where(eq(integrations.id, id));
    } catch (error) {
      console.error("Failed to delete integration:", error);
      throw error;
    }
  }

  async getUserMeetings(userId: string, startDate?: Date, endDate?: Date): Promise<Meeting[]> {
    try {
      let conditions = [eq(meetings.userId, userId)];
      
      if (startDate && endDate) {
        conditions.push(gte(meetings.startTime, startDate));
        conditions.push(lte(meetings.startTime, endDate));
      }
      
      return await this.getDb()
        .select()
        .from(meetings)
        .where(and(...conditions))
        .orderBy(desc(meetings.startTime));
    } catch (error) {
      console.error("Failed to get user meetings:", error);
      return [];
    }
  }

  async createMeeting(meeting: InsertMeeting): Promise<Meeting> {
    try {
      const [newMeeting] = await this.getDb().insert(meetings).values(meeting).returning();
      return newMeeting;
    } catch (error) {
      console.error("Failed to create meeting:", error);
      throw error;
    }
  }

  async getMeetingsByDate(userId: string, date: Date): Promise<Meeting[]> {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      return await this.getDb()
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
    } catch (error) {
      console.error("Failed to get meetings by date:", error);
      return [];
    }
  }

  async getProductivityMetrics(userId: string, startDate: Date, endDate: Date): Promise<ProductivityMetrics[]> {
    try {
      return await this.getDb()
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
    } catch (error) {
      console.error("Failed to get productivity metrics:", error);
      return [];
    }
  }

  async createOrUpdateProductivityMetrics(metrics: InsertProductivityMetrics): Promise<ProductivityMetrics> {
    try {
      const existing = await this.getDb()
        .select()
        .from(productivityMetrics)
        .where(
          and(
            eq(productivityMetrics.userId, metrics.userId),
            eq(productivityMetrics.date, metrics.date)
          )
        );

      if (existing.length > 0) {
        const [updated] = await this.getDb()
          .update(productivityMetrics)
          .set(metrics)
          .where(eq(productivityMetrics.id, existing[0].id))
          .returning();
        return updated;
      } else {
        const [created] = await this.getDb().insert(productivityMetrics).values(metrics).returning();
        return created;
      }
    } catch (error) {
      console.error("Failed to create or update productivity metrics:", error);
      throw error;
    }
  }

  async getAggregatedMetrics(startDate: Date, endDate: Date): Promise<any> {
    try {
      const result = await this.getDb()
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
    } catch (error) {
      console.error("Failed to get aggregated metrics:", error);
      return null;
    }
  }

  async createBreakSuggestion(suggestion: InsertBreakSuggestion): Promise<BreakSuggestion> {
    try {
      const [newSuggestion] = await this.getDb().insert(breakSuggestions).values(suggestion).returning();
      return newSuggestion;
    } catch (error) {
      console.error("Failed to create break suggestion:", error);
      throw error;
    }
  }

  async getRecentBreakSuggestions(userId: string, hours: number): Promise<BreakSuggestion[]> {
    try {
      const hoursAgo = new Date(Date.now() - hours * 60 * 60 * 1000);
      return await this.getDb()
        .select()
        .from(breakSuggestions)
        .where(
          and(
            eq(breakSuggestions.userId, userId),
            gte(breakSuggestions.suggestedAt, hoursAgo)
          )
        )
        .orderBy(desc(breakSuggestions.suggestedAt));
    } catch (error) {
      console.error("Failed to get recent break suggestions:", error);
      return [];
    }
  }

  async updateBreakSuggestion(id: string, updates: Partial<InsertBreakSuggestion>): Promise<BreakSuggestion> {
    try {
      const [updated] = await this.getDb()
        .update(breakSuggestions)
        .set(updates)
        .where(eq(breakSuggestions.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error("Failed to update break suggestion:", error);
      throw error;
    }
  }

  async createFocusSession(session: InsertFocusSession): Promise<FocusSession> {
    try {
      const [newSession] = await this.getDb().insert(focusSessions).values(session).returning();
      return newSession;
    } catch (error) {
      console.error("Failed to create focus session:", error);
      throw error;
    }
  }

  async getActiveFocusSession(userId: string): Promise<FocusSession | undefined> {
    try {
      const [session] = await this.getDb()
        .select()
        .from(focusSessions)
        .where(
          and(
            eq(focusSessions.userId, userId),
            eq(focusSessions.status, "active")
          )
        );
      return session || undefined;
    } catch (error) {
      console.error("Failed to get active focus session:", error);
      return undefined;
    }
  }

  async updateFocusSession(id: string, updates: Partial<InsertFocusSession>): Promise<FocusSession> {
    try {
      const [updated] = await this.getDb()
        .update(focusSessions)
        .set(updates)
        .where(eq(focusSessions.id, id))
        .returning();
      return updated;
    } catch (error) {
      console.error("Failed to update focus session:", error);
      throw error;
    }
  }

  async logActivity(log: InsertActivityLog): Promise<ActivityLog> {
    try {
      const [newLog] = await this.getDb().insert(activityLogs).values(log).returning();
      return newLog;
    } catch (error) {
      console.error("Failed to log activity:", error);
      throw error;
    }
  }

  async getRecentActivity(limit: number): Promise<ActivityLog[]> {
    try {
      return await this.getDb()
        .select()
        .from(activityLogs)
        .orderBy(desc(activityLogs.timestamp))
        .limit(limit);
    } catch (error) {
      console.error("Failed to get recent activity:", error);
      return [];
    }
  }

  async getSlackTeam(slackTeamId: string): Promise<SlackTeam | undefined> {
    try {
      const [team] = await this.getDb()
        .select()
        .from(slackTeams)
        .where(eq(slackTeams.slackTeamId, slackTeamId));
      return team || undefined;
    } catch (error) {
      console.error("Failed to get slack team:", error);
      return undefined;
    }
  }

  async createSlackTeam(team: InsertSlackTeam): Promise<SlackTeam> {
    try {
      const [newTeam] = await this.getDb().insert(slackTeams).values(team).returning();
      return newTeam;
    } catch (error) {
      console.error("Failed to create slack team:", error);
      throw error;
    }
  }

  async updateSlackTeam(slackTeamId: string, updates: Partial<InsertSlackTeam>): Promise<SlackTeam> {
    try {
      const [updated] = await this.getDb()
        .update(slackTeams)
        .set(updates)
        .where(eq(slackTeams.slackTeamId, slackTeamId))
        .returning();
      return updated;
    } catch (error) {
      console.error("Failed to update slack team:", error);
      throw error;
    }
  }

  // Clear focus sessions for a user (for demo purposes)
  async clearUserFocusSessions(userId: string): Promise<void> {
    try {
      await this.getDb().delete(focusSessions).where(eq(focusSessions.userId, userId));
    } catch (error) {
      console.error("Failed to clear focus sessions:", error);
      throw error;
    }
  }

  // Clear break suggestions for a user (for demo purposes)
  async clearUserBreakSuggestions(userId: string): Promise<void> {
    try {
      await this.getDb().delete(breakSuggestions).where(eq(breakSuggestions.userId, userId));
    } catch (error) {
      console.error("Failed to clear break suggestions:", error);
      throw error;
    }
  }

  // Get focus sessions for a user within a date range
  async getFocusSessionsByDateRange(userId: string, startDate: Date, endDate: Date): Promise<FocusSession[]> {
    try {
      return await this.getDb()
        .select()
        .from(focusSessions)
        .where(
          and(
            eq(focusSessions.userId, userId),
            gte(focusSessions.startTime, startDate),
            lte(focusSessions.startTime, endDate)
          )
        )
        .orderBy(focusSessions.startTime);
    } catch (error) {
      console.error("Failed to get focus sessions:", error);
      return [];
    }
  }

  // Get focus sessions for a specific date
  async getFocusSessionsByDate(userId: string, date: Date): Promise<FocusSession[]> {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      
      return await this.getFocusSessionsByDateRange(userId, startOfDay, endOfDay);
    } catch (error) {
      console.error("Failed to get focus sessions by date:", error);
      return [];
    }
  }

  // Clear productivity metrics for a user (for demo purposes)
  async clearUserProductivityMetrics(userId: string): Promise<void> {
    try {
      await this.getDb().delete(productivityMetrics).where(eq(productivityMetrics.userId, userId));
    } catch (error) {
      console.error("Failed to clear productivity metrics:", error);
      throw error;
    }
  }

  // Clear all meetings for a user (for demo purposes)
  async clearUserMeetings(userId: string): Promise<void> {
    try {
      await this.getDb().delete(meetings).where(eq(meetings.userId, userId));
    } catch (error) {
      console.error("Failed to clear meetings:", error);
      throw error;
    }
  }

  // Update a meeting (for demo time skipping)
  async updateMeeting(meetingId: string, updates: Partial<InsertMeeting>): Promise<Meeting> {
    try {
      const [updated] = await this.getDb()
        .update(meetings)
        .set(updates)
        .where(eq(meetings.id, meetingId))
        .returning();
      return updated;
    } catch (error) {
      console.error("Failed to update meeting:", error);
      throw error;
    }
  }

  // Water Tracking Methods
  async logWaterIntake(userId: string, glasses: number, date: Date): Promise<WaterIntake> {
    try {
      const [intake] = await this.getDb()
        .insert(waterIntake)
        .values({ userId, glasses, date })
        .returning();
      return intake;
    } catch (error) {
      console.error("Failed to log water intake:", error);
      throw error;
    }
  }

  async getTodayWaterProgress(userId: string): Promise<{ totalGlasses: number; goal: number; percentage: number }> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      // Get today's total water intake
      const intakeResult = await this.getDb()
        .select({ totalGlasses: sql<number>`COALESCE(SUM(${waterIntake.glasses}), 0)` })
        .from(waterIntake)
        .where(and(
          eq(waterIntake.userId, userId),
          gte(waterIntake.date, today),
          lte(waterIntake.date, tomorrow)
        ));

      const totalGlasses = Number(intakeResult[0]?.totalGlasses || 0);

      // Get user's current goal
      const goalResult = await this.getDb()
        .select({ dailyGoal: waterGoals.dailyGoal })
        .from(waterGoals)
        .where(eq(waterGoals.userId, userId))
        .orderBy(desc(waterGoals.createdAt))
        .limit(1);

      const goal = goalResult[0]?.dailyGoal || 8; // Default to 8 glasses
      const percentage = goal > 0 ? (totalGlasses / goal) * 100 : 0;

      return { totalGlasses, goal, percentage };
    } catch (error) {
      console.error("Failed to get today's water progress:", error);
      throw error;
    }
  }

  async setWaterGoal(userId: string, goal: number): Promise<WaterGoal> {
    try {
      const [waterGoal] = await this.getDb()
        .insert(waterGoals)
        .values({ userId, dailyGoal: goal })
        .returning();
      return waterGoal;
    } catch (error) {
      console.error("Failed to set water goal:", error);
      throw error;
    }
  }

  async getWeeklyWaterStats(userId: string): Promise<{ 
    totalGlasses: number; 
    averagePerDay: number; 
    goalsMet: number; 
    daysTracked: number; 
    maxGlasses: number 
  }> {
    try {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
      oneWeekAgo.setHours(0, 0, 0, 0);

      // Get daily totals for the past week
      const dailyTotals = await this.getDb()
        .select({
          date: waterIntake.date,
          totalGlasses: sql<number>`SUM(${waterIntake.glasses})`
        })
        .from(waterIntake)
        .where(and(
          eq(waterIntake.userId, userId),
          gte(waterIntake.date, oneWeekAgo)
        ))
        .groupBy(waterIntake.date)
        .orderBy(waterIntake.date);

      // Get current goal
      const goalResult = await this.getDb()
        .select({ dailyGoal: waterGoals.dailyGoal })
        .from(waterGoals)
        .where(eq(waterGoals.userId, userId))
        .orderBy(desc(waterGoals.createdAt))
        .limit(1);

      const dailyGoal = goalResult[0]?.dailyGoal || 8;

      const totalGlasses = dailyTotals.reduce((sum, day) => sum + Number(day.totalGlasses), 0);
      const daysTracked = dailyTotals.length;
      const averagePerDay = daysTracked > 0 ? Math.round(totalGlasses / daysTracked) : 0;
      const goalsMet = dailyTotals.filter(day => Number(day.totalGlasses) >= dailyGoal).length;
      const maxGlasses = dailyTotals.length > 0 ? 
        Math.max(...dailyTotals.map(day => Number(day.totalGlasses))) : 0;

      return { totalGlasses, averagePerDay, goalsMet, daysTracked, maxGlasses };
    } catch (error) {
      console.error("Failed to get weekly water stats:", error);
      throw error;
    }
  }

  async getWaterStreak(userId: string): Promise<number> {
    try {
      // Get current goal
      const goalResult = await this.getDb()
        .select({ dailyGoal: waterGoals.dailyGoal })
        .from(waterGoals)
        .where(eq(waterGoals.userId, userId))
        .orderBy(desc(waterGoals.createdAt))
        .limit(1);

      const dailyGoal = goalResult[0]?.dailyGoal || 8;

      // Get daily totals for the past 30 days (enough to calculate streaks)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      thirtyDaysAgo.setHours(0, 0, 0, 0);

      const dailyTotals = await this.getDb()
        .select({
          date: waterIntake.date,
          totalGlasses: sql<number>`SUM(${waterIntake.glasses})`
        })
        .from(waterIntake)
        .where(and(
          eq(waterIntake.userId, userId),
          gte(waterIntake.date, thirtyDaysAgo)
        ))
        .groupBy(waterIntake.date)
        .orderBy(desc(waterIntake.date));

      // Calculate current streak
      let streak = 0;
      for (const day of dailyTotals) {
        if (Number(day.totalGlasses) >= dailyGoal) {
          streak++;
        } else {
          break;
        }
      }

      return streak;
    } catch (error) {
      console.error("Failed to get water streak:", error);
      throw error;
    }
  }

  async setWaterReminders(userId: string, intervalMinutes: number): Promise<WaterReminder> {
    try {
      // First, deactivate any existing reminders
      await this.getDb()
        .update(waterReminders)
        .set({ isActive: false })
        .where(eq(waterReminders.userId, userId));

      // Create new reminder
      const [reminder] = await this.getDb()
        .insert(waterReminders)
        .values({ userId, intervalMinutes, isActive: true })
        .returning();
      
      return reminder;
    } catch (error) {
      console.error("Failed to set water reminders:", error);
      throw error;
    }
  }
}

export const storage = new DatabaseStorage();
