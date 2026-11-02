"use client";

import React, { useEffect, useState } from "react";
import type { AxiosError } from "axios";
import axiosInstance from "@/utils/axiosInstance";

const COOLDOWN_SECONDS = 60;

type Props = {
	email: string;
	onSent?: () => void;
};

export default function ResendVerificationEmail({ email, onSent }: Props) {
	const [sending, setSending] = useState(false);
	const [cooldown, setCooldown] = useState(0);
	const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

	useEffect(() => {
		if (cooldown <= 0) return;
		const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
		return () => clearTimeout(timer);
	}, [cooldown]);

	const resend = async () => {
		setSending(true);
		setNotice(null);
		try {
			await axiosInstance.post("/resend-verification", { email });
			setNotice({ ok: true, text: `Verification email sent to ${email}. Please check your inbox and spam folder.` });
			setCooldown(COOLDOWN_SECONDS);
			onSent?.();
		} catch (error) {
			const axiosError = error as AxiosError<{ message?: string }>;
			setNotice({
				ok: false,
				text:
					axiosError.response?.status === 429
						? "Too many emails requested for this address. Please try again in about an hour."
						: axiosError.response?.data?.message || "Failed to resend verification email. Please try again later.",
			});
		} finally {
			setSending(false);
		}
	};

	return (
		<div>
			<button
				type="button"
				onClick={resend}
				disabled={sending || cooldown > 0}
				className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-primary p-3 font-medium text-primary transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
			>
				{cooldown > 0 ? `Resend again in ${cooldown}s` : "Resend verification email"}
				{sending && (
					<span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-primary border-t-transparent" />
				)}
			</button>
			{notice && (
				<p className={`mt-3 text-center ${notice.ok ? "text-green-600" : "text-red-500"}`} role="status">
					{notice.text}
				</p>
			)}
		</div>
	);
}
