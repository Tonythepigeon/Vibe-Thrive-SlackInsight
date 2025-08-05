import { WebClient } from "@slack/web-api";
import { storage } from "../storage";
import type { BreakSuggestion } from "@shared/schema";

class SlackService {
  private clients: Map<string, WebClient> = new Map();

  constructor() {
    // Initialize with environment bot token if available
    if (process.env.SLACK_BOT_TOKEN) {
      this.clients.set("default", new WebClient(process.env.SLACK_BOT_TOKEN));
    }
  }

  private async getClient(teamId?: string): Promise<WebClient> {
    if (teamId && this.clients.has(teamId)) {
      return this.clients.get(teamId)!;
    }

    // Try to get team-specific token from database
    if (teamId) {
      try {
        const team = await storage.getSlackTeam(teamId);
        if (team && team.botToken) {
          const client = new WebClient(team.botToken);
          this.clients.set(teamId, client);
          return client;
        }
      } catch (error) {
        console.error("Failed to get team from database:", error);
      }
    }

    // Fallback to default client with environment bot token
    if (this.clients.has("default")) {
      return this.clients.get("default")!;
    }

    // Create default client if we have a bot token
    if (process.env.SLACK_BOT_TOKEN) {
      const defaultClient = new WebClient(process.env.SLACK_BOT_TOKEN);
      this.clients.set("default", defaultClient);
      return defaultClient;
    }

    // If no token available, create a client anyway (will fail auth but won't crash)
    console.warn("No Slack bot token available - commands may fail");
    return new WebClient();
  }

  async handleSlackEvents(req: any, res: any) {
    try {
      const { type, challenge, event } = req.body;

      // Handle URL verification
      if (type === "url_verification") {
        return res.json({ challenge });
      }

      // Handle events
      if (type === "event_callback" && event) {
        await this.processSlackEvent(event);
      }

      res.status(200).json({ ok: true });
    } catch (error) {
      console.error("Slack event handling error:", error);
      res.status(500).json({ error: "Failed to handle Slack event" });
    }
  }

  // Handle slash commands
  async handleSlashCommand(req: any, res: any) {
    try {
      const { command, text, user_id, team_id, channel_id } = req.body;

      // Verify request is from Slack (in production, verify signing secret)
      
      let response;
      
      // Check if we should use AI for natural language processing
      const shouldUseAI = await this.shouldUseAIForSlashCommand(command, text);
      
      if (shouldUseAI) {
        try {
          const { aiService } = await import('./ai');
          const isAIHealthy = await aiService.isHealthy();
          
          if (isAIHealthy) {
            // Create a natural language prompt for the AI
            const aiPrompt = this.createAIPromptFromSlashCommand(command, text);
            const aiResponse = await aiService.processUserMessage(aiPrompt, user_id, team_id);
            
            // Format AI response for Slack
            response = {
              response_type: "ephemeral",
              text: aiResponse.message,
              blocks: this.formatAIResponseBlocks(aiResponse)
            };
            
            res.json(response);
            return;
          }
        } catch (error) {
          console.error("AI processing failed for slash command, falling back:", error);
        }
      }
      
      // Fallback to traditional command handling
      switch (command) {
        case "/focus":
          response = await this.handleFocusCommand(text, user_id, team_id);
          break;
        case "/break":
          response = await this.handleBreakCommand(text, user_id, team_id);
          break;
        case "/productivity":
          response = await this.handleProductivityCommand(text, user_id, team_id);
          break;
        default:
          response = {
            text: "Unknown command. Available commands: /focus, /break, /productivity\n\n💡 *Tip:* You can also message me directly or mention me in channels for natural language interactions!"
          };
      }

      res.json(response);
    } catch (error) {
      console.error("Slash command error:", error);
      res.status(500).json({ error: "Command failed" });
    }
  }

  private shouldUseAIForSlashCommand(command: string, text: string): boolean {
    // Use AI if the text contains natural language patterns rather than simple parameters
    if (!text || text.trim().length === 0) {
      return false;
    }
    
    // Skip AI for simple numeric inputs or standard parameters
    const simplePatterns = [
      /^\d+$/, // Just numbers like "25"
      /^(end|stop)$/i, // Simple commands like "end"
      /^(general|hydration|stretch|meditation|walk)$/i, // Simple break types
    ];
    
    if (simplePatterns.some(pattern => pattern.test(text.trim()))) {
      return false;
    }
    
    // Use AI for natural language inputs
    const naturalLanguageIndicators = [
      'please', 'can you', 'i need', 'i want', 'help me', 'show me',
      'minutes', 'session', 'time', 'quick', 'long', 'short',
      'coffee', 'tired', 'stressed', 'focused', 'productive'
    ];
    
    const lowerText = text.toLowerCase();
    return naturalLanguageIndicators.some(indicator => lowerText.includes(indicator));
  }

  private createAIPromptFromSlashCommand(command: string, text: string): string {
    const commandMap: Record<string, string> = {
      '/focus': 'start a focus session',
      '/break': 'suggest a break',
      '/productivity': 'show my productivity metrics'
    };
    
    const baseCommand = commandMap[command] || command;
    return `${baseCommand} ${text}`.trim();
  }

  // Handle interactive components (buttons, modals, etc.)
  async handleInteractivity(req: any, res: any) {
    try {
      console.log("Received interactivity request");
      const payload = JSON.parse(req.body.payload);
      const { type, user, team, actions } = payload;

      console.log(`Interactivity payload: type=${type}, user=${user?.id}, actions=${JSON.stringify(actions?.map((a: any) => ({action_id: a.action_id, value: a.value})))}`);

      let response;
      switch (type) {
        case "block_actions":
          console.log("Processing block_actions");
          response = await this.handleBlockActions(payload);
          break;
        case "view_submission":
          console.log("Processing view_submission");
          response = await this.handleViewSubmission(payload);
          break;
        default:
          console.log(`Unknown interaction type: ${type}`);
          response = { response_action: "clear" };
      }

      console.log(`Sending interactivity response:`, JSON.stringify(response, null, 2));
      res.json(response);
    } catch (error) {
      console.error("Interactivity error:", error);
      res.status(500).json({ error: "Interaction failed" });
    }
  }

  async handleOAuth(req: any, res: any) {
    try {
      const { code, state } = req.query;
      console.log("OAuth request received with code:", code ? "present" : "missing");

      if (!code) {
        console.error("OAuth failed: No authorization code provided");
        return res.status(400).json({ error: "Authorization code required" });
      }

      // Check environment variables
      if (!process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET) {
        console.error("OAuth failed: Missing SLACK_CLIENT_ID or SLACK_CLIENT_SECRET");
        return res.status(500).json({ error: "OAuth configuration missing" });
      }

      console.log("Calling Slack OAuth API...");
      const client = new WebClient();
      const result = await client.oauth.v2.access({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        code,
      });

      console.log("Slack OAuth API response:", {
        ok: result.ok,
        hasTeam: !!result.team,
        hasAccessToken: !!result.access_token,
        hasAuthedUser: !!result.authed_user,
        hasUserToken: !!(result.authed_user?.access_token)
      });

      if (result.ok && result.team && result.access_token) {
        // Store bot token for this team first (most important)
        this.clients.set(result.team.id!, new WebClient(result.access_token));
        console.log(`Stored bot client for team ${result.team.id}`);

        // Try to store team information in database (non-critical)
        try {
          await storage.createSlackTeam({
            slackTeamId: result.team.id!,
            teamName: result.team.name!,
            botToken: result.access_token,
            botUserId: result.bot_user_id!,
          });
          console.log(`Stored team ${result.team.id} in database`);
        } catch (dbError) {
          console.error("Failed to store team in database (non-critical):", dbError);
          // Continue with OAuth flow even if database fails
        }

        // If authed_user is present, try to store user token (important for status updates)
        if (result.authed_user && result.authed_user.access_token) {
          try {
            console.log(`Processing user token for ${result.authed_user.id}`);
            
            // Get user info from Slack API to get their timezone
            let userTimezone = 'America/New_York'; // Default
            let userName = 'Slack User';
            try {
              const userClient = new WebClient(result.authed_user.access_token);
              const userInfo = await userClient.users.info({ user: result.authed_user.id! });
              if (userInfo.ok && userInfo.user) {
                userTimezone = userInfo.user.tz || 'America/New_York';
                userName = userInfo.user.real_name || userInfo.user.name || 'Slack User';
                console.log(`Got user info: name=${userName}, timezone=${userTimezone}`);
              }
            } catch (userInfoError) {
              console.error("Failed to get user info (using defaults):", userInfoError);
            }
            
            // Check if user already exists
            let user = await storage.getUserBySlackId(result.authed_user.id!);
            
            if (user) {
              console.log(`User ${result.authed_user.id} already exists`);
              // Update existing user with timezone and name
              await storage.updateUser(user.id, {
                name: userName,
                timezone: userTimezone
              });
            } else {
              console.log(`Creating new user ${result.authed_user.id}`);
              // Create new user
              user = await storage.createUser({
                slackUserId: result.authed_user.id!,
                email: `${result.authed_user.id}@slack.local`, // Placeholder, will be updated
                name: userName,
                timezone: userTimezone,
                slackTeamId: result.team.id!,
              });
            }

            // Store user token in integrations table
            await storage.createIntegration({
              userId: user.id,
              type: 'slack_user',
              accessToken: result.authed_user.access_token,
              refreshToken: result.authed_user.refresh_token || null,
              // User tokens don't typically expire, but store if provided
              expiresAt: null,
              isActive: true,
            });

            console.log(`Successfully stored user token for ${result.authed_user.id}`);
          } catch (userError) {
            console.error("Failed to store user token (non-critical):", userError);
            // Continue with OAuth flow even if user storage fails
          }
        } else {
          console.log("No user token received - user permissions may not have been granted");
        }

        // Try to log activity (non-critical)
        try {
          await storage.logActivity({
            action: "slack_app_installed",
            details: { teamId: result.team.id, teamName: result.team.name }
          });
        } catch (logError) {
          console.error("Failed to log activity (non-critical):", logError);
        }

        console.log("OAuth successful! Redirecting to success page");
        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5000'}/integration-success`);
      } else {
        console.error("OAuth failed: Invalid response from Slack", {
          ok: result.ok,
          error: result.error,
          hasTeam: !!result.team,
          hasAccessToken: !!result.access_token
        });
        res.status(400).json({ 
          error: "OAuth failed", 
          details: result.error || "Invalid response from Slack"
        });
      }
    } catch (error) {
      console.error("Slack OAuth error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ 
        error: "OAuth failed", 
        details: errorMessage 
      });
    }
  }

  async handleInstall(req: any, res: any) {
    try {
      const botScopes = [
        'commands',
        'chat:write',
        'users:read',
        'team:read'
      ].join(',');
      
      const userScopes = [
        'users.profile:write',
        'users.profile:read'
      ].join(',');
      
      const installUrl = `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID}&scope=${botScopes}&user_scope=${userScopes}`;
      res.json({ installUrl });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate install URL" });
    }
  }

  // Command handlers
  private async handleFocusCommand(text: string, userId: string, teamId: string) {
    // Check if this is an "end" command
    if (text.trim().toLowerCase() === 'end') {
      return this.handleEndFocusCommand(userId, teamId);
    }
    
    const duration = parseInt(text) || 25; // Default 25 minutes
    
    try {
      // Set a timeout for the entire operation
      const result = await Promise.race([
        this.processFocusCommand(userId, teamId, duration),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), 1000)
        )
      ]);
      
      return result;
    } catch (error) {
      console.error("Focus command error:", error);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // If it's a timeout, provide immediate value without database
      if (errorMessage === 'Operation timeout') {
        return {
          response_type: "ephemeral",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `🎯 *Focus Mode Activated!*\nDuration: ${duration} minutes\n\n📝 *Quick Focus Tips:*\n• Close unnecessary tabs and apps\n• Put phone in silent mode\n• Set your Slack status to "🎯 In focus mode"\n• Set clear goals for this session\n\n⏰ Timer started! You're now in focus mode.`
              }
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: "💡 _Working in offline mode - your session data will sync when connected._"
                }
              ]
            }
          ]
        };
      }
      
      return {
        response_type: "ephemeral",
        text: "❌ Failed to start focus session. Please try again in a moment."
      };
    }
  }

  private async handleEndFocusCommand(userId: string, teamId: string) {
    try {
      // Set a timeout for the entire operation
      const result = await Promise.race([
        this.processEndFocusCommand(userId, teamId),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), 1000)
        )
      ]);
      
      return result;
    } catch (error) {
      console.error("End focus command error:", error);
      
      return {
        response_type: "ephemeral",
        text: "❌ Failed to end focus session. Please try again in a moment."
      };
    }
  }

  private async processEndFocusCommand(userId: string, teamId: string) {
    // Ensure team info is stored
    await this.ensureTeamStored(teamId);

    let user = await storage.getUserBySlackId(userId);
    
    // If user doesn't exist, they can't have an active session
    if (!user) {
      return {
        response_type: "ephemeral",
        text: "❌ No active focus session found."
      };
    }

    // Check for active focus session
    const activeSession = await storage.getActiveFocusSession(user.id);
    if (!activeSession) {
      return {
        response_type: "ephemeral",
        text: "❌ No active focus session found."
      };
    }

    // End the focus session
    await storage.updateFocusSession(activeSession.id, {
      status: 'completed',
      endTime: new Date()
    });

    // Clear Slack status asynchronously (don't wait for it)
    this.clearFocusMode(user.id).catch(console.error);

    // Log activity without waiting
    storage.logActivity({
      userId: user.id,
      action: "focus_session_ended",
      details: { 
        sessionId: activeSession.id, 
        duration: activeSession.duration,
        trigger: "manual_end_command"
      }
    }).catch(console.error);

    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ *Focus session ended!*\n\nGreat work! You've completed your focus session.\n\n🔄 Your Slack status is being cleared automatically.\n\nTime to take a well-deserved break! 🎉`
          }
        }
      ]
    };
  }

  private async ensureTeamStored(teamId: string) {
    try {
      // Check if team already exists
      const existingTeam = await storage.getSlackTeam(teamId);
      if (existingTeam) {
        return;
      }

      // If team doesn't exist and we have a bot token, store basic team info
      if (process.env.SLACK_BOT_TOKEN) {
        await storage.createSlackTeam({
          slackTeamId: teamId,
          teamName: "Unknown Team", // Will be updated later via OAuth
          botToken: process.env.SLACK_BOT_TOKEN,
          botUserId: "Unknown", // Will be updated later
        });
        console.log(`Stored team info for ${teamId}`);
      }
    } catch (error) {
      console.error("Failed to ensure team is stored:", error);
    }
  }

  private async processFocusCommand(userId: string, teamId: string, duration: number) {
    // Ensure team info is stored
    await this.ensureTeamStored(teamId);

    let user = await storage.getUserBySlackId(userId);
    
    // If user doesn't exist, create them automatically
    if (!user) {
      user = await storage.createUser({
        slackUserId: userId,
        slackTeamId: teamId,
        email: `${userId}@slack.local`, // Placeholder email
        name: "Slack User", // Will be updated when we get more info
      });
      
      // Log activity without waiting
      storage.logActivity({
        userId: user.id,
        action: "user_auto_created",
        details: { slackUserId: userId, teamId, trigger: "focus_command" }
      }).catch(console.error);
    }

    // Check for active focus session
    const activeSession = await storage.getActiveFocusSession(user.id);
    if (activeSession) {
      return {
        response_type: "ephemeral",
        text: "You already have an active focus session. End it first with `/focus end`."
      };
    }

    // Create focus session
    const session = await storage.createFocusSession({
      userId: user.id,
      duration,
      startTime: new Date()
    });

    // Update daily productivity metrics (async, don't block response)
    this.updateDailyMetrics(user.id, new Date()).catch(console.error);

    // Set Slack status asynchronously (don't wait for it)
    this.setFocusMode(user.id, duration).catch(console.error);

    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🎯 *Focus mode activated!*\nDuration: ${duration} minutes\n\n⚡ Setting up your Slack status automatically...\n\nI'll send you a DM with session details and confirmation!`
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "End Focus Session"
              },
              style: "danger",
              action_id: "end_focus",
              value: session.id
            }
          ]
        }
      ]
    };
  }

  private async handleBreakCommand(text: string, userId: string, teamId: string) {
    const breakType = text.toLowerCase() || "general";
    
    try {
      // Set a timeout for the entire operation
      const result = await Promise.race([
        this.processBreakCommand(userId, teamId, breakType),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), 1000)
        )
      ]);
      
      return result;
    } catch (error) {
      console.error("Break command error:", error);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        response_type: "ephemeral",
        text: errorMessage === 'Operation timeout'
          ? `☕ Your ${breakType} break suggestion is being prepared!`
          : "❌ Failed to process break request. Please try again."
      };
    }
  }

  private async processBreakCommand(userId: string, teamId: string, breakType: string) {
    // Ensure team info is stored
    await this.ensureTeamStored(teamId);

    let user = await storage.getUserBySlackId(userId);
    
    // If user doesn't exist, create them automatically
    if (!user) {
      user = await storage.createUser({
        slackUserId: userId,
        slackTeamId: teamId,
        email: `${userId}@slack.local`, // Placeholder email
        name: "Slack User", // Will be updated when we get more info
      });
      
      // Log activity without waiting
      storage.logActivity({
        userId: user.id,
        action: "user_auto_created",
        details: { slackUserId: userId, teamId, trigger: "break_command" }
      }).catch(console.error);
    }

    // Check if this is a good time for a break based on calendar
    const breakCheck = await this.shouldSuggestBreak(user.id);
    
    if (!breakCheck.suggest) {
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `⏰ *Break timing suggestion*\n\n${breakCheck.reason}. Maybe try taking a break after your meeting ends?\n\n💡 *Quick tip:* You can still take a micro-break (stretch, deep breaths) even during busy times!`
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Take Break Anyway"
                },
                style: "primary",
                action_id: "take_break_override",
                value: user.id
              }
            ]
          }
        ]
      };
    }

    const suggestion = await storage.createBreakSuggestion({
      userId: user.id,
      type: breakType,
      message: `You requested a ${breakType} break`,
      reason: breakCheck.reason
    });

    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `☕ *Break time!*\n${this.getBreakMessage(breakType)}\n\n✨ *Perfect timing:* ${breakCheck.reason}`
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Take Break Now"
              },
              style: "primary",
              action_id: "take_break",
              value: suggestion.id
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Maybe Later"
              },
              action_id: "defer_break",
              value: suggestion.id
            }
          ]
        }
      ]
    };
  }

  private async handleProductivityCommand(text: string, userId: string, teamId: string) {
    try {
      // Set a timeout for the entire operation
      const result = await Promise.race([
        this.processProductivityCommand(userId, teamId),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), 1000)
        )
      ]);
      
      return result;
    } catch (error) {
      console.error("Productivity command error:", error);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        response_type: "ephemeral",
        text: errorMessage === 'Operation timeout'
          ? "📊 Your productivity summary is being generated..."
          : "❌ Failed to get productivity summary. Please try again."
      };
    }
  }

  private async processProductivityCommand(userId: string, teamId: string) {
    // Ensure team info is stored
    await this.ensureTeamStored(teamId);

    let user = await storage.getUserBySlackId(userId);
    
    // If user doesn't exist, create them automatically
    if (!user) {
      user = await storage.createUser({
        slackUserId: userId,
        slackTeamId: teamId,
        email: `${userId}@slack.local`, // Placeholder email
        name: "Slack User", // Will be updated when we get more info
      });
      
      // Log activity without waiting
      storage.logActivity({
        userId: user.id,
        action: "user_auto_created",
        details: { slackUserId: userId, teamId, trigger: "productivity_command" }
      }).catch(console.error);
    }

    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Get weekly stats
    let metrics = await storage.getProductivityMetrics(user.id, weekAgo, today);
    const weeklyMeetings = await storage.getUserMeetings(user.id, weekAgo, today);
    
    // If no metrics exist but we have meetings, calculate them
    if (metrics.length === 0 && weeklyMeetings.length > 0) {
      const { analyticsService } = await import('./analytics');
      
      // Calculate metrics for the past 7 days
      for (let i = 0; i < 7; i++) {
        const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
        try {
          await analyticsService.processProductivityMetrics(user.id, date);
        } catch (error) {
          console.error(`Failed to process productivity metrics for ${date.toDateString()}:`, error);
        }
      }
      
      // Refresh metrics after calculation
      metrics = await storage.getProductivityMetrics(user.id, weekAgo, today);
    }
    
    // Get today's meetings specifically
    const todaysMeetings = await this.getTodaysMeetings(user.id);
    
    const totalMeetingTime = metrics.reduce((sum, m) => sum + (m.totalMeetingTime || 0), 0);
    const totalFocusTime = metrics.reduce((sum, m) => sum + (m.focusTime || 0), 0);
    const totalBreaks = metrics.reduce((sum, m) => sum + (m.breaksAccepted || 0), 0);

    // Format today's meetings
    const todaysMeetingText = this.formatTodaysMeetings(todaysMeetings, user.timezone || 'America/New_York');
    
    // Get insights using calendar service
    const { calendarService } = await import('./calendar');
    const insights = await calendarService.generateProductivityInsights(user.id);

    const blocks: any[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "📊 Your Productivity Summary"
        }
      }
    ];

    // Add today's meetings section if there are any
    if (todaysMeetings.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📅 *Today's Meetings*\n${todaysMeetingText}`
        }
      });
      blocks.push({ type: "divider" });
    } else if (!todaysMeetings.length && !weeklyMeetings.length) {
      // Show demo data option if no meetings at all
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: "📅 *No meetings found*\n\nTo see your productivity dashboard in action, you can generate some demo meeting data!"
        },
        accessory: {
          type: "button",
          text: {
            type: "plain_text",
            text: "Generate Demo Data",
          },
          action_id: "generate_demo_data",
          value: user.id
        }
      });
      blocks.push({ type: "divider" });
    }

    // Add weekly stats
    blocks.push({
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Meeting Time (7 days):*\n${Math.round(totalMeetingTime / 60)}h ${totalMeetingTime % 60}m`
        },
        {
          type: "mrkdwn",
          text: `*Focus Time:*\n${Math.round(totalFocusTime / 60)}h ${totalFocusTime % 60}m`
        },
        {
          type: "mrkdwn",
          text: `*Total Meetings:*\n${weeklyMeetings.length} meetings`
        },
        {
          type: "mrkdwn",
          text: `*Breaks Taken:*\n${totalBreaks} breaks`
        }
      ]
    });

    // Add insights if available
    if (insights.length > 0) {
      blocks.push({ type: "divider" });
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `💡 *Productivity Insights*\n${insights.map(insight => `• ${insight}`).join('\n')}`
        }
      });
    }

    // Add action button
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View Full Dashboard"
          },
          url: `${process.env.FRONTEND_URL || 'http://localhost:5000'}/dashboard?userId=${user.id}`,
          action_id: "view_dashboard"
        }
      ]
    });

    return {
      response_type: "ephemeral",
      blocks
    };
  }

  private formatTodaysMeetings(meetings: any[], timezone: string): string {
    if (meetings.length === 0) {
      return "No meetings scheduled for today 🎉";
    }

    const now = new Date();
    let formatted = '';

    // Sort meetings by start time
    const sortedMeetings = meetings.sort((a, b) => 
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

    sortedMeetings.forEach((meeting, index) => {
      const startTime = new Date(meeting.startTime);
      const endTime = new Date(meeting.endTime);
      const isCurrentlyInMeeting = now >= startTime && now <= endTime;
      const isPast = now > endTime;
      const isUpcoming = now < startTime;

      const startFormatted = startTime.toLocaleTimeString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      const endFormatted = endTime.toLocaleTimeString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      let status = '';
      if (isCurrentlyInMeeting) {
        status = '🔴 *In progress*';
      } else if (isPast) {
        status = '✅ *Completed*';
      } else if (isUpcoming) {
        const minutesUntil = Math.floor((startTime.getTime() - now.getTime()) / (1000 * 60));
        if (minutesUntil <= 15) {
          status = '🟡 *Starting soon*';
        } else {
          status = '⏰ *Upcoming*';
        }
      }

      formatted += `${status} ${startFormatted}-${endFormatted}: ${meeting.title || 'Untitled Meeting'}`;
      if (index < sortedMeetings.length - 1) {
        formatted += '\n';
      }
    });

    return formatted;
  }

  private async handleBlockActions(payload: any) {
    const { actions, user, team } = payload;
    const action = actions[0];

    console.log(`Block action received: action_id=${action.action_id}, value=${action.value}, user=${user.id}`);

    switch (action.action_id) {
      case "end_focus":
        console.log("Handling end_focus action");
        return await this.endFocusSession(action.value, user.id);
      case "take_break":
        console.log("Handling take_break action");
        return await this.acceptBreakSuggestion(action.value, user.id);
      case "take_break_override":
        console.log("Handling take_break_override action");
        return await this.forceBreakSuggestion(action.value, user.id);
      case "defer_break":
        console.log("Handling defer_break action");
        return await this.deferBreakSuggestion(action.value, user.id);
      case "generate_demo_data":
        console.log("Handling generate_demo_data action");
        return await this.generateDemoDataFromSlack(action.value, user.id);
      case "start_focus_25":
        console.log("Handling start_focus_25 action");
        return await this.handleQuickFocusSession(user.id, team.id, 25);
      case "start_focus_45":
        console.log("Handling start_focus_45 action");
        return await this.handleQuickFocusSession(user.id, team.id, 45);
      case "suggest_break_coffee":
        console.log("Handling suggest_break_coffee action");
        return await this.handleQuickBreakSuggestion(user.id, team.id, "hydration");
      case "suggest_break_stretch":
        console.log("Handling suggest_break_stretch action");
        return await this.handleQuickBreakSuggestion(user.id, team.id, "stretch");
      case "show_productivity":
        console.log("Handling show_productivity action");
        return await this.handleQuickProductivitySummary(user.id, team.id);
      default:
        console.log(`Unknown action_id: ${action.action_id}`);
        return { response_action: "clear" };
    }
  }

  private async handleViewSubmission(payload: any) {
    // Handle modal submissions
    return { response_action: "clear" };
  }

  // Quick action handlers for interactive buttons
  private async handleQuickFocusSession(slackUserId: string, teamId: string, duration: number) {
    try {
      const response = await this.handleFocusCommand(duration.toString(), slackUserId, teamId);
      const responseData = response as any;
      return {
        replace_original: true,
        text: `🎯 Started ${duration}-minute focus session!`,
        blocks: responseData.blocks || [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🎯 *${duration}-minute focus session started!*\n\nYour Slack status will be updated automatically. Stay focused! 💪`
            }
          }
        ]
      };
    } catch (error) {
      console.error("Quick focus session error:", error);
      return {
        replace_original: true,
        text: "❌ Failed to start focus session. Please try using `/focus` command instead."
      };
    }
  }

  private async handleQuickBreakSuggestion(slackUserId: string, teamId: string, breakType: string) {
    try {
      const response = await this.handleBreakCommand(breakType, slackUserId, teamId);
      const responseData = response as any;
      return {
        replace_original: true,
        text: `☕ ${breakType} break suggestion ready!`,
        blocks: responseData.blocks || [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `☕ *${breakType === 'hydration' ? 'Coffee' : 'Stretch'} break time!*\n\nTake a moment to refresh yourself. You've earned it! 🌟`
            }
          }
        ]
      };
    } catch (error) {
      console.error("Quick break suggestion error:", error);
      return {
        replace_original: true,
        text: "❌ Failed to process break suggestion. Please try using `/break` command instead."
      };
    }
  }

  private async handleQuickProductivitySummary(slackUserId: string, teamId: string) {
    try {
      const response = await this.handleProductivityCommand("", slackUserId, teamId);
      const responseData = response as any;
      return {
        replace_original: true,
        text: "📊 Here's your productivity summary!",
        blocks: responseData.blocks || [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "📊 *Productivity Summary*\n\nYour detailed metrics are being prepared..."
            }
          }
        ]
      };
    } catch (error) {
      console.error("Quick productivity summary error:", error);
      return {
        replace_original: true,
        text: "❌ Failed to load productivity summary. Please try using `/productivity` command instead."
      };
    }
  }

  private async endFocusSession(sessionId: string, slackUserId: string) {
    try {
      const user = await storage.getUserBySlackId(slackUserId);
      if (!user) return { response_action: "clear" };

      await storage.updateFocusSession(sessionId, {
        status: "completed",
        endTime: new Date()
      });

      await this.clearFocusMode(user.id);

      return {
        replace_original: true,
        text: "🎯 Focus session completed! Great work!"
      };
    } catch (error) {
      console.error("End focus session error:", error);
      return { response_action: "clear" };
    }
  }

  private async acceptBreakSuggestion(suggestionId: string, slackUserId: string) {
    try {
      const user = await storage.getUserBySlackId(slackUserId);
      if (!user) return { response_action: "clear" };

      // Update the break suggestion
      await storage.updateBreakSuggestion(suggestionId, {
        accepted: true,
        acceptedAt: new Date()
      });

      // Set coffee break status for 20 minutes
      await this.setBreakMode(user.id, 20);

      // Log activity
      storage.logActivity({
        userId: user.id,
        action: "break_accepted",
        details: { 
          suggestionId,
          duration: 20,
          type: "coffee_break"
        }
      }).catch(console.error);

      // Update daily productivity metrics (async)
      this.updateDailyMetrics(user.id, new Date()).catch(console.error);

      return {
        replace_original: true,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "☕ *Break time started!*\n\nEnjoy your 20-minute coffee break! ✅ Your Slack status has been updated.\n\n💡 *Break Tips:*\n• Step away from your desk\n• Hydrate and stretch\n• Get some fresh air if possible\n• Let your mind rest"
            }
          }
        ]
      };
    } catch (error) {
      console.error("Accept break error:", error);
      return { response_action: "clear" };
    }
  }

  private async deferBreakSuggestion(suggestionId: string, slackUserId: string) {
    try {
      console.log(`Defer break suggestion called: suggestionId=${suggestionId}, slackUserId=${slackUserId}`);
      
      const user = await storage.getUserBySlackId(slackUserId);
      if (user) {
        console.log(`Found user ${user.id} for defer break`);
        // Log the deferral
        storage.logActivity({
          userId: user.id,
          action: "break_deferred",
          details: { 
            suggestionId,
            reason: "maybe_later"
          }
        }).catch(console.error);

        // Also send a DM as backup (don't wait for it)
        this.sendDeferBreakDM(user).catch(console.error);
      } else {
        console.log(`No user found for slackUserId: ${slackUserId}`);
      }

      // Try a simpler response format with timestamp to prevent caching
      const timestamp = new Date().toLocaleTimeString();
      const response = {
        replace_original: true,
        response_type: "ephemeral",
        text: `👍 *No problem!* (${timestamp})\n\nI understand you're in the zone right now. Remember that regular breaks help maintain focus and prevent burnout.\n\n💡 *Break Benefits:*\n• Improves creativity and problem-solving\n• Reduces eye strain and physical tension\n• Boosts energy and mood\n• Enhances overall productivity\n\n⏰ Consider taking a break within the next 30-60 minutes. Your brain (and body) will thank you!\n\n💫 _Tip: Use \`/break\` anytime you're ready for a wellness break!_`
      };

      console.log(`Defer break response:`, JSON.stringify(response, null, 2));
      return response;
    } catch (error) {
      console.error("Defer break error:", error);
      return {
        replace_original: true,
        text: "👍 No problem! Remember to take breaks when you can - they're important for your wellbeing!"
      };
    }
  }

  // Force break when user chooses "Take Break Anyway"
  private async forceBreakSuggestion(userId: string, slackUserId: string) {
    try {
      const user = await storage.getUserBySlackId(slackUserId);
      if (!user) return { response_action: "clear" };

      // Set coffee break status for 15 minutes (shorter since they're busy)
      await this.setBreakMode(user.id, 15);

      // Log activity
      storage.logActivity({
        userId: user.id,
        action: "break_forced",
        details: { 
          duration: 15,
          reason: "override_calendar_conflict"
        }
      }).catch(console.error);

      return {
        replace_original: true,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "☕ *Quick break time!*\n\nYou chose to take a break anyway - good for you! Taking a 15-minute break even during busy times.\n\n💡 *Quick break tips:*\n• Do some desk stretches\n• Take a few deep breaths\n• Step outside for fresh air\n• Stay hydrated"
            }
          }
        ]
      };
    } catch (error) {
      console.error("Force break error:", error);
      return { response_action: "clear" };
    }
  }

  // Backup method to send DM if replace_original doesn't work
  private async sendDeferBreakDM(user: any) {
    try {
      const client = await this.getClient(user.slackTeamId || undefined);
      await client.chat.postMessage({
        channel: user.slackUserId,
        text: "👍 *Break reminder deferred*\n\nNo worries! I understand you're focused right now. Just remember that regular breaks help maintain your energy and creativity throughout the day.\n\nConsider taking a short break within the next hour - even 5 minutes can make a difference! ☕"
      });
      console.log(`Sent defer break DM to ${user.slackUserId}`);
    } catch (error) {
      console.error("Failed to send defer break DM:", error);
    }
  }

  private formatAIResponseBlocks(response: any): any[] {
    const blocks: any[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: response.message
        }
      }
    ];

    // Add recommendations if available
    if (response.recommendations && response.recommendations.length > 0) {
      blocks.push({ type: "divider" });
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `💡 *Recommendations:*\n${response.recommendations.map((rec: string) => `• ${rec}`).join('\n')}`
        }
      });
    }

    // Add action executed indicator if command was run
    if (response.commandExecuted) {
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "✅ _Command executed successfully_"
          }
        ]
      });
    }

    return blocks;
  }

  private async processSlackEvent(event: any) {
    switch (event.type) {
      case "app_mention":
        await this.handleAppMention(event);
        break;
      case "message":
        await this.handleMessage(event);
        break;
    }
  }

  private async handleMessage(event: any) {
    // Skip bot messages and messages without text
    if (event.bot_id || !event.text || event.subtype) {
      return;
    }

    // Check if this is a direct message (DM) to the bot
    const isDM = event.channel_type === 'im' || event.channel.startsWith('D');
    
    if (isDM) {
      // Handle direct messages with AI processing
      await this.handleDirectMessage(event);
    } else {
      // Handle channel messages (legacy keyword-based for now)
      await this.handleChannelMessage(event);
    }
  }

  private async handleDirectMessage(event: any) {
    try {
      // Use AI service for intelligent DM responses
      const { aiService } = await import('./ai');
      const isAIHealthy = await aiService.isHealthy();
      
      if (isAIHealthy) {
        // Process the message with AI
        const response = await aiService.processUserMessage(
          event.text, 
          event.user, 
          event.team || 'default'
        );
        
        const client = await this.getClient(event.team);
        await client.chat.postMessage({
          channel: event.channel,
          text: response.message,
          blocks: this.formatAIResponseBlocks(response)
        });
        return;
      }
    } catch (error) {
      console.error("AI service unavailable for DM, falling back to simple responses:", error);
    }

    // Fallback to simple responses for DMs
    await this.handleDirectMessageFallback(event);
  }

  private async handleDirectMessageFallback(event: any) {
    const client = await this.getClient(event.team);
    const text = event.text.toLowerCase();

    if (text.includes("focus") || text.includes("concentrate")) {
      await client.chat.postMessage({
        channel: event.channel,
        text: "🎯 Let's start a focus session! Use `/focus 25` for a 25-minute session, or `/focus 45` for 45 minutes. You can also just tell me 'start a focus session' and I'll help you!",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "🎯 *Focus Session Options*"
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "25 min Focus" },
                action_id: "start_focus_25",
                style: "primary"
              },
              {
                type: "button",
                text: { type: "plain_text", text: "45 min Focus" },
                action_id: "start_focus_45"
              }
            ]
          }
        ]
      });
    } else if (text.includes("break") || text.includes("rest")) {
      await client.chat.postMessage({
        channel: event.channel,
        text: "☕ Time for a break! Use `/break` to get a personalized break suggestion, or tell me what kind of break you need (coffee, stretch, walk, etc.)",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "☕ *Break Options*"
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Coffee Break" },
                action_id: "suggest_break_coffee"
              },
              {
                type: "button",
                text: { type: "plain_text", text: "Stretch Break" },
                action_id: "suggest_break_stretch"
              }
            ]
          }
        ]
      });
    } else if (text.includes("productivity") || text.includes("metrics") || text.includes("summary")) {
      await client.chat.postMessage({
        channel: event.channel,
        text: "📊 Let me show you your productivity summary! Use `/productivity` to see your detailed metrics and insights.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "📊 *Productivity Dashboard*"
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "View Productivity" },
                action_id: "show_productivity"
              }
            ]
          }
        ]
      });
    } else if (text.includes("help") || text.includes("commands") || text.includes("what can you do")) {
      await client.chat.postMessage({
        channel: event.channel,
        text: "👋 Hi! I'm your AI productivity assistant. Here's what I can help you with:",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "👋 *Hi! I'm your AI productivity assistant!*\n\nI can help you with:"
            }
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: "*🎯 Focus Sessions*\nStart timed focus sessions with automatic Slack status updates"
              },
              {
                type: "mrkdwn",
                text: "*☕ Smart Breaks*\nGet personalized break suggestions based on your schedule"
              },
              {
                type: "mrkdwn",
                text: "*📊 Productivity Metrics*\nTrack your meeting time, focus patterns, and work habits"
              },
              {
                type: "mrkdwn",
                text: "*🤖 Natural Language*\nJust tell me what you need in plain English!"
              }
            ]
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Examples:*\n• \"Start a 30 minute focus session\"\n• \"I need a coffee break\"\n• \"Show me my productivity metrics\"\n• \"How was my week?\""
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Slash Commands:*\n• `/focus` - Start focus sessions\n• `/break` - Get break suggestions\n• `/productivity` - View your metrics"
            }
          }
        ]
      });
    } else {
      // General response for unclear messages
      await client.chat.postMessage({
        channel: event.channel,
        text: "🤔 I'm not sure I understand. I can help you with focus sessions, breaks, and productivity tracking. Try saying something like:\n• \"Start a focus session\"\n• \"I need a break\"\n• \"Show my productivity\"\n• \"Help\" for more options",
      });
    }
  }

  private async handleChannelMessage(event: any) {
    // Legacy handling for channel messages (non-DM)
    // Only respond if the message specifically mentions productivity topics
    if (event.text && event.text.includes("break")) {
      await this.handleBreakRequest(event);
    }
    // We could expand this later to handle more channel interactions
  }

  private async handleAppMention(event: any) {
    try {
      // Try to use AI service for intelligent responses
      const { aiService } = await import('./ai');
      const isAIHealthy = await aiService.isHealthy();
      
      if (isAIHealthy) {
        // Use AI service for smart handling
        await aiService.handleAIMention(event);
        return;
      }
    } catch (error) {
      console.error("AI service unavailable, falling back to simple responses:", error);
    }

    // Fallback to simple keyword-based responses
    const client = await this.getClient(event.team);
    
    if (event.text.includes("focus")) {
      await client.chat.postMessage({
        channel: event.channel,
        text: "🎯 Ready to start a focus session? Use the `/focus` command to get started! You can also ask me in natural language like 'start a 30 minute focus session'.",
      });
    } else if (event.text.includes("break")) {
      await client.chat.postMessage({
        channel: event.channel,
        text: "☕ Taking breaks is important! I can suggest the perfect time for your next break. Try asking 'suggest a coffee break' or use `/break`.",
      });
    } else if (event.text.includes("productivity") || event.text.includes("metrics")) {
      await client.chat.postMessage({
        channel: event.channel,
        text: "📊 Want to see your productivity summary? Ask me 'show my productivity metrics' or use `/productivity`.",
      });
    } else {
      await client.chat.postMessage({
        channel: event.channel,
        text: "👋 Hi! I'm your AI productivity assistant! I can help with:\n• Starting focus sessions (try: 'start a 25 minute focus session')\n• Suggesting breaks (try: 'I need a coffee break')\n• Showing productivity metrics (try: 'how productive was I today?')\n\nJust mention me and ask in natural language, or use the slash commands: `/focus`, `/break`, `/productivity`",
      });
    }
  }

  private async handleBreakRequest(event: any) {
    const user = await storage.getUserBySlackId(event.user);
    if (user) {
      const suggestion = await storage.createBreakSuggestion({
        userId: user.id,
        type: "requested",
        message: "You requested a break suggestion",
        reason: "user_requested"
      });

      await this.sendBreakSuggestion(user.id, suggestion);
    }
  }

  async sendBreakSuggestion(userId: string, suggestion: BreakSuggestion) {
    try {
      const user = await storage.getUser(userId);
      if (!user || !user.slackUserId) return;

      const client = await this.getClient(user.slackTeamId || undefined);

      const breakMessages = {
        hydration: "💧 Time for a hydration break! Grab some water and give your body the fuel it needs.",
        stretch: "🤸‍♀️ Your body needs a stretch! Stand up and do some light stretching to refresh yourself.",
        meditation: "🧘‍♂️ Take a moment to breathe. A quick 5-minute meditation can reset your focus.",
        walk: "🚶‍♀️ Step away from your desk! A short walk can boost creativity and energy.",
        general: "⏰ You've been working hard! Time for a well-deserved break."
      };

      const message = breakMessages[suggestion.type as keyof typeof breakMessages] || breakMessages.general;

      await client.chat.postMessage({
        channel: user.slackUserId,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: message
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Take Break Now"
                },
                style: "primary",
                action_id: "accept_break",
                value: suggestion.id
              },
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Maybe Later"
                },
                action_id: "decline_break",
                value: suggestion.id
              }
            ]
          }
        ]
      });
    } catch (error) {
      console.error("Failed to send break suggestion:", error);
    }
  }

  private async getUserClient(userId: string): Promise<WebClient | null> {
    try {
      const user = await storage.getUser(userId);
      if (!user) {
        return null;
      }

      // Get user's Slack integration (user token)
      const integration = await storage.getIntegrationByType(userId, 'slack_user');

      if (integration && integration.accessToken) {
        return new WebClient(integration.accessToken);
      }

      return null;
    } catch (error) {
      console.error("Failed to get user client:", error);
      return null;
    }
  }

  async setFocusMode(userId: string, duration: number) {
    try {
      const user = await storage.getUser(userId);
      if (!user || !user.slackUserId) {
        return;
      }

      // Try to get user token first for status setting
      const userClient = await this.getUserClient(userId);
      
      if (userClient) {
        // We have user token - set status directly!
        const endTime = new Date(Date.now() + duration * 60 * 1000);
        
        try {
          await userClient.users.profile.set({
            profile: {
              status_text: "In focus mode",
              status_emoji: ":dart:",
              status_expiration: Math.floor(endTime.getTime() / 1000)
            }
          });

          // Get user's timezone for proper time display
          const userTimezone = user.timezone || 'America/New_York'; // Default to Eastern if not set
          const endTimeFormatted = endTime.toLocaleTimeString('en-US', {
            timeZone: userTimezone,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });

          // Send success DM with bot client
          const botClient = await this.getClient(user.slackTeamId || undefined);
          await botClient.chat.postMessage({
            channel: user.slackUserId,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `🎯 *Focus Session Started!*\n\n⏰ Duration: ${duration} minutes\n🕐 Ends at: ${endTimeFormatted}\n\n✅ Your Slack status has been automatically updated!\n\n📝 *Focus Tips:*\n• Close unnecessary tabs and apps\n• Put phone in silent mode\n• Set clear goals for this session`
                }
              }
            ]
          });

          console.log(`Successfully set focus status for user ${user.slackUserId}`);
        } catch (statusError) {
          console.error("Failed to set status, falling back to notification:", statusError);
          // Fall back to notification if status setting fails
          await this.sendFocusNotification(user, duration);
        }
      } else {
        // No user token - send helpful notification
        await this.sendFocusNotification(user, duration);
      }

      // Update the focus session to mark status as set
      const activeSession = await storage.getActiveFocusSession(userId);
      if (activeSession) {
        await storage.updateFocusSession(activeSession.id, { slackStatusSet: true });
      }
    } catch (error) {
      console.error("Failed to set focus mode:", error);
    }
  }

  async clearFocusMode(userId: string) {
    try {
      const user = await storage.getUser(userId);
      if (!user || !user.slackUserId) return;

      // Try to get user token first for status clearing
      const userClient = await this.getUserClient(userId);
      
      if (userClient) {
        // We have user token - clear status directly!
        try {
          await userClient.users.profile.set({
            profile: {
              status_text: "",
              status_emoji: "",
              status_expiration: 0
            }
          });

          // Send completion DM with bot client
          const botClient = await this.getClient(user.slackTeamId || undefined);
          await botClient.chat.postMessage({
            channel: user.slackUserId,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `✅ *Focus Session Complete!*\n\nGreat work! You've finished your focus session.\n\n✅ Your Slack status has been automatically cleared.\n\nTime to take a well-deserved break or move on to your next task! 🎉`
                }
              }
            ]
          });

          console.log(`Successfully cleared focus status for user ${user.slackUserId}`);
        } catch (statusError) {
          console.error("Failed to clear status, sending notification:", statusError);
          // Fall back to notification if status clearing fails
          await this.sendFocusCompletionNotification(user);
        }
      } else {
        // No user token - send helpful notification
        await this.sendFocusCompletionNotification(user);
      }
    } catch (error) {
      console.error("Failed to clear focus mode:", error);
    }
  }

  private async sendFocusNotification(user: any, duration: number) {
    const client = await this.getClient(user.slackTeamId || undefined);
    const endTime = new Date(Date.now() + duration * 60 * 1000);
    
    // Get user's timezone for proper time display
    const userTimezone = user.timezone || 'America/New_York'; // Default to Eastern if not set
    const endTimeFormatted = endTime.toLocaleTimeString('en-US', {
      timeZone: userTimezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    await client.chat.postMessage({
      channel: user.slackUserId,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🎯 *Focus Session Started!*\n\n⏰ Duration: ${duration} minutes\n🕐 Ends at: ${endTimeFormatted}\n\n💡 *Pro tip:* For automatic status updates, reinstall the app from your workspace's App Directory to grant user permissions!\n\n📝 *Focus Tips:*\n• Close unnecessary tabs and apps\n• Put phone in silent mode\n• Set your Slack status to "🎯 In focus mode"\n• Set clear goals for this session`
          }
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: "🔄 _Your focus session is being tracked. Click 'End Focus Session' when you're done._"
            }
          ]
        }
      ]
    });
  }

  private async sendFocusCompletionNotification(user: any) {
    const client = await this.getClient(user.slackTeamId || undefined);

    await client.chat.postMessage({
      channel: user.slackUserId,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ *Focus Session Complete!*\n\nGreat work! You've finished your focus session. Time to take a well-deserved break or move on to your next task.\n\n💡 _Don't forget to update your Slack status if you set it manually._`
          }
        }
      ]
    });
  }

  async sendProductivitySummary(userId: string, summary: any) {
    try {
      const user = await storage.getUser(userId);
      if (!user || !user.slackUserId) return;

      const client = await this.getClient(user.slackTeamId || undefined);

      await client.chat.postMessage({
        channel: user.slackUserId,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "📊 Your Daily Productivity Summary"
            }
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*Meeting Time:* ${Math.round(summary.totalMeetingTime / 60)}h ${summary.totalMeetingTime % 60}m`
              },
              {
                type: "mrkdwn",
                text: `*Focus Sessions:* ${summary.focusSessionsCompleted}`
              },
              {
                type: "mrkdwn",
                text: `*Meetings:* ${summary.meetingCount}`
              },
              {
                type: "mrkdwn",
                text: `*Focus Time:* ${Math.round(summary.focusTime / 60)}h ${summary.focusTime % 60}m`
              }
            ]
          }
        ]
      });
    } catch (error) {
      console.error("Failed to send productivity summary:", error);
    }
  }

  private getBreakMessage(type: string): string {
    const messages = {
      hydration: "💧 Stay hydrated! Time for a water break.",
      stretch: "🤸‍♀️ Your body needs movement. Take a quick stretch break!",
      meditation: "🧘‍♂️ Reset your mind with a 5-minute meditation break.",
      walk: "🚶‍♀️ Step outside for a refreshing walk.",
      general: "⏰ Time for a wellness break!"
    };
    return messages[type as keyof typeof messages] || messages.general;
  }

  // New method to set break status (similar to focus mode)
  async setBreakMode(userId: string, duration: number) {
    try {
      const user = await storage.getUser(userId);
      if (!user || !user.slackUserId) return;

      // Try to get user token first for status setting
      const userClient = await this.getUserClient(userId);
      
      if (userClient) {
        // We have user token - set status directly!
        const endTime = new Date(Date.now() + duration * 60 * 1000);
        
        try {
          await userClient.users.profile.set({
            profile: {
              status_text: "On a coffee break",
              status_emoji: ":coffee:",
              status_expiration: Math.floor(endTime.getTime() / 1000)
            }
          });

          // Get user's timezone for proper time display
          const userTimezone = user.timezone || 'America/New_York';
          const endTimeFormatted = endTime.toLocaleTimeString('en-US', {
            timeZone: userTimezone,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });

          // Send success DM with bot client
          const botClient = await this.getClient(user.slackTeamId || undefined);
          await botClient.chat.postMessage({
            channel: user.slackUserId,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `☕ *Coffee Break Started!*\n\n⏰ Duration: ${duration} minutes\n🕐 Ends at: ${endTimeFormatted}\n\n✅ Your Slack status has been automatically updated!\n\n🎉 *Enjoy your break:*\n• Step away from your screen\n• Hydrate and stretch\n• Take a few deep breaths\n• You've earned this time!`
                }
              }
            ]
          });

          console.log(`Successfully set coffee break status for user ${user.slackUserId}`);
        } catch (statusError) {
          console.error("Failed to set break status:", statusError);
          // Send notification even if status setting fails
          await this.sendBreakNotification(user, duration);
        }
      } else {
        // No user token - send helpful notification
        await this.sendBreakNotification(user, duration);
      }
    } catch (error) {
      console.error("Failed to set break mode:", error);
    }
  }

  private async sendBreakNotification(user: any, duration: number) {
    const client = await this.getClient(user.slackTeamId || undefined);
    const endTime = new Date(Date.now() + duration * 60 * 1000);
    
    // Get user's timezone for proper time display
    const userTimezone = user.timezone || 'America/New_York';
    const endTimeFormatted = endTime.toLocaleTimeString('en-US', {
      timeZone: userTimezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    await client.chat.postMessage({
      channel: user.slackUserId,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `☕ *Coffee Break Started!*\n\n⏰ Duration: ${duration} minutes\n🕐 Ends at: ${endTimeFormatted}\n\n💡 *Pro tip:* For automatic status updates, make sure you've granted user permissions!\n\n🌟 *Break Tips:*\n• Set your Slack status to "☕ On a coffee break"\n• Step away from your desk\n• Hydrate and stretch\n• Take some deep breaths`
          }
        }
      ]
    });
  }

  // Meeting-aware break suggestion methods
  private async getTodaysMeetings(userId: string) {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    
    return await storage.getUserMeetings(userId, startOfDay, endOfDay);
  }

  private async isCurrentlyInMeeting(userId: string): Promise<boolean> {
    const now = new Date();
    const meetings = await this.getTodaysMeetings(userId);
    
    return meetings.some(meeting => {
      const startTime = new Date(meeting.startTime);
      const endTime = new Date(meeting.endTime);
      return now >= startTime && now <= endTime;
    });
  }

  private async getNextMeetingTime(userId: string): Promise<Date | null> {
    const now = new Date();
    const meetings = await this.getTodaysMeetings(userId);
    
    const upcomingMeetings = meetings
      .filter(meeting => new Date(meeting.startTime) > now)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    return upcomingMeetings.length > 0 ? new Date(upcomingMeetings[0].startTime) : null;
  }

  private async shouldSuggestBreak(userId: string): Promise<{ suggest: boolean; reason: string }> {
    // Check if currently in a meeting
    const inMeeting = await this.isCurrentlyInMeeting(userId);
    if (inMeeting) {
      return { suggest: false, reason: "Currently in a meeting" };
    }

    // Check if next meeting is soon (within 10 minutes)
    const nextMeeting = await this.getNextMeetingTime(userId);
    if (nextMeeting) {
      const timeUntilMeeting = nextMeeting.getTime() - Date.now();
      const minutesUntilMeeting = Math.floor(timeUntilMeeting / (1000 * 60));
      
      if (minutesUntilMeeting <= 10) {
        return { 
          suggest: false, 
          reason: `Next meeting in ${minutesUntilMeeting} minutes` 
        };
      }
      
      if (minutesUntilMeeting <= 30) {
        return { 
          suggest: true, 
          reason: `Perfect timing! ${minutesUntilMeeting} minutes until your next meeting` 
        };
      }
    }

    return { suggest: true, reason: "No meetings scheduled soon" };
  }

  // Generate demo data from Slack button
  private async generateDemoDataFromSlack(userId: string, slackUserId: string) {
    try {
      // Import the function from routes
      const { generateTestMeetingData } = await import('../routes');
      await generateTestMeetingData(userId);

      return {
        replace_original: true,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "✅ *Demo data generated!*\n\nGreat! I've created realistic meeting data for the past and upcoming weeks. Try `/productivity` again to see your updated summary, or click the button below to view your full dashboard."
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "View Full Dashboard"
                },
                url: `${process.env.FRONTEND_URL || 'http://localhost:5000'}/dashboard?userId=${userId}`,
                action_id: "view_dashboard"
              }
            ]
          }
        ]
      };
    } catch (error) {
      console.error("Generate demo data error:", error);
      return {
        replace_original: true,
        text: "❌ Failed to generate demo data. Please try again."
      };
    }
  }

  // Update daily productivity metrics
  private async updateDailyMetrics(userId: string, date: Date) {
    try {
      const { analyticsService } = await import('./analytics');
      await analyticsService.processProductivityMetrics(userId, date);
    } catch (error) {
      console.error("Failed to update daily metrics:", error);
    }
  }
}

export const slackService = new SlackService();
