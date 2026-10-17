import "@/styles/satoshi.css";
import "@/styles/style.css";
import "flatpickr/dist/flatpickr.min.css";
import "jsvectormap/dist/jsvectormap.css";
import ToastProvider from '@/components/ToastProvider';
// GTM + GA everywhere except the participant app (/play): see SiteAnalytics.
import { SiteAnalytics } from "@/features/deck-participant/lib/SiteAnalytics";

import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import ClientProviders from "./ClientLayout";

// Numbers, timers and question codes in the Quiz module (`font-mono`).
const plexMono = IBM_Plex_Mono({
	subsets: ["latin"],
	weight: ["400", "500", "600"],
	variable: "--font-plex-mono",
	display: "swap",
});

export const metadata: Metadata = {
	title: "MindSpear",
	description: "MindSpear - Quiz, Quest and Survey Platform",
	icons: {
		icon: [
			{
				url: "/images/logo/favicon.svg",
				type: "image/svg+xml",
			},
		],
		shortcut: "/images/logo/favicon.svg",
	},
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body className={plexMono.variable} suppressHydrationWarning>
				<ClientProviders>
					{children}
					<ToastProvider />
				</ClientProviders>
				<SiteAnalytics />
			</body>
		</html>
	);
}
