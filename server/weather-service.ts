import axios from 'axios';

export interface WeatherData {
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

export interface WeatherAlert {
  type: 'rain' | 'storm' | 'wind' | 'temperature' | 'visibility';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  affectedDays: string[];
  recommendation: string;
}

export interface JobWeatherAnalysis {
  jobId: number;
  location: string;
  alerts: WeatherAlert[];
  workableDays: number;
  totalDays: number;
  delayRisk: 'low' | 'medium' | 'high';
  recommendations: string[];
}

class WeatherService {
  private apiKey: string;
  private baseUrl = 'https://api.openweathermap.org/data/2.5';

  constructor() {
    this.apiKey = process.env.OPENWEATHER_API_KEY || '';
    if (!this.apiKey) {
      console.warn('OPENWEATHER_API_KEY not found in environment variables');
    }
  }

  async getCoordinatesFromLocation(location: string): Promise<{ lat: number; lon: number }> {
    try {
      const response = await axios.get(`${this.baseUrl}/weather`, {
        params: {
          q: location,
          appid: this.apiKey,
        },
      });
      
      return {
        lat: response.data.coord.lat,
        lon: response.data.coord.lon,
      };
    } catch (error) {
      console.error('Error getting coordinates:', error);
      throw new Error('Could not find location');
    }
  }

  async getCurrentWeather(location: string): Promise<WeatherData['current']> {
    try {
      const response = await axios.get(`${this.baseUrl}/weather`, {
        params: {
          q: location,
          appid: this.apiKey,
          units: 'imperial',
        },
      });

      const data = response.data;
      return {
        temperature: Math.round(data.main.temp),
        condition: data.weather[0].main,
        humidity: data.main.humidity,
        windSpeed: Math.round(data.wind.speed),
        pressure: data.main.pressure,
        visibility: Math.round((data.visibility || 10000) / 1609.34), // Convert to miles
      };
    } catch (error) {
      console.error('Error fetching current weather:', error);
      throw new Error('Failed to fetch current weather');
    }
  }

  async getForecast(location: string, days: number = 5): Promise<WeatherData['forecast']> {
    try {
      const coords = await this.getCoordinatesFromLocation(location);
      
      const response = await axios.get(`${this.baseUrl}/forecast`, {
        params: {
          lat: coords.lat,
          lon: coords.lon,
          appid: this.apiKey,
          units: 'imperial',
          cnt: days * 8, // 8 forecasts per day (every 3 hours)
        },
      });

      // Group forecasts by day
      const dailyForecasts: { [key: string]: any[] } = {};
      
      response.data.list.forEach((item: any) => {
        const date = item.dt_txt.split(' ')[0];
        if (!dailyForecasts[date]) {
          dailyForecasts[date] = [];
        }
        dailyForecasts[date].push(item);
      });

      // Process daily forecasts
      return Object.entries(dailyForecasts).map(([date, forecasts]) => {
        const temps = forecasts.map(f => f.main.temp);
        const conditions = forecasts.map(f => f.weather[0]);
        const precipitation = forecasts.reduce((sum, f) => sum + (f.rain?.['3h'] || 0), 0);
        
        // Get most common condition
        const conditionCounts = conditions.reduce((acc: any, cond) => {
          acc[cond.main] = (acc[cond.main] || 0) + 1;
          return acc;
        }, {});
        const mostCommonCondition = Object.keys(conditionCounts).reduce((a, b) => 
          conditionCounts[a] > conditionCounts[b] ? a : b
        );

        return {
          date,
          maxTemp: Math.round(Math.max(...temps)),
          minTemp: Math.round(Math.min(...temps)),
          condition: mostCommonCondition,
          description: conditions.find(c => c.main === mostCommonCondition)?.description || '',
          humidity: Math.round(forecasts.reduce((sum, f) => sum + f.main.humidity, 0) / forecasts.length),
          windSpeed: Math.round(forecasts.reduce((sum, f) => sum + f.wind.speed, 0) / forecasts.length),
          precipitationChance: Math.round(forecasts.filter(f => f.weather[0].main.includes('Rain')).length / forecasts.length * 100),
          precipitationAmount: Math.round(precipitation * 100) / 100,
        };
      });
    } catch (error) {
      console.error('Error fetching forecast:', error);
      throw new Error('Failed to fetch weather forecast');
    }
  }

  async getWeatherData(location: string): Promise<WeatherData> {
    const [current, forecast] = await Promise.all([
      this.getCurrentWeather(location),
      this.getForecast(location, 7),
    ]);

    return {
      location,
      current,
      forecast,
    };
  }

  analyzeWeatherForJob(
    forecast: WeatherData['forecast'],
    startDate: string,
    endDate: string,
    jobType: string = 'general'
  ): JobWeatherAnalysis {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const alerts: WeatherAlert[] = [];
    const recommendations: string[] = [];
    
    let workableDays = 0;
    let totalDays = 0;
    
    forecast.forEach(day => {
      const dayDate = new Date(day.date);
      if (dayDate >= start && dayDate <= end) {
        totalDays++;
        
        // Analyze weather conditions for construction work
        let isWorkable = true;
        
        // Rain/precipitation analysis
        if (day.precipitationChance > 70 || day.precipitationAmount > 0.5) {
          isWorkable = false;
          alerts.push({
            type: 'rain',
            severity: day.precipitationAmount > 1 ? 'high' : 'medium',
            message: `Heavy rain expected on ${day.date}`,
            affectedDays: [day.date],
            recommendation: 'Consider indoor work or reschedule outdoor activities',
          });
        }
        
        // Wind analysis
        if (day.windSpeed > 25) {
          isWorkable = false;
          alerts.push({
            type: 'wind',
            severity: day.windSpeed > 35 ? 'critical' : 'high',
            message: `High winds (${day.windSpeed} mph) expected on ${day.date}`,
            affectedDays: [day.date],
            recommendation: 'Avoid crane operations and roofing work',
          });
        }
        
        // Temperature analysis
        if (day.maxTemp > 95) {
          alerts.push({
            type: 'temperature',
            severity: day.maxTemp > 105 ? 'critical' : 'high',
            message: `Extreme heat (${day.maxTemp}°F) expected on ${day.date}`,
            affectedDays: [day.date],
            recommendation: 'Schedule early morning work, ensure hydration breaks',
          });
        }
        
        if (day.minTemp < 32) {
          isWorkable = false;
          alerts.push({
            type: 'temperature',
            severity: day.minTemp < 20 ? 'critical' : 'high',
            message: `Freezing temperatures (${day.minTemp}°F) expected on ${day.date}`,
            affectedDays: [day.date],
            recommendation: 'Concrete work may be affected, protect materials',
          });
        }
        
        // Storm analysis
        if (day.condition.includes('Thunder') || day.condition.includes('Storm')) {
          isWorkable = false;
          alerts.push({
            type: 'storm',
            severity: 'critical',
            message: `Thunderstorms expected on ${day.date}`,
            affectedDays: [day.date],
            recommendation: 'All outdoor work must be suspended for safety',
          });
        }
        
        if (isWorkable) {
          workableDays++;
        }
      }
    });
    
    // Calculate delay risk
    const workablePercentage = totalDays > 0 ? workableDays / totalDays : 1;
    let delayRisk: 'low' | 'medium' | 'high' = 'low';
    
    if (workablePercentage < 0.5) {
      delayRisk = 'high';
      recommendations.push('Consider extending project timeline due to weather conditions');
    } else if (workablePercentage < 0.7) {
      delayRisk = 'medium';
      recommendations.push('Monitor weather closely and prepare alternative work plans');
    } else {
      recommendations.push('Weather conditions are generally favorable for construction');
    }
    
    // Add general recommendations based on alerts
    if (alerts.some(a => a.type === 'rain')) {
      recommendations.push('Ensure proper site drainage and cover materials');
    }
    if (alerts.some(a => a.type === 'wind')) {
      recommendations.push('Secure loose materials and postpone crane operations');
    }
    if (alerts.some(a => a.type === 'temperature' && a.message.includes('heat'))) {
      recommendations.push('Implement heat safety protocols and adjust work hours');
    }
    
    return {
      jobId: 0, // Will be set by caller
      location: '',
      alerts,
      workableDays,
      totalDays,
      delayRisk,
      recommendations,
    };
  }
}

export const weatherService = new WeatherService();