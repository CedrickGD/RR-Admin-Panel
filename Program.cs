using System.Text;

var builder = WebApplication.CreateBuilder(args);

if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ASPNETCORE_URLS")))
{
	builder.WebHost.UseUrls("http://localhost:5035");
}

builder.Services.AddHttpClient("CloudflareAdmin", client =>
{
	client.Timeout = TimeSpan.FromSeconds(5);
});

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/health", () => Results.Ok(new { ok = true, service = "rr-admin-dashboard-host" }));

app.MapGet("/api/cloudflare/overview", (
	HttpContext httpContext,
	IHttpClientFactory httpClientFactory,
	IConfiguration configuration,
	ILogger<Program> logger) =>
	ForwardCloudflareRequestAsync(httpContext, httpClientFactory, configuration, logger, "/v1/admin/overview"));

app.MapGet("/api/cloudflare/events-by-type", (
	HttpContext httpContext,
	IHttpClientFactory httpClientFactory,
	IConfiguration configuration,
	ILogger<Program> logger) =>
	ForwardCloudflareRequestAsync(httpContext, httpClientFactory, configuration, logger, "/v1/admin/events-by-type"));

app.MapGet("/api/cloudflare/daily", (
	HttpContext httpContext,
	IHttpClientFactory httpClientFactory,
	IConfiguration configuration,
	ILogger<Program> logger,
	int? days) =>
{
	var safeDays = Math.Clamp(days ?? 30, 1, 365);
	return ForwardCloudflareRequestAsync(httpContext, httpClientFactory, configuration, logger, $"/v1/admin/daily?days={safeDays}");
});

app.MapGet("/api/cloudflare/workers", (
	HttpContext httpContext,
	IHttpClientFactory httpClientFactory,
	IConfiguration configuration,
	ILogger<Program> logger) =>
	ForwardCloudflareRequestAsync(httpContext, httpClientFactory, configuration, logger, "/v1/admin/workers"));

app.MapFallbackToFile("index.html");

app.Run();

static async Task<IResult> ForwardCloudflareRequestAsync(
	HttpContext httpContext,
	IHttpClientFactory httpClientFactory,
	IConfiguration configuration,
	ILogger logger,
	string pathAndQuery)
{
	var cloudflareSection = configuration.GetSection("CloudflareAdmin");
	var incomingApiKey = httpContext.Request.Headers["X-Admin-Key"].FirstOrDefault()?.Trim();
	var configuredEnabled = cloudflareSection.GetValue("Enabled", false);
	var configuredAdminApiKey = cloudflareSection["AdminApiKey"]?.Trim();
	var enabled =
		configuredEnabled ||
		!string.IsNullOrWhiteSpace(configuredAdminApiKey) ||
		!string.IsNullOrWhiteSpace(incomingApiKey);

	if (!enabled)
	{
		return Results.Problem(
			title: "Cloudflare integration disabled",
			detail: "Enable CloudflareAdmin.Enabled or configure CloudflareAdmin.AdminApiKey, or provide X-Admin-Key on the request.",
			statusCode: StatusCodes.Status503ServiceUnavailable);
	}

	var baseUrl = (cloudflareSection["BaseUrl"] ?? "https://backend.rr-admin-panel.workers.dev").TrimEnd('/');
	httpContext.Response.Headers["X-Cloudflare-Upstream"] = GetBackendDisplayName(baseUrl);
	var adminApiKey = !string.IsNullOrWhiteSpace(incomingApiKey) ? incomingApiKey : configuredAdminApiKey;
	var requestUrl = $"{baseUrl}{pathAndQuery}";

	try
	{
		var client = httpClientFactory.CreateClient("CloudflareAdmin");
		using var request = new HttpRequestMessage(HttpMethod.Get, requestUrl);

		if (!string.IsNullOrWhiteSpace(adminApiKey))
		{
			request.Headers.TryAddWithoutValidation("X-Admin-Key", adminApiKey);
		}

		using var response = await client.SendAsync(request);
		var payload = await response.Content.ReadAsStringAsync();
		var contentType = response.Content.Headers.ContentType?.ToString() ?? "application/json; charset=utf-8";

		return Results.Content(payload, contentType, Encoding.UTF8, (int)response.StatusCode);
	}
	catch (Exception ex)
	{
		logger.LogWarning(ex, "Cloudflare proxy request failed for {PathAndQuery}.", pathAndQuery);
		return Results.Problem(
			title: "Cloudflare proxy unavailable",
			detail: "Failed to fetch Cloudflare admin data. The UI can continue with local fallback datasets.",
			statusCode: StatusCodes.Status502BadGateway);
	}
}

static string GetBackendDisplayName(string baseUrl)
{
	if (Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri))
	{
		return uri.Host;
	}

	return baseUrl;
}
