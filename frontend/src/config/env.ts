export const env = {
	apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "",
	reverbAppKey: process.env.NEXT_PUBLIC_REVERB_APP_KEY?.trim() || "",
	reverbHost: process.env.NEXT_PUBLIC_REVERB_HOST?.trim() || "",
	reverbPort: process.env.NEXT_PUBLIC_REVERB_PORT?.trim() || "",
	reverbScheme: process.env.NEXT_PUBLIC_REVERB_SCHEME?.trim() || "http",
	appUrl: process.env.NEXT_PUBLIC_APP_URL?.trim() || "",
	funGamesMock: process.env.NEXT_PUBLIC_FUN_GAMES_MOCK?.trim() || "",
} as const;

export function requireEnv(key: keyof typeof env): string {
	const value = env[key];
	if (!value) {
		throw new Error(`Missing environment variable: ${key}`);
	}
	return value;
}
