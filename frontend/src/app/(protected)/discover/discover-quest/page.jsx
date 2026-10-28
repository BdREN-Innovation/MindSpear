import DiscoverProductTab from "@/features/dashboard/discover/DiscoverProductTab";
import Title from "../../../../components/ui/Title";

const page = () => {
	return (
		<div>
			<Title as="h2">DISCOVER QUESTS</Title>
			<DiscoverProductTab product="quest" />
		</div>
	);
};

export default page;
