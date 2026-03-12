import Link from 'next/link';
import { apiGet } from '../../../lib/api';

type Lead = {
  id: string;
  fullName?: string;
  email?: string;
  phone?: string;
  source?: string;
  propertyInterest?: string;
  leadType?: string;
  temperature?: string;
  createdAt: string;
  tenant?: {
    id: string;
    name?: string;
  };
};

export default async function LeadDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const lead = await apiGet<Lead>(`/api/leads/${id}`);

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Link href="/leads">← Back to leads</Link>
      </div>

      <h1>{lead.fullName || 'Lead Detail'}</h1>

      <div style={{ marginTop: 16, lineHeight: 1.8 }}>
        <div><strong>ID:</strong> {lead.id}</div>
        <div><strong>Email:</strong> {lead.email || '-'}</div>
        <div><strong>Phone:</strong> {lead.phone || '-'}</div>
        <div><strong>Tenant:</strong> {lead.tenant?.name || lead.tenant?.id || '-'}</div>
        <div><strong>Source:</strong> {lead.source || '-'}</div>
        <div><strong>Property Interest:</strong> {lead.propertyInterest || '-'}</div>
        <div><strong>Lead Type:</strong> {lead.leadType || '-'}</div>
        <div><strong>Temperature:</strong> {lead.temperature || '-'}</div>
        <div><strong>Created:</strong> {new Date(lead.createdAt).toLocaleString()}</div>
      </div>
    </div>
  );
}
