/* eslint-disable @typescript-eslint/no-empty-object-type */
import axios, {
	AxiosInstance,
	AxiosResponse,
	InternalAxiosRequestConfig,
	AxiosError,
	Method,
	AxiosHeaders,
} from "axios";

// ----------------------------------
// Base API Response Types
// ----------------------------------
interface ApiResponse<T = unknown> {
	data: T;
	message?: string;
	success: boolean;
	statusCode: number;
}

interface PaginationData {
	current_page: number;
	total: number;
	per_page: number;
	last_page: number;
}

interface PaginatedApiResponse<T> extends ApiResponse<T> {
	pagination?: PaginationData;
}

// ----------------------------------
// Custom Axios Config Types
// ----------------------------------
export interface CustomAxiosRequestConfig<T = unknown>
	extends InternalAxiosRequestConfig<T> {
	_retry?: boolean;
}

// ----------------------------------
// API Error Handling Types
// ----------------------------------
interface ApiErrorResponse {
	message?: string;
	errors?: Record<string, string[]>;
	statusCode?: number;
}

interface ApiError<T = ApiErrorResponse> extends AxiosError<T> {}

// ----------------------------------
// Example Domain Models
// ----------------------------------
interface Quiz {
	id: number;
	title: string;
	description: string | null;
	// extend with more fields as needed
}

interface User {
	id: number;
	first_name: string;
	last_name: string;
	email: string;
	// extend with more fields as needed
}

// ----------------------------------
// Axios Setup
// ----------------------------------
const serverAxiosInstance: AxiosInstance = axios.create({
	// INTERNAL_API_BASE_URL is server-only (undefined in the browser bundle).
	baseURL: process.env.INTERNAL_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL,
	headers: {
		"Content-Type": "application/json",
	},
	timeout: 10000,
});

serverAxiosInstance.interceptors.request.use(
	(config) => {
		const customConfig = config as CustomAxiosRequestConfig;

		if (typeof window !== "undefined") {
			const token = localStorage.getItem("auth_token");

			customConfig.headers = new AxiosHeaders(customConfig.headers || {});

			if (token) {
				customConfig.headers.set("Authorization", `Bearer ${token}`);
			}
		}

		return customConfig;
	},
	(error) => Promise.reject(error)
);

serverAxiosInstance.interceptors.response.use(
	(response: AxiosResponse<ApiResponse>): AxiosResponse<ApiResponse> =>
		response,
	(error: ApiError): Promise<ApiError> => {
		if (error.response) {
			console.error("Server API Error:", {
				status: error.response.status,
				url: error.config?.url,
				data: error.response.data,
			});
		}
		return Promise.reject(error);
	}
);

// ----------------------------------
// Utility: Build endpoint with query + path
// ----------------------------------
const buildEndpoint = (
	basePath: string,
	params?: Record<string, string | number | undefined>
): string => {
	let endpoint = basePath;

	if (params) {
		const filteredParams = Object.fromEntries(
			Object.entries(params).filter(([, value]) => value !== undefined)
		) as Record<string, string | number>;

		// Replace path parameters
		Object.entries(filteredParams).forEach(([key, value]) => {
			endpoint = endpoint.replace(`:${key}`, value.toString());
		});

		const queryParams = new URLSearchParams();
		Object.entries(filteredParams).forEach(([key, value]) => {
			if (!endpoint.includes(`:${key}`)) {
				queryParams.append(key, value.toString());
			}
		});

		if (queryParams.toString()) {
			endpoint += `?${queryParams.toString()}`;
		}
	}

	return endpoint;
};

// ----------------------------------
// Generic Resource CRUD
// ----------------------------------
interface ApiResourceMethods<T> {
	getAll(
		params?: {
			page?: number;
			per_page?: number;
			[key: string]: string | number | undefined;
		},
		config?: CustomAxiosRequestConfig
	): Promise<AxiosResponse<PaginatedApiResponse<T[]>>>;

	getById(
		id: string | number,
		config?: CustomAxiosRequestConfig
	): Promise<AxiosResponse<ApiResponse<T>>>;

	create(
		data: Partial<T>,
		config?: CustomAxiosRequestConfig<Partial<T>>
	): Promise<AxiosResponse<ApiResponse<T>>>;

	update(
		id: string | number,
		data: Partial<T>,
		config?: CustomAxiosRequestConfig<Partial<T>>
	): Promise<AxiosResponse<ApiResponse<T>>>;

	delete(
		id: string | number,
		config?: CustomAxiosRequestConfig
	): Promise<AxiosResponse<ApiResponse<void>>>;

	customEndpoint<D = unknown, R = unknown>(
		path: string,
		method: Method,
		params?: Record<string, string | number | undefined>,
		data?: D,
		config?: CustomAxiosRequestConfig<D>
	): Promise<AxiosResponse<ApiResponse<R>>>;
}

export const createApiResource = <T>(
	resourcePath: string
): ApiResourceMethods<T> => ({
	getAll(params, config) {
		const endpoint = buildEndpoint(resourcePath, params);
		return serverAxiosInstance.get(endpoint, config);
	},

	getById(id, config) {
		const endpoint = buildEndpoint(`${resourcePath}/:id`, { id });
		return serverAxiosInstance.get(endpoint, config);
	},

	create(data, config) {
		return serverAxiosInstance.post(resourcePath, data, config);
	},

	update(id, data, config) {
		const endpoint = buildEndpoint(`${resourcePath}/:id`, { id });
		return serverAxiosInstance.put(endpoint, data, config);
	},

	delete(id, config) {
		const endpoint = buildEndpoint(`${resourcePath}/:id`, { id });
		return serverAxiosInstance.delete(endpoint, config);
	},

	customEndpoint(path, method, params, data, config) {
		const endpoint = buildEndpoint(`${resourcePath}${path}`, params);
		return serverAxiosInstance.request({
			method,
			url: endpoint,
			data,
			...config,
		});
	},
});

// ----------------------------------
// Server-Side Fetch Context
// ----------------------------------
interface ServerContext {
	req?: {
		headers?: {
			cookie?: string;
		};
		cookies?: Record<string, string>;
	};
}

interface FetchWithContextResult<T> {
	data: ApiResponse<T> | null;
	error: string | null;
}

// ----------------------------------
// Central API Service
// ----------------------------------
interface ServerApiService {
	instance: AxiosInstance;
	quizzes: ApiResourceMethods<Quiz>;
	users: ApiResourceMethods<User>;

	get<T>(
		url: string,
		config?: CustomAxiosRequestConfig
	): Promise<AxiosResponse<ApiResponse<T>>>;
	post<T, D = unknown>(
		url: string,
		data?: D,
		config?: CustomAxiosRequestConfig<D>
	): Promise<AxiosResponse<ApiResponse<T>>>;
	put<T, D = unknown>(
		url: string,
		data?: D,
		config?: CustomAxiosRequestConfig<D>
	): Promise<AxiosResponse<ApiResponse<T>>>;
	delete<T>(
		url: string,
		config?: CustomAxiosRequestConfig
	): Promise<AxiosResponse<ApiResponse<T>>>;

	fetchWithContext<T>(
		endpoint: string,
		context: ServerContext,
		method?: Method,
		data?: unknown
	): Promise<FetchWithContextResult<T>>;
}

export const serverApi: ServerApiService = {
	instance: serverAxiosInstance,
	quizzes: createApiResource<Quiz>("/quizes"),
	users: createApiResource<User>("/users"),

	get(url, config) {
		return serverAxiosInstance.get(url, config);
	},

	post(url, data, config) {
		return serverAxiosInstance.post(url, data, config);
	},

	put(url, data, config) {
		return serverAxiosInstance.put(url, data, config);
	},

	delete(url, config) {
		return serverAxiosInstance.delete(url, config);
	},

	async fetchWithContext<T>(
		endpoint: string,
		context: ServerContext,
		method: Method = "get",
		data?: unknown
	): Promise<FetchWithContextResult<T>> {
		try {
			const response = await serverAxiosInstance.request<ApiResponse<T>>({
				method,
				url: endpoint,
				data,
				headers: {
					Cookie: context.req?.headers?.cookie || "",
				},
			});

			return {
				data: response.data,
				error: null,
			};
		} catch (error) {
			const axiosError = error as ApiError;
			return {
				data: null,
				error:
					axiosError.response?.data?.message ||
					axiosError.message ||
					"Unknown error",
			};
		}
	},
};
