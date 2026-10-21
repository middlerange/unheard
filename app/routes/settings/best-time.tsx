// ABOUTME: Best Time to Post settings page — AI-suggested optimal posting times (Issue #12)
// ABOUTME: Heatmap visualization and industry benchmarks

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronLeft, Clock, Sparkles, TrendingUp, Calendar, Info } from "@/components/icons";
import { cn } from '@/lib/utils';
import { 
  getBestTimeRecommendations, 
  calculateBestTimes,
  getEngagementHeatmap,
  suggestNextTime,
} from '@/app/server-fns/best-time';
import { PLATFORM_DEFINITIONS } from '@/lib/platforms';

export const Route = createFileRoute('/settings/best-time')({
  loader: async () => {
    const [recommendations, heatmapData, nextSuggestion] = await Promise.all([
      getBestTimeRecommendations({ data: { platform: 'twitter' } }),
      getEngagementHeatmap({ data: { platform: 'twitter' } }),
      suggestNextTime({ data: { platform: 'twitter', withinHours: 48 } }),
    ]);
    return { recommendations, heatmapData, nextSuggestion };
  },
  component: BestTimeSettings,
});

const PLATFORMS = ['twitter', 'linkedin', 'reddit', 'discord', 'telegram'] as const;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function BestTimeSettings() {
  const initial = Route.useLoaderData();
  const [activePlatform, setActivePlatform] = useState<string>('twitter');
  const [recommendations, setRecommendations] = useState(initial.recommendations);
  const [heatmapData, setHeatmapData] = useState(initial.heatmapData);
  const [nextSuggestion, setNextSuggestion] = useState(initial.nextSuggestion);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  async function loadPlatformData(platform: string) {
    setIsLoading(true);
    try {
      const [recs, heatmap, suggestion] = await Promise.all([
        getBestTimeRecommendations({ data: { platform: platform as any } }),
        getEngagementHeatmap({ data: { platform: platform as any } }),
        suggestNextTime({ data: { platform: platform as any, withinHours: 48 } }),
      ]);
      setRecommendations(recs);
      setHeatmapData(heatmap);
      setNextSuggestion(suggestion);
    } finally {
      setIsLoading(false);
    }
  }

  const handlePlatformChange = (platform: string) => {
    setActivePlatform(platform);
    loadPlatformData(platform);
  };

  const handleCalculate = async () => {
    setIsCalculating(true);
    try {
      await calculateBestTimes({ data: { platform: activePlatform as any } });
      toast.success('Best times recalculated based on your history');
      await loadPlatformData(activePlatform);
    } catch {
      toast.error('Failed to calculate best times');
    } finally {
      setIsCalculating(false);
    }
  };
  
  const platformRec = recommendations[0];
  const topTimes = platformRec?.predictions?.slice(0, 5) || [];
  
  // Get color based on score
  const getScoreColor = (score: number) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    if (score >= 40) return 'bg-orange-500';
    return 'bg-[var(--color-text-tertiary)]';
  };
  
  // Get opacity based on score
  const getScoreOpacity = (score: number) => {
    return Math.max(0.1, score / 100);
  };
  
  return (
    <div className="w-full px-6 py-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-semibold">Best Time to Post</h1>
      </div>
      
      <p className="text-muted-foreground mb-6">
        AI-suggested optimal posting times based on your historical engagement data and industry benchmarks.
      </p>
      
      {/* Platform Tabs */}
      <Tabs value={activePlatform} onValueChange={handlePlatformChange}>
        <TabsList className="mb-6">
          {PLATFORMS.map((platform) => (
            <TabsTrigger key={platform} value={platform} className="capitalize">
              {PLATFORM_DEFINITIONS[platform as keyof typeof PLATFORM_DEFINITIONS]?.label || platform}
            </TabsTrigger>
          ))}
        </TabsList>
        
        <TabsContent value={activePlatform} className="mt-0 space-y-6">
          {/* Next Suggestion Card */}
          <Card className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border-purple-500/20">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-500" />
                <CardTitle className="text-base">Recommended Next Post</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-8 w-48 bg-muted rounded animate-pulse" />
              ) : nextSuggestion ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-bold">{nextSuggestion.label}</p>
                    <p className="text-sm text-muted-foreground">
                      Engagement Score: {nextSuggestion.score}/100
                      {nextSuggestion.confidence && ` • Confidence: ${nextSuggestion.confidence}%`}
                      {nextSuggestion.isBenchmark && ' (Industry benchmark)'}
                    </p>
                  </div>
                  <Button variant="outline" className="gap-2">
                    <Calendar className="w-4 h-4" />
                    Schedule Post
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground">No suggestion available</p>
              )}
            </CardContent>
          </Card>
          
          {/* Top Times */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-500" />
                  <CardTitle className="text-base">Top 5 Best Times</CardTitle>
                </div>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={handleCalculate}
                  disabled={isCalculating}
                >
                  {isCalculating ? 'Calculating...' : 'Recalculate'}
                </Button>
              </div>
              <CardDescription>
                Based on {platformRec?.isBenchmark ? 'industry benchmarks' : 'your posting history'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-12 w-full bg-muted rounded animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {topTimes.map((time: any, index: number) => (
                    <div 
                      key={index}
                      className="flex items-center gap-4 p-3 rounded-lg bg-muted/50"
                    >
                      <div className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white',
                        getScoreColor(time.score)
                      )}>
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">{time.label}</p>
                        <p className="text-xs text-muted-foreground">
                          Score: {time.score}/100
                          {time.confidence && ` • Confidence: ${time.confidence}%`}
                        </p>
                      </div>
                      <Badge variant={time.score >= 80 ? 'default' : 'secondary'}>
                        {time.score >= 80 ? 'Excellent' : time.score >= 60 ? 'Good' : 'Fair'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          
          {/* Heatmap */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-500" />
                <CardTitle className="text-base">Engagement Heatmap</CardTitle>
              </div>
              <CardDescription>
                Visual overview of best posting times throughout the week
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="h-64 w-full bg-muted rounded animate-pulse" />
              ) : heatmapData ? (
                <div className="space-y-1">
                  {/* Header row with hours */}
                  <div className="flex">
                    <div className="w-12"></div>
                    {HOURS.filter(h => h % 3 === 0).map(hour => (
                      <div key={hour} className="flex-1 text-[10px] text-muted-foreground text-center">
                        {hour % 12 || 12}{hour >= 12 ? 'p' : 'a'}
                      </div>
                    ))}
                  </div>
                  
                  {/* Day rows */}
                  {DAYS.map((day, dayIndex) => (
                    <div key={day} className="flex items-center">
                      <div className="w-12 text-xs text-muted-foreground">{day}</div>
                      <div className="flex-1 flex">
                        {HOURS.map((hour) => {
                          const score = heatmapData.heatmap[dayIndex]?.[hour] || 0;
                          return (
                            <div
                              key={hour}
                              className={cn(
                                'flex-1 h-6 rounded-sm mx-[1px]',
                                score > 0 ? getScoreColor(score) : 'bg-[var(--color-bg-muted)]'
                              )}
                              style={{ opacity: score > 0 ? getScoreOpacity(score) : 1 }}
                              title={`${day} ${hour}:00 - Score: ${Math.round(score)}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  
                  {/* Legend */}
                  <div className="flex items-center gap-4 mt-4 pt-4 border-t">
                    <span className="text-xs text-muted-foreground">Engagement:</span>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-[var(--color-text-tertiary)]" />
                      <span className="text-xs">Low</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-orange-500" />
                      <span className="text-xs">Medium</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-yellow-500" />
                      <span className="text-xs">Good</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 rounded bg-green-500" />
                      <span className="text-xs">Excellent</span>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">No heatmap data available</p>
              )}
            </CardContent>
          </Card>
          
          {/* Info Card */}
          <Card className="bg-muted/50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-500 mt-0.5" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">How this works:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>Scores are calculated from your historical post engagement</li>
                    <li>New accounts use industry benchmarks until data is collected</li>
                    <li>Higher scores indicate better predicted engagement</li>
                    <li>Confidence increases as more posts are scheduled</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
