import type { CloudflareDaily, CloudflareEventsByType, CloudflareOverview, CloudflareSnapshot, CloudflareWorkers } from '@/shared/types/dashboard';

type FetchCloudflareArgs = {
	backendUrl: string;
	adminApiKey?: string;
	enabled?: boolean;
};

const REQUEST_TIMEOUT_MS = 4500;

const normalizeBaseUrl = (value: string): string => {
	const trimmed = value.trim().replace(/\/$/, '');
	return trimmed.length > 0 ? trimmed : 'http://localhost:5035/api';
};

const endpointFor = (baseUrl: string, path: string): string => `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

const isLocalApiStyle = (baseUrl: string): boolean => /\/api$/i.test(baseUrl) || /\/api\//i.test(baseUrl);

const hostFromUrl = (value: string): string => {
	try {
		return new URL(value).host;
	} catch {
		return value;
	}
};

type FetchJsonResult<T> = {
	data?: T;
	connectedBackendName?: string;
	status?: number;
	error?: string;
};

async function fetchJson<T>(url: string, headers: HeadersInit): Promise<FetchJsonResult<T>> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			headers,
			signal: controller.signal,
		});
		const connectedBackendName = response.headers.get('X-Cloudflare-Upstream')?.trim() || undefined;
		if (!response.ok) {
			let error = `Request failed (${response.status})`;
			try {
				const contentType = response.headers.get('content-type') ?? '';
				if (contentType.includes('application/json')) {
					const payload = (await response.json()) as { detail?: string; title?: string; message?: string };
					const detail = payload.detail ?? payload.message ?? payload.title;
					if (typeof detail === 'string' && detail.trim().length > 0) {
						error = detail;
					}
				} else {
					const text = await response.text();
					if (text.trim().length > 0) {
						error = text.trim();
					}
				}
			} catch {
				// ignore parsing failures and keep generic status message
			}
			return {
				connectedBackendName,
				status: response.status,
				error,
			};
		}
		return {
			data: (await response.json()) as T,
			connectedBackendName,
			status: response.status,
		};
	} finally {
		clearTimeout(timeout);
	}
}

export async function fetchCloudflareSnapshot({
	backendUrl,
	adminApiKey,
	enabled = true,
}: FetchCloudflareArgs): Promise<CloudflareSnapshot> {
	const fetchedAtUtc = new Date().toISOString();

	if (!enabled) {
		return { loading: false, fetchedAtUtc };
	}

	const baseUrl = normalizeBaseUrl(backendUrl);
	const localApi = isLocalApiStyle(baseUrl);
	const baseHost = hostFromUrl(baseUrl);
	const defaultHeaders: HeadersInit = adminApiKey ? { 'X-Admin-Key': adminApiKey } : {};

	const overviewEndpoint = localApi
		? endpointFor(baseUrl, '/cloudflare/overview')
		: endpointFor(baseUrl, '/v1/admin/overview');
	const eventsEndpoint = localApi
		? endpointFor(baseUrl, '/cloudflare/events-by-type')
		: endpointFor(baseUrl, '/v1/admin/events-by-type');
	const dailyEndpoint = localApi
		? endpointFor(baseUrl, '/cloudflare/daily?days=30')
		: endpointFor(baseUrl, '/v1/admin/daily?days=30');
	const workersEndpoint = localApi
		? endpointFor(baseUrl, '/cloudflare/workers')
		: endpointFor(baseUrl, '/v1/admin/workers');

	try {
		const [overviewResult, eventsResult, dailyResult, workersResult] = await Promise.allSettled([
			fetchJson<CloudflareOverview>(overviewEndpoint, defaultHeaders),
			fetchJson<CloudflareEventsByType>(eventsEndpoint, defaultHeaders),
			fetchJson<CloudflareDaily>(dailyEndpoint, defaultHeaders),
			fetchJson<CloudflareWorkers>(workersEndpoint, defaultHeaders),
		]);

		const overview = overviewResult.status === 'fulfilled' ? overviewResult.value.data : undefined;
		const eventsByType = eventsResult.status === 'fulfilled' ? eventsResult.value.data : undefined;
		const daily = dailyResult.status === 'fulfilled' ? dailyResult.value.data : undefined;
		const workers = workersResult.status === 'fulfilled' ? workersResult.value.data : undefined;

		const requiredEndpointStatuses = [
			overviewResult.status === 'fulfilled' ? overviewResult.value.status : undefined,
			eventsResult.status === 'fulfilled' ? eventsResult.value.status : undefined,
			dailyResult.status === 'fulfilled' ? dailyResult.value.status : undefined,
		];
		const requiredEndpointErrors = [
			overviewResult.status === 'fulfilled' ? overviewResult.value.error : undefined,
			eventsResult.status === 'fulfilled' ? eventsResult.value.error : undefined,
			dailyResult.status === 'fulfilled' ? dailyResult.value.error : undefined,
		].filter((error): error is string => typeof error === 'string' && error.trim().length > 0);
		const workersEndpointError = workersResult.status === 'fulfilled' ? workersResult.value.error : undefined;

		const connectedBackendName =
			(overviewResult.status === 'fulfilled' ? overviewResult.value.connectedBackendName : undefined) ??
			(eventsResult.status === 'fulfilled' ? eventsResult.value.connectedBackendName : undefined) ??
			(dailyResult.status === 'fulfilled' ? dailyResult.value.connectedBackendName : undefined) ??
			(workersResult.status === 'fulfilled' ? workersResult.value.connectedBackendName : undefined) ??
			(localApi ? 'Cloudflare upstream' : baseHost);

		const requiredFailedCount = [overviewResult, eventsResult, dailyResult].filter(
			(result) => result.status === 'rejected',
		).length;

		const noPayload = !overview && !eventsByType && !daily;
		let error: string | undefined;

		if (noPayload) {
			if (requiredEndpointStatuses.some((status) => status === 401)) {
				error = 'Cloudflare rejected the admin key (401). Enter a valid X-Admin-Key.';
			} else if (requiredEndpointStatuses.some((status) => status === 503)) {
				error = 'Cloudflare proxy is disabled on this host. Enable CloudflareAdmin or provide X-Admin-Key.';
			} else if (requiredEndpointErrors.length > 0) {
				error = requiredEndpointErrors[0];
			} else if (typeof workersEndpointError === 'string' && workersEndpointError.trim().length > 0) {
				error = workersEndpointError;
			} else {
				error = 'Cloudflare admin endpoints unavailable. No backend data returned.';
			}
		} else if (requiredEndpointErrors.length > 0) {
			error = `Partial backend data loaded. ${requiredEndpointErrors[0]}`;
		}

		return {
			overview,
			eventsByType,
			daily,
			workers,
			connectedBackendName,
			fetchedAtUtc,
			error:
				requiredFailedCount > 0 && noPayload && !error
					? 'Cloudflare admin endpoints unavailable. No backend data returned.'
					: error,
			loading: false,
		};
	} catch {
		return {
			connectedBackendName: localApi ? 'Cloudflare upstream' : baseHost,
			error: 'Cloudflare admin endpoints unavailable. No backend data returned.',
			loading: false,
			fetchedAtUtc,
		};
	}
}
