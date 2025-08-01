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
            text: "Unknown command. Available commands: /focus, /break, /productivity"
          };
      }

      res.json(response);
    } catch (error) {
      console.error("Slash command error:", error);
      res.status(500).json({ error: "Command failed" });
    }
  }

  // Handle interactive components (buttons, modals, etc.)
  async handleInteractivity(req: any, res: any) {
    try {
      const payload = JSON.parse(req.body.payload);
      const { type, user, team, actions } = payload;

      let response;
      switch (type) {
        case "block_actions":
          response = await this.handleBlockActions(payload);
          break;
        case "view_submission":
          response = await this.handleViewSubmission(payload);
          break;
        default:
          response = { response_action: "clear" };
      }

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
            
            // Check if user already exists
            let user = await storage.getUserBySlackId(result.authed_user.id!);
            
            if (user) {
              console.log(`User ${result.authed_user.id} already exists`);
              // Update existing user with user token
              await storage.updateUser(user.id, {
                name: result.authed_user.id!, // Will be updated when we get more info
              });
            } else {
              console.log(`Creating new user ${result.authed_user.id}`);
              // Create new user
              user = await storage.createUser({
                slackUserId: result.authed_user.id!,
                email: `${result.authed_user.id}@slack.local`, // Placeholder, will be updated
                name: "Slack User",
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

    const suggestion = await storage.createBreakSuggestion({
      userId: user.id,
      type: breakType,
      message: `You requested a ${breakType} break`,
      reason: "user_requested"
    });

    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `☕ *Break time!*\n${this.getBreakMessage(breakType)}`
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
    
    const metrics = await storage.getProductivityMetrics(user.id, weekAgo, today);
    const meetings = await storage.getUserMeetings(user.id, weekAgo, today);
    
    const totalMeetingTime = metrics.reduce((sum, m) => sum + (m.totalMeetingTime || 0), 0);
    const totalFocusTime = metrics.reduce((sum, m) => sum + (m.focusTime || 0), 0);
    const totalBreaks = metrics.reduce((sum, m) => sum + (m.breaksAccepted || 0), 0);

    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "📊 Your Productivity Summary (Last 7 Days)"
          }
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Meeting Time:*\n${Math.round(totalMeetingTime / 60)}h ${totalMeetingTime % 60}m`
            },
            {
              type: "mrkdwn",
              text: `*Focus Time:*\n${Math.round(totalFocusTime / 60)}h ${totalFocusTime % 60}m`
            },
            {
              type: "mrkdwn",
              text: `*Meetings:*\n${meetings.length} total`
            },
            {
              type: "mrkdwn",
              text: `*Breaks Taken:*\n${totalBreaks} breaks`
            }
          ]
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
              url: `${process.env.FRONTEND_URL || 'http://localhost:5000'}/dashboard`,
              action_id: "view_dashboard"
            }
          ]
        }
      ]
    };
  }

  private async handleBlockActions(payload: any) {
    const { actions, user, team } = payload;
    const action = actions[0];

    switch (action.action_id) {
      case "end_focus":
        return await this.endFocusSession(action.value, user.id);
      case "take_break":
        return await this.acceptBreakSuggestion(action.value, user.id);
      case "defer_break":
        return await this.deferBreakSuggestion(action.value, user.id);
      default:
        return { response_action: "clear" };
    }
  }

  private async handleViewSubmission(payload: any) {
    // Handle modal submissions
    return { response_action: "clear" };
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
      await storage.updateBreakSuggestion(suggestionId, {
        accepted: true,
        acceptedAt: new Date()
      });

      return {
        replace_original: true,
        text: "☕ Enjoy your break! You deserve it."
      };
    } catch (error) {
      console.error("Accept break error:", error);
      return { response_action: "clear" };
    }
  }

  private async deferBreakSuggestion(suggestionId: string, slackUserId: string) {
    return {
      replace_original: true,
      text: "👍 No problem! I'll remind you about taking breaks later."
    };
  }

  private async processSlackEvent(event: any) {
    switch (event.type) {
      case "app_mention":
        await this.handleAppMention(event);
        break;
      case "message":
        if (event.text && event.text.includes("break")) {
          await this.handleBreakRequest(event);
        }
        break;
    }
  }

  private async handleAppMention(event: any) {
    const client = await this.getClient(event.team);
    
    if (event.text.includes("focus")) {
      await client.chat.postMessage({
        channel: event.channel,
        text: "🎯 Ready to start a focus session? Use the `/focus` command to get started!",
      });
    } else if (event.text.includes("break")) {
      await client.chat.postMessage({
        channel: event.channel,
        text: "☕ Taking breaks is important! I can suggest the perfect time for your next break.",
      });
    } else {
      await client.chat.postMessage({
        channel: event.channel,
        text: "👋 Hi! I help you stay productive by managing your focus time and suggesting breaks. Try asking me about focus sessions or breaks!",
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
      if (!user) return null;

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
      if (!user || !user.slackUserId) return;

      // Try to get user token first for status setting
      const userClient = await this.getUserClient(userId);
      
      if (userClient) {
        // We have user token - set status directly!
        const endTime = new Date(Date.now() + duration * 60 * 1000);
        
        try {
          await userClient.users.profile.set({
            profile: {
              status_text: `In focus mode until ${endTime.toLocaleTimeString()}`,
              status_emoji: ":dart:",
              status_expiration: Math.floor(endTime.getTime() / 1000)
            }
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
                  text: `🎯 *Focus Session Started!*\n\n⏰ Duration: ${duration} minutes\n🕐 Ends at: ${endTime.toLocaleTimeString()}\n\n✅ Your Slack status has been automatically updated!\n\n📝 *Focus Tips:*\n• Close unnecessary tabs and apps\n• Put phone in silent mode\n• Set clear goals for this session`
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

    await client.chat.postMessage({
      channel: user.slackUserId,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🎯 *Focus Session Started!*\n\n⏰ Duration: ${duration} minutes\n🕐 Ends at: ${endTime.toLocaleTimeString()}\n\n💡 *Pro tip:* For automatic status updates, reinstall the app from your workspace's App Directory to grant user permissions!\n\n📝 *Focus Tips:*\n• Close unnecessary tabs and apps\n• Put phone in silent mode\n• Set your Slack status to "🎯 In focus mode"\n• Set clear goals for this session`
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
}

export const slackService = new SlackService();
