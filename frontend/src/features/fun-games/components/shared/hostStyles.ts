// Host-screen button and card classes, so every page looks the same.
// Primary actions use ink (dark); orange stays reserved for live/urgent states.

export const btnPrimary =
	"inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-dark px-4 text-sm font-semibold text-white transition hover:bg-dark-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-dark/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-dark dark:hover:bg-gray-2";

export const btnSecondary =
	"inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-stroke bg-white px-4 text-sm font-semibold text-dark transition hover:bg-gray-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-dark/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stroke-dark dark:bg-gray-dark dark:text-white dark:hover:bg-dark-2";

export const btnDanger =
	"inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-light-3 bg-white px-4 text-sm font-semibold text-red-dark transition hover:bg-red-light-5 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-transparent";

export const card = "rounded-xl border border-stroke bg-white p-4 dark:border-stroke-dark dark:bg-gray-dark sm:p-5";

export const inputClass =
	"w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition placeholder:text-dark-6 focus:border-blue-dark focus:ring-2 focus:ring-blue-light-4 aria-[invalid=true]:border-red-dark dark:border-stroke-dark dark:bg-dark-2 dark:text-white";

export const labelClass = "mb-1 block text-sm font-semibold text-dark dark:text-white";
