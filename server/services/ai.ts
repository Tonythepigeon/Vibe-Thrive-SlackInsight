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
   
3. BREAK: Suggest or manage breaks (type: general, hydration, stretch, meditation, walk)
   - Examples: "suggest a break", "I need a coffee break", "time for a stretch"
   
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
- Use "focus" for concentration/work session requests
- Use "break" for rest/pause requests
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
      type: 'greeting',
      timestamp: new Date().toISOString()
    };
  }

  private async executeFocusCommand(intent: CommandIntent, userId: string, teamId: string) {
    const duration = intent.parameters?.duration || 25;
    
    // Check if this is an end request
    if (intent.parameters && 'end' in intent.parameters) {
      return await slackService.handleSlashCommand({
        body: {
          command: '/focus',
          text: 'end',
          user_id: userId,
          team_id: teamId
        }
      }, { json: (response: any) => response });
    }
    
    // Start focus session
    return await slackService.handleSlashCommand({
      body: {
        command: '/focus',
        text: duration.toString(),
        user_id: userId,
        team_id: teamId
      }
    }, { json: (response: any) => response });
  }

  private async executeBreakCommand(intent: CommandIntent, userId: string, teamId: string) {
    const breakType = intent.parameters?.breakType || 'general';
    
    return await slackService.handleSlashCommand({
      body: {
        command: '/break',
        text: breakType,
        user_id: userId,
        team_id: teamId
      }
    }, { json: (response: any) => response });
  }

  private async executeProductivityCommand(userId: string, teamId: string) {
    return await slackService.handleSlashCommand({
      body: {
        command: '/productivity',
        text: '',
        user_id: userId,
        team_id: teamId
      }
    }, { json: (response: any) => response });
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
        responsePrompt = `Based on this user request and command execution, generate a helpful, friendly response.

User's original message: "${originalMessage}"
Command executed: ${intent.action}
Command successful: ${commandResult ? 'yes' : 'no'}

Generate a response that:
1. Acknowledges what the user wanted
2. Confirms what action was taken
3. Provides 2-3 helpful tips or recommendations related to productivity
4. Is warm, encouraging, and supportive

Keep it concise but helpful. Focus on productivity and wellness benefits.`;
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
        recommendations
      };
    } catch (error) {
      console.error("Response generation error:", error);
      
      // Fallback response
      const fallbackMessages = {
        greeting: "Hello! I'm your productivity assistant. I can help you with focus sessions, breaks, and productivity tracking. How can I assist you today?",
        focus: "I've started your focus session! Remember to eliminate distractions and set clear goals for maximum productivity.",
        break: "Time for a well-deserved break! Stepping away helps maintain your energy and creativity throughout the day.",
        productivity: "Here's your productivity summary! Regular tracking helps you understand your work patterns and optimize your schedule.",
        unsupported: "I'm here to help with productivity features like focus sessions, breaks, and metrics!"
      };

      return {
        message: fallbackMessages[intent.action],
        commandExecuted: !!commandResult,
        commandResult
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
          recommendations.push(
            "Try the Pomodoro Technique: 25 minutes focused work, 5 minute break",
            "Turn off notifications and close unnecessary browser tabs",
            "Have water and snacks ready before starting your session"
          );
          break;
          
        case 'break':
          recommendations.push(
            "Step away from your screen - even 5 minutes helps reset your mind",
            "Try some light stretching or deep breathing exercises",
            "Hydrate! Dehydration can significantly impact focus and energy"
          );
          break;
          
        case 'productivity':
          // Generate dynamic recommendations based on user data
          const dynamicRecs = await this.generateProductivityRecommendations(commandResult);
          recommendations.push(...dynamicRecs);
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
      console.error("AI mention handling error:", error);
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

    return blocks;
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