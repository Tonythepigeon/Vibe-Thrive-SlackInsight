import cron from "node-cron";
import { storage } from "../storage";
import { calendarService } from "./calendar";
import { analyticsService } from "./analytics";
import { slackService } from "./slack";

class SchedulerService {
  private jobs: cron.ScheduledTask[] = [];

  start() {
    console.log("Starting scheduler service...");

    // Sync calendars every 15 minutes
    const calendarSyncJob = cron.schedule("*/15 * * * *", async () => {
      await this.syncAllCalendars();
    }, { scheduled: false });

    // Process daily productivity metrics every hour
    const metricsJob = cron.schedule("0 * * * *", async () => {
      await this.processHourlyMetrics();
    }, { scheduled: false });

    // Send daily summaries at 6 PM
    const dailySummaryJob = cron.schedule("0 18 * * *", async () => {
      await this.sendDailySummaries();
    }, { scheduled: false });

    // Clean up old data at midnight
    const cleanupJob = cron.schedule("0 0 * * *", async () => {
      await this.cleanupOldData();
    }, { scheduled: false });

    // Start all jobs
    calendarSyncJob.start();
    metricsJob.start();
    dailySummaryJob.start();
    cleanupJob.start();

    this.jobs = [calendarSyncJob, metricsJob, dailySummaryJob, cleanupJob];
    console.log("Scheduler service started with 4 jobs");
  }

  stop() {
    this.jobs.forEach(job => job.stop());
    console.log("Scheduler service stopped");
  }

  private async syncAllCalendars() {
    try {
      console.log("Starting calendar sync for all users...");
      
      // Get all active calendar integrations
      const integrations = await storage.getUserIntegrations(""); // This would need to be modified to get all integrations
      
      for (const integration of integrations) {
        if (integration.isActive && (integration.type === "google_calendar" || integration.type === "outlook")) {
          await calendarService.syncUserCalendar(integration.userId, integration.type as any);
          
          // Add small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      console.log(`Calendar sync completed for ${integrations.length} integrations`);
    } catch (error) {
      console.error("Calendar sync error:", error);
    }
  }

  private async processHourlyMetrics() {
    try {
      console.log("Processing hourly productivity metrics...");
      
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      // This would need to be modified to get all active users
      // For now, we'll process metrics for users who have recent activity
      const recentActivity = await storage.getRecentActivity(100);
      const activeUserIds = [...new Set(recentActivity.map(a => a.userId).filter(Boolean))];
      
      for (const userId of activeUserIds) {
        if (userId) {
          await analyticsService.processProductivityMetrics(userId, today);
          
          // Add delay to avoid overwhelming the database
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      
      console.log(`Processed metrics for ${activeUserIds.length} users`);
    } catch (error) {
      console.error("Metrics processing error:", error);
    }
  }

  private async sendDailySummaries() {
    try {
      console.log("Sending daily productivity summaries...");
      
      const today = new Date();
      const recentActivity = await storage.getRecentActivity(50);
      const activeUserIds = [...new Set(recentActivity.map(a => a.userId).filter(Boolean))];
      
      for (const userId of activeUserIds) {
        if (userId) {
          const metrics = await storage.getProductivityMetrics(userId, today, today);
          
          if (metrics.length > 0) {
            const summary = metrics[0];
            await slackService.sendProductivitySummary(userId, summary);
          }
          
          // Rate limit Slack messages
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      console.log(`Sent summaries to ${activeUserIds.length} users`);
    } catch (error) {
      console.error("Daily summary error:", error);
    }
  }

  private async cleanupOldData() {
    try {
      console.log("Cleaning up old data...");
      
      // This would implement cleanup logic for old activity logs, expired tokens, etc.
      // For now, just log the activity
      
      await storage.logActivity({
        action: "data_cleanup_completed",
        details: { timestamp: new Date().toISOString() }
      });
      
      console.log("Data cleanup completed");
    } catch (error) {
      console.error("Data cleanup error:", error);
    }
  }

  // Manual trigger methods for testing
  async triggerCalendarSync() {
    await this.syncAllCalendars();
  }

  async triggerMetricsProcessing() {
    await this.processHourlyMetrics();
  }

  async triggerDailySummaries() {
    await this.sendDailySummaries();
  }
}

export const schedulerService = new SchedulerService();
