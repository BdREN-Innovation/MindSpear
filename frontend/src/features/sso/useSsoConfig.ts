"use client";

import { useEffect, useState } from "react";
import { ssoApi, type SsoConfig } from "./api";

// One request per page load, shared by every SSO button on the page.
let pending: Promise<SsoConfig | null> | null = null;

function loadConfig(): Promise<SsoConfig | null> {
	pending ??= ssoApi.config().catch(() => {
		pending = null;
		return null;
	});
	return pending;
}

/**
 * The backend's SSO settings: undefined while loading, null when they can't be read
 * (then SSO stays hidden and the pages behave as without SSO).
 */
export function useSsoConfig(): SsoConfig | null | undefined {
	const [config, setConfig] = useState<SsoConfig | null | undefined>(undefined);
	useEffect(() => {
		let active = true;
		loadConfig().then((next) => active && setConfig(next));
		return () => {
			active = false;
		};
	}, []);
	return config;
}
