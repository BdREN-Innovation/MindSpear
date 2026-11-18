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

/** The backend's SSO settings; null while loading or when it can't be read (then SSO stays hidden). */
export function useSsoConfig(): SsoConfig | null {
	const [config, setConfig] = useState<SsoConfig | null>(null);
	useEffect(() => {
		let active = true;
		loadConfig().then((next) => active && setConfig(next));
		return () => {
			active = false;
		};
	}, []);
	return config;
}
