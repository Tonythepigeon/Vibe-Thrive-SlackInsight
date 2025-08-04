# Overview
this is my edit!!!!!
This is a productivity and wellness Slack application designed to help employees optimize their work patterns through meeting analytics, proactive break suggestions, and focus mode features. The application integrates with calendar systems (Google Calendar, Microsoft Outlook) and communication tools (Slack, Microsoft Teams) to provide personalized insights and recommendations for better work-life balance.

The system tracks meeting patterns, suggests intelligent breaks, generates productivity summaries, and offers focus mode functionality with calendar blocking and Slack status management. It's built as a full-stack web application with a React frontend dashboard for analytics and a Node.js backend handling integrations and data processing.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **React 18** with TypeScript for the user interface
- **Vite** as the build tool and development server
- **Tailwind CSS** with **shadcn/ui** component library for styling
- **TanStack Query** for server state management and API caching
- **Wouter** for client-side routing
- **React Hook Form** with Zod validation for form handling

The frontend follows a component-based architecture with reusable UI components, custom hooks for mobile detection and toast notifications, and a centralized query client for API interactions.

## Backend Architecture 
- **Express.js** server with TypeScript
- **Drizzle ORM** for database operations with PostgreSQL
- **Neon Database** as the PostgreSQL provider
- Modular service architecture with separate services for:
  - Calendar integration (Google Calendar, Microsoft Outlook)
  - Slack API handling and OAuth
  - Analytics and insights generation
  - Scheduled task management (cron jobs)
  - Data storage abstraction layer

## Database Design
- **PostgreSQL** with Drizzle ORM for type-safe database operations
- Core entities include:
  - Users with Slack integration and timezone support
  - Integrations for storing OAuth tokens and configuration
  - Meetings with external calendar sync capabilities
  - Productivity metrics with time-based aggregation
  - Break suggestions with context-aware timing
  - Focus sessions with duration tracking
  - Activity logs for audit trails
  - Slack team configurations

## Authentication & Authorization
- OAuth 2.0 flows for external service integrations
- Slack OAuth for team and user authentication
- Token-based authentication with refresh token support
- Session management using PostgreSQL session store

## Data Processing & Analytics
- Scheduled background jobs for calendar synchronization
- Real-time productivity metrics calculation
- Intelligent break suggestion algorithms based on meeting patterns
- Meeting analytics with time distribution analysis
- Activity logging and audit trail maintenance

## External Service Integration
- **Google Calendar API** for meeting data and calendar management
- **Microsoft Graph API** for Outlook calendar integration
- **Slack Web API** for messaging, status updates, and OAuth
- **Microsoft Teams** integration capability for meeting transcripts
- WebSocket support for real-time notifications

# External Dependencies

## Third-Party APIs
- **Google Calendar API** - Meeting sync, calendar blocking for focus mode
- **Microsoft Graph API** - Outlook calendar integration and Teams data
- **Slack Web API** - Bot interactions, status management, OAuth flows
- **Microsoft Teams API** - Meeting transcripts and collaboration data (stretch goal)

## Database & Infrastructure
- **Neon Database** - Serverless PostgreSQL hosting
- **PostgreSQL** - Primary database with session storage

## Authentication Services
- **Google OAuth 2.0** - Calendar access authorization
- **Microsoft OAuth 2.0** - Outlook and Teams integration
- **Slack OAuth** - Workspace and user authentication

## Development & Monitoring
- **Replit** - Development environment and deployment
- **Vite** - Frontend build tooling with HMR
- **ESBuild** - Production build optimization
- **Node-cron** - Scheduled task execution
- **WebSocket** - Real-time communication support