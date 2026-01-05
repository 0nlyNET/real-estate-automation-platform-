import { LeadStage, LeadTemperature, LeadType } from '../lead.entity';

// Protected updates from agent UI (stage moves, notes, assignment, etc.)
export class UpdateLeadDto {
  fullName?: string;
  email?: string;
  phone?: string;
  source?: string;
  location?: string;
  propertyInterest?: string;
  leadType?: LeadType;
  temperature?: LeadTemperature;
  stage?: LeadStage;
  budgetRange?: string;
  estimatedPrice?: string;
  preferredAreas?: string[];
  notes?: string;
  assignedTo?: string;
  score?: number;
  nextFollowUpAt?: string;
}
