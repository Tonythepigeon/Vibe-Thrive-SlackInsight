import { GoogleGenerativeAI } from "@google/generative-ai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { slackService } from "./slack";
import { storage } from "../storage";

interface CommandIntent {
  action: 'focus' | 'break' | 'productivity' | 'greeting' | 'unsupported';
  parameters?: {
    duration?: number;
    breakType?: string;
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
   - Examples: "start focus for 30 minutes", "end my focus session", "I need to concentrate"
   
3. BREAK: Start breaks or manage break requests (type: general, hydration, stretch, meditation, walk)
   - Examples: "I need a break", "start a coffee break", "time for a stretch", "take a break"
   
4. PRODUCTIVITY: Show productivity metrics and summaries
   - Examples: "show my productivity", "how productive was I today?", "meeting summary"

5. UNSUPPORTED: Any request not related to these productivity features
   - Examples: "what's the weather?", "tell me a joke", "book a meeting"

Respond ONLY with a JSON object in this exact format:
{
  "action": "greeting|focus|break|productivity|unsupported",
  "parameters": {
    "duration": 25,
    "breakType": "general"
  },
  "confidence": 0.95
}

Rules:
- Use "greeting" for any form of hello, hi, hey, or general greetings
- Use "focus" for concentration/work session requests (will start actual focus sessions)
- Use "break" for rest/pause requests (will start actual breaks)
- Use "productivity" for metrics/summary requests
- Use "unsupported" for anything else
- Default focus duration is 25 minutes
- Default break type is "general"
- Confidence should be 0.8+ for supported actions, lower for unsupported`;

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
    if (intent.parameters && 'end' in intent.parameters) {
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
    
    console.log(`Starting break execution for user ${userId}, team ${teamId}, type: ${breakType}`);
    
    // Actually execute the break command - start the break directly
    try {
      const { slackService } = await import('./slack');
      
      // First, get the user to ensure they exist
      const { storage } = await import('../storage');
      let user = await storage.getUserBySlackId(userId);
      
      if (!user) {
        user = await storage.createUser({
          slackUserId: userId,
          slackTeamId: teamId,
          email: `${userId}@slack.local`,
          name: "Slack User",
        });
      }
      
      // Start the break directly by setting break mode (this sets Slack status)
      await slackService.setBreakMode(user.id, 20); // 20 minute break
      
      // Create a break suggestion for tracking
      const suggestion = await storage.createBreakSuggestion({
        userId: user.id,
        type: breakType,
        message: `AI initiated ${breakType} break`,
        reason: "AI detected break request",
        accepted: true,
        acceptedAt: new Date()
      });
      
      // Log the activity
      storage.logActivity({
        userId: user.id,
        action: "break_started",
        details: { 
          suggestionId: suggestion.id,
          duration: 20,
          type: breakType,
          trigger: "ai_command"
        }
      }).catch(console.error);
      
      return {
        command: 'break',
        action: 'start',
        breakType: breakType,
        duration: 20,
        success: true,
        executed: true,
        result: { suggestionId: suggestion.id }
      };
    } catch (error) {
      console.error("Failed to process break command:", error);
      return {
        command: 'break',
        action: 'start',
        breakType: breakType,
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
          commandDescription = `Started your ${commandResult.breakType} break`;
          executionStatus = commandResult?.executed ? '✅ Break started successfully!' : '❌ Failed to start break';
        } else if (commandResult?.command === 'productivity') {
          commandDescription = 'Generated your productivity metrics';
          executionStatus = commandResult?.executed ? '✅ Metrics ready!' : '❌ Failed to generate';
        }

        responsePrompt = `Based on this user request and command execution, generate a helpful, friendly response.

User's original message: "${originalMessage}"
Command: ${commandDescription}
Execution status: ${executionStatus}
Command successful: ${commandResult?.success ? 'yes' : 'no'}

Generate a response that:
1. Acknowledges what the user wanted
2. Confirms what I've done for them (since the command was actually executed)
3. Provides 2-3 helpful tips or recommendations related to productivity
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
        break: commandResult?.executed ? "✅ I've started your break! Your Slack status has been updated to show you're on a break. Enjoy your 20-minute wellness time!" : "❌ I couldn't start your break. Please try using the `/break` command directly.",
        productivity: commandResult?.executed ? "✅ I've generated your productivity metrics! Check your DMs for your detailed summary and insights." : "❌ I couldn't generate your productivity metrics. Please try using the `/productivity` command directly.",
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
            recommendations.push(
              "Your focus session is now active! Try the Pomodoro Technique: 25 minutes focused work, 5 minute break",
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
            recommendations.push(
              "Your break is now active! Step away from your screen - even 5 minutes helps reset your mind",
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
}

export const aiService = new AIService();