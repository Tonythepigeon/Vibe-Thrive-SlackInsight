import { google } from "googleapis";
import { Client } from "@microsoft/microsoft-graph-client";
import { storage } from "../storage";
import type { InsertMeeting } from "@shared/schema";

class CalendarService {
  private googleOAuth2Client: any;

  constructor() {
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      this.googleOAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        `${process.env.BASE_URL}/api/oauth/google/callback`
      );
    }
  }

  async handleGoogleCallback(req: any, res: any) {
    try {
      const { code, state } = req.query;
      
      if (!code) {
        return res.status(400).json({ error: "Authorization code required" });
      }

      const { tokens } = await this.googleOAuth2Client.getToken(code);
      
      // Extract user ID from state parameter
      const userId = state;
      
      // Store the integration
      await storage.createIntegration({
        userId,
        type: "google_calendar",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        metadata: { scope: tokens.scope }
      });

      // Start initial sync
      this.syncUserCalendar(userId, "google_calendar");

      await storage.logActivity({
        userId,
        action: "google_calendar_connected",
        details: { scope: tokens.scope }
      });

      res.redirect(`${process.env.FRONTEND_URL}/integrations?success=google`);
    } catch (error) {
      console.error("Google OAuth error:", error);
      res.status(500).json({ error: "Failed to connect Google Calendar" });
    }
  }

  async handleOutlookCallback(req: any, res: any) {
    try {
      const { code, state } = req.query;
      
      if (!code) {
        return res.status(400).json({ error: "Authorization code required" });
      }

      // Exchange code for tokens using Microsoft Graph
      const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: process.env.MICROSOFT_CLIENT_ID!,
          client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
          code,
          grant_type: "authorization_code",
          redirect_uri: `${process.env.BASE_URL}/api/oauth/outlook/callback`,
        }),
      });

      const tokens = await tokenResponse.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        scope?: string;
      };
      
      if (!tokens.access_token) {
        throw new Error("Failed to get access token");
      }

      const userId = state;

      await storage.createIntegration({
        userId,
        type: "outlook",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        metadata: { scope: tokens.scope }
      });

      this.syncUserCalendar(userId, "outlook");

      await storage.logActivity({
        userId,
        action: "outlook_connected",
        details: { scope: tokens.scope }
      });

      res.redirect(`${process.env.FRONTEND_URL}/integrations?success=outlook`);
    } catch (error) {
      console.error("Outlook OAuth error:", error);
      res.status(500).json({ error: "Failed to connect Outlook" });
    }
  }

  async syncUserCalendar(userId: string, integrationType: "google_calendar" | "outlook") {
    try {
      const integration = await storage.getIntegrationByType(userId, integrationType);
      if (!integration || !integration.accessToken) return;

      if (integrationType === "google_calendar") {
        await this.syncGoogleCalendar(userId, integration);
      } else if (integrationType === "outlook") {
        await this.syncOutlookCalendar(userId, integration);
      }
    } catch (error) {
      console.error(`Failed to sync ${integrationType}:`, error);
    }
  }

  private async syncGoogleCalendar(userId: string, integration: any) {
    try {
      this.googleOAuth2Client.setCredentials({
        access_token: integration.accessToken,
        refresh_token: integration.refreshToken,
      });

      const calendar = google.calendar({ version: "v3", auth: this.googleOAuth2Client });
      
      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const response = await calendar.events.list({
        calendarId: "primary",
        timeMin: oneWeekAgo.toISOString(),
        timeMax: oneWeekFromNow.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = response.data.items || [];

      for (const event of events) {
        if (!event.start?.dateTime || !event.end?.dateTime) continue;

        const startTime = new Date(event.start.dateTime);
        const endTime = new Date(event.end.dateTime);
        const duration = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));

        const meetingData: InsertMeeting = {
          userId,
          externalId: event.id!,
          title: event.summary || "Untitled Meeting",
          startTime,
          endTime,
          duration,
          attendees: event.attendees?.map(a => ({ email: a.email, name: a.displayName })) || [],
          source: "google_calendar",
          meetingType: event.conferenceData ? "video_call" : "in_person",
        };

        await storage.createMeeting(meetingData);
      }

      await storage.logActivity({
        userId,
        action: "calendar_synced",
        details: { source: "google_calendar", eventCount: events.length }
      });

    } catch (error) {
      console.error("Google Calendar sync error:", error);
      
      // If token expired, try to refresh
      if (error instanceof Error && error.message.includes("invalid_grant")) {
        await this.refreshGoogleToken(userId, integration);
      }
    }
  }

  private async syncOutlookCalendar(userId: string, integration: any) {
    try {
      const graphClient = Client.init({
        authProvider: (done) => {
          done(null, integration.accessToken);
        },
      });

      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const events = await graphClient
        .api('/me/calendar/events')
        .filter(`start/dateTime ge '${oneWeekAgo.toISOString()}' and start/dateTime le '${oneWeekFromNow.toISOString()}'`)
        .orderby('start/dateTime')
        .get();

      for (const event of events.value || []) {
        if (!event.start?.dateTime || !event.end?.dateTime) continue;

        const startTime = new Date(event.start.dateTime);
        const endTime = new Date(event.end.dateTime);
        const duration = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));

        const meetingData: InsertMeeting = {
          userId,
          externalId: event.id!,
          title: event.subject || "Untitled Meeting",
          startTime,
          endTime,
          duration,
          attendees: event.attendees?.map((a: any) => ({ email: a.emailAddress?.address, name: a.emailAddress?.name })) || [],
          source: "outlook",
          meetingType: event.isOnlineMeeting ? "video_call" : "in_person",
        };

        await storage.createMeeting(meetingData);
      }

      await storage.logActivity({
        userId,
        action: "calendar_synced",
        details: { source: "outlook", eventCount: events.value?.length || 0 }
      });

    } catch (error) {
      console.error("Outlook sync error:", error);
      
      if (error instanceof Error && error.message.includes("401")) {
        await this.refreshOutlookToken(userId, integration);
      }
    }
  }

  private async refreshGoogleToken(userId: string, integration: any) {
    try {
      this.googleOAuth2Client.setCredentials({
        refresh_token: integration.refreshToken,
      });

      const { credentials } = await this.googleOAuth2Client.refreshAccessToken();

      await storage.updateIntegration(integration.id, {
        accessToken: credentials.access_token,
        expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : undefined,
      });

    } catch (error) {
      console.error("Failed to refresh Google token:", error);
      await storage.updateIntegration(integration.id, { isActive: false });
    }
  }

  private async refreshOutlookToken(userId: string, integration: any) {
    try {
      const response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: process.env.MICROSOFT_CLIENT_ID!,
          client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
          refresh_token: integration.refreshToken,
          grant_type: "refresh_token",
        }),
      });

      const tokens = await response.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };

      if (tokens.access_token) {
        await storage.updateIntegration(integration.id, {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || integration.refreshToken,
          expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined,
        });
      }

    } catch (error) {
      console.error("Failed to refresh Outlook token:", error);
      await storage.updateIntegration(integration.id, { isActive: false });
    }
  }

  async generateProductivityInsights(userId: string): Promise<string[]> {
    const insights: string[] = [];
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const meetings = await storage.getUserMeetings(userId, weekAgo, today);
    
    if (meetings.length === 0) return insights;

    // Meeting time analysis
    const totalMeetingTime = meetings.reduce((sum, meeting) => sum + (meeting.duration || 0), 0);
    const avgMeetingTime = totalMeetingTime / meetings.length;
    
    if (totalMeetingTime > 20 * 60) { // More than 20 hours per week
      insights.push("You're spending a lot of time in meetings. Consider if all meetings are necessary.");
    }

    // Back-to-back meeting detection
    const backToBackCount = this.detectBackToBackMeetings(meetings);
    if (backToBackCount > 3) {
      insights.push(`You had ${backToBackCount} back-to-back meetings this week. Try scheduling buffer time between meetings.`);
    }

    // Peak meeting time analysis
    const meetingHours = meetings.map(m => new Date(m.startTime).getHours());
    const peakHour = this.getMostFrequentHour(meetingHours);
    if (peakHour) {
      insights.push(`Your peak meeting time is ${peakHour}:00. Consider blocking focus time before or after.`);
    }

    return insights;
  }

  private detectBackToBackMeetings(meetings: any[]): number {
    let count = 0;
    const sortedMeetings = meetings.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    for (let i = 0; i < sortedMeetings.length - 1; i++) {
      const currentEnd = new Date(sortedMeetings[i].endTime);
      const nextStart = new Date(sortedMeetings[i + 1].startTime);
      
      // If next meeting starts within 5 minutes of current ending
      if (nextStart.getTime() - currentEnd.getTime() <= 5 * 60 * 1000) {
        count++;
      }
    }
    
    return count;
  }

  private getMostFrequentHour(hours: number[]): number | null {
    if (hours.length === 0) return null;
    
    const frequency: { [key: number]: number } = {};
    hours.forEach(hour => {
      frequency[hour] = (frequency[hour] || 0) + 1;
    });
    
    return parseInt(Object.keys(frequency).reduce((a, b) => frequency[parseInt(a)] > frequency[parseInt(b)] ? a : b));
  }
}

export const calendarService = new CalendarService();
