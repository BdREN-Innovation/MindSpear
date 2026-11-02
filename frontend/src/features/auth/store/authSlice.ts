import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axiosInstance from "@/utils/axiosInstance";

interface LoginPayload {
	email: string;
	password: string;
}

interface AuthResponse {
	data: {
		token: string;
		user: {
			id: number;
			full_name: string;
			email: string;
			profile_picture?: string | null;
		};
	};
}

interface AuthState {
	token: string | null;
	isAuthenticated: boolean;
	loading: boolean;
	error: string | null;
	user: {
		id: number;
		full_name: string;
		email: string;
		profile_picture?: string | null;
	} | null;
}

const tokenFromStorage =
	typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

const initialState: AuthState = {
	token: tokenFromStorage,
	isAuthenticated: !!tokenFromStorage,
	loading: false,
	error: null,
	user: null,
};

export const loginUser = createAsyncThunk<
	{ token: string; user: AuthState["user"] },
	LoginPayload,
	{ rejectValue: string }
>("auth/loginUser", async ({ email, password }, { rejectWithValue }) => {
	try {
		const response = await axiosInstance.post<AuthResponse>("/login", {
			email,
			password,
		});
		console.log(response, "resultresultresultresult");

		const token = response.data?.data?.token;
		const rawUser = response.data?.data?.user;

		const user = {
			id: rawUser.id,
			full_name: rawUser.full_name,
			email: rawUser.email,
			profile_picture: rawUser.profile_picture ?? null,
		};
		if (token && user) {
			localStorage.setItem("auth_token", token);
			// #### Cookie set For server side api call -> utils -> serverApiService.ts
			await fetch("/api/auth/set-cookie", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token }),
			});
			return { token, user };
		} else {
			return rejectWithValue("No token received");
		}
	} catch (error) {
		const axiosError = error as {
			response?: {
				data?: {
					message?: string;
					data?: {
						validation_errors?: Record<string, string[]>;
					};
				};
			};
		};

		// Check if it's a validation error with detailed structure
		if (axiosError?.response?.data?.data?.validation_errors) {
			const validationErrors =
				axiosError.response.data.data.validation_errors;
			// Format the validation errors into a single string for display (without field names)
			const errorMessages = Object.values(validationErrors).flat();
			const message = errorMessages.join(" ") || "Validation failed";
			return rejectWithValue(message);
		}

		// Fallback to original message
		const message = axiosError?.response?.data?.message || "Login failed";
		return rejectWithValue(message);
	}
});

export const logoutUser = createAsyncThunk<void, void, { rejectValue: string }>(
	"auth/logoutUser",
	async (_, { rejectWithValue }) => {
		try {
			await axiosInstance.post("/logout");
			localStorage.removeItem("auth_token");
		} catch (error) {
			const axiosError = error as {
				response?: {
					data?: {
						message?: string;
						data?: {
							validation_errors?: Record<string, string[]>;
						};
					};
				};
			};

			// Check if it's a validation error with detailed structure
			if (axiosError?.response?.data?.data?.validation_errors) {
				const validationErrors =
					axiosError.response.data.data.validation_errors;
				// Format the validation errors into a single string for display (without field names)
				const errorMessages = Object.values(validationErrors).flat();
				const message = errorMessages.join(" ") || "Validation failed";
				return rejectWithValue(message);
			}

			// Fallback to original message
			const message =
				axiosError?.response?.data?.message || "Logout failed";
			return rejectWithValue(message);
		}
	}
);

export const loginWithGoogle = createAsyncThunk<
	{ token: string; user: AuthState["user"] },
	{ code: string; scope: string },
	{ rejectValue: string }
>("auth/loginWithGoogle", async ({ code, scope }, { rejectWithValue }) => {
	try {
		const response = await axiosInstance.get(
			`/auth/google/callback?code=${code}&scope=${scope}`
		);

		const token = response.data?.data?.token;
		const rawUser = response.data?.data?.user;

		if (token && rawUser) {
			const user = {
				id: rawUser.id,
				full_name: `${rawUser.first_name || ""} ${
					rawUser.last_name || ""
				}`.trim(),
				email: rawUser.email,
				profile_picture: rawUser.profile_picture ?? null,
			};

			// Token save
			localStorage.setItem("auth_token", token);

			// Cookie set
			await fetch("/api/auth/set-cookie", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token }),
			});

			return { token, user };
		} else {
			return rejectWithValue("Google login failed");
		}
	} catch (error) {
		const axiosError = error as {
			response?: {
				data?: {
					message?: string;
					data?: {
						validation_errors?: Record<string, string[]>;
					};
				};
			};
		};

		// Check if it's a validation error with detailed structure
		if (axiosError?.response?.data?.data?.validation_errors) {
			const validationErrors =
				axiosError.response.data.data.validation_errors;
			// Format the validation errors into a single string for display (without field names)
			const errorMessages = Object.values(validationErrors).flat();
			const message = errorMessages.join(" ") || "Validation failed";
			return rejectWithValue(message);
		}

		// Fallback to original message
		const message =
			axiosError?.response?.data?.message || "Google login failed";
		return rejectWithValue(message);
	}
});

// login with microsoft
export const loginWithMicrosoft = createAsyncThunk<
	{ token: string; user: AuthState["user"] },
	{ code: string; state: string }, // ✅ scope
	{ rejectValue: string }
>("auth/loginWithMicrosoft", async ({ code, state }, { rejectWithValue }) => {
	try {
		const response = await axiosInstance.get(
			`/auth/microsoft/callback?code=${code}&state=${state}` // ✅ state query param
		);

		const token = response.data?.data?.token;
		const rawUser = response.data?.data?.user;

		if (token && rawUser) {
			const user = {
				id: rawUser.id,
				full_name: `${rawUser.first_name || ""} ${
					rawUser.last_name || ""
				}`.trim(),
				email: rawUser.email,
				profile_picture: rawUser.profile_picture ?? null,
			};

			localStorage.setItem("auth_token", token);

			await fetch("/api/auth/set-cookie", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token }),
			});

			return { token, user };
		} else {
			return rejectWithValue("Microsoft login failed");
		}
	} catch (error) {
		const axiosError = error as {
			response?: {
				data?: {
					message?: string;
					data?: {
						validation_errors?: Record<string, string[]>;
					};
				};
			};
		};

		// Check if it's a validation error with detailed structure
		if (axiosError?.response?.data?.data?.validation_errors) {
			const validationErrors =
				axiosError.response.data.data.validation_errors;
			// Format the validation errors into a single string for display (without field names)
			const errorMessages = Object.values(validationErrors).flat();
			const message = errorMessages.join(" ") || "Validation failed";
			return rejectWithValue(message);
		}

		// Fallback to original message
		const message =
			axiosError?.response?.data?.message || "Microsoft login failed";
		return rejectWithValue(message);
	}
});

// Register user
interface RegisterPayload {
	first_name: string;
	last_name: string;
	email: string;
	password: string;
	password_confirmation: string;
}

export const registerUser = createAsyncThunk<
	{ user: AuthState["user"]; emailSent: boolean },
	RegisterPayload,
	{ rejectValue: string }
>("auth/registerUser", async (userData, { rejectWithValue }) => {
	try {
		const response = await axiosInstance.post("/register", userData);
		//console.log("register response:", response);

		const rawUser = response.data?.data?.user;
		const emailSent = response.data?.data?.email_sent;

		if (rawUser) {
			const user = {
				id: rawUser.id,
				full_name:
					rawUser.full_name ||
					`${rawUser.first_name || ""} ${
						rawUser.last_name || ""
					}`.trim(),
				email: rawUser.email,
			};

			// Cookie set (SSR এর জন্য)
			// await fetch("/api/auth/set-cookie", {
			// 	method: "POST",
			// 	headers: { "Content-Type": "application/json" },
			// 	body: JSON.stringify({ token }),
			// });

			return { user, emailSent };
		} else {
			return rejectWithValue("Registration failed");
		}
	} catch (error) {
		const axiosError = error as {
			response?: {
				data?: {
					message?: string;
					data?: {
						validation_errors?: Record<string, string[]>;
					};
				};
			};
		};

		// Check if it's a validation error with detailed structure
		if (axiosError?.response?.data?.data?.validation_errors) {
			const validationErrors =
				axiosError.response.data.data.validation_errors;
			// Format the validation errors into a single string for display (without field names)
			const errorMessages = Object.values(validationErrors).flat();
			const message = errorMessages.join(" ") || "Validation failed";
			return rejectWithValue(message);
		}

		// Fallback to original message
		const message =
			axiosError?.response?.data?.message || "Registration failed";
		return rejectWithValue(message);
	}
});

// Update profile picture
interface UpdateProfilePicturePayload {
	profilePicture: File;
}

export const updateProfilePicture = createAsyncThunk<
	{ profile_picture: string },
	UpdateProfilePicturePayload,
	{ rejectValue: string }
>(
	"auth/updateProfilePicture",
	async ({ profilePicture }, { rejectWithValue }) => {
		try {
			const formData = new FormData();
			formData.append("profile_picture", profilePicture);

			const response = await axiosInstance.post<{
				profile_picture: string;
			}>("/profile/update-profile-picture", formData, {
				headers: {
					"Content-Type": "multipart/form-data",
				},
			});

			return response.data;
		} catch (error) {
			const axiosError = error as {
				response?: {
					data?: {
						message?: string;
						data?: {
							validation_errors?: Record<string, string[]>;
						};
					};
				};
			};

			// Check if it's a validation error with detailed structure
			if (axiosError?.response?.data?.data?.validation_errors) {
				const validationErrors =
					axiosError.response.data.data.validation_errors;
				// Format the validation errors into a single string for display (without field names)
				const errorMessages = Object.values(validationErrors).flat();
				const message = errorMessages.join(" ") || "Validation failed";
				return rejectWithValue(message);
			}

			// Fallback to original message
			const message =
				axiosError?.response?.data?.message ||
				"Failed to update profile picture";
			return rejectWithValue(message);
		}
	}
);

const authSlice = createSlice({
	name: "auth",
	initialState,
	reducers: {
		logout: (state) => {
			state.token = null;
			state.user = null;
			state.isAuthenticated = false;
			localStorage.removeItem("auth_token");
		},
		clearAuth: (state) => {
			state.token = null;
			state.user = null;
			state.isAuthenticated = false;
			state.error = null;
		},
		clearError: (state) => {
			state.error = null;
		},
		updateUser: (state, action) => {
			if (state.user) {
				// Properly merge the updates to ensure immutability
				state.user = {
					...state.user,
					...action.payload,
				};
			}
		},
	},
	extraReducers: (builder) => {
		builder
			.addCase(loginUser.pending, (state) => {
				state.loading = true;
				state.error = null;
			})
			.addCase(loginUser.fulfilled, (state, action) => {
				state.loading = false;
				state.token = action.payload.token;
				state.user = action.payload.user;
				state.isAuthenticated = true;
			})
			.addCase(loginUser.rejected, (state, action) => {
				state.loading = false;
				state.error = action.payload || "Login failed";
				state.isAuthenticated = false;
			})
			.addCase(loginWithGoogle.pending, (state) => {
				state.loading = true;
				state.error = null;
			})
			.addCase(loginWithGoogle.fulfilled, (state, action) => {
				state.loading = false;
				state.token = action.payload.token;
				state.user = action.payload.user;
				state.isAuthenticated = true;
			})
			.addCase(loginWithGoogle.rejected, (state, action) => {
				state.loading = false;
				state.error = action.payload || "Google login failed";
				state.isAuthenticated = false;
			})

			.addCase(logoutUser.pending, (state) => {
				state.loading = true;
			})
			.addCase(logoutUser.fulfilled, (state) => {
				state.token = null;
				state.isAuthenticated = false;
				state.loading = false;
			})
			.addCase(logoutUser.rejected, (state, action) => {
				state.loading = false;
				state.error = action.payload || "Logout failed";
			})
			.addCase(loginWithMicrosoft.pending, (state) => {
				state.loading = true;
				state.error = null;
			})
			.addCase(loginWithMicrosoft.fulfilled, (state, action) => {
				state.loading = false;
				state.token = action.payload.token;
				state.user = action.payload.user;
				state.isAuthenticated = true;
			})
			.addCase(loginWithMicrosoft.rejected, (state, action) => {
				state.loading = false;
				state.error = action.payload || "Microsoft login failed";
				state.isAuthenticated = false;
			})
			.addCase(registerUser.pending, (state) => {
				state.loading = true;
				state.error = null;
			})
			.addCase(registerUser.fulfilled, (state, action) => {
				state.loading = false;
				state.token = null;
				state.user = action.payload.user;
				state.isAuthenticated = false; // Not authenticated until email verification
				state.error = null;
			})
			.addCase(registerUser.rejected, (state, action) => {
				state.loading = false;
				state.error = action.payload || "Registration failed";
				state.isAuthenticated = false;
			})
			.addCase(updateProfilePicture.pending, (state) => {
				state.loading = true;
			})
			.addCase(updateProfilePicture.fulfilled, (state, action) => {
				state.loading = false;
				if (state.user) {
					state.user.profile_picture = action.payload.profile_picture;
				}
			})
			.addCase(updateProfilePicture.rejected, (state, action) => {
				state.loading = false;
				state.error =
					action.payload || "Failed to update profile picture";
			});
	},
});

export const { logout, clearAuth, clearError, updateUser } = authSlice.actions;
export default authSlice.reducer;
