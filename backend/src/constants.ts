import type { TelemetryEventName } from './types/telemetry';

export const allowedEventNames = new Set<TelemetryEventName>([
	'install_first_run',
	'app_start',
	'heartbeat',
	'update_check',
]);

export const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

