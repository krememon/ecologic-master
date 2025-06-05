import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { 
  Cloud, 
  CloudRain, 
  Sun, 
  CloudSnow, 
  Wind, 
  Thermometer, 
  Droplets, 
  Eye,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Calendar,
  MapPin,
  RefreshCw
} from "lucide-react";
import { format, parseISO } from "date-fns";

interface WeatherData {
  location: string;
  current: {
    temperature: number;
    condition: string;
    humidity: number;
    windSpeed: number;
    pressure: number;
    visibility: number;
  };
  forecast: Array<{
    date: string;
    maxTemp: number;
    minTemp: number;
    condition: string;
    description: string;
    humidity: number;
    windSpeed: number;
    precipitationChance: number;
    precipitationAmount: number;
  }>;
}

interface WeatherAlert {
  type: 'rain' | 'storm' | 'wind' | 'temperature' | 'visibility';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  affectedDays: string[];
  recommendation: string;
}

interface JobWeatherAnalysis {
  jobId: number;
  location: string;
  alerts: WeatherAlert[];
  workableDays: number;
  totalDays: number;
  delayRisk: 'low' | 'medium' | 'high';
  recommendations: string[];
}

interface WeatherAnalysisResponse {
  weather: WeatherData;
  analysis: JobWeatherAnalysis;
}

interface WeatherDashboardProps {
  jobId: number;
  location: string;
  startDate?: string | null;
  endDate?: string | null;
}

const getWeatherIcon = (condition: string) => {
  switch (condition.toLowerCase()) {
    case 'clear':
    case 'sunny':
      return <Sun className="h-6 w-6 text-yellow-500" />;
    case 'clouds':
    case 'cloudy':
    case 'overcast':
      return <Cloud className="h-6 w-6 text-gray-500" />;
    case 'rain':
    case 'drizzle':
      return <CloudRain className="h-6 w-6 text-blue-500" />;
    case 'snow':
      return <CloudSnow className="h-6 w-6 text-blue-200" />;
    case 'thunderstorm':
    case 'storm':
      return <CloudRain className="h-6 w-6 text-purple-600" />;
    default:
      return <Cloud className="h-6 w-6 text-gray-500" />;
  }
};

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case 'low': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'medium': return 'bg-orange-100 text-orange-800 border-orange-200';
    case 'high': return 'bg-red-100 text-red-800 border-red-200';
    case 'critical': return 'bg-red-200 text-red-900 border-red-300';
    default: return 'bg-gray-100 text-gray-800 border-gray-200';
  }
};

const getDelayRiskColor = (risk: string) => {
  switch (risk) {
    case 'low': return 'text-green-600';
    case 'medium': return 'text-yellow-600';
    case 'high': return 'text-red-600';
    default: return 'text-gray-600';
  }
};

const getDelayRiskIcon = (risk: string) => {
  switch (risk) {
    case 'low': return <CheckCircle className="h-5 w-5 text-green-600" />;
    case 'medium': return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
    case 'high': return <XCircle className="h-5 w-5 text-red-600" />;
    default: return <AlertTriangle className="h-5 w-5 text-gray-600" />;
  }
};

export default function WeatherDashboard({ jobId, location, startDate, endDate }: WeatherDashboardProps) {
  const { toast } = useToast();
  const [refreshing, setRefreshing] = useState(false);

  // Fetch current weather
  const { data: currentWeather, isLoading: loadingCurrent } = useQuery<WeatherData>({
    queryKey: [`/api/weather/current/${encodeURIComponent(location)}`],
    enabled: !!location,
  });

  // Analyze weather for job
  const weatherAnalysisMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/weather/analyze-job/${jobId}`);
      return res.json() as Promise<WeatherAnalysisResponse>;
    },
    onSuccess: () => {
      toast({
        title: "Weather Analysis Updated",
        description: "Latest weather data and forecasts loaded",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Weather Analysis Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await weatherAnalysisMutation.mutateAsync();
    } finally {
      setRefreshing(false);
    }
  };

  // Only show weather analysis if job has dates
  const canAnalyze = startDate && location;
  const analysis = weatherAnalysisMutation.data?.analysis;
  const forecast = weatherAnalysisMutation.data?.weather.forecast || [];

  if (loadingCurrent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            Weather Conditions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-pulse text-slate-500">Loading weather data...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!currentWeather) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            Weather Conditions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Cloud className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <p className="text-slate-500">Unable to load weather data</p>
            <p className="text-sm text-slate-400 mt-2">Check location and try again</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Weather */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Cloud className="h-5 w-5" />
              Current Weather
            </CardTitle>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <MapPin className="h-4 w-4" />
              {currentWeather.location}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="flex items-center gap-3">
              {getWeatherIcon(currentWeather.current.condition)}
              <div>
                <p className="text-2xl font-bold">{currentWeather.current.temperature}°F</p>
                <p className="text-sm text-slate-600 capitalize">{currentWeather.current.condition}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Wind className="h-4 w-4 text-slate-500" />
              <div>
                <p className="font-medium">{currentWeather.current.windSpeed} mph</p>
                <p className="text-xs text-slate-500">Wind Speed</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Droplets className="h-4 w-4 text-slate-500" />
              <div>
                <p className="font-medium">{currentWeather.current.humidity}%</p>
                <p className="text-xs text-slate-500">Humidity</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-slate-500" />
              <div>
                <p className="font-medium">{currentWeather.current.visibility} mi</p>
                <p className="text-xs text-slate-500">Visibility</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Weather Analysis */}
      {canAnalyze && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Job Weather Analysis
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRefresh}
                disabled={weatherAnalysisMutation.isPending || refreshing}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${(weatherAnalysisMutation.isPending || refreshing) ? 'animate-spin' : ''}`} />
                {weatherAnalysisMutation.isPending || refreshing ? 'Analyzing...' : 'Analyze Weather'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {analysis ? (
              <div className="space-y-6">
                {/* Delay Risk Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    {getDelayRiskIcon(analysis.delayRisk)}
                    <div>
                      <p className="font-medium">Delay Risk</p>
                      <p className={`text-sm capitalize font-semibold ${getDelayRiskColor(analysis.delayRisk)}`}>
                        {analysis.delayRisk}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <Calendar className="h-5 w-5 text-slate-600" />
                    <div>
                      <p className="font-medium">Workable Days</p>
                      <p className="text-sm">
                        {analysis.workableDays} of {analysis.totalDays} days
                      </p>
                    </div>
                  </div>
                  
                  <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <p className="font-medium mb-2">Work Efficiency</p>
                    <Progress 
                      value={(analysis.workableDays / analysis.totalDays) * 100} 
                      className="h-2"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      {Math.round((analysis.workableDays / analysis.totalDays) * 100)}% favorable conditions
                    </p>
                  </div>
                </div>

                {/* Weather Alerts */}
                {analysis.alerts.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-3">Weather Alerts</h4>
                    <div className="space-y-3">
                      {analysis.alerts.map((alert, index) => (
                        <Alert key={index} className={getSeverityColor(alert.severity)}>
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <p className="font-medium">{alert.message}</p>
                                <Badge variant="outline" className="text-xs">
                                  {alert.severity}
                                </Badge>
                              </div>
                              <p className="text-sm">{alert.recommendation}</p>
                              <p className="text-xs opacity-75">
                                Affected: {alert.affectedDays.map(day => format(parseISO(day), 'MMM d')).join(', ')}
                              </p>
                            </div>
                          </AlertDescription>
                        </Alert>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                {analysis.recommendations.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-3">Recommendations</h4>
                    <div className="space-y-2">
                      {analysis.recommendations.map((rec, index) => (
                        <div key={index} className="flex items-start gap-2 text-sm">
                          <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                          <p>{rec}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 7-Day Forecast */}
                {forecast.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-3">7-Day Forecast</h4>
                    <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
                      {forecast.slice(0, 7).map((day, index) => (
                        <div key={index} className="text-center p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                          <p className="text-xs font-medium text-slate-600 mb-2">
                            {format(parseISO(day.date), 'MMM d')}
                          </p>
                          <div className="flex justify-center mb-2">
                            {getWeatherIcon(day.condition)}
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm font-bold">{day.maxTemp}°</p>
                            <p className="text-xs text-slate-500">{day.minTemp}°</p>
                            {day.precipitationChance > 0 && (
                              <p className="text-xs text-blue-600">
                                {day.precipitationChance}% rain
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <Cloud className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                <p className="text-slate-500 mb-4">
                  {!startDate ? 'Add start date to analyze weather impact' : 'Click "Analyze Weather" to get forecast'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}