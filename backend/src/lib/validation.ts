import { allowedEventNames, uuidRegex } from '../constants';
import type { TelemetryEventName, TelemetryRequestBody } from '../types/telemetry';

export function validatePayload(body: TelemetryRequestBody): string | null {
	if (!body.install_id || !uuidRegex.test(body.install_id.trim())) {
		return 'install_id must be a valid UUID.';
	}

	if (!body.event_name || !allowedEventNames.has(body.event_name.trim() as TelemetryEventName)) {
		return 'event_name is invalid.';
	}

	if (!body.app_version || body.app_version.trim().length === 0 || body.app_version.trim().length > 32) {
		return 'app_version is required and must be 1-32 chars.';
	}

	if (!body.platform || body.platform.trim().length === 0 || body.platform.trim().length > 32) {
		return 'platform is required and must be 1-32 chars.';
	}

	if (!body.timestamp_utc) {
		return 'timestamp_utc is required.';
	}

	const parsedDate = new Date(body.timestamp_utc);
	if (Number.isNaN(parsedDate.getTime())) {
		return 'timestamp_utc must be an ISO-8601 date.';
	}

	return null;
}

