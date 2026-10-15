
import { BillingOverviewType as BillingOverviewType, Subscription } from '@/types/billing';
import { Users, Presentation, HardDrive, Calendar, DollarSign, File } from 'lucide-react';
import Link from 'next/link';
import { useStorageUsage } from '@/features/file-library/hooks/useStorageUsage';
import { formatBytes } from '@/features/file-library/lib/format';

interface BillingOverviewProps {
	data: BillingOverviewType;
	subscription: Subscription;
}

const BillingOverview = ({ data, subscription }: BillingOverviewProps) => {
	const { usage: storage } = useStorageUsage();
	const formatDate = (date: Date) => {
		return date.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	};

	return (
		<div className="space-y-6">
			{/* Current Plan Card */}
			<div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
				<div className="flex justify-between items-start mb-4">
					<div>
						<h2 className="text-xl font-semibold text-gray-900">Current Plan</h2>
						<p className="text-gray-600">Active subscription details</p>
					</div>
					<span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">
						Active
					</span>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
					<div>
						<div className="flex items-center gap-3 mb-2">
							<div className="w-12 h-12 bg-orange-50 rounded-lg flex items-center justify-center">
								<DollarSign className="w-6 h-6 text-primary" />
							</div>
							<div>
								<p className="text-2xl font-bold text-gray-900">${subscription.price}/{subscription.interval}</p>
								<p className="text-gray-600">{subscription.plan} Plan</p>
							</div>
						</div>
					</div>

					<div>
						<div className="flex items-center gap-3 mb-2">
							<div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
								<Calendar className="w-6 h-6 text-purple-600" />
							</div>
							<div>
								<p className="text-lg font-semibold text-gray-900">
									{formatDate(data.nextBillingDate)}
								</p>
								<p className="text-gray-600">Next billing date</p>
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Usage Statistics */}
			<div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
				<h3 className="text-lg font-semibold text-gray-900 mb-4">Usage Statistics</h3>
				<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
					<div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
						<div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
							<Users className="w-5 h-5 text-green-600" />
						</div>
						<div>
							<p className="text-2xl font-bold text-gray-900">{data.usage.participants.toLocaleString()}</p>
							<p className="text-gray-600 text-sm">Participants</p>
						</div>
					</div>

					<div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
						<div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center">
							<Presentation className="w-5 h-5 text-primary" />
						</div>
						<div>
							<p className="text-2xl font-bold text-gray-900">{data.usage.presentations}</p>
							<p className="text-gray-600 text-sm">Presentations</p>
						</div>
					</div>

					<div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
						<div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
							<HardDrive className="w-5 h-5 text-orange-600" />
						</div>
						<div>
							<p className="text-2xl font-bold text-gray-900">
								{storage ? formatBytes(storage.used) : `${data.usage.storage} GB`}
							</p>
							<p className="text-gray-600 text-sm">
								{storage ? `of ${formatBytes(storage.limit)} · ` : ''}
								<Link href="/my-files" className="text-primary hover:underline">My Files</Link>
							</p>
						</div>
					</div>
				</div>
			</div>

			{/* Quick Actions */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				<button className="bg-white border border-gray-200 rounded-lg p-6 text-left hover:border-primary transition-colors">
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center">
							<DollarSign className="w-5 h-5 text-primary" />
						</div>
						<div>
							<h4 className="font-semibold text-gray-900">Upgrade Plan</h4>
							<p className="text-gray-600 text-sm">Get more features and higher limits</p>
						</div>
					</div>
				</button>

				<button className="bg-white border border-gray-200 rounded-lg p-6 text-left hover:border-primary transition-colors">
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
							<File className="w-5 h-5 text-green-600" />
						</div>
						<div>
							<h4 className="font-semibold text-gray-900">View Invoices</h4>
							<p className="text-gray-600 text-sm">Download past billing statements</p>
						</div>
					</div>
				</button>
			</div>
		</div>
	);
};

export default BillingOverview;