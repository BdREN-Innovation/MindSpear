import axios, {
	AxiosInstance,
	AxiosRequestConfig,
	AxiosResponse,
	InternalAxiosRequestConfig,
	AxiosHeaders,
} from "axios";
import { apiConfig } from "@/config/api";

interface ApiResponse<T = unknown> {
	data: T;
	message?: string;
	success: boolean;
	statusCode: number;
}

if (!apiConfig.baseURL && typeof window !== "undefined") {
	console.warn(
		"NEXT_PUBLIC_API_BASE_URL is not defined; axios will use relative URLs."
	);
}

interface CustomAxiosRequestConfig extends InternalAxiosRequestConfig {
	_retry?: boolean;
}

type ApiRequestConfig = AxiosRequestConfig & {
	_retry?: boolean;
};

const axiosInstance: AxiosInstance = axios.create({
	baseURL: apiConfig.baseURL,
	headers: apiConfig.jsonHeaders,
	timeout: apiConfig.timeoutMs,
});

const liveParticipantModuleForUrl = (url?: string): "quest" | "quiz" | null => {
	if (!url) return null;
	if (/\/quest-attempts\/[^/]+\/(answer|status)/.test(url)) return "quest";
	if (/\/quiz-attempts\/[^/]+\/(answer|status)/.test(url)) return "quiz";
	return null;
};

const isAnonymousLiveRequest = (url?: string): boolean => {
	if (!url) return false;

	return (
		/\/quest-attempts\/[^/]+\/(answer|status)/.test(url) ||
		/\/quiz-attempts\/[^/]+\/(answer|status)/.test(url) ||
		/\/quest-sessions\/[^/]+\/state/.test(url) ||
		/\/quiz-sessions\/[^/]+\/state/.test(url)
	);
};

const getParticipantTokenForCurrentSession = (
	module: "quest" | "quiz"
): string | null => {
	if (typeof window === "undefined") return null;

	const sessionId = new URLSearchParams(window.location.search).get("sid");
	if (!sessionId) return null;

	return window.sessionStorage.getItem(
		`mindspear:live:${module}:${sessionId}:participant_token`
	);
};

// Request interceptor with proper typing
axiosInstance.interceptors.request.use(
	(config: InternalAxiosRequestConfig) => {
		const customConfig = config as CustomAxiosRequestConfig;

		if (typeof window !== "undefined") {
			const token = localStorage.getItem("auth_token");
			if (token) {
				customConfig.headers =
					customConfig.headers || new AxiosHeaders();
				customConfig.headers.set("Authorization", `Bearer ${token}`);
			}

			const participantModule = liveParticipantModuleForUrl(
				customConfig.url
			);
			const participantToken = participantModule
				? getParticipantTokenForCurrentSession(participantModule)
				: null;
			if (participantToken) {
				customConfig.headers =
					customConfig.headers || new AxiosHeaders();
				customConfig.headers.set(
					"X-Participant-Token",
					participantToken
				);
			}

		}
		return customConfig;
	},
	(error) => {
		return Promise.reject(error);
	}
);

// Callers of these APIs turn every failure into UI (DeckApiError, library
// notices), so the generic console logging below is only noise there.
const QUIET_URL = /(?:^|\/)(?:quests\/v2|quest-sessions\/v2|library)(?:[/?#]|$)/;

/** Failures the caller expects and handles: cancelled requests, quiet APIs, 4xx with an API error code. */
const isExpectedFailure = (error: unknown): boolean => {
	if (axios.isCancel(error)) return true;
	if (!axios.isAxiosError(error)) return false;
	if (QUIET_URL.test(error.config?.url ?? "")) return true;
	const status = error.response?.status ?? 0;
	if (status < 400 || status >= 500) return false;
	const body = error.response?.data as { code?: unknown; data?: { code?: unknown } | null } | undefined;
	const code = body?.data?.code ?? body?.code;
	return typeof code === "string" && code !== "";
};

// ##### Response interceptor with proper typing and error handling #####
axiosInstance.interceptors.response.use(
	(response: AxiosResponse<ApiResponse>) => {
		return response;
	},
	(error) => {
		if (
			error.response?.status === 401 &&
			typeof window !== "undefined" &&
			!isAnonymousLiveRequest(error.config?.url)
		) {
			localStorage.removeItem("auth_token");
			window.location.href = "/";
		}

		if (isExpectedFailure(error)) return Promise.reject(error);

		if (error.response) {
			switch (error.response.status) {
				case 400:
					console.error("Bad request:", error.response.data);
					break;
				case 401:
					// Redirected to sign-in above.
					break;
				case 403:
					console.error("Forbidden access:", error.response.data);
					break;
				case 404:
					console.error("Resource not found:", error.config?.url);
					break;
				case 500:
					console.error("Server error:", error.response.data);
					break;
				default:
					console.error(
						"Unhandled error status:",
						error.response.status
					);
					console.error("Response headers:", error.response.headers);
					console.error("Response data:", error.response.data);
					console.error("Request URL:", error.config?.url);
			}
		} else if (error.request) {
			console.error("No response received:", error.request);
		} else {
			console.error("Request setup error:", error.message);
		}

		return Promise.reject(error);
	}
);

// ##### Create a typed wrapper function for API calls #####
export const api = {
	get: async <T>(
		url: string,
		config?: ApiRequestConfig
	): Promise<ApiResponse<T>> => {
		const response = await axiosInstance.get<ApiResponse<T>>(url, config);
		return response.data;
	},
	post: async <T>(
		url: string,
		data?: unknown,
		config?: ApiRequestConfig
	): Promise<ApiResponse<T>> => {
		const response = await axiosInstance.post<ApiResponse<T>>(
			url,
			data,
			config
		);
		return response.data;
	},
	put: async <T>(
		url: string,
		data?: unknown,
		config?: ApiRequestConfig
	): Promise<ApiResponse<T>> => {
		const response = await axiosInstance.put<ApiResponse<T>>(
			url,
			data,
			config
		);
		return response.data;
	},
	delete: async <T>(
		url: string,
		config?: ApiRequestConfig
	): Promise<ApiResponse<T>> => {
		const response = await axiosInstance.delete<ApiResponse<T>>(
			url,
			config
		);
		return response.data;
	},
};

export default axiosInstance;
