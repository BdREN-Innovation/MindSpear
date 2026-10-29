"use client";

import { useState, useEffect } from "react";
import { Rocket, Home } from "lucide-react";
import Link from "next/link";

const UpcomingPage = () => {
	const [loading, setLoading] = useState<boolean>(true);

	useEffect(() => {
		// Simulate loading
		const timer = setTimeout(() => {
			setLoading(false);
		}, 500);

		return () => clearTimeout(timer);
	}, []);

	if (loading) {
		return (
			<div className="min-h-screen flex items-center justify-center">
				<div className="text-center">
					<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
					<p className="mt-4 text-lg text-muted-foreground">Loading...</p>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-background">
			<div className="relative overflow-hidden">
				<div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))]" />

				<div className="container relative mx-auto px-4 py-16 sm:py-20">
					<div className="mx-auto max-w-3xl text-center">
						{/* Logo/Icon */}
						<div className="mb-6 flex justify-center">
							<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/20">
								<Rocket className="h-6 w-6 text-primary" />
							</div>
						</div>

						{/* Title */}
						<h1 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
							Upcoming Features
						</h1>

						{/* Subtitle */}
						<p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground">
							Explore what&apos;s coming next to enhance your learning experience
						</p>

						{/* Back to Home Button */}
						<div className="mt-8 flex justify-center">
							<Link
								href="/dashboard"
								className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-primary/90"
							>
								<Home className="h-4 w-4" />
								Back to Home
							</Link>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

export default UpcomingPage;