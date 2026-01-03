import Link from 'next/link';

const metrics = [
  { label: 'Median first response (sms)', value: '38s' },
  { label: 'Emails sent last 7d', value: '124' },
  { label: 'Appointments booked', value: '22' },
  { label: 'Conversion by source (ads)', value: '8.2%' },
];

export default function Reporting() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reporting</h1>
          <p className="text-gray-600">Speed-to-lead and booking outcomes per tenant.</p>
        </div>
        <Link href="/" className="text-blue-600 hover:underline">
          Home
        </Link>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded border p-4 shadow-sm">
            <div className="text-sm text-gray-500">{metric.label}</div>
            <div className="text-2xl font-semibold">{metric.value}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
