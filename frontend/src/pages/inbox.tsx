import Link from 'next/link';

const mockConversations = [
  {
    id: '1',
    lead: 'Alex Buyer',
    lastMessage: 'Can we tour 123 Main St?',
    status: 'Active sequence',
  },
  {
    id: '2',
    lead: 'Sandra Seller',
    lastMessage: 'What is my home worth?',
    status: 'Awaiting reply',
  },
];

export default function Inbox() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inbox</h1>
          <p className="text-gray-600">Two-way SMS + email with sequence context.</p>
        </div>
        <Link href="/" className="text-blue-600 hover:underline">
          Home
        </Link>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {mockConversations.map((convo) => (
          <div key={convo.id} className="rounded border p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{convo.lead}</h3>
              <span className="text-xs text-green-700">{convo.status}</span>
            </div>
            <p className="mt-2 text-sm text-gray-700">{convo.lastMessage}</p>
            <button className="mt-3 rounded bg-blue-600 px-3 py-1 text-white">Reply</button>
          </div>
        ))}
      </div>
      <section className="mt-8 rounded border p-4">
        <h2 className="font-semibold">AI Reply Suggestions</h2>
        <p className="text-sm text-gray-600">
          Suggestions are powered by pluggable providers. Implement `src/lib/ai/suggestions.ts`.
        </p>
      </section>
    </main>
  );
}
