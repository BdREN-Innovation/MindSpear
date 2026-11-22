"use client";

import Image from "next/image";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import SsoSigninButton from "./SsoSigninButton";

/**
 * The sign-up page while LOCAL_SIGNUP_ENABLED=false: new accounts come from BDREN.
 * BDREN's sign-up page sends the person back to /auth/sign-in?sso=start, which signs
 * them in here and creates their Mindspear account (SSO_AUTO_CREATE_USERS).
 */
export default function BdrenSignup({ signupUrl }: { signupUrl: string | null }) {
	return (
		<>
			<div className="flex flex-col items-center justify-center">
				<Link href="/">
					<Image src="/images/logo/logo.svg" alt="Logo" width={176} height={32} />
				</Link>
				<h1 className="mb-2 mt-4 text-3xl font-bold text-[#222]">Create your account</h1>
				<p className="mb-6 max-w-md text-center text-lg text-[#222]">
					{signupUrl
						? "Mindspear accounts come with a BDREN account. Create one, confirm your email, and you'll come back here signed in."
						: "New sign-ups are closed at the moment."}
				</p>
			</div>

			{signupUrl && (
				<>
					<a
						href={signupUrl}
						// Dark text, as the shared Button: white on this orange is too faint to read (about 2:1).
						className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary p-4 font-medium text-dark transition hover:bg-primary-dark"
					>
						Create a BDREN account
						<ExternalLink className="h-4 w-4" aria-hidden />
					</a>
					<p className="mb-2 mt-6 text-center text-sm text-gray-600 dark:text-gray-300">Already have a BDREN account?</p>
					<SsoSigninButton text="Sign in" />
				</>
			)}

			<div className="mt-6 text-center">
				<p>
					Already have a Mindspear account? &nbsp;
					<Link href="/auth/sign-in" className="text-primary hover:underline">
						Sign In
					</Link>
				</p>
			</div>
		</>
	);
}
