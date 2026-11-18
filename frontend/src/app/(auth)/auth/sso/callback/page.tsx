import { Suspense } from "react";
import SsoCallback from "@/features/sso/components/SsoCallback";

// BDREN single sign-on returns here (SSO_REDIRECT_URI). All logic lives in features/sso.
export default function SsoCallbackPage() {
	return (
		<Suspense>
			<SsoCallback />
		</Suspense>
	);
}
