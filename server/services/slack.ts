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
    console.log(`🔑 Getting Slack client for teamId: ${teamId}`);
    
    if (teamId && this.clients.has(teamId)) {
      console.log(`✅ Using cached client for team: ${teamId}`);
      return this.clients.get(teamId)!;
    }

    // Try to get team-specific token from database
    if (teamId) {
      try {
        const team = await storage.getSlackTeam(teamId);
        if (team && team.botToken && team.botToken.trim() !== "") {
          console.log(`🏢 Found team-specific bot token for team: ${teamId}`);
          console.log(`🔐 Token starts with: ${team.botToken.substring(0, 10)}...`);
          const client = new WebClient(team.botToken);
          this.clients.set(teamId, client);
          return client;
        } else {
          console.log(`⚠️ No valid bot token found for team: ${teamId}`);
        }
      } catch (error) {
        console.error("Failed to get team from database:", error);
      }
    }

    // Fallback to default client with environment bot token
    if (this.clients.has("default")) {
      console.log(`🔄 Using cached default client`);
      return this.clients.get("default")!;
    }

    // Create default client if we have a bot token
    if (process.env.SLACK_BOT_TOKEN) {
      console.log(`🌍 Using environment bot token`);
      console.log(`🔐 Env token starts with: ${process.env.SLACK_BOT_TOKEN.substring(0, 10)}...`);
      const defaultClient = new WebClient(process.env.SLACK_BOT_TOKEN);
      this.clients.set("default", defaultClient);
      return defaultClient;
    }

    // If no token available, create a client anyway (will fail auth but won't crash)
    console.error("❌ No Slack bot token available - commands will fail with invalid_auth");
    return new WebClient();
  }

  async handleSlackEvents(req: any, res: any) {
    try {
      const { type, challenge, event } = req.body;

      // Handle URL verification
      if (type === "url_verification") {
        return res.json({ challenge });
      }

      // Immediately acknowledge the event to prevent Slack timeouts
      res.status(200).json({ ok: true });

      // Handle events asynchronously after acknowledgment
      if (type === "event_callback" && event) {
        // Process the event asynchronously to avoid blocking the response
        this.processSlackEvent(event).catch(error => {
          console.error("Error processing Slack event:", error);
        });
      }
    } catch (error) {
      console.error("Slack event handling error:", error);
      // Only send error response if we haven't already sent a response
      if (!res.headersSent) {
      res.status(500).json({ error: "Failed to handle Slack event" });
      }
    }
  }

  // Handle slash commands
  async handleSlackCommand(req: any, res: any) {
    try {
      const { command, text, user_id, team_id, channel_id } = req.body;

      console.log(`🔧 Slash command received: ${command} from user ${user_id} in team ${team_id}`);
      console.log(`📝 Command text: "${text}"`);
      console.log(`📋 Request headers:`, req.headers);

      // Verify request is from Slack (in production, verify signing secret)
      const slackSignature = req.headers['x-slack-signature'];
      const slackTimestamp = req.headers['x-slack-request-timestamp'];
      
      if (!slackSignature || !slackTimestamp) {
        console.log(`⚠️ Missing Slack signature headers`);
      } else {
        console.log(`✅ Slack signature headers present`);
      }
      
      // Send immediate acknowledgment for simple commands to prevent timeouts
      const isSimpleCommand = this.isSimpleCommand(command, text);
      
      if (isSimpleCommand) {
        // For simple commands, process immediately and respond
      let response;
        
      switch (command) {
        case "/focus":
          response = await this.handleFocusCommand(text, user_id, team_id);
          break;
        case "/break":
          response = await this.handleBreakCommand(text, user_id, team_id);
          break;
        case "/water":
          response = await this.handleWaterCommand(text, user_id, team_id);
          break;
        case "/productivity":
          response = await this.handleProductivityCommand(text, user_id, team_id);
          break;
        case "/test":
          response = {
            text: "🧪 Test command working! User: " + user_id + ", Team: " + team_id + ", Text: '" + text + "'"
          };
          break;
        default:
          response = {
              text: "Unknown command. Available commands: /focus, /break, /water, /productivity, /test\n\n💡 *Tip:* You can also message me directly or mention me in channels for natural language interactions!"
          };
      }

      console.log(`🔍 Sending response for ${command}:`, JSON.stringify(response, null, 2));
      res.json(response);
        return;
      }
      
      // For complex commands that might take longer, send immediate acknowledgment
      res.json({
        response_type: "ephemeral",
        text: "🤔 Processing your request...",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "🤔 *Processing your request...*\n\nI'm working on it! You'll see the full response shortly."
            }
          }
        ]
      });
      
      // Process the command asynchronously
      this.processComplexSlashCommand(command, text, user_id, team_id, channel_id).catch(error => {
        console.error("Error processing complex slash command:", error);
      });
      
    } catch (error) {
      console.error("Slash command error:", error);
      // Only send error response if we haven't already sent a response
      if (!res.headersSent) {
      res.status(500).json({ error: "Command failed" });
      }
    }
  }

  // Keep the old method name for backward compatibility
  async handleSlashCommand(req: any, res: any) {
    return this.handleSlackCommand(req, res);
  }

  private isSimpleCommand(command: string, text: string): boolean {
    // /test command is always simple
    if (command === "/test") {
      return true;
    }
    
    // Simple commands are those that don't require AI processing or complex operations
    if (!text || text.trim().length === 0) {
      return true; // Commands without text are simple
    }
    
    // Simple patterns that don't need AI
    const simplePatterns = [
      /^\d+$/, // Just numbers like "25"
      /^(end|stop)$/i, // Simple commands like "end"
      /^(general|hydration|stretch|meditation|walk)$/i, // Simple break types
    ];
    
    return simplePatterns.some(pattern => pattern.test(text.trim()));
  }

  private async processComplexSlashCommand(command: string, text: string, user_id: string, team_id: string, channel_id: string): Promise<void> {
    try {
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
            
            // Send the AI response as a DM to avoid cluttering the channel
            const client = await this.getClient(team_id);
            await client.chat.postMessage({
              channel: user_id, // Send as DM
              text: aiResponse.message,
              blocks: this.formatAIResponseBlocks(aiResponse)
            });
            return;
          }
        } catch (error) {
          console.error("AI processing failed for slash command, falling back:", error);
        }
      }
      
      // Fallback to traditional command handling for complex commands
      let response: any;
      switch (command) {
        case "/focus":
          response = await this.handleFocusCommand(text, user_id, team_id);
          break;
        case "/break":
          response = await this.handleBreakCommand(text, user_id, team_id);
          break;
        case "/water":
          response = await this.handleWaterCommand(text, user_id, team_id);
          break;
        case "/productivity":
          response = await this.handleProductivityCommand(text, user_id, team_id);
          break;
        default:
          response = {
            text: "Unknown command. Available commands: /focus, /break, /water, /productivity\n\n💡 *Tip:* You can also message me directly or mention me in channels for natural language interactions!"
          };
      }

      // Send the response as a DM
      const client = await this.getClient(team_id);
      await client.chat.postMessage({
        channel: user_id, // Send as DM
        text: response.text || response.response_type || "Command processed",
        blocks: response.blocks || []
      });
    } catch (error) {
      console.error("Error in processComplexSlashCommand:", error);
      // Try to send error message as DM
      try {
        const client = await this.getClient(team_id);
        await client.chat.postMessage({
          channel: user_id,
          text: "❌ Sorry, there was an error processing your command. Please try again."
        });
      } catch (dmError) {
        console.error("Failed to send error DM:", dmError);
      }
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

      // Send immediate acknowledgment to prevent Slack timeouts
      res.json({ response_action: "clear" });

      // Process the interaction asynchronously
      this.processInteractivityAsync(payload).catch(error => {
        console.error("Error processing interactivity:", error);
      });
    } catch (error) {
      console.error("Interactivity error:", error);
      // Only send error response if we haven't already sent a response
      if (!res.headersSent) {
        res.status(500).json({ error: "Interaction failed" });
      }
    }
  }

  private async processInteractivityAsync(payload: any): Promise<void> {
    try {
      const { type, user, team, actions } = payload;

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

      console.log(`Processed interactivity response:`, JSON.stringify(response, null, 2));
      
      // If we have a response that needs to be sent, send it as a DM
      if (response && user) {
        const responseAny = response as any;
        if (responseAny.text || responseAny.blocks) {
          try {
            const client = await this.getClient(team?.id);
            await client.chat.postMessage({
              channel: user.id,
              text: responseAny.text || "Action completed",
              blocks: responseAny.blocks || []
            });
          } catch (dmError) {
            console.error("Failed to send interactivity response DM:", dmError);
          }
        }
      }
    } catch (error) {
      console.error("Error in processInteractivityAsync:", error);
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
        'im:write',
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
  async handleFocusCommand(text: string, userId: string, teamId: string) {
    // Check if this is an "end" command
    if (text.trim().toLowerCase() === 'end') {
      return this.handleEndFocusCommand(userId, teamId);
    }
    
    // Parse the input to extract time slot and duration
    const parsedInput = this.parseFocusInput(text);
    
    if (parsedInput.error) {
      return {
        response_type: "ephemeral",
        text: `❌ ${parsedInput.error}\n\n📝 *Usage examples:*\n• \`/focus 25\` - Start now for 25 minutes\n• \`/focus 2:30pm 45\` - Start at 2:30 PM for 45 minutes\n• \`/focus 14:30 60\` - Start at 14:30 for 60 minutes\n• \`/focus now 30\` - Start immediately for 30 minutes\n• \`/focus end\` - End current session`
      };
    }
    
    const { startTime, duration } = parsedInput;
    
    try {
      // Set a timeout for the entire operation
      const result = await Promise.race([
        this.processFocusCommand(userId, teamId, duration, startTime),
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
        const isScheduled = startTime > new Date();
        const startTimeText = isScheduled ? 
          `\n⏰ Scheduled for: ${startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}` : 
          '';
        
        return {
          response_type: "ephemeral",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `🎯 *Focus ${isScheduled ? 'Session Scheduled' : 'Mode Activated'}!*\nDuration: ${duration} minutes${startTimeText}\n\n📝 *Quick Focus Tips:*\n• Close unnecessary tabs and apps\n• Put phone in silent mode\n• Set your Slack status to "🎯 In focus mode"\n• Set clear goals for this session\n\n${isScheduled ? '📅 You\'ll be reminded when it\'s time to start!' : '⏰ Timer started! You\'re now in focus mode.'}`
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

  // Parse focus command input to extract time and duration
  private parseFocusInput(text: string): { startTime: Date; duration: number; error?: string } {
    const trimmed = text.trim();
    
    // Handle empty input - default to now, 25 minutes
    if (!trimmed) {
      return { startTime: new Date(), duration: 25 };
    }
    
    const parts = trimmed.split(/\s+/);
    
    // Single number - duration only, start now
    if (parts.length === 1 && /^\d+$/.test(parts[0])) {
      const duration = parseInt(parts[0]);
      if (duration < 5 || duration > 240) {
        return { startTime: new Date(), duration: 25, error: "Duration must be between 5 and 240 minutes" };
      }
      return { startTime: new Date(), duration };
    }
    
    // Two parts - could be "now 25", "2:30pm 45", "14:30 60", etc.
    if (parts.length === 2) {
      const [timeStr, durationStr] = parts;
      const duration = parseInt(durationStr);
      
      if (isNaN(duration) || duration < 5 || duration > 240) {
        return { startTime: new Date(), duration: 25, error: "Duration must be between 5 and 240 minutes" };
      }
      
      // Handle "now" keyword
      if (timeStr.toLowerCase() === 'now') {
        return { startTime: new Date(), duration };
      }
      
      // Parse time formats
      const startTime = this.parseTimeString(timeStr);
      if (!startTime) {
        return { startTime: new Date(), duration: 25, error: "Invalid time format. Use formats like '2:30pm', '14:30', or 'now'" };
      }
      
      // Check if time is in the past (more than 5 minutes ago)
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      if (startTime < fiveMinutesAgo) {
        return { startTime: new Date(), duration: 25, error: "Cannot schedule focus sessions in the past" };
      }
      
      // Check if time is too far in the future (more than 24 hours)
      const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      if (startTime > twentyFourHoursFromNow) {
        return { startTime: new Date(), duration: 25, error: "Cannot schedule focus sessions more than 24 hours in advance" };
      }
      
      return { startTime, duration };
    }
    
    // Invalid format
    return { startTime: new Date(), duration: 25, error: "Invalid command format" };
  }
  
  // Parse break command input to extract time, duration, and break type
  private parseBreakInput(text: string): { startTime: Date; duration: number; breakType: string; error?: string } {
    const trimmed = text.trim();
    
    // Handle empty input - default break suggestion
    if (!trimmed) {
      return { startTime: new Date(), duration: 15, breakType: "general" }; // Default 15-minute general break
    }
    
    const parts = trimmed.split(/\s+/);
    const breakTypes = ['coffee', 'hydration', 'stretch', 'meditation', 'walk', 'lunch', 'general'];
    
    // Single input - could be duration or break type
    if (parts.length === 1) {
      // Check if it's a number (duration)
      if (/^\d+$/.test(parts[0])) {
        const duration = parseInt(parts[0]);
        if (duration < 1 || duration > 120) {
          return { startTime: new Date(), duration: 15, breakType: "general", error: "Break duration must be between 1 and 120 minutes" };
        }
        return { startTime: new Date(), duration, breakType: "general" };
      }
      
      // Check if it's a break type
      const breakType = parts[0].toLowerCase();
      if (breakTypes.includes(breakType)) {
        return { startTime: new Date(), duration: this.getDefaultBreakDuration(breakType), breakType };
      }
      
      return { startTime: new Date(), duration: 15, breakType: "general", error: "Invalid input. Use a number for duration or a break type (coffee, stretch, etc.)" };
    }
    
    // Two parts - could be "duration type", "time duration", or "now duration"
    if (parts.length === 2) {
      const [first, second] = parts;
      
      // Check if first is "now"
      if (first.toLowerCase() === 'now') {
        const duration = parseInt(second);
        if (isNaN(duration) || duration < 1 || duration > 120) {
          return { startTime: new Date(), duration: 15, breakType: "general", error: "Break duration must be between 1 and 120 minutes" };
        }
        return { startTime: new Date(), duration, breakType: "general" };
      }
      
      // Check if first is a time (2:30pm, 14:30)
      const startTime = this.parseTimeString(first);
      if (startTime) {
        const duration = parseInt(second);
        if (isNaN(duration) || duration < 1 || duration > 120) {
          return { startTime: new Date(), duration: 15, breakType: "general", error: "Break duration must be between 1 and 120 minutes" };
        }
        
        // Validate timing (same as focus sessions)
        const now = new Date();
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
        if (startTime < fiveMinutesAgo) {
          return { startTime: new Date(), duration: 15, breakType: "general", error: "Cannot schedule breaks in the past" };
        }
        
        const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        if (startTime > twentyFourHoursFromNow) {
          return { startTime: new Date(), duration: 15, breakType: "general", error: "Cannot schedule breaks more than 24 hours in advance" };
        }
        
        return { startTime, duration, breakType: "general" };
      }
      
      // Check if first is duration and second is break type
      const duration = parseInt(first);
      const breakType = second.toLowerCase();
      if (!isNaN(duration) && breakTypes.includes(breakType)) {
        if (duration < 1 || duration > 120) {
          return { startTime: new Date(), duration: 15, breakType: "general", error: "Break duration must be between 1 and 120 minutes" };
        }
        return { startTime: new Date(), duration, breakType };
      }
      
      return { startTime: new Date(), duration: 15, breakType: "general", error: "Invalid format. Use 'duration type' or 'time duration'" };
    }
    
    // Three parts - "time duration type" or "now duration type"
    if (parts.length === 3) {
      const [first, second, third] = parts;
      
      // Handle "now duration type"
      if (first.toLowerCase() === 'now') {
        const duration = parseInt(second);
        const breakType = third.toLowerCase();
        
        if (isNaN(duration) || duration < 1 || duration > 120) {
          return { startTime: new Date(), duration: 15, breakType: "general", error: "Break duration must be between 1 and 120 minutes" };
        }
        
        if (!breakTypes.includes(breakType)) {
          return { startTime: new Date(), duration: 15, breakType: "general", error: `Invalid break type. Use: ${breakTypes.join(', ')}` };
        }
        
        return { startTime: new Date(), duration, breakType };
      }
      
      // Handle "time duration type"
      const startTime = this.parseTimeString(first);
      if (startTime) {
        const duration = parseInt(second);
        const breakType = third.toLowerCase();
        
        if (isNaN(duration) || duration < 1 || duration > 120) {
          return { startTime: new Date(), duration: 15, breakType: "general", error: "Break duration must be between 1 and 120 minutes" };
        }
        
        if (!breakTypes.includes(breakType)) {
          return { startTime: new Date(), duration: 15, breakType: "general", error: `Invalid break type. Use: ${breakTypes.join(', ')}` };
        }
        
        // Validate timing
        const now = new Date();
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
        if (startTime < fiveMinutesAgo) {
          return { startTime: new Date(), duration: 15, breakType: "general", error: "Cannot schedule breaks in the past" };
        }
        
        const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        if (startTime > twentyFourHoursFromNow) {
          return { startTime: new Date(), duration: 15, breakType: "general", error: "Cannot schedule breaks more than 24 hours in advance" };
        }
        
        return { startTime, duration, breakType };
      }
    }
    
    // Invalid format
    return { startTime: new Date(), duration: 15, breakType: "general", error: "Invalid command format" };
  }
  
  // Get default duration for break types
  private getDefaultBreakDuration(breakType: string): number {
    const durations = {
      coffee: 10,
      hydration: 5,
      stretch: 10,
      meditation: 15,
      walk: 20,
      lunch: 60,
      general: 15
    };
    return durations[breakType as keyof typeof durations] || 15;
  }

  // Parse time string into Date object (today at specified time)
  private parseTimeString(timeStr: string): Date | null {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    try {
      // Handle 12-hour format (2:30pm, 10:15am)
      const twelveHourMatch = timeStr.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
      if (twelveHourMatch) {
        let hours = parseInt(twelveHourMatch[1]);
        const minutes = parseInt(twelveHourMatch[2]);
        const ampm = twelveHourMatch[3].toLowerCase();
        
        if (ampm === 'pm' && hours !== 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;
        
        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
          return new Date(today.getTime() + hours * 60 * 60 * 1000 + minutes * 60 * 1000);
        }
      }
      
      // Handle 24-hour format (14:30, 09:15)
      const twentyFourHourMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
      if (twentyFourHourMatch) {
        const hours = parseInt(twentyFourHourMatch[1]);
        const minutes = parseInt(twentyFourHourMatch[2]);
        
        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
          return new Date(today.getTime() + hours * 60 * 60 * 1000 + minutes * 60 * 1000);
        }
      }
      
      // Handle hour only (14, 2pm)
      const hourOnlyMatch = timeStr.match(/^(\d{1,2})\s*(am|pm)?$/i);
      if (hourOnlyMatch) {
        let hours = parseInt(hourOnlyMatch[1]);
        const ampm = hourOnlyMatch[2]?.toLowerCase();
        
        if (ampm === 'pm' && hours !== 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;
        
        if (hours >= 0 && hours <= 23) {
          return new Date(today.getTime() + hours * 60 * 60 * 1000);
        }
      }
    } catch (error) {
      console.error("Error parsing time string:", error);
    }
    
    return null;
  }

  private async processFocusCommand(userId: string, teamId: string, duration: number, startTime: Date = new Date()) {
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

    const now = new Date();
    const isScheduled = startTime > now;
    
    // For immediate sessions, use current time; for scheduled sessions, use specified time
    const sessionStartTime = isScheduled ? startTime : now;

    // Create focus session
    const session = await storage.createFocusSession({
      userId: user.id,
      duration,
      startTime: sessionStartTime,
      status: isScheduled ? 'scheduled' : 'active'
    });

    // Update daily productivity metrics (async, don't block response)
    this.updateDailyMetrics(user.id, sessionStartTime).catch(console.error);

    if (isScheduled) {
      // For scheduled sessions, show confirmation and schedule reminder
      const userTimezone = user?.timezone || 'America/New_York';
      const startTimeFormatted = sessionStartTime.toLocaleTimeString('en-US', {
        timeZone: userTimezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      
      // TODO: Here we could schedule a reminder using the scheduler service
      // schedulerService.scheduleReminder(user.id, sessionStartTime, session.id)
      
      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `📅 *Focus session scheduled!*\n\n⏰ Start time: ${startTimeFormatted}\n⏱️ Duration: ${duration} minutes\n\n✅ I'll send you a reminder when it's time to start your focus session!\n\n💡 *Preparation tips:*\n• Block your calendar if needed\n• Prepare your workspace\n• Set clear goals for the session`
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Cancel Session"
                },
                style: "danger",
                action_id: "cancel_scheduled_focus",
                value: session.id
              }
            ]
          }
        ]
      };
    } else {
      // For immediate sessions, set Slack status and start now
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
  }

  async handleBreakCommand(text: string, userId: string, teamId: string) {
    // Parse the input to extract timing, duration, and break type
    const parsedInput = this.parseBreakInput(text);
    
    if (parsedInput.error) {
      return {
        response_type: "ephemeral",
        text: `❌ ${parsedInput.error}\n\n📝 *Usage examples:*\n• \`/break 15\` - Take a 15-minute break now\n• \`/break 2:30pm 20\` - Schedule a 20-minute break at 2:30 PM\n• \`/break now 10 coffee\` - Take a 10-minute coffee break now\n• \`/break 30 lunch\` - Take a 30-minute lunch break\n• \`/break\` - Get a wellness break suggestion`
      };
    }
    
    const { startTime, duration, breakType } = parsedInput;
    
    try {
      // Set a timeout for the entire operation
      const result = await Promise.race([
        this.processBreakCommand(userId, teamId, breakType, duration, startTime),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), 1000)
        )
      ]);
      
      return result;
    } catch (error) {
      console.error("Break command error:", error);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isScheduled = startTime > new Date();
      
      return {
        response_type: "ephemeral",
        text: errorMessage === 'Operation timeout'
          ? `☕ Your ${duration}-minute ${breakType} break ${isScheduled ? 'is being scheduled' : 'suggestion is being prepared'}!`
          : "❌ Failed to process break request. Please try again."
      };
    }
  }

  async handleWaterCommand(text: string, userId: string, teamId: string) {
    // Parse the input to extract action and parameters
    const parsedInput = this.parseWaterInput(text);
    
    if (parsedInput.error) {
      return {
        response_type: "ephemeral",
        text: `❌ ${parsedInput.error}\n\n💧 *Usage examples:*\n• \`/water\` - Log 1 glass of water\n• \`/water 3\` - Log 3 glasses\n• \`/water goal 8\` - Set daily goal to 8 glasses\n• \`/water stats\` - Show today's progress\n• \`/water remind 2h\` - Set reminders every 2 hours`
      };
    }
    
    const { action, glasses, goal, reminderInterval } = parsedInput;
    
    try {
      // Set a timeout for the entire operation
      const result = await Promise.race([
        this.processWaterCommand(userId, teamId, action, glasses, goal, reminderInterval),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Operation timeout')), 1000)
        )
      ]);
      
      return result;
    } catch (error) {
      console.error("Water command error:", error);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        response_type: "ephemeral",
        text: errorMessage === 'Operation timeout'
          ? "💧 Processing your water tracking request..."
          : "❌ Failed to process water request. Please try again."
      };
    }
  }

  // Parse water command input
  private parseWaterInput(text: string): { 
    action: 'log' | 'goal' | 'stats' | 'remind'; 
    glasses?: number; 
    goal?: number; 
    reminderInterval?: number; 
    error?: string 
  } {
    const trimmed = text.trim();
    
    // Handle empty input - default to logging 1 glass
    if (!trimmed) {
      return { action: 'log', glasses: 1 };
    }
    
    const parts = trimmed.split(/\s+/);
    
    // Single number - log that many glasses
    if (parts.length === 1 && /^\d+$/.test(parts[0])) {
      const glasses = parseInt(parts[0]);
      if (glasses < 1 || glasses > 20) {
        return { action: 'log', error: "Please log between 1 and 20 glasses at a time" };
      }
      return { action: 'log', glasses };
    }
    
    // Check for specific actions
    const firstWord = parts[0].toLowerCase();
    
    if (firstWord === 'stats' || firstWord === 'status' || firstWord === 'progress') {
      return { action: 'stats' };
    }
    
    if (firstWord === 'goal') {
      if (parts.length !== 2 || !/^\d+$/.test(parts[1])) {
        return { action: 'goal', error: "Usage: /water goal [number] (e.g., /water goal 8)" };
      }
      const goal = parseInt(parts[1]);
      if (goal < 1 || goal > 20) {
        return { action: 'goal', error: "Daily goal should be between 1 and 20 glasses" };
      }
      return { action: 'goal', goal };
    }
    
    if (firstWord === 'remind' || firstWord === 'reminder') {
      if (parts.length !== 2) {
        return { action: 'remind', error: "Usage: /water remind [interval] (e.g., /water remind 2h, /water remind 90m)" };
      }
      
      const intervalStr = parts[1].toLowerCase();
      let reminderInterval: number;
      
      // Parse interval (support h for hours, m for minutes)
      if (intervalStr.endsWith('h')) {
        const hours = parseInt(intervalStr.slice(0, -1));
        if (isNaN(hours) || hours < 1 || hours > 8) {
          return { action: 'remind', error: "Reminder interval should be between 1-8 hours" };
        }
        reminderInterval = hours * 60; // convert to minutes
      } else if (intervalStr.endsWith('m')) {
        reminderInterval = parseInt(intervalStr.slice(0, -1));
        if (isNaN(reminderInterval) || reminderInterval < 30 || reminderInterval > 480) {
          return { action: 'remind', error: "Reminder interval should be between 30-480 minutes" };
        }
      } else {
        // Try parsing as plain number (assume minutes)
        reminderInterval = parseInt(intervalStr);
        if (isNaN(reminderInterval) || reminderInterval < 30 || reminderInterval > 480) {
          return { action: 'remind', error: "Reminder interval should be between 30-480 minutes" };
        }
      }
      
      return { action: 'remind', reminderInterval };
    }
    
    // If first word is a number, it might be "glasses action" format
    if (/^\d+$/.test(firstWord)) {
      const glasses = parseInt(firstWord);
      if (glasses < 1 || glasses > 20) {
        return { action: 'log', error: "Please log between 1 and 20 glasses at a time" };
      }
      return { action: 'log', glasses };
    }
    
    // Invalid format
    return { action: 'log', error: "Invalid command format" };
  }

  private async processWaterCommand(
    userId: string, 
    teamId: string, 
    action: 'log' | 'goal' | 'stats' | 'remind',
    glasses?: number,
    goal?: number,
    reminderInterval?: number
  ) {
    // Ensure team info is stored
    await this.ensureTeamStored(teamId);

    let user = await storage.getUserBySlackId(userId);
    
    // If user doesn't exist, create them automatically
    if (!user) {
      user = await storage.createUser({
        slackUserId: userId,
        slackTeamId: teamId,
        email: `${userId}@slack.local`,
        name: "Slack User",
      });
      
      // Log activity without waiting
      storage.logActivity({
        userId: user.id,
        action: "user_auto_created",
        details: { slackUserId: userId, teamId, trigger: "water_command" }
      }).catch(console.error);
    }

    switch (action) {
      case 'log':
        return await this.logWaterIntake(user.id, glasses || 1);
      case 'goal':
        return await this.setWaterGoal(user.id, goal!);
      case 'stats':
        return await this.getWaterStats(user.id);
      case 'remind':
        return await this.setWaterReminders(user.id, reminderInterval!);
      default:
        return {
          response_type: "ephemeral",
          text: "❌ Invalid water command action"
        };
    }
  }

  private async processBreakCommand(userId: string, teamId: string, breakType: string, duration: number = 15, startTime: Date = new Date()) {
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

    const now = new Date();
    const isScheduled = startTime > now;
    
    // For immediate breaks, check if this is a good time based on calendar
    const breakCheck = isScheduled ? 
      { suggest: true, reason: "Scheduled break" } : 
      await this.shouldSuggestBreak(user.id);
    
    if (!isScheduled && !breakCheck.suggest) {
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

    // Create break suggestion
    const suggestion = await storage.createBreakSuggestion({
      userId: user.id,
      type: breakType,
      message: `You requested a ${duration}-minute ${breakType} break`,
      reason: breakCheck.reason,
      suggestedAt: startTime
    });

    // Update daily productivity metrics (async, don't block response)
    this.updateDailyMetrics(user.id, startTime).catch(console.error);

    if (isScheduled) {
      // For scheduled breaks, show confirmation and schedule reminder
      const userTimezone = user?.timezone || 'America/New_York';
      const startTimeFormatted = startTime.toLocaleTimeString('en-US', {
        timeZone: userTimezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });

    return {
      response_type: "ephemeral",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
              text: `📅 *Break scheduled!*\n\n⏰ Start time: ${startTimeFormatted}\n⏱️ Duration: ${duration} minutes\n☕ Type: ${this.getBreakMessage(breakType)}\n\n✅ I'll send you a reminder when it's time for your break!\n\n💡 *Break prep tips:*\n• Clear your current task\n• Set expectations with colleagues\n• Prepare for a refreshing pause`
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                  text: "Cancel Break"
              },
                style: "danger",
                action_id: "cancel_scheduled_break",
              value: suggestion.id
              }
            ]
          }
        ]
      };
    } else {
      // For immediate breaks, start the break now
      this.setBreakMode(user.id, duration).catch(console.error);

      // Mark the suggestion as accepted immediately for instant breaks
      storage.updateBreakSuggestion(suggestion.id, {
        accepted: true,
        acceptedAt: new Date()
      }).catch(console.error);

      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `☕ *${duration}-minute ${breakType} break started!*\n\n${this.getBreakMessage(breakType)}\n\n⚡ Setting up your Slack status automatically...\n\n✨ *Perfect timing:* ${breakCheck.reason}\n\n🌟 *Enjoy your break:*\n• Step away from your screen\n• ${this.getBreakTip(breakType)}\n• You've earned this time!`
            }
          },
          {
            type: "actions",
            elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                  text: "End Break Early"
              },
                style: "danger",
                action_id: "end_break",
              value: suggestion.id
            }
          ]
        }
      ]
    };
    }
  }

  async handleProductivityCommand(text: string, userId: string, teamId: string) {
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

    // Start proactive break monitoring for this user
    this.startProactiveBreakMonitoring(user.id).catch(console.error);

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

    const response = {
      response_type: "ephemeral",
      text: "📊 Your Productivity Summary", // Fallback text
      blocks
    };

    console.log(`📊 Productivity command response for ${userId}:`);
    console.log(`- Response type: ${response.response_type}`);
    console.log(`- Number of blocks: ${blocks.length}`);
    console.log(`- Block types: ${blocks.map(b => b.type).join(', ')}`);
    
    return response;
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
      case "proactive_break_now":
        console.log("Handling proactive_break_now action");
        return await this.handleProactiveBreakNow(action.value, user.id);
      case "proactive_break_delay_30":
        console.log("Handling proactive_break_delay_30 action");
        return await this.handleProactiveBreakDelay(action.value, user.id, 30);
      case "proactive_break_delay_60":
        console.log("Handling proactive_break_delay_60 action");
        return await this.handleProactiveBreakDelay(action.value, user.id, 60);
      case "proactive_break_dismiss":
        console.log("Handling proactive_break_dismiss action");
        return await this.handleProactiveBreakDismiss(action.value, user.id);
      case "cancel_scheduled_focus":
        console.log("Handling cancel_scheduled_focus action");
        return await this.cancelScheduledFocusSession(action.value, user.id);
      case "cancel_scheduled_break":
        console.log("Handling cancel_scheduled_break action");
        return await this.cancelScheduledBreak(action.value, user.id);
      case "end_break":
        console.log("Handling end_break action");
        return await this.endBreakEarly(action.value, user.id);
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
      case "log_water_1":
        console.log("Handling log_water_1 action");
        return await this.handleWaterButton(action.value, user.id, 'log', 1);
      case "water_stats":
        console.log("Handling water_stats action");
        return await this.handleWaterButton(action.value, user.id, 'stats');
      case "water_goal_setup":
        console.log("Handling water_goal_setup action");
        return await this.showWaterGoalModal(action.value, user.id);
      case "water_remind_setup":
        console.log("Handling water_remind_setup action");
        return await this.showWaterReminderModal(action.value, user.id);
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
      const statusText = response.executed 
        ? "✅ _Command executed successfully_" 
        : "❌ _Command failed to execute_";
      
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: statusText
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
      // Send immediate acknowledgment to prevent Slack timeouts
      // For DMs, we can't send an immediate response, but we can process quickly
      
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
        
        console.log(`🤖 Processing AI message for user ${event.user} in team ${event.team}`);
        const client = await this.getClient(event.team);
        
        console.log(`📤 Sending AI response to channel ${event.channel}`);
        await client.chat.postMessage({
          channel: event.channel,
          text: response.message,
          blocks: this.formatAIResponseBlocks(response)
        });
        console.log(`✅ AI response sent successfully`);
        return; // Exit here - don't fall through to fallback
      }
    } catch (error) {
      console.error("AI service error for DM, falling back to simple responses:", error);
      // Only fall through to fallback if AI service is completely unavailable
      // or if there was a critical error
    }

    // Only reach here if AI service is unhealthy or failed completely
    await this.handleDirectMessageFallback(event);
  }

  private async handleDirectMessageFallback(event: any) {
    console.log(`🔄 Using fallback response for user ${event.user} in team ${event.team}`);
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
      coffee: "☕ Coffee break time! Grab your favorite beverage.",
      hydration: "💧 Stay hydrated! Time for a water break.",
      stretch: "🤸‍♀️ Your body needs movement. Take a quick stretch break!",
      meditation: "🧘‍♂️ Reset your mind with a meditation break.",
      walk: "🚶‍♀️ Step outside for a refreshing walk.",
      lunch: "🍽️ Time for a proper lunch break!",
      general: "⏰ Time for a wellness break!"
    };
    return messages[type as keyof typeof messages] || messages.general;
  }

  private getBreakTip(type: string): string {
    const tips = {
      coffee: "Enjoy your drink mindfully, away from work",
      hydration: "Drink water slowly and take deep breaths",
      stretch: "Focus on your neck, shoulders, and back",
      meditation: "Try the 4-7-8 breathing technique",
      walk: "Get some fresh air and natural light",
      lunch: "Eat slowly and enjoy your meal",
      general: "Take a few deep breaths and relax"
    };
    return tips[type as keyof typeof tips] || tips.general;
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

  // Clear break mode status
  async clearBreakMode(userId: string) {
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
                  text: `✅ *Break Complete!*\n\nHope you feel refreshed! Your Slack status has been cleared automatically.\n\nTime to get back to work with renewed energy! 💪`
                }
              }
            ]
          });

          console.log(`Successfully cleared break status for user ${user.slackUserId}`);
        } catch (statusError) {
          console.error("Failed to clear break status, sending notification:", statusError);
          // Fall back to notification if status clearing fails
          await this.sendBreakCompletionNotification(user);
        }
      } else {
        // No user token - send helpful notification
        await this.sendBreakCompletionNotification(user);
      }
    } catch (error) {
      console.error("Failed to clear break mode:", error);
    }
  }

  private async sendBreakCompletionNotification(user: any) {
    const client = await this.getClient(user.slackTeamId || undefined);

    await client.chat.postMessage({
      channel: user.slackUserId,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ *Break Complete!*\n\nHope you feel refreshed! Time to get back to work with renewed energy.\n\n💡 _Don't forget to update your Slack status if you set it manually._`
          }
        }
      ]
    });
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

  // Cancel a scheduled break
  private async cancelScheduledBreak(suggestionId: string, slackUserId: string) {
    try {
      const user = await storage.getUserBySlackId(slackUserId);
      if (!user) return { response_action: "clear" };

      // Update the break suggestion to mark as cancelled/declined
      await storage.updateBreakSuggestion(suggestionId, {
        accepted: false,
        acceptedAt: new Date() // Mark when it was declined
      });

      // Log activity
      storage.logActivity({
        userId: user.id,
        action: "break_cancelled",
        details: { 
          suggestionId,
          trigger: "user_button_cancel"
        }
      }).catch(console.error);

      return {
        replace_original: true,
        text: "📅 Break cancelled successfully. You can schedule a new one anytime with `/break`!"
      };
    } catch (error) {
      console.error("Cancel scheduled break error:", error);
      return { response_action: "clear" };
    }
  }

  // End break early
  private async endBreakEarly(suggestionId: string, slackUserId: string) {
    try {
      const user = await storage.getUserBySlackId(slackUserId);
      if (!user) return { response_action: "clear" };

      // Clear the break status
      await this.clearBreakMode(user.id);

      // Log activity
      storage.logActivity({
        userId: user.id,
        action: "break_ended_early",
        details: { 
          suggestionId,
          trigger: "user_button_end"
        }
      }).catch(console.error);

      return {
        replace_original: true,
        text: "☕ Break ended! Hope you feel refreshed and ready to get back to work! 💪"
      };
    } catch (error) {
      console.error("End break early error:", error);
      return { response_action: "clear" };
    }
  }

  // Cancel a scheduled focus session
  private async cancelScheduledFocusSession(sessionId: string, slackUserId: string) {
    try {
      const user = await storage.getUserBySlackId(slackUserId);
      if (!user) return { response_action: "clear" };

      // Update the session status to cancelled
      await storage.updateFocusSession(sessionId, {
        status: 'cancelled',
        endTime: new Date()
      });

      // Log activity
      storage.logActivity({
        userId: user.id,
        action: "focus_session_cancelled",
        details: { 
          sessionId,
          trigger: "user_button_cancel"
        }
      }).catch(console.error);

      return {
        replace_original: true,
        text: "📅 Focus session cancelled successfully. You can schedule a new one anytime with `/focus`!"
      };
    } catch (error) {
      console.error("Cancel scheduled focus session error:", error);
      return { response_action: "clear" };
    }
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

  // Water tracking methods
  private async logWaterIntake(userId: string, glasses: number) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Start of day
      
      // Log the water intake
      await storage.logWaterIntake(userId, glasses, today);
      
      // Get today's progress
      const { totalGlasses, goal, percentage } = await storage.getTodayWaterProgress(userId);
      
      // Log activity
      storage.logActivity({
        userId,
        action: "water_logged",
        details: { glasses, totalToday: totalGlasses, goal }
      }).catch(console.error);

      // Check if goal is reached
      const isGoalReached = totalGlasses >= goal;
      const progress = Math.min(percentage, 100);
      
      // Create progress bar
      const progressBar = this.createProgressBar(progress);
      
      let celebrationText = "";
      if (isGoalReached && totalGlasses - glasses < goal) {
        // Just reached goal with this log
        celebrationText = "\n\n🎉 *Congratulations! You've reached your daily water goal!* 🎉";
      }

      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `💧 *Water logged!* +${glasses} glass${glasses > 1 ? 'es' : ''}\n\n📊 *Today's Progress:*\n${progressBar} ${totalGlasses}/${goal} glasses (${Math.round(progress)}%)${celebrationText}`
            }
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `💡 *Tip:* Staying hydrated improves focus and energy levels!`
              }
            ]
          }
        ]
      };
    } catch (error) {
      console.error("Failed to log water intake:", error);
      return {
        response_type: "ephemeral",
        text: "❌ Failed to log water intake. Please try again."
      };
    }
  }

  private async setWaterGoal(userId: string, goal: number) {
    try {
      await storage.setWaterGoal(userId, goal);
      
      // Get today's progress with new goal
      const { totalGlasses, percentage } = await storage.getTodayWaterProgress(userId);
      const progress = Math.min(percentage, 100);
      const progressBar = this.createProgressBar(progress);
      
      // Log activity
      storage.logActivity({
        userId,
        action: "water_goal_set",
        details: { goal, currentProgress: totalGlasses }
      }).catch(console.error);

      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🎯 *Daily water goal updated!*\n\nNew goal: ${goal} glasses per day\n\n📊 *Today's Progress:*\n${progressBar} ${totalGlasses}/${goal} glasses (${Math.round(progress)}%)`
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Log Water 💧"
                },
                action_id: "log_water_1",
                value: userId
              },
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Set Reminders"
                },
                action_id: "water_remind_setup",
                value: userId
              }
            ]
          }
        ]
      };
    } catch (error) {
      console.error("Failed to set water goal:", error);
      return {
        response_type: "ephemeral",
        text: "❌ Failed to set water goal. Please try again."
      };
    }
  }

  private async getWaterStats(userId: string) {
    try {
      const { totalGlasses, goal, percentage } = await storage.getTodayWaterProgress(userId);
      const weekStats = await storage.getWeeklyWaterStats(userId);
      const streak = await storage.getWaterStreak(userId);
      
      const progress = Math.min(percentage, 100);
      const progressBar = this.createProgressBar(progress);
      
      let streakText = "";
      if (streak > 0) {
        streakText = `\n🔥 *Current streak:* ${streak} day${streak > 1 ? 's' : ''}`;
      }

      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "💧 Your Hydration Stats"
            }
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `📊 *Today's Progress:*\n${progressBar} ${totalGlasses}/${goal} glasses (${Math.round(progress)}%)${streakText}`
            }
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*This Week:*\n${weekStats.totalGlasses} glasses`
              },
              {
                type: "mrkdwn",
                text: `*Daily Average:*\n${weekStats.averagePerDay} glasses`
              },
              {
                type: "mrkdwn",
                text: `*Goals Met:*\n${weekStats.goalsMet}/${weekStats.daysTracked} days`
              },
              {
                type: "mrkdwn",
                text: `*Best Day:*\n${weekStats.maxGlasses} glasses`
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
                  text: "Log Water 💧"
                },
                style: "primary",
                action_id: "log_water_1",
                value: userId
              },
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Update Goal"
                },
                action_id: "water_goal_setup",
                value: userId
              }
            ]
          }
        ]
      };
    } catch (error) {
      console.error("Failed to get water stats:", error);
      return {
        response_type: "ephemeral",
        text: "❌ Failed to get water stats. Please try again."
      };
    }
  }

  private async setWaterReminders(userId: string, intervalMinutes: number) {
    try {
      await storage.setWaterReminders(userId, intervalMinutes);
      
      const intervalHours = Math.floor(intervalMinutes / 60);
      const remainingMinutes = intervalMinutes % 60;
      
      let intervalText = "";
      if (intervalHours > 0 && remainingMinutes > 0) {
        intervalText = `${intervalHours}h ${remainingMinutes}m`;
      } else if (intervalHours > 0) {
        intervalText = `${intervalHours} hour${intervalHours > 1 ? 's' : ''}`;
      } else {
        intervalText = `${intervalMinutes} minutes`;
      }
      
      // Log activity
      storage.logActivity({
        userId,
        action: "water_reminders_set",
        details: { intervalMinutes }
      }).catch(console.error);

      return {
        response_type: "ephemeral",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `⏰ *Water reminders enabled!*\n\nI'll remind you to drink water every ${intervalText} during work hours.\n\n💡 *Tip:* You can always log water manually with \`/water\` or update your reminders anytime!`
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Log Water Now 💧"
                },
                style: "primary",
                action_id: "log_water_1",
                value: userId
              },
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "View Stats"
                },
                action_id: "water_stats",
                value: userId
              }
            ]
          }
        ]
      };
    } catch (error) {
      console.error("Failed to set water reminders:", error);
      return {
        response_type: "ephemeral",
        text: "❌ Failed to set water reminders. Please try again."
      };
    }
  }

  // Create visual progress bar
  private createProgressBar(percentage: number): string {
    const filledBlocks = Math.floor(percentage / 10);
    const emptyBlocks = 10 - filledBlocks;
    return '🟦'.repeat(filledBlocks) + '⬜'.repeat(emptyBlocks);
  }

  // Handle water tracking button interactions
  private async handleWaterButton(userId: string, slackUserId: string, action: 'log' | 'stats', glasses?: number) {
    try {
      const user = await storage.getUserBySlackId(slackUserId);
      if (!user) return { response_action: "clear" };

      if (action === 'log') {
        const result = await this.logWaterIntake(user.id, glasses || 1);
        return {
          replace_original: true,
          ...result
        };
      } else if (action === 'stats') {
        const result = await this.getWaterStats(user.id);
        return {
          replace_original: true,
          ...result
        };
      }

      return { response_action: "clear" };
    } catch (error) {
      console.error("Water button error:", error);
      return { response_action: "clear" };
    }
  }

  // Show modal for setting water goal (simplified version)
  private async showWaterGoalModal(userId: string, slackUserId: string) {
    try {
      return {
        replace_original: true,
        text: "💧 To update your water goal, use the command: `/water goal [number]`\nExample: `/water goal 10` to set a goal of 10 glasses per day"
      };
    } catch (error) {
      console.error("Water goal modal error:", error);
      return { response_action: "clear" };
    }
  }

  // Show modal for setting reminders (simplified version)
  private async showWaterReminderModal(userId: string, slackUserId: string) {
    try {
      return {
        replace_original: true,
        text: "⏰ To set water reminders, use the command: `/water remind [interval]`\nExamples:\n• `/water remind 2h` - Every 2 hours\n• `/water remind 90m` - Every 90 minutes"
      };
    } catch (error) {
      console.error("Water reminder modal error:", error);
      return { response_action: "clear" };
    }
  }

  // Proactive Break Monitoring System
  async startProactiveBreakMonitoring(userId: string) {
    try {
      const user = await storage.getUser(userId);
      if (!user || !user.slackUserId) {
        console.log(`Cannot start break monitoring for user ${userId} - no Slack user ID`);
        return;
      }

      // Check if user wants break monitoring (could be a user preference)
      const shouldMonitor = await this.shouldMonitorBreaksForUser(userId);
      if (!shouldMonitor) {
        return;
      }

      // Start monitoring with intelligent timing
      this.scheduleNextBreakCheck(userId);
      console.log(`Started proactive break monitoring for user ${userId}`);
    } catch (error) {
      console.error("Failed to start break monitoring:", error);
    }
  }

  // Send a simple test message (for debugging Slack connectivity)
  async sendTestMessage(userId: string) {
    try {
      console.log(`📤 Sending test message to user ${userId}`);
      
      const user = await storage.getUser(userId);
      if (!user || !user.slackUserId) {
        console.log(`❌ No user or Slack user ID found for ${userId}`);
        return;
      }

      console.log(`✅ Found user for test message: ${user.name} (${user.slackUserId})`);

      const client = await this.getUserClient(user.id);
      if (!client) {
        console.log(`⚠️ No user client available for ${userId}, falling back to bot`);
        const botClient = await this.getClient(user.slackTeamId || undefined);
        if (!botClient) {
          console.log(`❌ No bot client available either for team ${user.slackTeamId}`);
          return;
        }
        
        console.log(`📱 Sending simple test message via bot client to ${user.slackUserId}`);
        await botClient.chat.postMessage({
          channel: user.slackUserId,
          text: `🧪 Test message from ProductivityWise! If you can see this, Slack messaging is working correctly. Current time: ${new Date().toLocaleString()}`
        });
        console.log(`✅ Simple test message sent successfully via bot`);
        return;
      }

      console.log(`✅ User client available, sending test message`);
      await client.chat.postMessage({
        channel: user.slackUserId,
        text: `🧪 Test message from ProductivityWise! If you can see this, Slack messaging is working correctly. Current time: ${new Date().toLocaleString()}`
      });
      console.log(`✅ Test message sent successfully via user client to ${user.slackUserId}`);
      
    } catch (error) {
      console.error("❌ Error sending test message:", error);
      if (error instanceof Error) {
        console.error("Stack trace:", error.stack);
      }
    }
  }

  // Check for breaks immediately after time skip (for demo purposes)
  async checkBreakAfterTimeSkip(userId: string) {
    try {
      console.log(`🔍 Checking for immediate break suggestions after time skip for user ${userId}`);
      
      const user = await storage.getUser(userId);
      if (!user || !user.slackUserId) {
        console.log(`❌ Cannot check breaks for user ${userId} - no user found or no Slack user ID`);
        console.log(`User data:`, user);
        return;
      }

      console.log(`✅ Found user: ${user.name} (${user.slackUserId})`);

      // Get demo time instead of real time
      const demoTime = await this.getDemoTimeForUser(userId);
      console.log(`⏰ Using demo time for break check: ${demoTime.toISOString()}`);
      
      const workingHours = this.isWorkingHours(demoTime, user.timezone || undefined);
      if (!workingHours) {
        console.log(`🚫 Skipping break check for ${userId} - outside working hours (demo time: ${demoTime.getHours()}:${demoTime.getMinutes()})`);
        return;
      }

      console.log(`✅ Within working hours (${demoTime.getHours()}:${demoTime.getMinutes()})`);

      // Check if user needs a break using demo time
      const breakNeeded = await this.analyzeBreakNeedWithDemoTime(userId, demoTime);
      if (!breakNeeded.needed) {
        console.log(`⏸️ No break needed for ${userId}: ${breakNeeded.reason}`);
        return;
      }

      console.log(`🎯 Break needed for ${userId}: ${breakNeeded.reason} (type: ${breakNeeded.type}, urgency: ${breakNeeded.urgency})`);

      // Check for meeting conflicts using demo time
      const meetingConflict = await this.checkMeetingConflictsWithDemoTime(userId, demoTime);
      if (meetingConflict.hasConflict) {
        console.log(`⏰ Break suggestion delayed for ${userId}: ${meetingConflict.reason}`);
        return; // Don't schedule delayed for demo - just skip
      }

      console.log(`✅ No meeting conflicts, proceeding with break alert`);

      // Send proactive break alert immediately
      console.log(`📱 Sending immediate break alert for ${userId}: ${breakNeeded.reason}`);
      await this.sendProactiveBreakAlert(userId, breakNeeded);
      console.log(`✅ Break alert sent successfully to ${user.slackUserId}`);
      
    } catch (error) {
      console.error("❌ Error in immediate break check after time skip:", error);
      if (error instanceof Error) {
        console.error("Stack trace:", error.stack);
      }
    }
  }

  private async shouldMonitorBreaksForUser(userId: string): Promise<boolean> {
    // Check if user has had recent activity (meetings, focus sessions, etc.)
    const today = new Date();
    const meetings = await storage.getMeetingsByDate(userId, today);
    const focusSessions = await storage.getFocusSessionsByDate(userId, today);
    
    // Only monitor if user is actively using the productivity features
    return meetings.length > 0 || focusSessions.length > 0;
  }

  private scheduleNextBreakCheck(userId: string) {
    // Check every 30 minutes for break opportunities
    setTimeout(async () => {
      await this.checkForProactiveBreakSuggestion(userId);
      // Schedule the next check
      this.scheduleNextBreakCheck(userId);
    }, 30 * 60 * 1000); // 30 minutes
  }

  private async checkForProactiveBreakSuggestion(userId: string) {
    try {
      const user = await storage.getUser(userId);
      if (!user) return;

      const now = new Date();
      const workingHours = this.isWorkingHours(now);
      
      if (!workingHours) {
        console.log(`Skipping break check for ${userId} - outside working hours`);
        return;
      }

      // Check if user needs a break
      const breakNeeded = await this.analyzeBreakNeed(userId, now);
      if (!breakNeeded.needed) {
        console.log(`No break needed for ${userId}: ${breakNeeded.reason}`);
        return;
      }

      // Check for meeting conflicts
      const meetingConflict = await this.checkMeetingConflicts(userId, now);
      if (meetingConflict.hasConflict) {
        console.log(`Break suggestion delayed for ${userId}: ${meetingConflict.reason}`);
        
        // Schedule suggestion for after the conflict
        if (meetingConflict.suggestAfter) {
          this.scheduleDelayedBreakSuggestion(userId, meetingConflict.suggestAfter);
        }
        return;
      }

      // Send proactive break alert
      await this.sendProactiveBreakAlert(userId, breakNeeded);
      
    } catch (error) {
      console.error("Error in proactive break check:", error);
    }
  }

  private async analyzeBreakNeed(userId: string, now: Date): Promise<{needed: boolean, reason: string, type: string, urgency: 'low' | 'medium' | 'high'}> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get today's break activity
    const recentBreaks = await storage.getRecentBreakSuggestions(userId, 24);
    
    const todaysBreaks = recentBreaks.filter(b => 
      b.accepted && b.acceptedAt && new Date(b.acceptedAt).toDateString() === today.toDateString()
    );

    // Calculate time since last break (including user-initiated breaks)
    const lastBreak = todaysBreaks[0];
    const hoursSinceLastBreak = lastBreak && lastBreak.acceptedAt
      ? (now.getTime() - new Date(lastBreak.acceptedAt).getTime()) / (1000 * 60 * 60)
      : this.getHoursSinceWorkStart(now); // Hours since work started today

    // Simple 2-hour rule: suggest break every 2 hours
    if (hoursSinceLastBreak >= 2) {
      const breakTypes = ['hydration', 'stretch', 'walk', 'meditation'];
      const breakType = breakTypes[todaysBreaks.length % breakTypes.length]; // Rotate through types
      
      let urgency: 'low' | 'medium' | 'high' = 'medium';
      if (hoursSinceLastBreak >= 3) urgency = 'high';
      if (hoursSinceLastBreak < 2.5) urgency = 'low';

      return {
        needed: true,
        reason: `${hoursSinceLastBreak.toFixed(1)} hours since last break - time for a wellness break!`,
        type: breakType,
        urgency
      };
    }

    return {
      needed: false,
      reason: `Only ${hoursSinceLastBreak.toFixed(1)} hours since last break`,
      type: '',
      urgency: 'low'
    };
  }

  private getHoursSinceWorkStart(now: Date): number {
    const workStart = new Date(now);
    workStart.setHours(8, 0, 0, 0); // Work starts at 8 AM
    
    // If it's before 8 AM, assume work hasn't started
    if (now.getHours() < 8) {
      return 0;
    }
    
    return (now.getTime() - workStart.getTime()) / (1000 * 60 * 60);
  }

  // Get demo time for a user (used for break checking after time skips)
  private async getDemoTimeForUser(userId: string): Promise<Date> {
    try {
      // Import routes to access userTimeOffsets
      const { userTimeOffsets } = await import('../routes');
      const storedOffset = userTimeOffsets?.get(userId) || 0;
      
      if (storedOffset !== 0) {
        const now = new Date();
        return new Date(now.getTime() + storedOffset);
      }
      
      return new Date(); // Fallback to real time
    } catch (error) {
      console.error("Failed to get demo time, using real time:", error);
      return new Date();
    }
  }

  // Demo-time aware break need analysis
  private async analyzeBreakNeedWithDemoTime(userId: string, demoTime: Date): Promise<{needed: boolean, reason: string, type: string, urgency: 'low' | 'medium' | 'high'}> {
    const today = new Date(demoTime);
    today.setHours(0, 0, 0, 0);
    
    // Get today's break activity (using demo time)
    const recentBreaks = await storage.getRecentBreakSuggestions(userId, 24);
    
    const todaysBreaks = recentBreaks.filter(b => 
      b.accepted && b.acceptedAt && new Date(b.acceptedAt).toDateString() === today.toDateString()
    );

    // Calculate time since last break using demo time
    const lastBreak = todaysBreaks[0];
    const hoursSinceLastBreak = lastBreak && lastBreak.acceptedAt
      ? (demoTime.getTime() - new Date(lastBreak.acceptedAt).getTime()) / (1000 * 60 * 60)
      : this.getHoursSinceWorkStart(demoTime); // Hours since work started in demo time

    console.log(`Break analysis for ${userId} (demo time ${demoTime.toISOString()}): ${hoursSinceLastBreak.toFixed(1)} hours since last break`);

    // Simple 2-hour rule: suggest break every 2 hours
    if (hoursSinceLastBreak >= 2) {
      const breakTypes = ['hydration', 'stretch', 'walk', 'meditation'];
      const breakType = breakTypes[todaysBreaks.length % breakTypes.length]; // Rotate through types
      
      let urgency: 'low' | 'medium' | 'high' = 'medium';
      if (hoursSinceLastBreak >= 3) urgency = 'high';
      if (hoursSinceLastBreak < 2.5) urgency = 'low';

      return {
        needed: true,
        reason: `${hoursSinceLastBreak.toFixed(1)} hours since last break - time for a wellness break!`,
        type: breakType,
        urgency
      };
    }

    return {
      needed: false,
      reason: `Only ${hoursSinceLastBreak.toFixed(1)} hours since last break`,
      type: '',
      urgency: 'low'
    };
  }

  // Demo-time aware meeting conflict checking
  private async checkMeetingConflictsWithDemoTime(userId: string, demoTime: Date): Promise<{hasConflict: boolean, reason: string, suggestAfter?: Date}> {
    const meetings = await storage.getMeetingsByDate(userId, demoTime);
    
    // Check if currently in a meeting (using demo time)
    const currentMeeting = meetings.find(m => {
      const start = new Date(m.startTime);
      const end = new Date(m.endTime);
      return start <= demoTime && end >= demoTime;
    });

    if (currentMeeting) {
      return {
        hasConflict: true,
        reason: `Currently in "${currentMeeting.title}" (demo time)`,
        suggestAfter: new Date(currentMeeting.endTime)
      };
    }

    // Check for meetings starting within 10 minutes (using demo time)
    const upcomingMeeting = meetings.find(m => {
      const start = new Date(m.startTime);
      const timeDiff = start.getTime() - demoTime.getTime();
      return timeDiff > 0 && timeDiff <= 10 * 60 * 1000; // Within 10 minutes
    });

    if (upcomingMeeting) {
      return {
        hasConflict: true,
        reason: `Meeting "${upcomingMeeting.title}" starts in ${Math.round((new Date(upcomingMeeting.startTime).getTime() - demoTime.getTime()) / (1000 * 60))} minutes`,
        suggestAfter: new Date(upcomingMeeting.endTime)
      };
    }

    return { hasConflict: false, reason: "No conflicts" };
  }

  private async checkMeetingConflicts(userId: string, now: Date): Promise<{hasConflict: boolean, reason: string, suggestAfter?: Date}> {
    const meetings = await storage.getMeetingsByDate(userId, now);
    
    // Check if currently in a meeting
    const currentMeeting = meetings.find(m => {
      const start = new Date(m.startTime);
      const end = new Date(m.endTime);
      return start <= now && end >= now;
    });

    if (currentMeeting) {
      return {
        hasConflict: true,
        reason: `Currently in "${currentMeeting.title}"`,
        suggestAfter: new Date(currentMeeting.endTime)
      };
    }

    // Check if meeting starting soon (within 10 minutes)
    const soonMeeting = meetings.find(m => {
      const start = new Date(m.startTime);
      const minutesUntil = (start.getTime() - now.getTime()) / (1000 * 60);
      return minutesUntil > 0 && minutesUntil <= 10;
    });

    if (soonMeeting) {
      return {
        hasConflict: true,
        reason: `"${soonMeeting.title}" starts in ${Math.round((new Date(soonMeeting.startTime).getTime() - now.getTime()) / (1000 * 60))} minutes`,
        suggestAfter: new Date(soonMeeting.endTime)
      };
    }

    return { hasConflict: false, reason: "No conflicts" };
  }

  private scheduleDelayedBreakSuggestion(userId: string, suggestAfter: Date) {
    const delay = suggestAfter.getTime() - Date.now() + (5 * 60 * 1000); // 5 minutes after meeting ends
    
    if (delay > 0 && delay < 24 * 60 * 60 * 1000) { // Within 24 hours
      setTimeout(async () => {
        console.log(`Sending delayed break suggestion for user ${userId}`);
        const breakNeeded = await this.analyzeBreakNeed(userId, new Date());
        if (breakNeeded.needed) {
          await this.sendProactiveBreakAlert(userId, breakNeeded);
        }
      }, delay);
    }
  }

  private async sendProactiveBreakAlert(userId: string, breakInfo: {reason: string, type: string, urgency: 'low' | 'medium' | 'high'}) {
    try {
      console.log(`📤 Attempting to send proactive break alert to user ${userId}`);
      
      const user = await storage.getUser(userId);
      if (!user || !user.slackUserId) {
        console.log(`❌ No user or Slack user ID found for ${userId}`);
        return;
      }

      console.log(`✅ Found user for break alert: ${user.name} (${user.slackUserId})`);

      const client = await this.getUserClient(user.id);
      if (!client) {
        console.log(`⚠️ No user client available for ${userId}, falling back to bot`);
        const botClient = await this.getClient(user.slackTeamId || undefined);
        if (!botClient) {
          console.log(`❌ No bot client available either for team ${user.slackTeamId}`);
          return;
        }
        
        console.log(`📱 Sending simple break message via bot client to ${user.slackUserId}`);
        await botClient.chat.postMessage({
          channel: user.slackUserId,
          text: `💡 *Break Time Suggestion*\n\n${this.getBreakMessage(breakInfo.type)}\n\n${breakInfo.reason}\n\nUse \`/break\` when you're ready!`
        });
        console.log(`✅ Simple break message sent successfully`);
        return;
      }

      console.log(`✅ User client available, sending interactive break alert`);

      const urgencyIcon = {
        low: '💡',
        medium: '⚠️', 
        high: '🚨'
      }[breakInfo.urgency];

      const breakMessages = {
        stretch: "🤸 Time to stretch and move around",
        hydration: "💧 Stay hydrated with a water break", 
        walk: "🚶 How about a quick walk outside?",
        meditation: "🧘 Try a 5-minute mindfulness break"
      };

      const message = breakMessages[breakInfo.type as keyof typeof breakMessages] || "Take a quick wellness break";

      await client.chat.postMessage({
        channel: user.slackUserId,
        text: `${urgencyIcon} Break Time Suggestion: ${message} - ${breakInfo.reason}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn", 
              text: `${urgencyIcon} *Break Time Suggestion*\n\n${message}\n\n_${breakInfo.reason}_`
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Take Break Now ☕"
                },
                style: "primary",
                action_id: "proactive_break_now",
                value: JSON.stringify({ userId, type: breakInfo.type })
              },
              {
                type: "button", 
                text: {
                  type: "plain_text",
                  text: "Delay 30 min ⏰"
                },
                action_id: "proactive_break_delay_30",
                value: JSON.stringify({ userId, type: breakInfo.type })
              },
              {
                type: "button",
                text: {
                  type: "plain_text", 
                  text: "Delay 1 hour ⏱️"
                },
                action_id: "proactive_break_delay_60", 
                value: JSON.stringify({ userId, type: breakInfo.type })
              },
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Not now ❌"
                },
                action_id: "proactive_break_dismiss",
                value: JSON.stringify({ userId })
              }
            ]
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: "💡 _This suggestion respects your meeting schedule and current activity_"
              }
            ]
          }
        ]
      });

      console.log(`✅ Interactive break alert sent successfully to ${user.slackUserId}`);

      // Log the proactive suggestion
      await storage.logActivity({
        userId,
        action: "proactive_break_suggested",
        details: { 
          type: breakInfo.type,
          reason: breakInfo.reason,
          urgency: breakInfo.urgency
        }
      });

    } catch (error) {
      console.error("❌ Failed to send proactive break alert:", error);
      if (error instanceof Error) {
        console.error("Stack trace:", error.stack);
      }
    }
  }

  private isWorkingHours(date: Date, userTimezone?: string): boolean {
    // Convert to user's timezone if provided
    let localHour: number;
    let localDay: number;
    
    if (userTimezone) {
      // Get the date in user's timezone
      const userDate = new Date(date.toLocaleString('en-US', { timeZone: userTimezone }));
      localHour = userDate.getHours();
      localDay = userDate.getDay();
    } else {
      // Fallback to UTC
      localHour = date.getHours();
      localDay = date.getDay();
    }
    
    // Monday-Friday, 6 AM - 11 PM (expanded for demo purposes)
    // This allows break suggestions throughout most of the day for demo
    return localDay >= 1 && localDay <= 5 && localHour >= 6 && localHour <= 23;
  }

  // Proactive Break Button Handlers
  private async handleProactiveBreakNow(actionValue: string, slackUserId: string) {
    try {
      const { userId, type } = JSON.parse(actionValue);
      
      // Start the break immediately
      await this.setBreakMode(userId, type === 'walk' ? 15 : 20); // Shorter breaks for walks
      
      // Log the activity
      await storage.logActivity({
        userId,
        action: "proactive_break_accepted",
        details: { type, timing: "immediate" }
      });

      return {
        replace_original: true,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `✅ *Break Started!*\n\n${this.getBreakMessage(type)}\n\n⏰ Duration: ${type === 'walk' ? 15 : 20} minutes\n🕐 Your Slack status has been updated automatically!\n\n💡 *Enjoy your break and return refreshed!*`
            }
          }
        ]
      };
    } catch (error) {
      console.error("Proactive break now error:", error);
      return {
        replace_original: true,
        text: "❌ Failed to start break. Please try again."
      };
    }
  }

  private async handleProactiveBreakDelay(actionValue: string, slackUserId: string, delayMinutes: number) {
    try {
      const { userId, type } = JSON.parse(actionValue);
      
      // Schedule the break for later
      setTimeout(async () => {
        const breakNeeded = await this.analyzeBreakNeed(userId, new Date());
        if (breakNeeded.needed) {
          await this.sendProactiveBreakAlert(userId, breakNeeded);
        }
      }, delayMinutes * 60 * 1000);

      // Log the delay
      await storage.logActivity({
        userId,
        action: "proactive_break_delayed",
        details: { type, delayMinutes }
      });

      return {
        replace_original: true,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `⏰ *Break Delayed*\n\nI'll remind you about taking a ${type} break in ${delayMinutes} minutes.\n\n💡 *Tip:* Try to wrap up your current task before then so you can take a proper break!`
            }
          }
        ]
      };
    } catch (error) {
      console.error("Proactive break delay error:", error);
      return {
        replace_original: true,
        text: "❌ Failed to delay break. Please try again."
      };
    }
  }

  private async handleProactiveBreakDismiss(actionValue: string, slackUserId: string) {
    try {
      const { userId } = JSON.parse(actionValue);
      
      // Log the dismissal
      await storage.logActivity({
        userId,
        action: "proactive_break_dismissed",
        details: { reason: "user_dismissed" }
      });

      return {
        replace_original: true,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `👍 *Break Suggestion Dismissed*\n\nNo worries! Remember to take breaks when you can.\n\n💡 *Pro tip:* Regular breaks help maintain focus and prevent burnout. I'll check in with you again later.`
            }
          }
        ]
      };
    } catch (error) {
      console.error("Proactive break dismiss error:", error);
      return {
        replace_original: true,
        text: "❌ Failed to dismiss break. Please try again."
      };
    }
  }
}

export const slackService = new SlackService();
