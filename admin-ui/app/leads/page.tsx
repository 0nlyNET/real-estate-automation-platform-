import Link from 'next/link';
import { apiGet } from '../../lib/api';

type Lead = {
  id: string;
  fullName?: string;
  email?: string;
  phone?: string;
  createdAt: string;
  tenant?: {
    id: string;
    name?: string;
  };
};

type LeadListResponse = {
  items: Lead[];
  total: number;
  take: number;
  skip: number;
};

export default async function LeadsPage() {
  const data = await apiGet<LeadListResponse>('/api/leads');

  return (
    <div>
      <h1>Leads</h1>
      <p>Total leads: {data.total}</p>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">Name</th>
            <th align="left">Email</th>
            <th align="left">Tenant</th>
            <th align="left">Created</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((lead) => (
            <tr key={lead.id} style={{ borderTop: '1px solid #ddd' }}>
              <td>
                <Link href={`/leads/${lead.id}`}>
                  {lead.fullName || 'Unknown'}
                </Link>
              </td>
              <td>{lead.email || '-'}</td>
              <td>{lead.tenant?.name || lead.tenant?.id || '-'}</td>
              <td>{new Date(lead.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
