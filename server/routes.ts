import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { slackService } from "./services/slack";
import { calendarService } from "./services/calendar";
import { analyticsService } from "./services/analytics";
import { schedulerService } from "./services/scheduler";
import { insertUserSchema, insertIntegrationSchema, insertFocusSessionSchema, type InsertMeeting } from "@shared/schema";

// Generate realistic test meeting data for a user
async function generateTestMeetingData(userId: string) {
  const meetingTypes = [
    { title: "Weekly Team Standup", duration: 30, type: "video_call" as const },
    { title: "Quick Check-in", duration: 30, type: "video_call" as const },
    { title: "1:1 with Manager", duration: 30, type: "video_call" as const },
    { title: "Client Call", duration: 30, type: "video_call" as const },
    { title: "Team Sync", duration: 30, type: "video_call" as const },
    { title: "Status Update", duration: 30, type: "video_call" as const },
    { title: "Coffee Chat", duration: 30, type: "in_person" as const },
    { title: "Project Review Meeting", duration: 60, type: "video_call" as const },
    { title: "Client Presentation", duration: 45, type: "video_call" as const },
    { title: "Design Review", duration: 60, type: "video_call" as const },
    { title: "Sprint Planning", duration: 90, type: "video_call" as const },
    { title: "All Hands Meeting", duration: 45, type: "video_call" as const }
  ];

  const attendeeOptions = [
    [{ email: "sarah@company.com", name: "Sarah Johnson" }],
    [{ email: "mike@company.com", name: "Mike Chen" }, { email: "alex@company.com", name: "Alex Rodriguez" }],
    [{ email: "manager@company.com", name: "Jennifer Smith" }],
    [{ email: "client@external.com", name: "David Wilson" }, { email: "sales@company.com", name: "Lisa Brown" }],
    [{ email: "team@company.com", name: "Development Team" }]
  ];

  // Generate meetings for the past 7 days and next 7 days
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 7);

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + dayOffset);
    
    // Skip weekends completely - no meetings on Saturday (6) or Sunday (0)
    const dayOfWeek = currentDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      console.log(`Skipping ${currentDate.toDateString()} - weekend`);
      continue; // Skip this day entirely
    }
    
    // Generate 2-5 meetings per weekday only (reduced from 2-6)
    const meetingCount = Math.floor(Math.random() * 4) + 2; // 2-5 meetings max
    
    const dailyMeetings: InsertMeeting[] = [];
    let totalDailyTime = 0;
    const maxDailyTime = 300; // Reduced to 5 hours max per day (was 8 hours)
    
    console.log(`Generating ${meetingCount} meetings for ${currentDate.toDateString()}`);
    
    for (let i = 0; i < meetingCount && totalDailyTime < maxDailyTime; i++) {
      const meetingTemplate = meetingTypes[Math.floor(Math.random() * meetingTypes.length)];
      const attendees = attendeeOptions[Math.floor(Math.random() * attendeeOptions.length)];
      
      // Don't exceed daily time limit
      if (totalDailyTime + meetingTemplate.duration > maxDailyTime) {
        console.log(`Skipping meeting - would exceed daily limit (${totalDailyTime + meetingTemplate.duration} > ${maxDailyTime})`);
        continue;
      }
      
      // Generate meeting time strictly within 8 AM to 5 PM (work hours only)
      const startHour = Math.floor(Math.random() * 8) + 8; // 8 AM - 3 PM (to allow for meeting duration)
      const startMinute = Math.floor(Math.random() * 4) * 15; // 0, 15, 30, 45 minutes
      
      const startTime = new Date(currentDate);
      startTime.setHours(startHour, startMinute, 0, 0);
      
      const endTime = new Date(startTime);
      endTime.setMinutes(startTime.getMinutes() + meetingTemplate.duration);
      
      // Ensure meeting doesn't go past 5 PM (17:00)
      if (endTime.getHours() >= 17) {
        console.log(`Skipping meeting - would end after 5 PM (${endTime.getHours()}:${endTime.getMinutes()})`);
        continue; // Skip this meeting if it would go past 5 PM
      }
      
      // Check for conflicts with existing meetings
      const hasConflict = dailyMeetings.some(meeting => {
        return (startTime < meeting.endTime && endTime > meeting.startTime);
      });
      
      if (!hasConflict) {
        dailyMeetings.push({
          userId,
          externalId: `test-${userId}-${dayOffset}-${i}-${Date.now()}-${Math.random()}`,
          title: meetingTemplate.title,
          startTime,
          endTime,
          duration: meetingTemplate.duration,
          attendees,
          source: "test_data",
          meetingType: meetingTemplate.type
        });
        
        totalDailyTime += meetingTemplate.duration;
        console.log(`Added meeting: ${meetingTemplate.title} (${meetingTemplate.duration}min) at ${startTime.toLocaleTimeString()}`);
      } else {
        console.log(`Skipping meeting due to conflict: ${meetingTemplate.title}`);
      }
    }
    
    // Sort meetings by start time and save them
    dailyMeetings.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    
    for (const meeting of dailyMeetings) {
      try {
        await storage.createMeeting(meeting);
      } catch (error) {
        // Skip if already exists (based on externalId uniqueness)
        continue;
      }
    }
  }

  console.log(`Generated test meeting data for user ${userId}`);
  
  // Generate some demo focus sessions and break suggestions to make metrics realistic
  await generateDemoFocusData(userId, startDate);
  
  // After generating meetings, calculate productivity metrics for each day
  const { analyticsService } = await import('./services/analytics');
  
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + dayOffset);
    
    try {
      await analyticsService.processProductivityMetrics(userId, currentDate);
    } catch (error) {
      console.error(`Failed to process productivity metrics for ${currentDate.toDateString()}:`, error);
    }
  }
  
  console.log(`Generated productivity metrics for user ${userId}`);
}

// Generate demo focus sessions and break suggestions
async function generateDemoFocusData(userId: string, startDate: Date) {
  const focusSessionTypes = [25, 30, 45, 60, 90]; // Pomodoro and other common durations
  const breakTypes = ['hydration', 'stretch', 'meditation', 'walk'];
  
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + dayOffset);
    
    // Skip weekends for focus sessions too
    const isWeekend = currentDate.getDay() === 0 || currentDate.getDay() === 6;
    if (isWeekend) {
      continue; // Skip weekends completely
    }
    
    // Generate 1-4 focus sessions per weekday only
    const focusSessionCount = Math.floor(Math.random() * 4) + 1; // 1-4 sessions
    
    for (let i = 0; i < focusSessionCount; i++) {
      const duration = focusSessionTypes[Math.floor(Math.random() * focusSessionTypes.length)];
      // Focus sessions during work hours: 8 AM - 5 PM
      const startHour = Math.floor(Math.random() * 9) + 8; // 8 AM - 4 PM
      const startMinute = Math.floor(Math.random() * 4) * 15;
      
      const startTime = new Date(currentDate);
      startTime.setHours(startHour, startMinute, 0, 0);
      
      const endTime = new Date(startTime);
      endTime.setMinutes(startTime.getMinutes() + duration);
      
      // Skip if session would go past 5 PM
      if (endTime.getHours() >= 17) {
        continue;
      }
      
      // Create focus session
      try {
        await storage.createFocusSession({
          userId,
          duration,
          startTime,
          endTime,
          status: 'completed',
          slackStatusSet: Math.random() > 0.3 // 70% had Slack status set
        });
      } catch (error) {
        // Skip if creation fails
        continue;
      }
    }
    
    // Generate some break suggestions (2-5 per weekday only)
    const breakCount = Math.floor(Math.random() * 4) + 2; // 2-5 breaks
    
    for (let i = 0; i < breakCount; i++) {
      const breakType = breakTypes[Math.floor(Math.random() * breakTypes.length)];
      const accepted = Math.random() > 0.4; // 60% acceptance rate
      
      const suggestedTime = new Date(currentDate);
      suggestedTime.setHours(
        Math.floor(Math.random() * 9) + 8, // 8 AM - 4 PM
        Math.floor(Math.random() * 4) * 15,
        0, 0
      );
      
      const breakMessage = {
        hydration: "💧 Time for a water break! Stay hydrated.",
        stretch: "🤸 Take a moment to stretch and move around.",
        meditation: "🧘 Try a quick 5-minute meditation break.",
        walk: "🚶 How about a quick walk outside?"
      }[breakType] || "Take a quick wellness break!";
      
      try {
        await storage.createBreakSuggestion({
          userId,
          type: breakType,
          message: breakMessage,
          reason: "Scheduled wellness break",
          accepted,
          suggestedAt: suggestedTime,
          acceptedAt: accepted ? new Date(suggestedTime.getTime() + Math.random() * 30 * 60 * 1000) : undefined
        });
      } catch (error) {
        // Skip if creation fails
        continue;
      }
    }
  }
  
  console.log(`Generated demo focus sessions and break suggestions for user ${userId}`);
}

// Clear focus sessions and break suggestions for demo purposes
async function clearFocusAndBreakData(userId: string) {
  try {
    // Clear focus sessions and break suggestions using storage methods
    await storage.clearUserFocusSessions(userId);
    await storage.clearUserBreakSuggestions(userId);
    
    // Also clear old productivity metrics so they get recalculated fresh
    try {
      await storage.clearUserProductivityMetrics(userId);
      console.log(`Cleared old productivity metrics for user ${userId}`);
    } catch (metricsError) {
      console.error("Failed to clear productivity metrics:", metricsError);
      // Continue anyway - we'll recalculate them
    }
    
    // Recalculate productivity metrics without focus/break data
    const { analyticsService } = await import('./services/analytics');
    const today = new Date();
    
    for (let i = 0; i < 14; i++) {
      const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      try {
        await analyticsService.processProductivityMetrics(userId, date);
      } catch (error) {
        console.error(`Failed to recalculate metrics for ${date.toDateString()}:`, error);
      }
    }
    
    console.log(`Cleared focus sessions and break suggestions for user ${userId}`);
  } catch (error) {
    console.error("Failed to clear focus and break data:", error);
    throw error;
  }
}

export { generateTestMeetingData, clearFocusAndBreakData };

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Initialize services
  schedulerService.start();

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Integration success page
  app.get("/integration-success", (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Integration Successful - ProductivityWise</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 40px 20px;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .container {
            background: white;
            border-radius: 12px;
            padding: 40px;
            max-width: 500px;
            text-align: center;
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
          }
          .success-icon {
            font-size: 64px;
            margin-bottom: 20px;
          }
          h1 {
            color: #2d3748;
            margin-bottom: 16px;
            font-size: 28px;
          }
          p {
            color: #4a5568;
            line-height: 1.6;
            margin-bottom: 16px;
          }
          .features {
            background: #f7fafc;
            border-radius: 8px;
            padding: 20px;
            margin: 24px 0;
            text-align: left;
          }
          .feature {
            display: flex;
            align-items: center;
            margin-bottom: 12px;
          }
          .feature:last-child {
            margin-bottom: 0;
          }
          .feature-icon {
            margin-right: 12px;
            font-size: 18px;
          }
          .cta {
            background: #4299e1;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            margin-top: 20px;
          }
          .cta:hover {
            background: #3182ce;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">🎉</div>
          <h1>Integration Successful!</h1>
          <p>Great! ProductivityWise has been successfully connected to your Slack workspace with full permissions.</p>
          
          <div class="features">
            <div class="feature">
              <span class="feature-icon">🎯</span>
              <span><strong>Automatic Status Updates:</strong> Your Slack status will update during focus sessions</span>
            </div>
            <div class="feature">
              <span class="feature-icon">⏰</span>
              <span><strong>Smart Break Suggestions:</strong> Get personalized break recommendations</span>
            </div>
            <div class="feature">
              <span class="feature-icon">📊</span>
              <span><strong>Productivity Insights:</strong> Track your meeting time and focus patterns</span>
            </div>
          </div>
          
          <p>You can now return to Slack and try the following commands:</p>
          <p><strong>/focus 25</strong> - Start a focus session with automatic status updates<br>
          <strong>/break</strong> - Get a personalized break suggestion<br>
          <strong>/productivity</strong> - View your productivity metrics</p>
          
          <a href="slack://open" class="cta">Return to Slack</a>
        </div>
      </body>
      </html>
    `);
  });

  // Database health check
  app.get("/api/health/db", async (req, res) => {
    try {
      const start = Date.now();
      
      // Test basic database connectivity with timeout
      const dbTest = storage.getUserBySlackId("test-connection-check");
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database health check timeout')), 3000)
      );
      
      await Promise.race([dbTest, timeout]);
      const duration = Date.now() - start;
      
      res.json({ 
        status: "ok", 
        database: "connected",
        queryTime: `${duration}ms`,
        timestamp: new Date().toISOString() 
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ 
        status: "error", 
        database: "failed",
        error: errorMessage,
        timestamp: new Date().toISOString() 
      });
    }
  });

  // Slack App endpoints - Fix context binding by using arrow functions
  app.post("/api/slack/events", (req, res) => slackService.handleSlackEvents(req, res));
  app.get("/api/slack/oauth", (req, res) => slackService.handleOAuth(req, res));
  app.get("/api/slack/install", (req, res) => slackService.handleInstall(req, res));
  app.post("/api/slack/commands", (req, res) => slackService.handleSlashCommand(req, res));
  app.post("/api/slack/interactive", (req, res) => slackService.handleInteractivity(req, res));

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
  app.get("/api/oauth/google/callback", (req, res) => calendarService.handleGoogleCallback(req, res));
  app.get("/api/oauth/outlook/callback", (req, res) => calendarService.handleOutlookCallback(req, res));

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

  // Test data generation endpoint
  app.post("/api/generate-test-data", async (req, res) => {
    try {
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({ error: "User ID required" });
      }

      await generateTestMeetingData(userId);
      res.json({ success: true, message: "Test meeting data generated successfully" });
    } catch (error) {
      console.error("Failed to generate test data:", error);
      res.status(500).json({ error: "Failed to generate test data" });
    }
  });

  // Clear focus and break data endpoint
  app.post("/api/clear-demo-data", async (req, res) => {
    try {
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({ error: "User ID required" });
      }

      await clearFocusAndBreakData(userId);
      res.json({ success: true, message: "Focus sessions and breaks cleared successfully" });
    } catch (error) {
      console.error("Failed to clear demo data:", error);
      res.status(500).json({ error: "Failed to clear demo data" });
    }
  });

  // Dashboard endpoint that includes meetings
  app.get("/api/dashboard/:userId", async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Get this week's data
      const today = new Date();
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay()); // Start of week (Sunday)
      startOfWeek.setHours(0, 0, 0, 0);
      
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6); // End of week (Saturday)
      endOfWeek.setHours(23, 59, 59, 999);

      const meetings = await storage.getUserMeetings(userId, startOfWeek, endOfWeek);
      const metrics = await storage.getProductivityMetrics(userId, startOfWeek, endOfWeek);
      
      res.json({
        user: {
          id: user.id,
          name: user.name,
          timezone: user.timezone || 'America/New_York'
        },
        meetings,
        metrics,
        weekRange: {
          start: startOfWeek,
          end: endOfWeek
        }
      });
    } catch (error) {
      console.error("Dashboard API error:", error);
      res.status(500).json({ error: "Failed to load dashboard data" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
