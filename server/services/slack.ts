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
      const team = await storage.getSlackTeam(teamId);
      if (team && team.botToken) {
        const client = new WebClient(team.botToken);
        this.clients.set(teamId, client);
        return client;
      }
    }

    return this.clients.get("default") || new WebClient();
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

      if (!code) {
        return res.status(400).json({ error: "Authorization code required" });
      }

      const client = new WebClient();
      const result = await client.oauth.v2.access({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        code,
      });

      if (result.ok && result.team && result.access_token) {
        // Store team information
        await storage.createSlackTeam({
          slackTeamId: result.team.id!,
          teamName: result.team.name!,
          botToken: result.access_token,
          botUserId: result.bot_user_id!,
        });

        // Store bot token for this team
        this.clients.set(result.team.id!, new WebClient(result.access_token));

        // If authed_user is present, create user record
        if (result.authed_user) {
          try {
            await storage.createUser({
              slackUserId: result.authed_user.id!,
              email: `${result.authed_user.id}@slack.local`, // Placeholder, will be updated
              name: "Slack User",
              slackTeamId: result.team.id!,
            });
          } catch (error) {
            // User might already exist
            console.log("User already exists or creation failed:", error);
          }
        }

        await storage.logActivity({
          action: "slack_app_installed",
          details: { teamId: result.team.id, teamName: result.team.name }
        });

        res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5000'}/integration-success`);
      } else {
        res.status(400).json({ error: "OAuth failed" });
      }
    } catch (error) {
      console.error("Slack OAuth error:", error);
      res.status(500).json({ error: "OAuth failed" });
    }
  }

  async handleInstall(req: any, res: any) {
    try {
      const scopes = [
        'commands',
        'chat:write',
        'users:read',
        'users.profile:write',
        'users.profile:read',
        'team:read'
      ].join(',');
      
      const installUrl = `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID}&scope=${scopes}&user_scope=`;
      res.json({ installUrl });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate install URL" });
    }
  }

  // Command handlers
  private async handleFocusCommand(text: string, userId: string, teamId: string) {
    const duration = parseInt(text) || 25; // Default 25 minutes
    
    try {
      const user = await storage.getUserBySlackId(userId);
      if (!user) {
        return {
          text: "Please connect your account first by visiting the productivity dashboard."
        };
      }

      // Check for active focus session
      const activeSession = await storage.getActiveFocusSession(user.id);
      if (activeSession) {
        return {
          text: "You already have an active focus session. End it first with `/focus end`."
        };
      }

      // Create focus session
      const session = await storage.createFocusSession({
        userId: user.id,
        duration,
        startTime: new Date()
      });

      // Set Slack status
      await this.setFocusMode(user.id, duration);

      return {
        response_type: "in_channel",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🎯 *Focus mode activated!*\nDuration: ${duration} minutes\nYour Slack status has been updated.`
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
    } catch (error) {
      console.error("Focus command error:", error);
      return {
        text: "Failed to start focus session. Please try again."
      };
    }
  }

  private async handleBreakCommand(text: string, userId: string, teamId: string) {
    const breakType = text.toLowerCase() || "general";
    
    try {
      const user = await storage.getUserBySlackId(userId);
      if (!user) {
        return {
          text: "Please connect your account first by visiting the productivity dashboard."
        };
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
    } catch (error) {
      console.error("Break command error:", error);
      return {
        text: "Failed to process break request. Please try again."
      };
    }
  }

  private async handleProductivityCommand(text: string, userId: string, teamId: string) {
    try {
      const user = await storage.getUserBySlackId(userId);
      if (!user) {
        return {
          text: "Please connect your account first by visiting the productivity dashboard."
        };
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
    } catch (error) {
      console.error("Productivity command error:", error);
      return {
        text: "Failed to get productivity summary. Please try again."
      };
    }
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

  async setFocusMode(userId: string, duration: number) {
    try {
      const user = await storage.getUser(userId);
      if (!user || !user.slackUserId) return;

      const client = await this.getClient(user.slackTeamId || undefined);
      const endTime = new Date(Date.now() + duration * 60 * 1000);

      await client.users.profile.set({
        user: user.slackUserId,
        profile: {
          status_text: `In focus mode until ${endTime.toLocaleTimeString()}`,
          status_emoji: ":dart:",
          status_expiration: Math.floor(endTime.getTime() / 1000)
        }
      });

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

      const client = await this.getClient(user.slackTeamId || undefined);

      await client.users.profile.set({
        user: user.slackUserId,
        profile: {
          status_text: "",
          status_emoji: "",
          status_expiration: 0
        }
      });
    } catch (error) {
      console.error("Failed to clear focus mode:", error);
    }
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
