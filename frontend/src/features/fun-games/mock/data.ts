// Sample content for the mock adapter only (NEXT_PUBLIC_QUIZ_MOCK=1).

import type { AdminQuestion, AdminQuizDetail, TimerConfig } from "../types";

type SeedQuestion = [text: string, options: string[], correct: number, marks?: number];

function questions(prefix: string, seeds: SeedQuestion[], negative: number): AdminQuestion[] {
	return seeds.map(([text, options, correct, marks = 2], qi) => {
		const id = `${prefix}-q${qi + 1}`;
		return {
			id,
			type: "single_choice",
			text,
			imageUrl: null,
			options: options.map((optionText, oi) => ({ id: `${id}-o${oi + 1}`, text: optionText })),
			correctOptionId: `${id}-o${correct + 1}`,
			marks,
			negativeMarks: negative,
		};
	});
}

function quiz(
	id: string,
	title: string,
	description: string,
	instructions: string,
	timer: TimerConfig,
	status: AdminQuizDetail["status"],
	qs: AdminQuestion[],
): AdminQuizDetail {
	return {
		id,
		title,
		description,
		instructions,
		timer,
		status,
		questions: qs,
		questionCount: qs.length,
		totalMarks: qs.reduce((sum, q) => sum + q.marks, 0),
		defaultMarks: 2,
		defaultNegativeMarks: qs[0]?.negativeMarks ?? 0,
		updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
		sessionCount: 0,
	};
}

export function seedQuizzes(): AdminQuizDetail[] {
	return [
		quiz(
			"networks-6",
			"Computer Networks — Weekly Quiz 6",
			"Subnetting, TCP handshakes and routing basics.",
			"Everyone gets the same question at the same time. A question locks when its timer reaches zero.",
			{ mode: "perQuestion", secondsPerQuestion: 20 },
			"live",
			questions(
				"net",
				[
					["A host is configured as 192.168.10.77/26. What is the broadcast address of its subnet?", ["192.168.10.63", "192.168.10.127", "192.168.10.255", "192.168.10.95"], 1],
					["Which TCP flag is set in the first segment of a three-way handshake?", ["ACK", "FIN", "SYN", "RST"], 2],
					["How many usable host addresses does a /28 subnet provide?", ["14", "16", "30", "12"], 0],
					["Which protocol resolves an IPv4 address to a MAC address?", ["DNS", "ARP", "DHCP", "ICMP"], 1],
					["What is the default port for HTTPS?", ["80", "8080", "443", "22"], 2],
					["Which layer of the OSI model does a router primarily operate at?", ["Data link", "Network", "Transport", "Session"], 1],
					["Which routing protocol is a link-state protocol?", ["RIP", "OSPF", "BGP", "EIGRP"], 1],
					["What does TTL in an IP header limit?", ["Packet size", "Number of hops", "Connection time", "Window size"], 1],
				],
				0.5,
			),
		),
		quiz(
			"os-sched",
			"Operating Systems — Scheduling Drill",
			"FCFS, SJF, Round Robin and priority scheduling.",
			"Keep a pen and paper ready for Gantt charts. Calculators are allowed.",
			{ mode: "total", totalSeconds: 15 * 60 },
			"live",
			questions(
				"os",
				[
					["What is a context switch?", ["Saving and loading CPU state", "Switching users", "Paging to disk", "Changing kernel modules"], 0],
					["Three processes arrive at time 0 with burst times 6, 2 and 8 ms. Using non-preemptive SJF, what is the average waiting time?", ["3.33 ms", "4.67 ms", "5.33 ms", "6.00 ms"], 0],
					["Which scheduling algorithm can cause starvation of long processes?", ["FCFS", "Round Robin", "SJF", "FIFO"], 2],
					["In Round Robin, a very large time quantum makes the algorithm behave like…", ["SJF", "FCFS", "Priority", "Multilevel queue"], 1],
					["Aging is a technique used to prevent…", ["Deadlock", "Starvation", "Thrashing", "Fragmentation"], 1],
					["Which metric is the time from submission to completion?", ["Waiting time", "Response time", "Turnaround time", "Burst time"], 2],
				],
				0.5,
			),
		),
		quiz(
			"db-norm",
			"Databases — Normalisation Check",
			"1NF to BCNF with short worked examples.",
			"Read each schema carefully before answering.",
			{ mode: "total", totalSeconds: 20 * 60 },
			"upcoming",
			questions(
				"db",
				[
					["A relation with no repeating groups and atomic values is in at least…", ["1NF", "2NF", "3NF", "BCNF"], 0],
					["2NF removes which kind of dependency?", ["Transitive", "Partial", "Multivalued", "Join"], 1],
					["3NF removes which kind of dependency?", ["Partial", "Transitive", "Trivial", "Functional"], 1],
				],
				0,
			),
		),
		quiz(
			"ds-trees",
			"Data Structures — Trees & Heaps",
			"Traversals, BST operations and binary heaps.",
			"",
			{ mode: "perQuestion", secondsPerQuestion: 30 },
			"completed",
			questions(
				"ds",
				[
					["In-order traversal of a BST visits keys in…", ["Random order", "Ascending order", "Descending order", "Level order"], 1],
					["The height of a complete binary tree with n nodes is…", ["O(n)", "O(log n)", "O(n log n)", "O(1)"], 1],
					["Inserting into a binary heap of n elements costs…", ["O(1)", "O(log n)", "O(n)", "O(n log n)"], 1],
					["Which traversal uses a queue?", ["Pre-order", "In-order", "Post-order", "Level order"], 3],
				],
				0.5,
			),
		),
		quiz(
			"se-agile",
			"Software Engineering — Agile Basics",
			"Scrum roles, ceremonies and estimation.",
			"Answer quickly — each question has its own short timer.",
			{ mode: "perQuestion", secondsPerQuestion: 15, overrides: { "se-q3": 25 } },
			"lobby",
			questions(
				"se",
				[
					["Who owns the product backlog in Scrum?", ["Scrum Master", "Product Owner", "Development team", "Stakeholders"], 1],
					["What is the usual maximum length of a sprint?", ["1 week", "2 weeks", "1 month", "3 months"], 2],
					["A team completes 18, 22 and 20 points in three sprints. What is a reasonable velocity to plan with?", ["18", "20", "22", "60"], 1],
					["Which event inspects the increment with stakeholders?", ["Daily scrum", "Sprint review", "Retrospective", "Backlog refinement"], 1],
				],
				0,
			),
		),
		quiz(
			"algo-draft",
			"Algorithms — Greedy vs Dynamic Programming",
			"Coin change, knapsack and interval scheduling.",
			"",
			{ mode: "total", totalSeconds: 25 * 60 },
			"draft",
			questions(
				"algo",
				[
					["Which problem is solved optimally by a greedy choice?", ["0/1 knapsack", "Fractional knapsack", "Longest common subsequence", "Edit distance"], 1],
					["Memoisation is a form of…", ["Divide and conquer", "Dynamic programming", "Backtracking", "Branch and bound"], 1],
				],
				0,
			),
		),
	];
}

export const BOT_NAMES = [
	"Ayesha Rahman", "Tanvir Hasan", "Nusrat Jahan", "Imran Kabir", "Farhana Akter",
	"Rafiq Islam", "Sadia Noor", "Mahmud Hossain", "Lamia Chowdhury", "Arif Mollah",
	"Tasnim Sultana", "Shakib Ahmed", "Rumana Begum", "Kamal Uddin", "Priya Das",
	"Jahid Hasan", "Mitu Rani", "Sajid Karim", "Nabila Hoque", "Rashed Alam",
];

/** Sample "My Library" quizzes, with question types Fun Games can't play, to show skipping. */
export interface LibrarySeed {
	id: string;
	title: string;
	description: string;
	secondsPerQuestion: number;
	questions: Array<{
		text: string;
		typeLabel: string;
		supported: boolean;
		choices: string[];
		correct: number | number[];
		points: number;
	}>;
}

export const LIBRARY: LibrarySeed[] = [
	{
		id: "lib-net",
		title: "Networking — Week 3 practice",
		description: "IP addressing and transport protocols.",
		secondsPerQuestion: 20,
		questions: [
			{ text: "What is the default port for HTTPS?", typeLabel: "Single choice", supported: true, choices: ["80", "443", "22", "21"], correct: 1, points: 2 },
			{ text: "TCP is connection-oriented.", typeLabel: "True / false", supported: true, choices: ["True", "False"], correct: 0, points: 1 },
			{ text: "Which is a transport-layer protocol?", typeLabel: "Multiple choice", supported: true, choices: ["IP", "UDP", "ARP"], correct: [1], points: 2 },
			{ text: "Pick both link-layer protocols", typeLabel: "Multiple choice", supported: true, choices: ["Ethernet", "PPP", "HTTP"], correct: [0, 1], points: 2 },
			{ text: "Order the OSI layers from the bottom", typeLabel: "Sort answer", supported: false, choices: ["Physical", "Data link", "Network"], correct: [0, 1, 2], points: 3 },
			{ text: "How many bits are in an IPv4 address?", typeLabel: "Single choice", supported: true, choices: ["16", "32", "64", "128"], correct: 1, points: 2 },
		],
	},
	{
		id: "lib-gk",
		title: "General knowledge warm-up",
		description: "",
		secondsPerQuestion: 15,
		questions: [
			{ text: "Which planet is known as the Red Planet?", typeLabel: "Single choice", supported: true, choices: ["Venus", "Mars", "Jupiter"], correct: 1, points: 1 },
			{ text: "Water boils at 100 °C at sea level.", typeLabel: "True / false", supported: true, choices: ["True", "False"], correct: 0, points: 1 },
			{ text: "The capital of Bangladesh is ____.", typeLabel: "Fill in the blanks", supported: true, choices: ["Dhaka", "Chattogram", "Khulna"], correct: [0], points: 1 },
		],
	},
];
