import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, jsonb, boolean, decimal } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slackUserId: text("slack_user_id").unique(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").default("UTC"),
  slackTeamId: text("slack_team_id"),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const integrations = pgTable("integrations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  type: text("type").notNull(), // 'google_calendar', 'outlook', 'slack'
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at"),
  metadata: jsonb("metadata"), // Store additional config
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const meetings = pgTable("meetings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  externalId: text("external_id"), // ID from calendar provider
  title: text("title"),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  duration: integer("duration"), // in minutes
  attendees: jsonb("attendees"), // Array of attendee info
  source: text("source").notNull(), // 'google_calendar', 'outlook'
  meetingType: text("meeting_type"), // 'video_call', 'in_person', 'phone'
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const productivityMetrics = pgTable("productivity_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  date: timestamp("date").notNull(),
  totalMeetingTime: integer("total_meeting_time").default(0), // in minutes
  meetingCount: integer("meeting_count").default(0),
  focusTime: integer("focus_time").default(0), // in minutes
  breaksSuggested: integer("breaks_suggested").default(0),
  breaksAccepted: integer("breaks_accepted").default(0),
  focusSessionsStarted: integer("focus_sessions_started").default(0),
  focusSessionsCompleted: integer("focus_sessions_completed").default(0),
  backToBackMeetings: integer("back_to_back_meetings").default(0),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const breakSuggestions = pgTable("break_suggestions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  type: text("type").notNull(), // 'hydration', 'stretch', 'meditation', 'walk'
  message: text("message").notNull(),
  suggestedAt: timestamp("suggested_at").default(sql`now()`),
  accepted: boolean("accepted").default(false),
  acceptedAt: timestamp("accepted_at"),
  reason: text("reason"), // Why the break was suggested
});

export const focusSessions = pgTable("focus_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  duration: integer("duration").notNull(), // in minutes
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time"),
  status: text("status").default("active"), // 'active', 'completed', 'interrupted', 'scheduled', 'cancelled'
  slackStatusSet: boolean("slack_status_set").default(false),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const activityLogs = pgTable("activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  action: text("action").notNull(),
  details: jsonb("details"),
  timestamp: timestamp("timestamp").default(sql`now()`),
});

export const slackTeams = pgTable("slack_teams", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slackTeamId: text("slack_team_id").unique().notNull(),
  teamName: text("team_name").notNull(),
  botToken: text("bot_token"),
  botUserId: text("bot_user_id"),
  installedAt: timestamp("installed_at").default(sql`now()`),
  isActive: boolean("is_active").default(true),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  integrations: many(integrations),
  meetings: many(meetings),
  productivityMetrics: many(productivityMetrics),
  breakSuggestions: many(breakSuggestions),
  focusSessions: many(focusSessions),
  activityLogs: many(activityLogs),
}));

export const integrationsRelations = relations(integrations, ({ one }) => ({
  user: one(users, { fields: [integrations.userId], references: [users.id] }),
}));

export const meetingsRelations = relations(meetings, ({ one }) => ({
  user: one(users, { fields: [meetings.userId], references: [users.id] }),
}));

export const productivityMetricsRelations = relations(productivityMetrics, ({ one }) => ({
  user: one(users, { fields: [productivityMetrics.userId], references: [users.id] }),
}));

export const breakSuggestionsRelations = relations(breakSuggestions, ({ one }) => ({
  user: one(users, { fields: [breakSuggestions.userId], references: [users.id] }),
}));

export const focusSessionsRelations = relations(focusSessions, ({ one }) => ({
  user: one(users, { fields: [focusSessions.userId], references: [users.id] }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  user: one(users, { fields: [activityLogs.userId], references: [users.id] }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertIntegrationSchema = createInsertSchema(integrations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMeetingSchema = createInsertSchema(meetings).omit({
  id: true,
  createdAt: true,
});

export const insertProductivityMetricsSchema = createInsertSchema(productivityMetrics).omit({
  id: true,
  createdAt: true,
});

export const insertBreakSuggestionSchema = createInsertSchema(breakSuggestions).omit({
  id: true,
});

export const insertFocusSessionSchema = createInsertSchema(focusSessions).omit({
  id: true,
  createdAt: true,
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({
  id: true,
});

export const insertSlackTeamSchema = createInsertSchema(slackTeams).omit({
  id: true,
  installedAt: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Integration = typeof integrations.$inferSelect;
export type InsertIntegration = z.infer<typeof insertIntegrationSchema>;
export type Meeting = typeof meetings.$inferSelect;
export type InsertMeeting = z.infer<typeof insertMeetingSchema>;
export type ProductivityMetrics = typeof productivityMetrics.$inferSelect;
export type InsertProductivityMetrics = z.infer<typeof insertProductivityMetricsSchema>;
export type BreakSuggestion = typeof breakSuggestions.$inferSelect;
export type InsertBreakSuggestion = z.infer<typeof insertBreakSuggestionSchema>;
export type FocusSession = typeof focusSessions.$inferSelect;
export type InsertFocusSession = z.infer<typeof insertFocusSessionSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type SlackTeam = typeof slackTeams.$inferSelect;
export type InsertSlackTeam = z.infer<typeof insertSlackTeamSchema>;
