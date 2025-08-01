import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { slackService } from "./services/slack";
import { calendarService } from "./services/calendar";
import { analyticsService } from "./services/analytics";
import { schedulerService } from "./services/scheduler";
import { insertUserSchema, insertIntegrationSchema, insertFocusSessionSchema } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Initialize services
  schedulerService.start();

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Slack App endpoints
  app.post("/api/slack/events", slackService.handleSlackEvents);
  app.get("/api/slack/oauth", slackService.handleOAuth);
  app.get("/api/slack/install", slackService.handleInstall);
  app.post("/api/slack/commands", slackService.handleSlashCommand);
  app.post("/api/slack/interactive", slackService.handleInteractivity);

  // User management
  app.get("/api/users/:id", async (req, res) => {
    try {
      const user = await storage.getUser(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const userData = insertUserSchema.parse(req.body);
      const user = await storage.createUser(userData);
      await storage.logActivity({
        userId: user.id,
        action: "user_created",
        details: { email: user.email }
      });
      res.json(user);
    } catch (error) {
      res.status(400).json({ error: "Invalid user data" });
    }
  });

  // Integration management
  app.get("/api/users/:userId/integrations", async (req, res) => {
    try {
      const integrations = await storage.getUserIntegrations(req.params.userId);
      res.json(integrations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch integrations" });
    }
  });

  app.post("/api/users/:userId/integrations", async (req, res) => {
    try {
      const integrationData = insertIntegrationSchema.parse({
        ...req.body,
        userId: req.params.userId
      });
      const integration = await storage.createIntegration(integrationData);
      
      // Start syncing calendar data if it's a calendar integration
      if (integration.type === 'google_calendar' || integration.type === 'outlook') {
        calendarService.syncUserCalendar(req.params.userId, integration.type);
      }

      await storage.logActivity({
        userId: req.params.userId,
        action: "integration_connected",
        details: { type: integration.type }
      });

      res.json(integration);
    } catch (error) {
      res.status(400).json({ error: "Invalid integration data" });
    }
  });

  app.delete("/api/integrations/:id", async (req, res) => {
    try {
      await storage.deleteIntegration(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete integration" });
    }
  });

  // Calendar OAuth endpoints
  app.get("/api/oauth/google/callback", calendarService.handleGoogleCallback);
  app.get("/api/oauth/outlook/callback", calendarService.handleOutlookCallback);

  // Meeting analytics
  app.get("/api/users/:userId/meetings", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const meetings = await storage.getUserMeetings(
        req.params.userId,
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );
      res.json(meetings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch meetings" });
    }
  });

  app.get("/api/users/:userId/productivity-metrics", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();
      
      const metrics = await storage.getProductivityMetrics(req.params.userId, start, end);
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch productivity metrics" });
    }
  });

  // Break suggestions
  app.post("/api/users/:userId/break-suggestions", async (req, res) => {
    try {
      const suggestion = await storage.createBreakSuggestion({
        userId: req.params.userId,
        type: req.body.type,
        message: req.body.message,
        reason: req.body.reason
      });

      // Send break suggestion to Slack
      await slackService.sendBreakSuggestion(req.params.userId, suggestion);

      await storage.logActivity({
        userId: req.params.userId,
        action: "break_suggested",
        details: { type: suggestion.type, message: suggestion.message }
      });

      res.json(suggestion);
    } catch (error) {
      res.status(500).json({ error: "Failed to create break suggestion" });
    }
  });

  app.patch("/api/break-suggestions/:id", async (req, res) => {
    try {
      const updated = await storage.updateBreakSuggestion(req.params.id, req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update break suggestion" });
    }
  });

  // Focus sessions
  app.post("/api/users/:userId/focus-sessions", async (req, res) => {
    try {
      const sessionData = insertFocusSessionSchema.parse({
        ...req.body,
        userId: req.params.userId,
        startTime: new Date()
      });

      const session = await storage.createFocusSession(sessionData);
      
      // Set Slack status to focus mode
      await slackService.setFocusMode(req.params.userId, session.duration);

      await storage.logActivity({
        userId: req.params.userId,
        action: "focus_session_started",
        details: { duration: session.duration }
      });

      res.json(session);
    } catch (error) {
      res.status(400).json({ error: "Failed to start focus session" });
    }
  });

  app.patch("/api/focus-sessions/:id", async (req, res) => {
    try {
      const updates = { ...req.body };
      if (req.body.status === 'completed' || req.body.status === 'interrupted') {
        updates.endTime = new Date();
      }

      const session = await storage.updateFocusSession(req.params.id, updates);
      
      // Clear Slack status if session ended
      if (session.status !== 'active') {
        await slackService.clearFocusMode(session.userId);
      }

      res.json(session);
    } catch (error) {
      res.status(500).json({ error: "Failed to update focus session" });
    }
  });

  app.get("/api/users/:userId/focus-sessions/active", async (req, res) => {
    try {
      const session = await storage.getActiveFocusSession(req.params.userId);
      res.json(session);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch active focus session" });
    }
  });

  // Analytics and insights
  app.get("/api/analytics/overview", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const start = startDate ? new Date(startDate as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate as string) : new Date();

      const overview = await analyticsService.getOverviewMetrics(start, end);
      res.json(overview);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch analytics overview" });
    }
  });

  app.get("/api/analytics/insights", async (req, res) => {
    try {
      const insights = await analyticsService.generateInsights();
      res.json(insights);
    } catch (error) {
      res.status(500).json({ error: "Failed to generate insights" });
    }
  });

  // Activity logs
  app.get("/api/activity", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const activities = await storage.getRecentActivity(limit);
      res.json(activities);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch activity logs" });
    }
  });

  // Integration status
  app.get("/api/integrations/status", async (req, res) => {
    try {
      const status = await analyticsService.getIntegrationStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch integration status" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
