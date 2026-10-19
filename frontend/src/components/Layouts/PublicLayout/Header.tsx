"use client";

import { MenuOutlined } from "@ant-design/icons";
import { Drawer, Button } from "antd";
import Link from "next/link";
import Image from "next/image";
import { JSX, useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "@/stores/store";
import { usePathname } from "next/navigation";

type NavItem = {
	name: string;
	href: string;
};

const navItems: NavItem[] = [
	{ name: "Home", href: "/" },
	{ name: "Login", href: "/auth/sign-in" },
	{ name: "Registration", href: "/auth/sign-up" },
];

export default function HedaerPublic(): JSX.Element {
	const pathname = usePathname();
	const isHeaderStatus =
		pathname.includes("join") ||
		pathname.includes("quiz-public") ||
		pathname.includes("attempt") ||
		pathname.includes("live") ||
		// Players' results after a live quiz (they had the site's Login / Registration menu).
		pathname.includes("quiz-result-view");
	const [open, setOpen] = useState<boolean>(false);
	const isAuthenticated = useSelector(
		(state: RootState) => state.auth.isAuthenticated
	);
	//console.log("Header - isAuthenticated:", isAuthenticated);
	return (
		<nav
			className={`${
				isHeaderStatus ? "hidden" : "block"
			} bg-white dark:!bg-dark-2 dark:bg-none shadow-md px-4 py-4 flex justify-between items-center`}
		>
			<div className="text-xl font-semibold text-blue-600">
				<Link href={"/"}>
					<Image
						className="hidden dark:block"
						src={"/images/logo/logo.svg"}
						alt="Logo"
						width={176}
						height={32}
					/>
					<Image
						className="dark:hidden"
						src={"/images/logo/logo.svg"}
						alt="Logo"
						width={176}
						height={32}
					/>
				</Link>
			</div>

			<div className="hidden md:flex space-x-6">
				{!isAuthenticated && (
					<>
						{navItems.map((item) => (
							<Link
								key={item.href}
								href={item.href}
								className="text-gray-700 dark:text-white hover:text-blue-600"
							>
								{item.name}
							</Link>
						))}
					</>
				)}
			</div>

			<div className="md:hidden">
				<Button
					type="text"
					icon={<MenuOutlined />}
					onClick={() => setOpen(true)}
				/>
				<Drawer
					title="Menu"
					placement="right"
					onClose={() => setOpen(false)}
					open={open}
				>
					{navItems.map((item) => (
						<Link
							key={item.href}
							href={item.href}
							className="block py-2 text-gray-800 hover:text-blue-600"
							onClick={() => setOpen(false)}
						>
							{item.name}
						</Link>
					))}
				</Drawer>
			</div>
		</nav>
	);
}
