import { CloudRain, CloudSun, Cloudy, Snowflake, Sun, Wind } from 'lucide-react';
import type { WeatherCondition } from '@/shared/types/dashboard';

type WeatherConditionIconProps = {
	condition: WeatherCondition;
	size?: number;
};

export function WeatherConditionIcon({ condition, size = 22 }: WeatherConditionIconProps) {
	switch (condition) {
		case 'sunny':
			return <Sun size={size} />;
		case 'rain':
			return <CloudRain size={size} />;
		case 'storm':
			return <Wind size={size} />;
		case 'fog':
			return <Cloudy size={size} />;
		case 'snow':
			return <Snowflake size={size} />;
		case 'cloudy':
		default:
			return <CloudSun size={size} />;
	}
}
