"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, KeyRound, Loader2, Unlink } from "lucide-react";
import { toast } from "react-toastify";
import { ssoApi, ssoErrorMessage, type SsoEntitlement, type SsoEntitlements, type SsoStatus } from "../api";
import { redirectToSso } from "../session";

const FEATURE_LABELS: Record<string, string> = {
	ai_requests: "AI requests",
	storage_gb: "Storage (GB)",
	projects: "Projects",
	team_members: "Team members",
};

function formatNumber(value: number | null): string {
	return value === null ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function UsageRow({ item }: { item: SsoEntitlement }) {
	const label = FEATURE_LABELS[item.feature] ?? item.feature;
	if (item.status !== "ok") {
		const note: Record<SsoEntitlement["status"], string> = {
			ok: "",
			not_linked: "Not limited",
			not_provisioned: "Activate your BDREN account to see this",
			not_configured: "Not set up on this server",
			unavailable: "Can't be read right now",
		};
		return (
			<li className="flex items-center justify-between gap-3 py-2 text-sm">
				<span className="font-medium text-dark dark:text-white">{label}</span>
				<span className="text-dark-5 dark:text-dark-6">{note[item.status]}</span>
			</li>
		);
	}
	const percent = item.limit ? Math.min(100, Math.round((((item.used ?? 0) + (item.reserved ?? 0)) / item.limit) * 100)) : 0;
	return (
		<li className="py-2 text-sm">
			<div className="mb-1 flex items-center justify-between gap-3">
				<span className="font-medium text-dark dark:text-white">{label}</span>
				<span className="tabular-nums text-dark-5 dark:text-dark-6">
					{formatNumber(item.used)} of {formatNumber(item.limit)} used
				</span>
			</div>
			<div className="h-1.5 overflow-hidden rounded-full bg-gray-2 dark:bg-dark-3" aria-hidden>
				<div className={`h-full rounded-full ${percent >= 90 ? "bg-red" : "bg-primary"}`} style={{ width: `${percent}%` }} />
			</div>
			{item.reset_at ? <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">Resets {new Date(item.reset_at).toLocaleDateString()}</p> : null}
		</li>
	);
}

/** Profile section: connect / disconnect BDREN SSO and see the plan's limits. Hidden while SSO is off. */
export default function SsoAccountPanel() {
	const [status, setStatus] = useState<SsoStatus | null>(null);
	const [usage, setUsage] = useState<SsoEntitlements | null>(null);
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		try {
			const next = await ssoApi.status();
			setStatus(next);
			setUsage(next.enabled && next.linked ? await ssoApi.entitlements().catch(() => null) : null);
		} catch {
			setStatus(null);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	if (!status?.enabled) return null;

	const connect = async () => {
		setBusy(true);
		try {
			await redirectToSso("link");
		} catch (error) {
			toast.error(ssoErrorMessage(error, "Could not start connecting BDREN."));
			setBusy(false);
		}
	};

	const disconnect = async () => {
		setBusy(true);
		try {
			await ssoApi.unlink();
			toast.success("BDREN account disconnected. Use your password or another sign-in method from now on.");
			await load();
		} catch (error) {
			toast.error(ssoErrorMessage(error, "Could not disconnect BDREN."));
		} finally {
			setBusy(false);
		}
	};

	return (
		<section className="mt-8 rounded-lg border border-stroke p-6 dark:border-dark-3" aria-labelledby="sso-panel-title">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h2 id="sso-panel-title" className="flex items-center gap-2 text-lg font-semibold text-dark dark:text-white">
						<KeyRound className="h-5 w-5 text-secondary" aria-hidden />
						{status.provider_name}
					</h2>
					<p className="mt-1 text-sm text-dark-5 dark:text-dark-6">
						{status.linked && status.identity
							? `Connected${status.identity.email ? ` as ${status.identity.email}` : ""}. You can sign in with ${status.provider_name}.`
							: `Connect your ${status.provider_name} account to sign in with it and use your BDREN plan here.`}
					</p>
				</div>
				{status.linked ? (
					<button
						type="button"
						onClick={disconnect}
						disabled={busy}
						className="inline-flex items-center gap-2 rounded-lg border border-stroke px-4 py-2 text-sm font-medium text-dark hover:border-red hover:text-red disabled:opacity-60 dark:border-dark-3 dark:text-white"
					>
						{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Unlink className="h-4 w-4" aria-hidden />}
						Disconnect
					</button>
				) : (
					<button
						type="button"
						onClick={connect}
						disabled={busy}
						className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-opacity-90 disabled:opacity-60"
					>
						{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
						Connect
					</button>
				)}
			</div>

			{status.linked && usage ? (
				<div className="mt-5 border-t border-stroke pt-4 dark:border-dark-3">
					<h3 className="mb-1 text-sm font-semibold text-dark dark:text-white">Plan limits</h3>
					{usage.activate_url ? (
						<p className="mb-2 text-sm text-dark-5 dark:text-dark-6">
							BDREN hasn&apos;t seen this account yet.{" "}
							<a href={usage.activate_url} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
								Activate it once <ExternalLink className="h-3.5 w-3.5" aria-hidden />
							</a>{" "}
							(no password needed) to see and use your plan.
						</p>
					) : null}
					<ul className="divide-y divide-stroke dark:divide-dark-3">
						{usage.features.map((item) => (
							<UsageRow key={item.feature} item={item} />
						))}
					</ul>
				</div>
			) : null}
		</section>
	);
}
