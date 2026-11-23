import axios from "axios";
import axiosInstance from "@/utils/axiosInstance";

// BDREN single sign-on: the backend's /api/v1/sso endpoints (app/Modules/Sso).
// See SSO_INTEGRATION.md in the repository root.

export interface SsoConfig {
	enabled: boolean;
	provider_name: string;
	/** ZITADEL's logout page; ends the central SSO session too. */
	logout_url: string | null;
	/** false: Mindspear doesn't create accounts itself; new people sign up at `signup_url`. */
	local_signup: boolean;
	/** BDREN's sign-up page, which returns to Mindspear's sign-in; null while SSO is off. */
	signup_url: string | null;
	/** Direct social logins that have credentials on the server; the others stay hidden. */
	social?: { google: boolean; microsoft: boolean };
}

export interface SsoStart {
	redirect_url: string;
	state: string;
}

export interface SsoUser {
	id: number;
	first_name: string;
	last_name: string;
	email: string;
	profile_picture: string | null;
}

export interface SsoIdentitySummary {
	issuer: string;
	subject: string;
	email: string | null;
	linked_via: "subject" | "email" | "link";
	linked_at: string | null;
	last_login_at: string | null;
}

export type SsoCallbackResult =
	| { mode: "login"; user: SsoUser; token: string; sso: { linked_via: string; created: boolean } }
	| { mode: "link"; identity: SsoIdentitySummary };

export interface SsoStatus {
	enabled: boolean;
	provider_name: string;
	linked: boolean;
	identity: SsoIdentitySummary | null;
}

export interface SsoEntitlement {
	feature: string;
	status: "ok" | "not_linked" | "not_provisioned" | "not_configured" | "unavailable";
	allowed: boolean;
	limit: number | null;
	used: number | null;
	reserved: number | null;
	remaining: number | null;
	reset_at: string | null;
}

export interface SsoEntitlements {
	product: string;
	features: SsoEntitlement[];
	/** Set when BDREN doesn't know the person yet: one sign-in there fixes it. */
	activate_url: string | null;
}

const data = <T>(response: { data: { data: T } }): T => response.data.data;

export const ssoApi = {
	config: async () => data<SsoConfig>(await axiosInstance.get("/sso/config")),
	startLogin: async () => data<SsoStart>(await axiosInstance.post("/sso/login")),
	startLink: async () => data<SsoStart>(await axiosInstance.post("/sso/link")),
	callback: async (code: string, state: string) => data<SsoCallbackResult>(await axiosInstance.post("/sso/callback", { code, state })),
	status: async () => data<SsoStatus>(await axiosInstance.get("/sso/status")),
	unlink: async () => data<{ unlinked: boolean }>(await axiosInstance.delete("/sso/link")),
	entitlements: async () => data<SsoEntitlements>(await axiosInstance.get("/sso/entitlements")),
};

/** The backend's message for a failed SSO call, or a fallback. */
export function ssoErrorMessage(error: unknown, fallback = "Something went wrong with BDREN sign-in."): string {
	if (axios.isAxiosError(error)) {
		const message = (error.response?.data as { message?: unknown } | undefined)?.message;
		if (typeof message === "string" && message.trim() !== "") return message;
		if (!error.response) return "The server can't be reached. Check your connection and try again.";
	}
	return fallback;
}
