import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	reactStrictMode: true,
	// The production image (Dockerfile, "run" stage) runs the self-contained server Next builds here;
	// `next dev` / `next start` elsewhere are unaffected.
	output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
	images: {
		domains: ["mindspear.app", "lh3.googleusercontent.com"],
	},
	webpack(config, { isServer }) {
		// Apply the node-loader for .node files
		config.module.rules.push({
			test: /\.node$/,
			use: "node-loader",
		});

		// Optionally, fix any issues with canvas module on the server
		if (isServer) {
			config.externals.push("canvas");
		}

		return config;
	},
	// Players join at /play; /join was the old page (links and QR codes may still point at it).
	async redirects() {
		return [{ source: "/join", destination: "/play", permanent: true }];
	},
		// Docker/local: the browser calls Laravel through this app (same origin), so
	// the site works at any address (localhost, 0.0.0.0, a LAN or public IP)
	// without CORS. Production routes these paths in Nginx instead (READMEv2.md).
	// AI_PROXY_URL does the same for the AI server (ai-server/): with it set,
	// NEXT_PUBLIC_AI_API_URL can be the path /ai-api.
	async rewrites() {
		const backend = process.env.BACKEND_PROXY_URL?.trim().replace(/\/$/, "");
		const ai = process.env.AI_PROXY_URL?.trim().replace(/\/$/, "");
		return [
			...(backend
				? [
						{ source: "/api/v1/:path*", destination: `${backend}/api/v1/:path*` },
						{ source: "/broadcasting/auth", destination: `${backend}/broadcasting/auth` },
						{ source: "/storage/:path*", destination: `${backend}/storage/:path*` },
					]
				: []),
			...(ai ? [{ source: "/ai-api/:path*", destination: `${ai}/:path*` }] : []),
		];
	},
	eslint: {
		// Warning: This allows production builds to successfully complete even if
		// your project has ESLint errors.
		ignoreDuringBuilds: true,
	},
};

export default nextConfig;
