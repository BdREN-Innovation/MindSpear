import axios from "axios";
import { cookies } from "next/headers";

export async function serverAxios() {
	const token = (await cookies()).get("auth_token")?.value;

	return axios.create({
		// INTERNAL_API_BASE_URL is server-only (undefined in the browser bundle).
		baseURL: process.env.INTERNAL_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL,
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});
}
