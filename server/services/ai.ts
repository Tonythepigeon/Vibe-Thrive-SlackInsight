import { GoogleGenerativeAI } from "@google/generative-ai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { slackService } from "./slack";
import { storage } from "../storage";

interface CommandIntent {
  action: 'focus' | 'break' | 'productivity' | 'greeting' | 'scheduling' | 'unsupported';
  parameters?: {
    duration?: number;
    breakType?: string;
    end?: boolean; // Added for focus end command
    activityType?: string; // For scheduling requests
    timePreference?: string; // 'morning', 'afternoon', 'anytime'
  };
  confidence: number;
}

interface AIResponse {
  message: string;
  commandExecuted?: boolean;
  commandResult?: any;
  recommendations?: string[];
  executed?: boolean;
}

class AIService {
  private llm: ChatGoogleGenerativeAI;
  private intentParser: RunnableSequence<any, any>;

  constructor() {
    if (!process.env.GOOGLE_API_KEY) {
      console.warn("GOOGLE_API_KEY not found - AI service will not function properly");
    }

    // Initialize Gemini 1.5 Flash
    this.llm = new ChatGoogleGenerativeAI({
      model: "gemini-1.5-flash",
      temperature: 0.3,
      apiKey: process.env.GOOGLE_API_KEY,
    });

    // Create intent parsing chain
    this.intentParser = this.createIntentParsingChain();
  }

  private createIntentParsingChain() {
    const systemPrompt = `You are a productivity assistant that interprets user requests and maps them to specific Slack commands.

Available commands:
1. GREETING: Detect greetings and introductions
   - Examples: "hi", "hello", "hey", "good morning", "good afternoon", "how are you"
   
2. FOCUS: Start or end focus sessions (duration in minutes)
   - Examples: "start focus for 30 minutes", "end my focus session", "I need to concentrate", "focus for 25 minutes"
   
3. BREAK: Start breaks or manage break requests (type: general, hydration, stretch, meditation, walk, coffee, lunch)
   - Examples: "I need a break", "start a coffee break", "time for a stretch", "take a break", "give me a 5 minute break", "10 minute coffee break"
   
4. PRODUCTIVITY: Show productivity metrics and summaries
   - Examples: "show my productivity", "how productive was I today?", "meeting summary"

5. SCHEDULING: Analyze schedule and suggest optimal times for activities
   - Examples: "when is ideal for a 15 minute walk?", "find me time for a coffee break", "when can I take a 30 minute break?", "my day looks packed, when should I take a walk?", "suggest a good time for lunch"

6. UNSUPPORTED: Any request not related to these productivity features
   - Examples: "what's the weather?", "tell me a joke", "book a meeting"

IMPORTANT: Extract duration and activity type from natural language requests:
- "5 minute break" → duration: 5
- "10 minute coffee break" → duration: 10, breakType: "coffee"
- "focus for 30 minutes" → duration: 30
- "25 minute focus session" → duration: 25
- "15 minute walk" → duration: 15, activityType: "walk"
- "30 minute lunch break" → duration: 30, activityType: "lunch"

Respond ONLY with a JSON object in this exact format:
{
  "action": "greeting|focus|break|productivity|scheduling|unsupported",
  "parameters": {
    "duration": 25,
    "breakType": "general",
    "end": false,
    "activityType": "walk",
    "timePreference": "anytime"
  },
  "confidence": 0.95
}

Rules:
- Use "greeting" for any form of hello, hi, hey, or general greetings
- Use "focus" for concentration/work session requests (will start actual focus sessions)
- Use "break" for rest/pause requests (will start actual breaks)
- Use "productivity" for metrics/summary requests
- Use "scheduling" for requests asking about optimal timing for activities
- Use "unsupported" for anything else
- Default focus duration is 25 minutes
- Default break duration is 15 minutes
- Default break type is "general"
- Set "end": true if user wants to end current session
- Extract activityType for scheduling requests (walk, lunch, coffee, break, etc.)
- Extract timePreference if mentioned (morning, afternoon, anytime)
- Confidence should be 0.8+ for supported actions, lower for unsupported
- ALWAYS extract duration from natural language when mentioned`;

    return RunnableSequence.from([
      (input: { userMessage: string }) => [
        new SystemMessage(systemPrompt),
        new HumanMessage(input.userMessage)
      ],
      this.llm,
      new StringOutputParser()
    ]);
  }

  async processUserMessage(
    userMessage: string, 
    userId: string, 
    teamId: string
  ): Promise<AIResponse> {
    try {
      // Parse user intent
      const intent = await this.parseIntent(userMessage);
      
      // Special handling for greetings - even with low confidence, treat as greeting if it looks like one
      if (intent.action === 'greeting' || (intent.confidence < 0.7 && this.isGreeting(userMessage))) {
        intent.action = 'greeting';
        intent.confidence = 0.9;
      }
      
      // Handle unsupported requests
      if (intent.action === 'unsupported' || intent.confidence < 0.7) {
        return {
          message: "Sorry, I cannot answer that. I'm here to help with your productivity - try asking about focus sessions, breaks, or your productivity metrics!",
          commandExecuted: false
        };
      }

      // Execute the appropriate command
      const result = await this.executeCommand(intent, userId, teamId);
      
      // Generate intelligent response with recommendations
      const response = await this.generateResponse(intent, result, userMessage);
      
      return response;
    } catch (error) {
      console.error("AI service error:", error);
      return {
        message: "I encountered an issue processing your request. Please try again or use the direct Slack commands (/focus, /break, /productivity).",
        commandExecuted: false
      };
    }
  }

  private async parseIntent(userMessage: string): Promise<CommandIntent> {
    try {
      const response = await this.intentParser.invoke({ userMessage });
      
      // Clean up the response to extract JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate the response structure
      if (!parsed.action || typeof parsed.confidence !== 'number') {
        throw new Error("Invalid response structure");
      }
      
      return {
        action: parsed.action,
        parameters: parsed.parameters || {},
        confidence: parsed.confidence
      };
    } catch (error) {
      console.error("Intent parsing error:", error);
      return {
        action: 'unsupported',
        confidence: 0.0
      };
    }
  }

  private async executeCommand(
    intent: CommandIntent, 
    userId: string, 
    teamId: string
  ): Promise<any> {
    try {
      console.log(`Executing command: ${intent.action} with parameters:`, intent.parameters);
      
      switch (intent.action) {
        case 'greeting':
          return await this.executeGreetingCommand(intent, userId, teamId);
        case 'focus':
          return await this.executeFocusCommand(intent, userId, teamId);
        case 'break':
          return await this.executeBreakCommand(intent, userId, teamId);
        case 'productivity':
          return await this.executeProductivityCommand(userId, teamId);
        case 'scheduling':
          return await this.executeSchedulingCommand(intent, userId, teamId);
        default:
          console.log(`Unknown action: ${intent.action}`);
          return null;
      }
    } catch (error) {
      console.error(`Command execution error for ${intent.action}:`, error);
      throw error;
    }
  }

  private async executeGreetingCommand(intent: CommandIntent, userId: string, teamId: string) {
    // For greetings, we don't need to execute any Slack commands
    // Just return a success indicator so the AI can generate a proper greeting response
    return {
      success: true,
      executed: true, // Mark as executed since greeting doesn't need external commands
      type: 'greeting',
      timestamp: new Date().toISOString()
    };
  }

  private async executeFocusCommand(intent: CommandIntent, userId: string, teamId: string) {
    const duration = intent.parameters?.duration || 25;
    
    console.log(`Starting focus execution for user ${userId}, team ${teamId}, duration: ${duration}`);
    
    // Check if this is an end request
    if (intent.parameters && intent.parameters.end === true) {
      // Actually execute the end focus command
      try {
        const { slackService } = await import('./slack');
        const result = await slackService.handleFocusCommand('end', userId, teamId);
        return {
          command: 'focus',
          action: 'end',
          success: true,
          executed: true,
          result
        };
      } catch (error) {
        console.error("Failed to end focus session:", error);
        return {
          command: 'focus',
          action: 'end',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }
    
    // Start focus session - actually execute it
    try {
      const { slackService } = await import('./slack');
      const result = await slackService.handleFocusCommand(duration.toString(), userId, teamId);
      return {
        command: 'focus',
        action: 'start',
        duration: duration,
        success: true,
        executed: true,
        result
      };
    } catch (error) {
      console.error("Failed to start focus session:", error);
      return {
        command: 'focus',
        action: 'start',
        duration: duration,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async executeBreakCommand(intent: CommandIntent, userId: string, teamId: string) {
    const breakType = intent.parameters?.breakType || 'general';
    const duration = intent.parameters?.duration || 15; // Default to 15 minutes
    
    console.log(`Starting break execution for user ${userId}, team ${teamId}, type: ${breakType}, duration: ${duration}`);
    
    // Actually execute the break command using the proper Slack service method
    try {
      const { slackService } = await import('./slack');
      
      // Use the proper break command handler which will parse and validate the input
      const breakCommandText = duration.toString() + (breakType !== 'general' ? ` ${breakType}` : '');
      const result = await slackService.handleBreakCommand(breakCommandText, userId, teamId);
      
      return {
        command: 'break',
        action: 'start',
        breakType: breakType,
        duration: duration,
        success: true,
        executed: true,
        result
      };
    } catch (error) {
      console.error("Failed to process break command:", error);
      return {
        command: 'break',
        action: 'start',
        breakType: breakType,
        duration: duration,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async executeProductivityCommand(userId: string, teamId: string) {
    // Actually execute the productivity command
    try {
      const { slackService } = await import('./slack');
      const result = await slackService.handleProductivityCommand("", userId, teamId);
      return {
        command: 'productivity',
        action: 'show',
        success: true,
        executed: true,
        result
      };
    } catch (error) {
      console.error("Failed to process productivity command:", error);
      return {
        command: 'productivity',
        action: 'show',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async executeSchedulingCommand(intent: CommandIntent, userId: string, teamId: string) {
    const duration = intent.parameters?.duration || 15;
    const activityType = intent.parameters?.activityType || 'break';
    const timePreference = intent.parameters?.timePreference || 'anytime';
    
    console.log(`Analyzing schedule for user ${userId}, team ${teamId}, activity: ${activityType}, duration: ${duration} minutes`);
    
    try {
      // Get user and their meetings
      const user = await storage.getUserBySlackId(userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Get today's meetings
      const todaysMeetings = await storage.getMeetingsByDate(user.id, new Date());
      
      // Analyze schedule and find optimal time slots
      const scheduleAnalysis = await this.analyzeScheduleForActivity(todaysMeetings, duration, activityType, timePreference, user.timezone || 'America/New_York');
      
      return {
        command: 'scheduling',
        action: 'analyze',
        duration: duration,
        activityType: activityType,
        timePreference: timePreference,
        success: true,
        executed: true,
        result: scheduleAnalysis
      };
    } catch (error) {
      console.error("Failed to analyze schedule:", error);
      return {
        command: 'scheduling',
        action: 'analyze',
        duration: duration,
        activityType: activityType,
        timePreference: timePreference,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async generateResponse(
    intent: CommandIntent, 
    commandResult: any, 
    originalMessage: string
  ): Promise<AIResponse> {
    try {
      let responsePrompt: string;
      
      if (intent.action === 'greeting') {
        responsePrompt = `The user sent a greeting: "${originalMessage}"

Generate a warm, friendly greeting response that:
1. Responds to their greeting appropriately
2. Introduces yourself as a productivity assistant
3. Briefly explains your main capabilities (focus sessions, breaks, productivity tracking)
4. Invites them to try your features
5. Is encouraging and welcoming

Keep it friendly and concise. Make them feel welcome!`;
      } else {
        // Generate specific responses based on the command
        let commandDescription = '';
        let executionStatus = '';
        
        if (commandResult?.command === 'focus') {
          if (commandResult?.action === 'start') {
            commandDescription = `Started a ${commandResult.duration}-minute focus session`;
            executionStatus = commandResult?.executed ? '✅ Successfully started!' : '❌ Failed to start';
          } else {
            commandDescription = 'Ended your current focus session';
            executionStatus = commandResult?.executed ? '✅ Successfully ended!' : '❌ Failed to end';
          }
        } else if (commandResult?.command === 'break') {
          commandDescription = `Started your ${commandResult.breakType} break for ${commandResult.duration} minutes`;
          executionStatus = commandResult?.executed ? '✅ Break started successfully!' : '❌ Failed to start break';
        } else if (commandResult?.command === 'productivity') {
          commandDescription = 'Generated your productivity metrics';
          executionStatus = commandResult?.executed ? '✅ Metrics ready!' : '❌ Failed to generate';
        } else if (commandResult?.command === 'scheduling') {
          commandDescription = `Analyzed your schedule for a ${commandResult.duration}-minute ${commandResult.activityType}`;
          executionStatus = commandResult?.executed ? '✅ Schedule analyzed!' : '❌ Failed to analyze';
        }

        responsePrompt = `Based on this user request and command execution, generate a helpful, friendly response.

User's original message: "${originalMessage}"
Command: ${commandDescription}
Execution status: ${executionStatus}
Command successful: ${commandResult?.success ? 'yes' : 'no'}

${commandResult?.command === 'scheduling' && commandResult?.result ? `
Schedule Analysis Results:
- Available time slots: ${commandResult.result.availableSlots?.length || 0}
- Total meetings today: ${commandResult.result.totalMeetings || 0}
- Total meeting time: ${Math.round((commandResult.result.totalMeetingTime || 0) / 60)}h ${(commandResult.result.totalMeetingTime || 0) % 60}m
- Recommendation: ${commandResult.result.recommendation || 'No specific recommendation'}

Available time slots:
${commandResult.result.availableSlots?.map((slot: any, index: number) => 
  `${index + 1}. ${slot.startTime || slot.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} - ${slot.description}${slot.confidence ? ` (Confidence: ${Math.round(slot.confidence * 100)}%)` : ''}`
).join('\n') || 'No available slots found'}

${commandResult.result.scheduleInsights && commandResult.result.scheduleInsights.length > 0 ? `
Schedule Insights:
${commandResult.result.scheduleInsights.map((insight: string) => `• ${insight}`).join('\n')}
` : ''}
` : ''}

Generate a response that:
1. Acknowledges what the user wanted
2. Confirms what I've done for them (since the command was actually executed)
3. ${commandResult?.command === 'scheduling' ? 'Presents the schedule analysis results in a clear, helpful way' : 'Provides 2-3 helpful tips or recommendations related to productivity'}
4. Is warm, encouraging, and supportive
5. Mentions that they can use slash commands for direct actions

Keep it concise but helpful. Focus on productivity and wellness benefits.

IMPORTANT: Since the command was actually executed, make sure to acknowledge that the action has been completed, not just suggested. End your response with a brief mention of slash commands like: "You can also use /focus, /break, or /productivity for quick actions!"`;
      }

      const response = await this.llm.invoke([
        new SystemMessage("You are a friendly productivity assistant helping users with focus and wellness."),
        new HumanMessage(responsePrompt)
      ]);

      const recommendations = await this.generateRecommendations(intent, commandResult);

      return {
        message: response.content as string,
        commandExecuted: !!commandResult,
        commandResult,
        recommendations,
        executed: commandResult?.executed || false
      };
    } catch (error) {
      console.error("Response generation error:", error);
      
      // Fallback response
      const fallbackMessages = {
        greeting: "Hello! I'm your productivity assistant. I can help you with focus sessions, breaks, and productivity tracking. How can I assist you today?",
        focus: commandResult?.executed ? "✅ I've successfully started your focus session! Your Slack status has been updated and the timer is running. Stay focused and productive!" : "❌ I couldn't start your focus session. Please try using the `/focus` command directly.",
        break: commandResult?.executed ? `✅ I've started your ${commandResult?.duration || 15}-minute break! Your Slack status has been updated to show you're on a break. Enjoy your wellness time!` : "❌ I couldn't start your break. Please try using the `/break` command directly.",
        productivity: commandResult?.executed ? "✅ I've generated your productivity metrics! Check your DMs for your detailed summary and insights." : "❌ I couldn't generate your productivity metrics. Please try using the `/productivity` command directly.",
        scheduling: "I'll analyze your schedule and find the best time for your activity!",
        unsupported: "I'm here to help with productivity features like focus sessions, breaks, and metrics!"
      };

      return {
        message: fallbackMessages[intent.action],
        commandExecuted: !!commandResult,
        commandResult,
        executed: commandResult?.executed || false
      };
    }
  }

  private async generateRecommendations(intent: CommandIntent, commandResult: any): Promise<string[]> {
    const recommendations: string[] = [];

    try {
      switch (intent.action) {
        case 'greeting':
          recommendations.push(
            "Try `/focus 25` to start a 25-minute focus session",
            "Use `/break` to get break suggestions when you need a rest",
            "Check `/productivity` to see your daily productivity metrics"
          );
          break;
          
        case 'focus':
          if (commandResult?.executed) {
            const duration = commandResult?.duration || 25;
            recommendations.push(
              `Your ${duration}-minute focus session is now active! Try the Pomodoro Technique: ${duration} minutes focused work, 5 minute break`,
              "Turn off notifications and close unnecessary browser tabs",
              "Have water and snacks ready before starting your session"
            );
          } else {
            recommendations.push(
              "Try using `/focus 25` to start a 25-minute focus session",
              "Turn off notifications and close unnecessary browser tabs",
              "Have water and snacks ready before starting your session"
            );
          }
          break;
          
        case 'break':
          if (commandResult?.executed) {
            const duration = commandResult?.duration || 15;
            recommendations.push(
              `Your ${duration}-minute break is now active! Step away from your screen - even short breaks help reset your mind`,
              "Try some light stretching or deep breathing exercises",
              "Hydrate! Dehydration can significantly impact focus and energy"
            );
          } else {
            recommendations.push(
              "Try using `/break` to get personalized break suggestions",
              "Step away from your screen - even 5 minutes helps reset your mind",
              "Try some light stretching or deep breathing exercises"
            );
          }
          break;
          
        case 'productivity':
          if (commandResult?.executed) {
            recommendations.push(
              "Your productivity metrics have been generated! Check your DMs for the full report",
              "Review your meeting patterns to identify optimization opportunities",
              "Consider scheduling regular focus blocks in your calendar"
            );
          } else {
            // Generate dynamic recommendations based on user data
            const dynamicRecs = await this.generateProductivityRecommendations(commandResult);
            recommendations.push(...dynamicRecs);
          }
          break;
          
        case 'scheduling':
          if (commandResult?.executed && commandResult?.result) {
            const slots = commandResult.result.availableSlots || [];
            const insights = commandResult.result.scheduleInsights || [];
            
            if (slots.length > 0) {
              const bestSlot = slots[0];
              const bestTime = bestSlot.startTime || bestSlot.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
              recommendations.push(
                `Best time for your ${commandResult.activityType}: ${bestTime}`,
                `You have ${slots.length} available time slots today for your activity`,
                "Consider setting a reminder for your chosen time slot"
              );
              
              // Add insights as recommendations if available
              if (insights.length > 0) {
                recommendations.push(...insights.slice(0, 2)); // Add up to 2 insights
              }
            } else {
              recommendations.push(
                "Your schedule is quite packed today. Consider shorter breaks or rescheduling some meetings",
                "Try taking 5-minute micro-breaks between meetings",
                "Consider blocking calendar time for breaks in advance"
              );
            }
          } else {
            recommendations.push(
              "Try asking about specific activities like 'when is ideal for a 15 minute walk?'",
              "I can analyze your schedule to find the best break times",
              "Consider your energy levels when choosing break times"
            );
          }
          break;
      }
    } catch (error) {
      console.error("Recommendation generation error:", error);
    }

    return recommendations;
  }

  private async generateProductivityRecommendations(productivityData: any): Promise<string[]> {
    const recommendations: string[] = [];

    try {
      // Analyze the productivity data and generate personalized recommendations
      if (productivityData && productivityData.blocks) {
        const hasHighMeetingLoad = productivityData.blocks.some((block: any) => 
          block.text?.text?.includes('Meeting Time') && 
          block.text.text.includes('h') && 
          parseInt(block.text.text) > 4
        );

        const hasLowFocusTime = productivityData.blocks.some((block: any) => 
          block.text?.text?.includes('Focus Time') && 
          block.text.text.includes('0h')
        );

        if (hasHighMeetingLoad) {
          recommendations.push("Consider blocking calendar time for deep work between meetings");
        }

        if (hasLowFocusTime) {
          recommendations.push("Try scheduling dedicated focus sessions using /focus command");
        }

        recommendations.push("Review your meeting patterns to identify optimization opportunities");
      }

      // Default recommendations if no specific data
      if (recommendations.length === 0) {
        recommendations.push(
          "Schedule regular focus blocks in your calendar for deep work",
          "Take breaks every 60-90 minutes to maintain peak performance",
          "Review and optimize your meeting schedule weekly"
        );
      }
    } catch (error) {
      console.error("Dynamic recommendation error:", error);
      recommendations.push("Keep tracking your productivity patterns to identify improvement areas");
    }

    return recommendations;
  }

  // Method to handle AI mentions in Slack
  async handleAIMention(event: any): Promise<void> {
    try {
      const { text, user, team, channel } = event;
      
      // Remove the bot mention from the text
      const cleanText = text.replace(/<@[^>]+>/g, '').trim();
      
      if (!cleanText) {
        return;
      }

      // Send immediate acknowledgment to prevent Slack timeouts
      const client = await (slackService as any).getClient(team);
      await client.chat.postMessage({
        channel: channel,
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

      // Process the user's message asynchronously
      this.processAIMentionAsync(cleanText, user, team, channel).catch(error => {
        console.error("Error processing AI mention:", error);
        // Send error message if processing fails
        client.chat.postMessage({
          channel: channel,
          text: "❌ Sorry, there was an error processing your request. Please try again."
        }).catch((dmError: any) => {
          console.error("Failed to send error message:", dmError);
        });
      });

    } catch (error) {
      console.error("AI mention handling error:", error);
    }
  }

  private async processAIMentionAsync(cleanText: string, user: string, team: string, channel: string): Promise<void> {
    try {
      // Process the user's message
      const response = await this.processUserMessage(cleanText, user, team);
      
      // Send response back to Slack
      const client = await (slackService as any).getClient(team);
      await client.chat.postMessage({
        channel: channel,
        text: response.message,
        blocks: this.formatResponseBlocks(response)
      });
    } catch (error) {
      console.error("Error in processAIMentionAsync:", error);
      throw error; // Re-throw to be caught by the caller
    }
  }

  private formatResponseBlocks(response: AIResponse): any[] {
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
          text: `💡 *Recommendations:*\n${response.recommendations.map(rec => `• ${rec}`).join('\n')}`
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

  // Simple greeting detection method
  private isGreeting(message: string): boolean {
    const greetingPatterns = [
      /^hi\b/i,
      /^hello\b/i,
      /^hey\b/i,
      /^good\s+(morning|afternoon|evening)\b/i,
      /^how\s+are\s+you\b/i,
      /^what's\s+up\b/i,
      /^sup\b/i,
      /^yo\b/i,
      /^greetings\b/i,
      /^good\s+day\b/i
    ];
    
    const cleanMessage = message.trim().toLowerCase();
    return greetingPatterns.some(pattern => pattern.test(cleanMessage));
  }

  // Health check method
  async isHealthy(): Promise<boolean> {
    try {
      if (!process.env.GOOGLE_API_KEY) {
        return false;
      }

      // Quick test of the LLM
      const testResponse = await this.llm.invoke([
        new HumanMessage("Hello")
      ]);

      return !!testResponse.content;
    } catch (error) {
      console.error("AI service health check failed:", error);
      return false;
    }
  }

  // Intelligent LLM-powered schedule analysis method
  private async analyzeScheduleForActivity(
    meetings: any[], 
    duration: number, 
    activityType: string, 
    timePreference: string, 
    timezone: string
  ): Promise<any> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Define work hours (9 AM to 6 PM)
    const workStart = new Date(today);
    workStart.setHours(9, 0, 0, 0);
    const workEnd = new Date(today);
    workEnd.setHours(18, 0, 0, 0);
    
    // Sort meetings by start time and filter future meetings
    const sortedMeetings = meetings
      .filter(meeting => new Date(meeting.startTime) >= now)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    
    // If no meetings today, use LLM to suggest optimal times
    if (sortedMeetings.length === 0) {
      return await this.generateLLMOptimalSlots(duration, activityType, timePreference, timezone, workStart, workEnd);
    }
    
    // Use LLM to analyze the schedule and find optimal slots
    return await this.analyzeScheduleWithLLM(sortedMeetings, duration, activityType, timePreference, timezone, now, workStart, workEnd);
  }

  private async analyzeScheduleWithLLM(
    meetings: any[], 
    duration: number, 
    activityType: string, 
    timePreference: string, 
    timezone: string,
    currentTime: Date,
    workStart: Date,
    workEnd: Date
  ): Promise<any> {
    // Format meetings for LLM analysis
    const formattedMeetings = meetings.map(meeting => ({
      title: meeting.title || 'Untitled Meeting',
      startTime: new Date(meeting.startTime).toLocaleTimeString('en-US', { 
        timeZone: timezone, 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      }),
      endTime: new Date(meeting.endTime).toLocaleTimeString('en-US', { 
        timeZone: timezone, 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      }),
      duration: meeting.duration || 30,
      type: meeting.meetingType || 'video_call',
      attendees: meeting.attendees?.length || 0
    }));

    const systemPrompt = `You are an intelligent productivity assistant that analyzes meeting schedules to find optimal times for activities like breaks, walks, and lunch.

Your task is to analyze a user's meeting schedule and suggest the best time slots for their requested activity.

CONTEXT:
- Activity requested: ${activityType} (${duration} minutes)
- Time preference: ${timePreference}
- Current time: ${currentTime.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true })}
- Work hours: 9:00 AM - 6:00 PM
- User's timezone: ${timezone}

MEETING SCHEDULE:
${formattedMeetings.map((m, i) => `${i + 1}. ${m.title} (${m.duration}min) - ${m.startTime} to ${m.endTime} - ${m.type} - ${m.attendees} attendees`).join('\n')}

ANALYSIS CRITERIA:
1. **Energy Management**: Consider when the user might need breaks based on meeting intensity
2. **Natural Break Patterns**: Lunch around 12-1 PM, coffee breaks in mid-morning/afternoon
3. **Meeting Context**: High-stakes meetings might need preparation time, back-to-back meetings need buffer time
4. **Activity-Specific Timing**: 
   - Walks: Better in daylight hours, avoid right before important meetings
   - Lunch: Traditional lunch hours (11:30 AM - 1:30 PM)
   - Coffee breaks: Mid-morning (10-11 AM) or mid-afternoon (2-4 PM)
   - Stretching: After long meetings or before important ones
5. **Time Preference**: Respect user's morning/afternoon preference
6. **Buffer Time**: Leave some buffer between activities and meetings

Respond with a JSON object in this exact format:
{
  "availableSlots": [
    {
      "startTime": "10:30 AM",
      "endTime": "10:45 AM", 
      "duration": 15,
      "type": "between_meetings",
      "description": "Between Team Standup and Client Meeting - good for a quick coffee break",
      "confidence": 0.9,
      "reasoning": "Natural break point, 15-minute gap, before important client meeting"
    }
  ],
  "totalMeetings": 4,
  "totalMeetingTime": 165,
  "recommendation": "I found 2 optimal slots for your 15-minute walk. The best time is 10:30 AM between your team standup and client meeting. This gives you a natural break and some fresh air before your important client call.",
  "scheduleInsights": [
    "You have a busy morning with back-to-back meetings",
    "Good opportunity for a walk before your client meeting at 11:00 AM",
    "Consider a longer lunch break after your project review"
  ]
}

IMPORTANT:
- Only suggest slots that are actually available (no conflicts with meetings)
- Consider the activity type when suggesting timing
- Provide confidence scores (0.1-1.0) for each slot
- Include reasoning for why each slot is optimal
- Be specific about timing and context
- Consider energy levels and meeting importance`;
    
    try {
      const response = await this.llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(`Please analyze my schedule and find the best ${duration}-minute slots for a ${activityType}.`)
      ]);

      // Parse the LLM response
      const jsonMatch = response.content.toString().match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in LLM response");
      }

      const analysis = JSON.parse(jsonMatch[0]);
      
             // Convert time strings back to Date objects for consistency
       const today = new Date(workStart.getFullYear(), workStart.getMonth(), workStart.getDate());
       const availableSlots = analysis.availableSlots?.map((slot: any) => ({
         ...slot,
         start: this.parseTimeString(slot.startTime, today, timezone),
         end: this.parseTimeString(slot.endTime, today, timezone)
       })) || [];

      return {
        availableSlots,
        totalMeetings: analysis.totalMeetings || meetings.length,
        totalMeetingTime: analysis.totalMeetingTime || meetings.reduce((sum, m) => sum + (m.duration || 0), 0),
        recommendation: analysis.recommendation || this.generateFallbackRecommendation(availableSlots, activityType, duration),
        scheduleInsights: analysis.scheduleInsights || []
      };

    } catch (error) {
      console.error("LLM schedule analysis failed, falling back to algorithmic approach:", error);
      return await this.fallbackScheduleAnalysis(meetings, duration, activityType, timePreference, timezone, currentTime, workStart, workEnd);
    }
  }

  private async generateLLMOptimalSlots(
    duration: number, 
    activityType: string, 
    timePreference: string, 
    timezone: string,
    workStart: Date,
    workEnd: Date
  ): Promise<any> {
    const systemPrompt = `You are an intelligent productivity assistant that suggests optimal times for activities when a user has no meetings scheduled.

CONTEXT:
- Activity requested: ${activityType} (${duration} minutes)
- Time preference: ${timePreference}
- Work hours: 9:00 AM - 6:00 PM
- User's timezone: ${timezone}
- No meetings scheduled today

ANALYSIS CRITERIA:
1. **Activity-Specific Timing**:
   - Walks: Best in daylight (10 AM - 4 PM), avoid extreme heat/cold
   - Lunch: Traditional lunch hours (11:30 AM - 1:30 PM)
   - Coffee breaks: Mid-morning (10-11 AM) or mid-afternoon (2-4 PM)
   - Stretching: Every 2-3 hours, especially after sitting
   - Meditation: Quiet times, avoid rush hours
2. **Energy Management**: Consider natural energy cycles
3. **Time Preference**: Respect user's morning/afternoon preference
4. **Productivity**: Suggest times that won't disrupt work flow

Respond with a JSON object in this exact format:
{
  "availableSlots": [
    {
      "startTime": "10:00 AM",
      "endTime": "10:15 AM",
      "duration": 15,
      "type": "morning_break",
      "description": "Perfect morning coffee break time",
      "confidence": 0.95,
      "reasoning": "Natural break point in morning, good for energy boost"
    }
  ],
  "totalMeetings": 0,
  "totalMeetingTime": 0,
  "recommendation": "Since you have no meetings today, I suggest taking your ${duration}-minute ${activityType} at 10:00 AM. This is an optimal time for this type of activity.",
  "scheduleInsights": [
    "You have a free day - great opportunity for longer breaks",
    "Consider scheduling some focus time between breaks",
    "Perfect day for outdoor activities if weather permits"
  ]
}`;

    try {
      const response = await this.llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(`I have no meetings today. When should I take my ${duration}-minute ${activityType}?`)
      ]);

      const jsonMatch = response.content.toString().match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in LLM response");
      }

      const analysis = JSON.parse(jsonMatch[0]);
      
      const availableSlots = analysis.availableSlots?.map((slot: any) => ({
        ...slot,
        start: this.parseTimeString(slot.startTime, workStart, timezone),
        end: this.parseTimeString(slot.endTime, workStart, timezone)
      })) || [];

      return {
        availableSlots,
        totalMeetings: 0,
        totalMeetingTime: 0,
        recommendation: analysis.recommendation,
        scheduleInsights: analysis.scheduleInsights || []
      };

    } catch (error) {
      console.error("LLM optimal slots generation failed, falling back to default slots:", error);
      const slots = this.generateDefaultSlots(workStart, workEnd, duration, timePreference, timezone);
      return {
        availableSlots: slots,
        totalMeetings: 0,
        totalMeetingTime: 0,
        recommendation: this.generateRecommendation(slots, activityType, duration),
        scheduleInsights: ["No meetings scheduled today - great opportunity for flexible timing"]
      };
    }
  }

  // Fallback to algorithmic approach if LLM fails
  private async fallbackScheduleAnalysis(
    meetings: any[], 
    duration: number, 
    activityType: string, 
    timePreference: string, 
    timezone: string,
    currentTime: Date,
    workStart: Date,
    workEnd: Date
  ): Promise<any> {
    const availableSlots: any[] = [];
    
    // Check for slot before first meeting
    const firstMeeting = meetings[0];
    const firstMeetingStart = new Date(firstMeeting.startTime);
    const timeBeforeFirst = firstMeetingStart.getTime() - currentTime.getTime();
    
    if (timeBeforeFirst >= duration * 60 * 1000) {
      const slotStart = new Date(currentTime);
      const slotEnd = new Date(currentTime.getTime() + duration * 60 * 1000);
      availableSlots.push({
        start: slotStart,
        end: slotEnd,
        duration: duration,
        type: 'before_first_meeting',
        description: `Before your first meeting at ${firstMeetingStart.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true })}`
      });
    }
    
    // Find gaps between meetings
    for (let i = 0; i < meetings.length - 1; i++) {
      const currentMeeting = meetings[i];
      const nextMeeting = meetings[i + 1];
      
      const currentMeetingEnd = new Date(currentMeeting.endTime);
      const nextMeetingStart = new Date(nextMeeting.startTime);
      
      const gapDuration = nextMeetingStart.getTime() - currentMeetingEnd.getTime();
      
      if (gapDuration >= duration * 60 * 1000) {
        const slotStart = new Date(currentMeetingEnd);
        const slotEnd = new Date(currentMeetingEnd.getTime() + duration * 60 * 1000);
        
        availableSlots.push({
          start: slotStart,
          end: slotEnd,
          duration: duration,
          type: 'between_meetings',
          description: `Between ${currentMeeting.title || 'meeting'} and ${nextMeeting.title || 'meeting'}`
        });
      }
    }
    
    // Check for slot after last meeting
    const lastMeeting = meetings[meetings.length - 1];
    const lastMeetingEnd = new Date(lastMeeting.endTime);
    const timeAfterLast = workEnd.getTime() - lastMeetingEnd.getTime();
    
    if (timeAfterLast >= duration * 60 * 1000) {
      const slotStart = new Date(lastMeetingEnd);
      const slotEnd = new Date(lastMeetingEnd.getTime() + duration * 60 * 1000);
      availableSlots.push({
        start: slotStart,
        end: slotEnd,
        duration: duration,
        type: 'after_last_meeting',
        description: `After your last meeting at ${lastMeetingEnd.toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true })}`
      });
    }
    
    const filteredSlots = this.filterSlotsByPreference(availableSlots, timePreference);
    const totalMeetingTime = meetings.reduce((sum, meeting) => sum + (meeting.duration || 0), 0);
    
    return {
      availableSlots: filteredSlots,
      totalMeetings: meetings.length,
      totalMeetingTime: totalMeetingTime,
      recommendation: this.generateRecommendation(filteredSlots, activityType, duration),
      scheduleInsights: ["Using algorithmic analysis due to LLM unavailability"]
    };
  }

  // Helper method to parse time strings back to Date objects
  private parseTimeString(timeStr: string, baseDate: Date, timezone: string): Date {
    const [time, period] = timeStr.split(' ');
    const [hours, minutes] = time.split(':').map(Number);
    
    let hour = hours;
    if (period === 'PM' && hours !== 12) hour += 12;
    if (period === 'AM' && hours === 12) hour = 0;
    
    const result = new Date(baseDate);
    result.setHours(hour, minutes, 0, 0);
    return result;
  }

  private generateFallbackRecommendation(slots: any[], activityType: string, duration: number): string {
    if (slots.length === 0) {
      return `I couldn't find a good ${duration}-minute slot for your ${activityType} today. Your schedule is quite packed! Consider taking shorter breaks or rescheduling some meetings.`;
    }
    
    const bestSlot = slots[0];
    const startTime = bestSlot.startTime || bestSlot.start.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    });
    
    const activityDescriptions: { [key: string]: string } = {
      'walk': 'walk',
      'lunch': 'lunch break',
      'coffee': 'coffee break',
      'break': 'break',
      'stretch': 'stretch break',
      'meditation': 'meditation session'
    };
    
    const activityDesc = activityDescriptions[activityType] || activityType;
    
    if (slots.length === 1) {
      return `Perfect! I found one ideal time for your ${duration}-minute ${activityDesc}: ${startTime}. This slot fits well in your schedule.`;
    } else {
      return `Great! I found ${slots.length} good options for your ${duration}-minute ${activityDesc}. The best time is ${startTime}, but you also have ${slots.length - 1} other options throughout the day.`;
    }
  }

  private generateDefaultSlots(workStart: Date, workEnd: Date, duration: number, timePreference: string, timezone: string): any[] {
    const slots = [];
    
    if (timePreference === 'morning' || timePreference === 'anytime') {
      const morningSlot = new Date(workStart);
      morningSlot.setHours(10, 0, 0, 0); // 10 AM
      slots.push({
        start: morningSlot,
        end: new Date(morningSlot.getTime() + duration * 60 * 1000),
        duration: duration,
        type: 'morning',
        description: 'Morning slot (10:00 AM)'
      });
    }
    
    if (timePreference === 'afternoon' || timePreference === 'anytime') {
      const afternoonSlot = new Date(workStart);
      afternoonSlot.setHours(14, 0, 0, 0); // 2 PM
      slots.push({
        start: afternoonSlot,
        end: new Date(afternoonSlot.getTime() + duration * 60 * 1000),
        duration: duration,
        type: 'afternoon',
        description: 'Afternoon slot (2:00 PM)'
      });
    }
    
    return slots;
  }

  private filterSlotsByPreference(slots: any[], timePreference: string): any[] {
    if (timePreference === 'anytime') {
      return slots;
    }
    
    return slots.filter(slot => {
      const hour = slot.start.getHours();
      if (timePreference === 'morning') {
        return hour < 12;
      } else if (timePreference === 'afternoon') {
        return hour >= 12;
      }
      return true;
    });
  }

  private generateRecommendation(slots: any[], activityType: string, duration: number): string {
    if (slots.length === 0) {
      return `I couldn't find a good ${duration}-minute slot for your ${activityType} today. Your schedule is quite packed! Consider taking shorter breaks or rescheduling some meetings.`;
    }
    
    const bestSlot = slots[0]; // First slot is usually the best
    const startTime = bestSlot.start.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    });
    
    const activityDescriptions: { [key: string]: string } = {
      'walk': 'walk',
      'lunch': 'lunch break',
      'coffee': 'coffee break',
      'break': 'break',
      'stretch': 'stretch break',
      'meditation': 'meditation session'
    };
    
    const activityDesc = activityDescriptions[activityType] || activityType;
    
    if (slots.length === 1) {
      return `Perfect! I found one ideal time for your ${duration}-minute ${activityDesc}: ${startTime}. This slot fits well in your schedule.`;
    } else {
      return `Great! I found ${slots.length} good options for your ${duration}-minute ${activityDesc}. The best time is ${startTime}, but you also have ${slots.length - 1} other options throughout the day.`;
    }
  }
}

export const aiService = new AIService();