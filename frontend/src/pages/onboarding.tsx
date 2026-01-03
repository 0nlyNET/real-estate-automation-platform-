import Link from 'next/link';

const checklist = [
  'Create tenant & timezone',
  'Connect Twilio + SendGrid',
  'Connect Google Calendar',
  'Connect CRM (HubSpot or Follow Up Boss)',
  'Define routing rules',
  'Configure sequences',
  'Invite team members',
];

export default function Onboarding() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Onboarding checklist</h1>
          <p className="text-gray-600">Finish these steps to activate automation.</p>
        </div>
        <Link href="/" className="text-blue-600 hover:underline">
          Home
        </Link>
      </div>
      <ul className="mt-6 space-y-3">
        {checklist.map((item) => (
          <li key={item} className="flex items-center gap-3 rounded border p-3">
            <span className="h-4 w-4 rounded-full border" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
