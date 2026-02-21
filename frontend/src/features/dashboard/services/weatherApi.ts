import type { OverviewWeather, WeatherCondition } from '@/shared/types/dashboard';

type OpenMeteoResponse = {
	current?: {
		temperature_2m?: number;
		apparent_temperature?: number;
		wind_speed_10m?: number;
		wind_direction_10m?: number;
		weather_code?: number;
		time?: string;
	};
	daily?: {
		temperature_2m_max?: number[];
		temperature_2m_min?: number[];
	};
};

const BERLIN_FORECAST_URL =
	'https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=UTC';

const toDirection = (degrees?: number): string => {
	if (typeof degrees !== 'number' || Number.isNaN(degrees)) {
		return 'N/A';
	}
	const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
	const index = Math.round(degrees / 22.5) % 16;
	return directions[index];
};

const mapCondition = (weatherCode?: number): { condition: WeatherCondition; label: string } => {
	if (weatherCode === undefined) {
		return { condition: 'cloudy', label: 'Unknown' };
	}
	if (weatherCode === 0) {
		return { condition: 'sunny', label: 'Clear' };
	}
	if ([1, 2, 3].includes(weatherCode)) {
		return { condition: 'cloudy', label: 'Cloudy' };
	}
	if ([45, 48].includes(weatherCode)) {
		return { condition: 'fog', label: 'Fog' };
	}
	if ([95, 96, 99].includes(weatherCode)) {
		return { condition: 'storm', label: 'Thunderstorm' };
	}
	if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) {
		return { condition: 'snow', label: 'Snow' };
	}
	return { condition: 'rain', label: 'Rain' };
};

const unavailableWeather = (error?: string): OverviewWeather => ({
	available: false,
	city: 'Berlin',
	country: 'DE',
	condition: 'cloudy',
	conditionLabel: 'Weather unavailable',
	error,
});

export async function fetchOverviewWeather(): Promise<OverviewWeather> {
	try {
		const response = await fetch(BERLIN_FORECAST_URL);
		if (!response.ok) {
			return unavailableWeather('Weather API unavailable');
		}

		const payload = (await response.json()) as OpenMeteoResponse;
		const conditionMeta = mapCondition(payload.current?.weather_code);
		const max = payload.daily?.temperature_2m_max?.[0];
		const min = payload.daily?.temperature_2m_min?.[0];

		return {
			available: true,
			city: 'Berlin',
			country: 'DE',
			condition: conditionMeta.condition,
			conditionLabel: conditionMeta.label,
			currentTempC: payload.current?.temperature_2m,
			feelsLikeC: payload.current?.apparent_temperature,
			minTempC: min,
			maxTempC: max,
			windKph: payload.current?.wind_speed_10m,
			windDirection: toDirection(payload.current?.wind_direction_10m),
			updatedAt: payload.current?.time,
		};
	} catch {
		return unavailableWeather('Weather API request failed');
	}
}

