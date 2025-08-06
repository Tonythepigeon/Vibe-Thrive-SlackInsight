import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-green-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">P</span>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">Productivitywise</h1>
            <span className="text-gray-400">▼</span>
          </div>
          <nav className="mt-4">
            <span className="text-gray-600 hover:text-gray-900 cursor-pointer">Home ▼</span>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">
            Hello and welcome to your Wellbeing partner
          </h2>
          
          {/* Hero Image */}
          <div className="w-full h-32 bg-gradient-to-r from-teal-400 via-emerald-400 to-green-400 rounded-lg mb-8 relative overflow-hidden">
            <div className="absolute inset-0 opacity-30">
              <svg viewBox="0 0 400 200" className="w-full h-full">
                <defs>
                  <pattern id="leaves" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                    <path d="M20 5 Q30 15 20 25 Q10 15 20 5" fill="rgba(255,255,255,0.3)" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#leaves)" />
              </svg>
            </div>
          </div>
        </div>

        {/* About Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-gray-900">
              About me and what do I do
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-gray-700">
              <span className="mr-2">👋</span>
              Hey hey!
            </p>
            <p className="text-gray-700">
              I'm your friendly Wellbeing Agent, your pocket-sized cheerleader for all things balance & bliss 
              <span className="ml-1">😊✨</span>
            </p>
            
            <div className="space-y-2 mt-4">
              <p className="text-gray-700">
                <span className="mr-2">📱</span>
                Been working non-stop? I'll nudge you to breathe, stretch, or shake it out 
                <span className="ml-1">💃🕺</span>
              </p>
              <p className="text-gray-700">
                <span className="mr-2">📊</span>
                I'll keep an eye on your day, total meetings, hours spent, and sneak in a "Hey, time for a break!" when you need it most
              </p>
              <p className="text-gray-700">
                <span className="mr-2">⚡</span>
                Want a quick wellness activity? Just ask!
              </p>
            </div>

            <p className="text-gray-700 mt-4">
              Let's boost your focus, beat stress, and keep the good vibes rolling! 
              <span className="ml-1">🌈🚀</span>
            </p>
          </CardContent>
        </Card>

        {/* Preferences Section */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-gray-900">
              Preferences
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <p className="text-gray-700 mb-2">
                <span className="mr-2">⚙️</span>
                To make my service perfect for you, I need to know some things.
              </p>
              <p className="text-gray-600 text-sm mb-4">
                Please make sure that the below configuration is always updated:
              </p>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex items-center gap-2">
                <span className="text-lg">🍽️</span>
                <span className="text-gray-700">Your usual lunch time: 13:00</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-lg">⏰</span>
                <span className="text-gray-700">Your preferred lunch break duration: 60 minutes</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-lg">🧠</span>
                <span className="text-gray-700">Your preferred frequency for short breaks through the day: Every 90 minutes</span>
              </div>
            </div>

            <Button variant="outline" className="border-gray-300 text-gray-700 hover:bg-gray-50">
              Change Values
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
} 